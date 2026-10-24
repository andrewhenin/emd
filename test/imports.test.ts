import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { makeDir } from "./helpers.ts";

const check = (files: Record<string, string>) => {
  const root = makeDir(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [`src/${k}`, v])),
  );
  return runCheck(root);
};

const runCheck = (root: string) =>
  spawnSync(
    "node",
    [
      "--no-warnings",
      "--experimental-strip-types",
      "scripts/check-imports.ts",
      root,
    ],
    { encoding: "utf8" },
  );

test("this repo respects the import boundaries", () => {
  const result = runCheck(process.cwd());
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

test("a clean layout passes", () => {
  const result = check({
    "core/index.ts": "export const x = 1;",
    "core/registry.ts":
      'export const load = () => import("../adapters/a/index.js");',
    "adapters/a/index.ts": 'import type { x } from "../../core/index.js";',
    "cli/main.ts": 'import { x } from "../core/index.js";',
    "bin.ts": 'import { run } from "./cli/main.js"; import("./mcp/server.js");',
    "mcp/server.ts": 'import { x } from "../core/index.js";',
  });
  expect(result.status).toBe(0);
});

test.each([
  [
    "core imports cli",
    { "core/a.ts": 'import "../cli/main.js";', "cli/main.ts": "" },
    "core must not import cli",
  ],
  [
    "core imports mcp",
    { "core/a.ts": 'import "../mcp/server.js";', "mcp/server.ts": "" },
    "core must not import mcp",
  ],
  [
    "cli bypasses core's public entry",
    { "cli/main.ts": 'import "../core/detect.js";', "core/detect.ts": "" },
    "public entry",
  ],
  [
    "mcp bypasses core's public entry",
    { "mcp/server.ts": 'import "../core/probe.js";', "core/probe.ts": "" },
    "public entry",
  ],
  [
    "cli imports mcp",
    { "cli/main.ts": 'import "../mcp/server.js";', "mcp/server.ts": "" },
    "cli must not import mcp",
  ],
  [
    "mcp imports cli",
    { "mcp/server.ts": 'import "../cli/main.js";', "cli/main.ts": "" },
    "mcp must not import cli",
  ],
  [
    "adapter imports another adapter",
    {
      "adapters/a/index.ts": 'import("../b/index.js");',
      "adapters/b/index.ts": "",
    },
    "adapters must not import each other",
  ],
  [
    "adapter imports cli",
    { "adapters/a/index.ts": 'import "../../cli/main.js";', "cli/main.ts": "" },
    "adapter must not import cli",
  ],
  [
    "core statically imports an adapter",
    {
      "core/a.ts": 'import "../adapters/a/index.js";',
      "adapters/a/index.ts": "",
    },
    "loaded lazily",
  ],
  [
    "cli statically imports an adapter",
    {
      "cli/main.ts": 'import "../adapters/a/index.js";',
      "adapters/a/index.ts": "",
    },
    "loaded lazily",
  ],
  [
    "a non-registry file dynamically imports an adapter",
    {
      "core/other.ts": 'import("../adapters/a/index.js");',
      "adapters/a/index.ts": "",
    },
    "only core/registry.ts",
  ],
  [
    "cli imports the entry",
    { "cli/main.ts": 'import "../bin.js";', "bin.ts": "" },
    "nothing may import the entry",
  ],
  [
    "mcp imports the entry",
    { "mcp/server.ts": 'import "../bin.js";', "bin.ts": "" },
    "nothing may import the entry",
  ],
  [
    "core imports the entry",
    { "core/a.ts": 'import "../bin.js";', "bin.ts": "" },
    "nothing may import the entry",
  ],
  [
    "entry bypasses core's public entry",
    { "bin.ts": 'import "./core/detect.js";', "core/detect.ts": "" },
    "public entry",
  ],
  [
    "entry statically imports an adapter",
    { "bin.ts": 'import "./adapters/a/index.js";', "adapters/a/index.ts": "" },
    "loaded lazily",
  ],
])("rejects: %s", (_name, files, message) => {
  const result = check(files);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
});
