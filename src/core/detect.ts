import { resolve } from "node:path";
import { probeStack } from "./probe.js";
import { inspectProject } from "./project.js";
import { loadAdapter } from "./registry.js";
import type { DetectResult } from "./result.js";
import { workspaceApps } from "./workspace.js";

export async function detect(dir = "."): Promise<DetectResult> {
  const root = resolve(dir);
  const id = await probeStack(root);
  if (!id) {
    const apps = await workspaceApps(root);
    return apps.length > 0
      ? { verdict: "none", root, apps }
      : { verdict: "none", root };
  }
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
