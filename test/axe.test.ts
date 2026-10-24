import { expect, test } from "vitest";
import { parseAxe } from "../src/core/device/axe.ts";
import { hasElement } from "../src/core/device/screen.ts";

// The shape is copied from a real `axe describe-ui` run on the sandbox: an
// array of application objects, nodes with AXLabel, AXUniqueId, AXValue and
// title, null where a field is empty.
const node = (fields: Record<string, unknown>, children: object[] = []) => ({
  type: "Group",
  role: "AXGroup",
  title: null,
  AXLabel: null,
  AXValue: null,
  AXUniqueId: null,
  enabled: true,
  children,
  ...fields,
});

const tree = JSON.stringify([
  node({ type: "Application", AXLabel: "emd-sandbox" }, [
    node({}, [
      node(
        { type: "StaticText", AXLabel: "Ready", AXUniqueId: "smoke-label" },
        [node({ type: "StaticText", AXLabel: "Ready" })],
      ),
      node({ type: "Button", AXLabel: "Tap me", AXUniqueId: "smoke-button" }),
      node({ type: "Slider", AXValue: "50%", title: "Volume" }),
    ]),
  ]),
]);

test("flattens the tree to the nodes that have an id or some text", () => {
  expect(parseAxe(tree)).toEqual([
    { id: "", texts: ["emd-sandbox"] },
    { id: "smoke-label", texts: ["Ready"] },
    { id: "", texts: ["Ready"] },
    { id: "smoke-button", texts: ["Tap me"] },
    { id: "", texts: ["50%", "Volume"] },
  ]);
});

test("treats null fields as empty and ignores nodes with nothing to match", () => {
  const nodes = parseAxe(JSON.stringify([node({}, [node({})])]));
  expect(nodes).toEqual([]);
});

test("accepts a single object as well as an array, and a banner before it", () => {
  const one = JSON.stringify(node({ AXLabel: "Solo" }));
  expect(parseAxe(one)).toEqual([{ id: "", texts: ["Solo"] }]);
  expect(parseAxe(`Describing UI...\n${tree}`)).toHaveLength(5);
});

test("a result that is not JSON is an error, not an empty screen", () => {
  expect(() => parseAxe("no tree here")).toThrow();
});

test("finds the same elements the Maestro tree does", () => {
  const nodes = parseAxe(tree);
  expect(hasElement(nodes, { id: "smoke-button" })).toBe(true);
  expect(hasElement(nodes, { text: "Tap me" })).toBe(true);
  expect(hasElement(nodes, { id: "smoke-label", text: "Ready" })).toBe(true);
  expect(hasElement(nodes, { id: "smoke-button", text: "Ready" })).toBe(false);
  expect(hasElement(nodes, { text: "Tapped" })).toBe(false);
});
