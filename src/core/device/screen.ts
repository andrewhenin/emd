// What every backend returns for a screen read: the nodes of the accessibility
// tree that have something to match on, in one shape.

// One node: its testID (empty when it has none) and its visible text or labels.
export type UiNode = { id: string; texts: string[] };

// An element to find: by testID, by visible text or label, or both on one node.
export type ElementSpec = { id?: string; text?: string };

// Found when one node has the id and the text asked for. The id matches
// exactly; the text matches whole, ignoring case (decision 0013), so styled
// text such as "GET STARTED" is found from the source's "Get started".
export function hasElement(nodes: UiNode[], spec: ElementSpec): boolean {
  const text = spec.text === undefined ? undefined : fold(spec.text);
  return nodes.some(
    (node) =>
      (spec.id === undefined || node.id === spec.id) &&
      (text === undefined || node.texts.some((t) => fold(t) === text)),
  );
}

// Upper case, as styled text shows it: "Straße" becomes "STRASSE".
const fold = (text: string) => text.toUpperCase();
