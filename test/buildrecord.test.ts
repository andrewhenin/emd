import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  builtApp,
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
  [undefined, now, now, true],
])("why build: %s", (reason, record, current, installed) => {
  expect(whyBuild(record, current, installed)).toBe(reason);
});

test("the built app is the only Debug simulator .app; none otherwise", () => {
  const dir = makeDir();
  expect(builtApp(dir)).toBeUndefined();
  const products = join(dir, "Build/Products");
  const debug = join(products, "Debug-iphonesimulator");
  mkdirSync(join(products, "Release-iphonesimulator/other.app"), {
    recursive: true,
  });
  expect(builtApp(dir)).toBeUndefined();
  mkdirSync(join(debug, "one.app"), { recursive: true });
  expect(builtApp(dir)).toBe(join(debug, "one.app"));
  mkdirSync(join(debug, "two.app"));
  expect(builtApp(dir)).toBeUndefined();
});
