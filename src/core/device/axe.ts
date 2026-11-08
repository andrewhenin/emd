import { runTool } from "../tool.js";
import { type App, type DeviceBackend, DidNotAct } from "./backend.js";
import type { UiNode } from "./screen.js";
import { type Step, targetOf } from "./step.js";

type RawNode = Record<string, unknown> & { children?: unknown };

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

// The tree from `axe describe-ui`, flattened to the nodes worth matching. AXe
// names the accessibility identifier (the testID) AXUniqueId, and the visible
// text or label AXLabel, with AXValue and title as other places for text. Empty
// fields are null.
export function parseAxe(output: string): UiNode[] {
  const start = output.search(/[[{]/);
  const root = JSON.parse(start >= 0 ? output.slice(start) : output) as
    | RawNode
    | RawNode[];
  const nodes: UiNode[] = [];
  const walk = (node: RawNode) => {
    const id = str(node.AXUniqueId);
    const texts = [
      ...new Set(
        [str(node.AXLabel), str(node.AXValue), str(node.title)].filter(Boolean),
      ),
    ];
    if (id !== "" || texts.length > 0) nodes.push({ id, texts });
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child as RawNode);
    }
  };
  for (const top of Array.isArray(root) ? root : [root]) walk(top);
  return nodes;
}

// The accessibility tree of what is on the simulator's screen now. AXe talks to
// the simulator directly, with no driver to start.
async function readScreen(device: string, bin: string): Promise<UiNode[]> {
  const { stdout } = await runTool(
    "axe describe-ui",
    bin,
    ["describe-ui", "--udid", device],
    120,
  );
  return parseAxe(stdout);
}

// AXe prints this line, then exits, when no element matches; it has not
// tapped. Source: Sources/AXe/Commands/Tap.swift and
// Utilities/AccessibilityTargetResolver.swift, AXe v1.5.0 to v1.8.0.
const notFound =
  /Warning: No accessibility element matched .* No tap performed\.$/m;

// AXe checks the whole text before it sends a key, and exits with this when a
// character is not on a US keyboard; it has not typed. Source:
// Sources/AXe/Commands/Type.swift and Utilities/TextToHIDEvents.swift, AXe
// v1.5.0 to v1.8.0.
const cannotType = /Error: No keycode found for character: /;

// Runs AXe; an error that matches `proof` means AXe did not act.
async function axe(name: string, bin: string, args: string[], proof?: RegExp) {
  try {
    await runTool(`axe ${name}`, bin, [name, ...args], 60);
  } catch (error) {
    if (proof?.test(String(error))) {
      throw new DidNotAct((error as Error).message);
    }
    throw error;
  }
}

async function act(step: Step, { device }: App, bin: string) {
  if (step === "scroll") {
    // A 200 pt swipe up from the center of an assumed 390x844 screen, in
    // 0.5 s (Sources/AXe/Commands/Gesture.swift). Maestro's scroll swipes from
    // 50% to 10% of the screen height, so a Maestro replay of the saved flow
    // can scroll further than AXe did. No AXe error proves it did not swipe.
    return axe("gesture", bin, ["scroll-up", "--udid", device]);
  }
  if ("inputText" in step) {
    // Types into the field that has focus. `--` keeps a text that starts with
    // "-" from being read as an option.
    return axe(
      "type",
      bin,
      ["--udid", device, "--", step.inputText],
      cannotType,
    );
  }
  // Taps the one element with this testID (AXUniqueId) or exact label
  // (AXLabel), waiting up to 10 s for it to appear (--wait-timeout needs
  // AXe 1.6.0).
  const target = targetOf(step);
  const selector =
    "id" in target ? ["--id", target.id] : ["--label", target.text];
  return axe(
    "tap",
    bin,
    [...selector, "--wait-timeout", "10", "--udid", device],
    notFound,
  );
}

export const axeBackend: DeviceBackend = { id: "axe", readScreen, act };
