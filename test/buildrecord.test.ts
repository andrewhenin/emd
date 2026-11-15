import { expect, test } from "vitest";
import expoAdapter from "../src/adapters/expo/index.ts";
import {
  readBuildRecord,
  whyBuild,
  writeBuildRecord,
} from "../src/core/buildrecord.ts";
import { makeDir } from "./helpers.ts";

const now = { fingerprint: "abc", port: 8081 };

test("a record is read back from the DerivedData folder; a missing or broken one is none", () => {
  const dir = makeDir();
  expect(readBuildRecord(dir)).toBeUndefined();
  writeBuildRecord(dir, now);
  expect(readBuildRecord(dir)).toEqual(now);
  writeBuildRecord(dir, { fingerprint: "abc" } as never);
  expect(readBuildRecord(dir)).toBeUndefined();
});

test.each([
  ["no earlier build", undefined, now, true],
  ["fingerprint changed", { ...now, fingerprint: "old" }, now, true],
  ["port changed", { ...now, port: 8082 }, now, true],
  ["app not installed", now, now, false],
])("builds with the reason: %s", (reason, record, current, installed) => {
  expect(whyBuild(record, current, installed)).toBe(reason);
});

test("reuses only when the fingerprint and port match and the app is installed", () => {
  expect(whyBuild(now, now, true)).toBeUndefined();
});

test("the Expo fingerprint fails, not guesses, without the project's Expo", async () => {
  await expect(expoAdapter.fingerprint(makeDir(), "ios")).rejects.toThrow();
});
