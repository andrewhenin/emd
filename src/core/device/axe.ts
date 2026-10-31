import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeviceBackend } from "./backend.js";
import type { UiNode } from "./screen.js";

const run = promisify(execFile);

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
  const { stdout } = await run(bin, ["describe-ui", "--udid", device], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  return parseAxe(stdout);
}

export const axeBackend: DeviceBackend = { id: "axe", readScreen };
