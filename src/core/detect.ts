import { resolve } from "node:path";
import type { StackId } from "./adapter.js";
import { probeStack } from "./probe.js";
import { loadAdapter } from "./registry.js";

export type DetectResult = {
  verdict: "detected" | "none";
  root: string;
  stack?: StackId;
};

export async function detect(dir = "."): Promise<DetectResult> {
  const root = resolve(dir);
  const id = await probeStack(root);
  if (!id) return { verdict: "none", root };
  const found = await (await loadAdapter(id)).detect(root);
  return found
    ? { verdict: "detected", root, stack: found.stack }
    : { verdict: "none", root };
}
