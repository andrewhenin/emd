import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { maestroBackend, parseMaestro } from "../src/core/device/maestro.ts";
import { hasElement } from "../src/core/device/screen.ts";
import { makeDir } from "./helpers.ts";

// The node shape is copied from a real `maestro hierarchy` run on the sandbox.
const node = (attributes: Record<string, string>, children: object[] = []) => ({
  attributes: {
    accessibilityText: "",
    title: "",
    value: "",
    text: "",
    hintText: "",
    "resource-id": "",
    bounds: "[0,0][0,0]",
    enabled: "true",
    ...attributes,
  },
  children,
});

const tree = JSON.stringify(
  node({}, [
    node({ accessibilityText: "emd-sandbox" }, [
      node({ accessibilityText: "Ready", "resource-id": "smoke-label" }, [
        node({ accessibilityText: "Ready" }),
      ]),
      node({ accessibilityText: "Tap me", "resource-id": "smoke-button" }),
    ]),
    node({
      text: "No signal",
      accessibilityText: "Cellular",
      value: "No signal",
    }),
  ]),
);

test("flattens the tree to the nodes that have an id or some text", () => {
  expect(parseMaestro(tree)).toEqual([
    { id: "", texts: ["emd-sandbox"] },
    { id: "smoke-label", texts: ["Ready"] },
    { id: "", texts: ["Ready"] },
    { id: "smoke-button", texts: ["Tap me"] },
    { id: "", texts: ["No signal", "Cellular"] },
  ]);
});

test("ignores anything before the JSON, such as a banner", () => {
  expect(parseMaestro(`Starting driver...\n${tree}`)).toHaveLength(5);
});

test("a tree printed before a bad exit is the answer, and the driver gets its startup timeout", async () => {
  // A stand-in for maestro: it needs the driver timeout, prints a tree, then
  // exits 1 the way Maestro can while it shuts its driver down.
  const bin = join(makeDir(), "maestro");
  writeFileSync(
    bin,
    `#!/bin/sh
[ "$MAESTRO_DRIVER_STARTUP_TIMEOUT" = 300000 ] || { echo "no driver timeout" >&2; exit 2; }
cat <<'TREE'
${tree}
TREE
exit 1
`,
  );
  chmodSync(bin, 0o755);
  const before = process.env.MAESTRO_DRIVER_STARTUP_TIMEOUT;
  delete process.env.MAESTRO_DRIVER_STARTUP_TIMEOUT;
  try {
    expect(await maestroBackend.readScreen("udid", bin)).toEqual(
      parseMaestro(tree),
    );
  } finally {
    if (before !== undefined)
      process.env.MAESTRO_DRIVER_STARTUP_TIMEOUT = before;
  }
});

test("a tree that is not JSON is an error, not an empty screen", () => {
  expect(() => parseMaestro("no tree here")).toThrow();
});

test("finds an element by testID, by text, or by both on one node", () => {
  const nodes = parseMaestro(tree);
  expect(hasElement(nodes, { id: "smoke-button" })).toBe(true);
  expect(hasElement(nodes, { text: "Tap me" })).toBe(true);
  expect(hasElement(nodes, { id: "smoke-label", text: "Ready" })).toBe(true);
  expect(hasElement(nodes, { text: "Cellular" })).toBe(true);
});

test("does not find what is not there", () => {
  const nodes = parseMaestro(tree);
  expect(hasElement(nodes, { id: "other" })).toBe(false);
  expect(hasElement(nodes, { text: "Tapped" })).toBe(false);
  // Both must hold on the same node: the button is not the label.
  expect(hasElement(nodes, { id: "smoke-button", text: "Ready" })).toBe(false);
  // Exact, not a substring.
  expect(hasElement(nodes, { text: "Tap" })).toBe(false);
  expect(hasElement([], { id: "smoke-button" })).toBe(false);
});
