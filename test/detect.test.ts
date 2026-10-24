import { beforeEach, expect, test, vi } from "vitest";
import { appJson, expoProject, makeDir } from "./helpers.ts";

beforeEach(() => vi.resetModules());

const loadCore = () => import("../src/core/index.ts");

const sandbox = appJson({
  ios: { bundleIdentifier: "com.emd.sandbox" },
  android: { package: "com.emd.sandbox" },
});

test("detects an Expo project with what launching it needs", async () => {
  const { detect } = await loadCore();
  const dir = expoProject({ "app.json": sandbox });
  expect(await detect(dir)).toEqual({
    verdict: "detected",
    root: dir,
    stack: "expo",
    platforms: ["ios", "android"],
    appIds: { ios: "com.emd.sandbox", android: "com.emd.sandbox" },
    commands: {
      run: { ios: "npx expo run:ios", android: "npx expo run:android" },
      server: "npx expo start",
    },
    packageManager: "npm",
    maestroFlows: [],
    notes: [],
  });
});

test("platforms come from app.json when it declares them", async () => {
  const { detect } = await loadCore();
  const dir = expoProject({
    "app.json": appJson({
      platforms: ["ios", "web"],
      ios: { bundleIdentifier: "com.emd.sandbox" },
      android: { package: "com.emd.sandbox" },
    }),
  });
  const result = await detect(dir);
  expect(result.platforms).toEqual(["ios"]);
  expect(result.appIds).toEqual({ ios: "com.emd.sandbox" });
  expect(result.commands?.run).toEqual({ ios: "npx expo run:ios" });
});

test.each([
  ["no app.json", {}],
  ["dynamic config only", { "app.config.js": "module.exports = {};" }],
  ["an app.json that is not JSON", { "app.json": "{ nope" }],
  ["an app.json without app IDs", { "app.json": appJson({ name: "x" }) }],
])("is still detected with %s, without app IDs", async (_name, files) => {
  const { detect } = await loadCore();
  const result = await detect(expoProject(files));
  expect(result).toMatchObject({
    verdict: "detected",
    stack: "expo",
    platforms: ["ios", "android"],
    appIds: {},
  });
});

test.each([
  [
    "a package-lock.json",
    { "package-lock.json": "{}" },
    "npm",
    "npx expo start",
  ],
  ["a yarn.lock", { "yarn.lock": "" }, "yarn", "yarn expo start"],
  [
    "a pnpm-lock.yaml",
    { "pnpm-lock.yaml": "" },
    "pnpm",
    "pnpm exec expo start",
  ],
  ["a bun.lock", { "bun.lock": "" }, "bun", "bunx expo start"],
  [
    "a packageManager field that beats the lockfile",
    {
      "package.json": JSON.stringify({
        dependencies: { expo: "~58.0.0" },
        packageManager: "pnpm@9.1.0",
      }),
      "yarn.lock": "",
    },
    "pnpm",
    "pnpm exec expo start",
  ],
])(
  "finds the package manager from %s",
  async (_name, files, packageManager, server) => {
    const { detect } = await loadCore();
    const result = await detect(expoProject(files));
    expect(result.packageManager).toBe(packageManager);
    expect(result.commands?.server).toBe(server);
  },
);

test("lists existing Maestro flows and notes files", async () => {
  const { detect } = await loadCore();
  const dir = expoProject({
    ".maestro/b.yml": "",
    ".maestro/a.yaml": "",
    ".maestro/readme.txt": "",
    "AGENTS.md": "",
    "docs/decisions/0001.md": "",
  });
  const result = await detect(dir);
  expect(result.maestroFlows).toEqual([".maestro/a.yaml", ".maestro/b.yml"]);
  expect(result.notes).toEqual(["AGENTS.md", "docs/decisions"]);
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
