import type { StackAdapter, StackId } from "./adapter.js";

// The only place that may import an adapter, and only dynamically (decision 0001).
const loaders: Record<StackId, () => Promise<{ default: StackAdapter }>> = {
  expo: () => import("../adapters/expo/index.js"),
};

const loaded = new Set<StackId>();

export async function loadAdapter(id: StackId): Promise<StackAdapter> {
  const adapter = (await loaders[id]()).default;
  loaded.add(id);
  return adapter;
}

export function loadedAdapters(): StackId[] {
  return [...loaded];
}
