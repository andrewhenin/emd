import { expect, test } from "vitest";
import type { UiNode } from "../src/core/device/screen.ts";
import { typeUntilShown } from "../src/core/device/typing.ts";

// Issue 163: `type` confirms its text. A stub stands in for the simulator;
// `screens` is what each read returns (the first read is before typing), the
// last one repeating.
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

test("ok when the field goes from empty to the text", async () => {
  const { io, typed } = stub([field(""), field("hello")]);
  expect((await typeUntilShown(io, "hello")).verdict).toBe("shown");
  expect(typed).toEqual(["hello"]);
});

test("ok when the field shows its old text plus the text", async () => {
  const { io } = stub([field("ab"), field("abhello")]);
  expect((await typeUntilShown(io, "hello")).verdict).toBe("shown");
});

test("the text already on screen before typing is not a confirmation", async () => {
  const { io } = stub([field("hello")]);
  const result = await typeUntilShown(io, "hello", 0.05, 10);
  expect(result.verdict).toBe("failed");
});

test("doubled text fails and says what the field shows", async () => {
  const { io } = stub([field(""), field("hellohello")]);
  const result = await typeUntilShown(io, "hello");
  expect(result).toMatchObject({ verdict: "failed" });
  expect(result).toHaveProperty(
    "reason",
    expect.stringContaining("hellohello"),
  );
});

test("no key arrived, then all arrive late: no retype", async () => {
  const { io, typed } = stub([
    field(""),
    field(""),
    field(""),
    field(""),
    field("hello"),
  ]);
  const result = await typeUntilShown(io, "hello");
  expect(result.verdict).toBe("shown");
  expect(result.retyped).toBeUndefined();
  expect(typed).toEqual(["hello"]);
});

test("some keys arrive and stall: types the rest once", async () => {
  const { io, typed } = stub([
    field(""),
    field("h"),
    field("h"),
    field("hello"),
  ]);
  const result = await typeUntilShown(io, "hello");
  expect(result).toMatchObject({ verdict: "shown", retyped: "ello" });
  expect(typed).toEqual(["hello", "ello"]);
});

test("fails with the screen text when nothing arrives", async () => {
  const { io, typed } = stub([field("")]);
  const result = await typeUntilShown(io, "hello", 0.05, 10);
  expect(result).toMatchObject({ verdict: "failed" });
  expect(result).toHaveProperty("reason", expect.stringContaining("no text"));
  expect(typed).toEqual(["hello"]);
});

test("an unrelated node that ends with a prefix of the text is ignored", async () => {
  const label: UiNode = { id: "title", texts: ["Say h"] };
  const { io, typed } = stub([[label, ...field("")]]);
  const result = await typeUntilShown(io, "hello", 0.05, 10);
  expect(result.verdict).toBe("failed");
  expect(result.retyped).toBeUndefined();
  expect(typed).toEqual(["hello"]);
});

test("secure field: bullets that grew by the text length", async () => {
  const { io } = stub([field(""), field("••••••")]);
  expect((await typeUntilShown(io, "hunter")).verdict).toBe("secure");
});

test("secure field: too few bullets, or other bullet characters, fail", async () => {
  for (const shown of ["•••", "●●●●●●", "******"]) {
    const { io } = stub([field(""), field(shown)]);
    expect((await typeUntilShown(io, "hunter", 0.05, 10)).verdict).toBe(
      "failed",
    );
  }
});
