import { beforeEach, expect, test, vi } from "vitest";
import { expoProject, makeDir } from "./helpers.ts";

beforeEach(() => vi.resetModules());

const loadCore = () => import("../src/core/index.ts");

test("detects an Expo project", async () => {
  const { detect } = await loadCore();
  const dir = expoProject();
  expect(await detect(dir)).toEqual({
    verdict: "detected",
    root: dir,
    stack: "expo",
  });
});

test("reports none for a directory that is not a mobile project", async () => {
  const { detect } = await loadCore();
  const dir = makeDir();
  expect(await detect(dir)).toEqual({ verdict: "none", root: dir });
  expect(await detect(`${dir}/missing`)).toMatchObject({ verdict: "none" });
});

test("loads no adapter until a stack is detected", async () => {
  const { detect, loadedAdapters } = await loadCore();
  expect(loadedAdapters()).toEqual([]);
  await detect(makeDir());
  expect(loadedAdapters()).toEqual([]);
  await detect(expoProject());
  expect(loadedAdapters()).toEqual(["expo"]);
});
