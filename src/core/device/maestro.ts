import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool } from "../tool.js";
import type { App, DeviceBackend } from "./backend.js";
import type { UiNode } from "./screen.js";
import { maestroFlow, type Step } from "./step.js";

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

const driverEnv = () => ({
  MAESTRO_DRIVER_STARTUP_TIMEOUT:
    process.env.MAESTRO_DRIVER_STARTUP_TIMEOUT ?? "300000",
});

// The accessibility tree of what is on the simulator's screen now. Maestro
// starts and stops its XCUITest driver on every call, which takes about 20 s,
// and about 50 s for the first call after an app launch.
async function readScreen(device: string, bin: string): Promise<UiNode[]> {
  try {
    const { stdout } = await runTool(
      "maestro hierarchy",
      bin,
      ["--device", device, "hierarchy"],
      240,
      { env: driverEnv() },
    );
    return parseMaestro(stdout);
  } catch (error) {
    // Maestro can print the tree and still exit badly while shutting its
    // driver down; a tree on stdout is the answer either way.
    const { stdout } = error as { stdout?: string };
    if (stdout) {
      try {
        return parseMaestro(stdout);
      } catch {}
    }
    throw error;
  }
}

// Runs the step as a one-step flow, the same form as the flow EMD saves.
// Maestro waits for a tap's element itself.
async function act(step: Step, { device, appId }: App, bin: string) {
  const dir = mkdtempSync(join(tmpdir(), "emd-step-"));
  const flow = join(dir, "step.yaml");
  writeFileSync(flow, maestroFlow(appId, [step]));
  try {
    await runTool(
      "maestro test",
      bin,
      ["--device", device, "test", flow],
      240,
      {
        env: driverEnv(),
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const maestroBackend: DeviceBackend = {
  id: "maestro",
  readScreen,
  act,
};
