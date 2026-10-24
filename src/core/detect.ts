import { resolve } from "node:path";
import { probeStack } from "./probe.js";
import { inspectProject } from "./project.js";
import { loadAdapter } from "./registry.js";
import type { DetectResult } from "./result.js";

export async function detect(dir = "."): Promise<DetectResult> {
  const root = resolve(dir);
  const id = await probeStack(root);
  if (!id) return { verdict: "none", root };
  const { maestroFlows, notes, ...project } = await inspectProject(root);
  const found = await (await loadAdapter(id)).detect(root, project);
  if (!found) return { verdict: "none", root };
  return {
    verdict: "detected",
    root,
    ...found,
    packageManager: project.packageManager,
    maestroFlows,
    notes,
  };
}
