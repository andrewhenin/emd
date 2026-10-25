// What every backend returns for a screen read: the nodes of the accessibility
// tree that have something to match on, in one shape.

// One node: its testID (empty when it has none) and its visible text or labels.
export type UiNode = { id: string; texts: string[] };

// An element to find: by testID, by visible text or label, or both on one node.
export type ElementSpec = { id?: string; text?: string };

// Found when one node has the id and the text asked for. Exact matches.
export function hasElement(nodes: UiNode[], spec: ElementSpec): boolean {
  return nodes.some(
    (node) =>
      (spec.id === undefined || node.id === spec.id) &&
      (spec.text === undefined || node.texts.includes(spec.text)),
  );
}
