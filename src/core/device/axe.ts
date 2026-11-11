import { join } from "node:path";
import { homeDir } from "../state.js";
import { runTool } from "../tool.js";
import type { DeviceBackend, Target, Where } from "./backend.js";
import type { UiNode } from "./screen.js";

// The AXe release `setup` installs: the same pin as e2e.yml (a test checks
// they match). Its release archive, not Homebrew: Homebrew floats the version
// and refused AXe on older Xcode (decision 0005).
export const axePin = {
  version: "1.8.0",
  sha256: "7b76340b72e90d0f211bc7c4636f15009076eff07acef2f2b632b175debd8834",
  url: "https://github.com/cameroncooke/AXe/releases/download/v1.8.0/AXe-macOS-v1.8.0-universal.tar.gz",
};

// Where `setup` puts it, with its frameworks: a user folder, so no admin rights.
export const axeDir = (): string =>
  join(homeDir(), "tools", `axe-${axePin.version}`);

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

// One AXe command on the simulator. AXe needs no driver, so a gesture takes
// about a second (experiments/tap-tools.md).
const run = async (
  bin: string,
  { device }: Where,
  command: string,
  args: string[],
) => {
  await runTool(
    `axe ${command}`,
    bin,
    [command, "--udid", device, ...args],
    60,
  );
};

// By testID (AXUniqueId) or label (AXLabel), AXe waits up to 5 s for the
// element to appear, then taps its activation point.
const targetArgs = (target: Target): string[] =>
  "id" in target
    ? ["--id", target.id, "--wait-timeout", "5"]
    : "text" in target
      ? ["--label", target.text, "--wait-timeout", "5"]
      : ["-x", String(target.x), "-y", String(target.y)];

export const axeBackend: DeviceBackend = {
  id: "axe",
  readScreen,
  tap: (where, bin, target) => run(bin, where, "tap", targetArgs(target)),
  // `--` so text that starts with a dash is typed, not read as an option.
  type: (where, bin, text) => run(bin, where, "type", ["--", text]),
  // AXe's preset scrolls 200 points through the screen's centre, the finger
  // moving the way named.
  swipe: (where, bin, direction) =>
    run(bin, where, "gesture", [`scroll-${direction}`]),
};
