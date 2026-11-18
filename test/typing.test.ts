import { expect, test } from "vitest";
import type { UiNode } from "../src/core/device/screen.ts";
import { typeUntilShown } from "../src/core/device/typing.ts";

// Issue 163: `type` confirms its text. A stub stands in for the simulator;
// `screens` is what each read returns, the last one repeating.
const field = (value: string): UiNode[] => [
  { id: "smoke-input", texts: value ? [value] : [] },
];

function stub(screens: UiNode[][]) {
  const typed: string[] = [];
  let reads = 0;
  return {
    typed,
    io: {
      type: async (text: string) => void typed.push(text),
      read: async () => screens[Math.min(reads++, screens.length - 1)] ?? [],
      sleep: async () => {},
    },
  };
}

test("returns shown when the text is on screen at the first read", async () => {
  const { io, typed } = stub([field("hello")]);
  expect(await typeUntilShown(io, "hello")).toMatchObject({
    verdict: "shown",
  });
  expect(typed).toEqual(["hello"]);
});

test("waits for late keys and does not type again", async () => {
  const { io, typed } = stub([
    field(""),
    field("h"),
    field("hel"),
    field("hello"),
  ]);
  expect((await typeUntilShown(io, "hello")).verdict).toBe("shown");
  expect(typed).toEqual(["hello"]);
});

test("types the missing rest once when the part stalls", async () => {
  const { io, typed } = stub([field("h"), field("h"), field("hello")]);
  const result = await typeUntilShown(io, "hello");
  expect(result).toMatchObject({ verdict: "shown", retyped: "ello" });
  expect(typed).toEqual(["hello", "ello"]);
});

test("fails and says what the screen shows when nothing arrives", async () => {
  const { io, typed } = stub([field("")]);
  const result = await typeUntilShown(io, "hello", 0.05, 10);
  expect(result.verdict).toBe("missing");
  expect(result.screen).toBe("the screen shows no text");
  expect(typed).toEqual(["hello"]);
});

test("retypes only once, then fails with the partial text on screen", async () => {
  const { io, typed } = stub([field("h")]);
  const result = await typeUntilShown(io, "hello", 0.05, 10);
  expect(result).toMatchObject({ verdict: "missing", retyped: "ello" });
  expect(result.screen).toBe('the screen shows "h"');
  expect(typed).toEqual(["hello", "ello"]);
});

test("accepts bullets as long as the text, as a secure field", async () => {
  const { io } = stub([field("••••••")]);
  expect((await typeUntilShown(io, "hunter")).verdict).toBe("secure");
});

test("too few bullets are not a confirmation", async () => {
  const { io } = stub([field("•••")]);
  expect((await typeUntilShown(io, "hunter", 0.05, 10)).verdict).toBe(
    "missing",
  );
});
