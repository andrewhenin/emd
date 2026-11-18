import { expect, test } from "vitest";
import type { UiNode } from "../src/core/device/screen.ts";
import { typeUntilShown } from "../src/core/device/typing.ts";

// Issue 163: `type` confirms its text. A stub stands in for the simulator, on
// a fake clock: a pause moves it by its length, a read by `readMs` (cut at the
// time the read was given). `screen` says what a read shows, from the keys
// typed so far and the time.
const field = (value: string): UiNode[] => [
  { id: "smoke-input", texts: value ? [value] : [] },
];

type Screen = (typed: string[], ms: number) => UiNode[];

// Each read shows the next screen; the last one repeats. The first read is the
// one before typing.
const reads = (...screens: UiNode[][]): Screen => {
  let n = 0;
  return () => screens[Math.min(n++, screens.length - 1)] ?? [];
};

function stub(screen: Screen, readMs = 0) {
  const typed: string[] = [];
  // The seconds each step was given, in order.
  const given: number[] = [];
  let ms = 0;
  return {
    typed,
    given,
    at: () => ms,
    io: {
      type: async (text: string, seconds: number) => {
        given.push(seconds);
        typed.push(text);
      },
      read: async (seconds: number) => {
        given.push(seconds);
        ms += Math.min(readMs, seconds * 1000);
        return screen(typed, ms);
      },
      sleep: async (pause: number) => {
        ms += pause;
      },
      now: () => ms,
    },
  };
}

test("ok when the field goes from empty to the text", async () => {
  const { io, typed } = stub(reads(field(""), field("hello")));
  expect((await typeUntilShown(io, "hello")).verdict).toBe("shown");
  expect(typed).toEqual(["hello"]);
});

test("ok when the field shows its old text plus the text", async () => {
  const { io } = stub(reads(field("ab"), field("abhello")));
  expect((await typeUntilShown(io, "hello")).verdict).toBe("shown");
});

test("the text already on screen before typing is not a confirmation", async () => {
  const { io } = stub(reads(field("hello")));
  expect((await typeUntilShown(io, "hello")).verdict).toBe("failed");
});

test("doubled text fails and says what the field shows", async () => {
  const { io } = stub(reads(field(""), field("hellohello")));
  const result = await typeUntilShown(io, "hello");
  expect(result).toMatchObject({ verdict: "failed" });
  expect(result).toHaveProperty(
    "reason",
    expect.stringContaining("hellohello"),
  );
});

test("no key arrived, then all arrive late within half the limit: no retype", async () => {
  const { io, typed } = stub((_, ms) => field(ms < 15_000 ? "" : "hello"));
  const result = await typeUntilShown(io, "hello");
  expect(result.verdict).toBe("shown");
  expect(result.retyped).toBeUndefined();
  expect(typed).toEqual(["hello"]);
});

test("no key arrived for half the limit: types all of it once", async () => {
  const { io, typed } = stub((keys) => field(keys.length > 1 ? "hello" : ""));
  const result = await typeUntilShown(io, "hello");
  expect(result).toMatchObject({ verdict: "shown", retyped: "hello" });
  expect(result.seconds).toBeGreaterThanOrEqual(20);
  expect(typed).toEqual(["hello", "hello"]);
});

test("the late keys and the retype both arrive: failed, never ok", async () => {
  const { io, typed } = stub((keys, ms) =>
    field(keys.length > 1 && ms > 25_000 ? "hellohello" : ""),
  );
  const result = await typeUntilShown(io, "hello");
  expect(result).toMatchObject({ verdict: "failed", retyped: "hello" });
  expect(result).toHaveProperty(
    "reason",
    expect.stringContaining("hellohello"),
  );
  expect(typed).toEqual(["hello", "hello"]);
});

test("some keys arrive and stall for half the limit: types the rest once", async () => {
  const { io, typed } = stub((keys) =>
    field(["", "h"][keys.length] ?? "hello"),
  );
  const result = await typeUntilShown(io, "hello");
  expect(result).toMatchObject({ verdict: "shown", retyped: "ello" });
  expect(typed).toEqual(["hello", "ello"]);
});

test("fails with the screen text when nothing arrives, after one retype", async () => {
  const { io, typed, at } = stub(reads(field("")));
  const result = await typeUntilShown(io, "hello");
  expect(result).toMatchObject({ verdict: "failed", seconds: 40 });
  expect(result).toHaveProperty(
    "reason",
    expect.stringMatching(
      /after 40 s and one retype; the screen shows no text/,
    ),
  );
  expect(typed).toEqual(["hello", "hello"]);
  expect(at()).toBe(40_000);
});

test("the whole call stays within the limit, the read before typing included", async () => {
  // Each read takes 15 s: the 40 s run out during the third.
  const { io, given, at } = stub(reads(field("")), 15_000);
  const result = await typeUntilShown(io, "hello");
  expect(result.verdict).toBe("failed");
  expect(at()).toBe(40_000);
  // Before typing, type, read, read after a 1 s pause: each got the time left.
  expect(given).toEqual([40, 25, 25, 9]);
});

test("no step starts after the limit: a slow first read means no typing", async () => {
  const { io, typed, given } = stub(reads(field("")), 60_000);
  const result = await typeUntilShown(io, "hello");
  expect(result).toMatchObject({ verdict: "failed", seconds: 40 });
  expect(typed).toEqual([]);
  expect(given).toEqual([40]);
});

test("an unrelated node that ends with a prefix of the text is not partial input", async () => {
  const label: UiNode = { id: "title", texts: ["Say h"] };
  const { io, typed } = stub(reads([label, ...field("")]));
  const result = await typeUntilShown(io, "hello");
  expect(result.verdict).toBe("failed");
  // A partial match would retype only "ello".
  expect(typed).toEqual(["hello", "hello"]);
});

test("secure field: bullets that grew by the text length", async () => {
  const { io } = stub(reads(field(""), field("••••••")));
  expect((await typeUntilShown(io, "hunter")).verdict).toBe("secure");
});

test("secure field: too few bullets, or other bullet characters, fail", async () => {
  for (const shown of ["•••", "●●●●●●", "******"]) {
    const { io } = stub(reads(field(""), field(shown)));
    expect((await typeUntilShown(io, "hunter")).verdict).toBe("failed");
  }
});
