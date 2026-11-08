import { runTool } from "../tool.js";
import { type App, type DeviceBackend, DidNotAct } from "./backend.js";
import type { UiNode } from "./screen.js";
import type { Target } from "./step.js";

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

// Taps the one element with this testID (AXUniqueId) or exact label (AXLabel)
// at once: the step has already waited for it to be on screen.
async function tap(target: Target, { device }: App, bin: string) {
  const selector =
    "id" in target ? ["--id", target.id] : ["--label", target.text];
  try {
    await runTool("axe tap", bin, ["tap", ...selector, "--udid", device], 60);
  } catch (error) {
    if (notFound.test(String(error))) {
      throw new DidNotAct((error as Error).message);
    }
    throw error;
  }
}

export const axeBackend: DeviceBackend = { id: "axe", readScreen, tap };
