import { expect, test } from "vitest";
import { cli, makeDir } from "./helpers.ts";

// #125: `detect` at a workspace root points to the app folders, through the
// real CLI.
const expoApp = JSON.stringify({ dependencies: { expo: "~58.0.0" } });
const library = JSON.stringify({ dependencies: { react: "19.0.0" } });
const detect = (root: string) => JSON.parse(cli("detect", root).stdout);

test("at a pnpm workspace root, lists the packages that depend on expo", () => {
  const root = makeDir({
    "package.json": JSON.stringify({ private: true }),
    "pnpm-workspace.yaml":
      "packages:\n  - 'apps/*' # the apps\n  - packages/*\nonlyBuiltDependencies: []\n",
    "apps/mobile/package.json": expoApp,
    "apps/web/package.json": library,
    "packages/ui/package.json": library,
    // Never read: node_modules and hidden folders.
    "node_modules/some-app/package.json": expoApp,
    "apps/.cache/package.json": expoApp,
  });
  expect(detect(root)).toEqual({
    verdict: "none",
    root,
    apps: ["apps/mobile"],
  });
});

test("reads a workspaces field: a list with exclusions, or packages with **", () => {
  const listed = makeDir({
    "package.json": JSON.stringify({ workspaces: ["apps/*", "!apps/old"] }),
    "apps/mobile/package.json": expoApp,
    "apps/old/package.json": expoApp,
  });
  expect(detect(listed).apps).toEqual(["apps/mobile"]);

  const nested = makeDir({
    "package.json": JSON.stringify({
      workspaces: { packages: ["clients/**"] },
    }),
    "clients/ios/phone/package.json": expoApp,
    "clients/shared/package.json": library,
  });
  expect(detect(nested).apps).toEqual(["clients/ios/phone"]);
});

test("reads an inline pnpm packages list", () => {
  const root = makeDir({
    "pnpm-workspace.yaml": "packages: ['apps/*', \"tools/*\"]\n",
    "apps/mobile/package.json": expoApp,
    "tools/cli/package.json": library,
  });
  expect(detect(root).apps).toEqual(["apps/mobile"]);
});

test("outside a workspace, none has no apps", () => {
  const root = makeDir({ "package.json": library });
  expect(detect(root)).toEqual({ verdict: "none", root });
});
