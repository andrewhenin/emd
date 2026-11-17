import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { expect, test } from "vitest";
import { expoConfig, expoProject, makeDir } from "./helpers.ts";

// `emd launch` through the built CLI, with stubs for everything native: `xcrun`
// (simctl), `npx` and the project's Expo CLI. They log each call to calls.log.
const bin = makeDir();
const state = makeDir();
const calls = join(bin, "calls.log");
const container = join(bin, "container");
const script = (name: string, body: string) => {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};
script(
  "xcrun",
  `echo "xcrun $@" >> "${calls}"
case "$*" in
  "simctl list devices available --json") echo '{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-26-5":[{"udid":"BASE","name":"iPhone 17","state":"Shutdown"},{"udid":"CLONE","name":"clone","state":"Shutdown"}]}}' ;;
  "simctl clone"*) echo CLONE ;;
  "simctl get_app_container"*) [ -d "${container}" ] && echo "${container}" || exit 1 ;;
  "--sdk"*) exit 1 ;;
esac
exit 0`,
);
script("npx", `shift\nexec node "$PWD/node_modules/expo/bin/cli" "$@"`);

const expo = expoConfig({ ios: { bundleIdentifier: "com.emd.sandbox" } });
const project = expoProject({
  ...expo,
  "node_modules/expo/bin/cli": [expo["node_modules/expo/bin/cli"], ""]
    .join("")
    .replace(
      'if (process.argv[2] !== "config" || process.argv[4] !== "--json") process.exit(1);',
      `const fs = require("fs");
const [, , command, ...rest] = process.argv;
fs.appendFileSync(${JSON.stringify(calls)}, "expo " + command + "\\n");
if (command === "start") {
  require("http").createServer((_, r) => r.end("packager-status:running")).listen(Number(rest[rest.indexOf("--port") + 1]));
  return;
}
if (command === "run:ios") process.exit(0);
if (command !== "config") process.exit(1);`,
    ),
  "node_modules/@expo/fingerprint/index.js":
    'exports.createFingerprintAsync = async () => ({ hash: "same" });',
});

const launch = () => {
  const run = spawnSync("node", ["dist/bin.js", "launch", project], {
    encoding: "utf8",
    env: {
      ...process.env,
      EMD_STATE_DIR: state,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
    },
  });
  return JSON.parse(run.stdout);
};
const builds = () =>
  readFileSync(calls, "utf8")
    .split("\n")
    .filter((line) => line === "expo run:ios").length;

// launch refuses to run off macOS, so the Linux CI job skips this test.
test.skipIf(process.platform !== "darwin")(
  "launch builds when the installed app has no Info.plist",
  () => {
    // First launch: not installed, so it builds and records the build.
    expect(launch().phases).toHaveProperty("build");
    expect(builds()).toBe(1);

    // simctl names a container, but the app's files are gone.
    mkdirSync(container);
    const second = launch();
    expect(second.phases).toHaveProperty("build");
    expect(second.phases).not.toHaveProperty("reuse");
    expect(builds()).toBe(2);

    // An Info.plist that cannot be read after a reuse: build once, no failure
    // for the reuse itself.
    writeFileSync(join(container, "Info.plist"), "");
    const third = launch();
    expect(third.phases).toHaveProperty("reuse");
    expect(third.phases).toHaveProperty("build");
    expect(third.reason).toContain("Built, but");
    expect(builds()).toBe(3);
  },
  120_000,
);
