import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DeviceBackend } from "./backend.js";
import type { UiNode } from "./screen.js";

const run = promisify(execFile);

type RawNode = { attributes?: Record<string, unknown>; children?: RawNode[] };

// Where Maestro puts a node's visible text or label.
const textKeys = ["text", "accessibilityText", "value", "title"];

// The tree from `maestro hierarchy`, flattened to the nodes worth matching.
export function parseMaestro(output: string): UiNode[] {
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

const candidates = ["maestro", join(homedir(), ".maestro", "bin", "maestro")];

// The accessibility tree of what is on the simulator's screen now. Maestro
// starts and stops its XCUITest driver on every call, which takes about 20 s,
// and about 50 s for the first call after an app launch.
async function readScreen(device: string): Promise<UiNode[]> {
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
      return parseMaestro(stdout);
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stdout?: string };
      if (failure.code === "ENOENT") continue;
      // Maestro can print the tree and still exit badly while shutting its
      // driver down; a tree on stdout is the answer either way.
      if (failure.stdout) {
        try {
          return parseMaestro(failure.stdout);
        } catch {}
      }
      throw error;
    }
  }
  throw new Error(
    "Maestro is not installed (looked on PATH and in ~/.maestro/bin).",
  );
}

export const maestroBackend: DeviceBackend = { id: "maestro", readScreen };
