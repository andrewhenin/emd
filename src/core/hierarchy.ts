import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// One node of the accessibility tree that has something to match on.
export type UiNode = { id: string; texts: string[] };

// An element to find: by testID, by visible text or label, or both on one node.
export type ElementSpec = { id?: string; text?: string };

type RawNode = { attributes?: Record<string, unknown>; children?: RawNode[] };

// Where Maestro puts a node's visible text or label.
const textKeys = ["text", "accessibilityText", "value", "title"];

// The tree from `maestro hierarchy`, flattened to the nodes worth matching.
export function parseHierarchy(output: string): UiNode[] {
  const start = output.indexOf("{");
  const root = JSON.parse(start >= 0 ? output.slice(start) : output) as RawNode;
  const nodes: UiNode[] = [];
  const walk = (node: RawNode) => {
    const attributes = node.attributes ?? {};
    const id = attributes["resource-id"];
    const texts = [
      ...new Set(
        textKeys
          .map((key) => attributes[key])
          .filter(
            (value): value is string =>
              typeof value === "string" && value !== "",
          ),
      ),
    ];
    if (typeof id === "string" && id !== "") nodes.push({ id, texts });
    else if (texts.length > 0) nodes.push({ id: "", texts });
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return nodes;
}

// Found when one node has the id and the text asked for. Exact matches.
export function hasElement(nodes: UiNode[], spec: ElementSpec): boolean {
  return nodes.some(
    (node) =>
      (spec.id === undefined || node.id === spec.id) &&
      (spec.text === undefined || node.texts.includes(spec.text)),
  );
}

const candidates = ["maestro", join(homedir(), ".maestro", "bin", "maestro")];

// The accessibility tree of what is on the simulator's screen now. Starting
// Maestro's driver can take a while on a cold or busy machine.
export async function readHierarchy(device: string): Promise<UiNode[]> {
  const env = {
    ...process.env,
    MAESTRO_DRIVER_STARTUP_TIMEOUT:
      process.env.MAESTRO_DRIVER_STARTUP_TIMEOUT ?? "300000",
  };
  for (const bin of candidates) {
    try {
      const { stdout } = await run(bin, ["--device", device, "hierarchy"], {
        env,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 240_000,
      });
      return parseHierarchy(stdout);
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stdout?: string };
      if (failure.code === "ENOENT") continue;
      // Maestro can print the tree and still exit badly while shutting its
      // driver down; a tree on stdout is the answer either way.
      if (failure.stdout) {
        try {
          return parseHierarchy(failure.stdout);
        } catch {}
      }
      throw error;
    }
  }
  throw new Error(
    "Maestro is not installed (looked on PATH and in ~/.maestro/bin).",
  );
}
