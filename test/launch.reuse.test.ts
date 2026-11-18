import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { expect, test } from "vitest";
import { expoProject, makeDir } from "./helpers.ts";

// `emd launch` through the built CLI, with stubs for everything native: `xcrun`
// (simctl), `axe`, `npx` and the project's Expo CLI. The stubs log each call to
// calls.log. Launch refuses to run off macOS, so the Linux CI job skips these.
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>emd</string></dict></plist>`;

function rig() {
  const bin = makeDir();
  const state = makeDir();
  const calls = join(bin, "calls.log");
  const container = join(bin, "container");
  const writePlist = join(bin, "write-plist");
  const failInstall = join(bin, "fail-install");
  const badInstall = join(bin, "bad-install");
  const script = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  script(
    "xcrun",
    `case "$*" in
  "simctl list devices available --json") echo '{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-26-5":[{"udid":"BASE","name":"iPhone 17","state":"Shutdown"},{"udid":"CLONE","name":"clone","state":"Shutdown"}]}}' ;;
  "simctl clone"*) echo CLONE ;;
  "simctl get_app_container"*) [ -d "${container}" ] && echo "${container}" || exit 1 ;;
  "simctl install"*) echo "$*" >> "${calls}"
    [ -f "${failInstall}" ] && exit 1
    mkdir -p "${container}"
    if [ -f "${badInstall}" ]; then : > "${container}/Info.plist"; else echo '${plist}' > "${container}/Info.plist"; fi ;;
  "simctl launch"*) echo "com.emd.sandbox: 4242" ;;
  "--sdk"*) exit 1 ;;
esac
exit 0`,
  );
  script("axe", `echo '[{"AXLabel":"Home"}]'`);
  script("npx", `shift\nexec node "$PWD/node_modules/expo/bin/cli" "$@"`);
  const config = {
    sdkVersion: "58.0.0",
    platforms: ["ios"],
    ios: { bundleIdentifier: "com.emd.sandbox" },
  };
  const project = expoProject({
    "node_modules/expo/bin/cli": `const fs = require("fs");
const [, , command, ...rest] = process.argv;
fs.appendFileSync(${JSON.stringify(calls)}, "expo " + command + "\\n");
if (command === "config") process.stdout.write(${JSON.stringify(JSON.stringify(config))});
else if (command === "start") require("http").createServer((_, r) => r.end("packager-status:running")).listen(Number(rest[rest.indexOf("--port") + 1]));
else if (command === "run:ios" && fs.existsSync(${JSON.stringify(writePlist)})) {
  fs.mkdirSync(${JSON.stringify(container)}, { recursive: true });
  fs.writeFileSync(${JSON.stringify(join(container, "Info.plist"))}, ${JSON.stringify(plist)});
} else if (command !== "run:ios") process.exit(1);`,
    "node_modules/@expo/fingerprint/index.js":
      'exports.createFingerprintAsync = async () => ({ hash: "same" });',
  });
  // Each rig holds its own Metro port. Two test runs have separate state dirs,
  // so without this both pick the first free port and see each other's stub.
  const root = realpathSync(project);
  mkdirSync(join(state, "owned"), { recursive: true });
  writeFileSync(
    join(
      state,
      "owned",
      `${createHash("sha1").update(root).digest("hex").slice(0, 12)}.json`,
    ),
    JSON.stringify({
      root,
      resources: [
        {
          kind: "port",
          id: String(20_000 + Math.floor(Math.random() * 40_000)),
          state: "creating",
        },
      ],
    }),
  );
  return {
    launch: () => {
      const run = spawnSync("node", ["dist/bin.js", "launch", project], {
        encoding: "utf8",
        env: {
          ...process.env,
          EMD_STATE_DIR: state,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
        },
      });
      return JSON.parse(run.stdout);
    },
    builds: () =>
      readFileSync(calls, "utf8")
        .split("\n")
        .filter((line) => line === "expo run:ios").length,
    // simctl names a container; `plistText` is its Info.plist, if any.
    install: (plistText?: string) => {
      mkdirSync(container, { recursive: true });
      if (plistText !== undefined) {
        writeFileSync(join(container, "Info.plist"), plistText);
      }
    },
    installs: () =>
      readFileSync(calls, "utf8")
        .split("\n")
        .filter((line) => line.startsWith("simctl install")).length,
    failInstalls: () => writeFileSync(failInstall, ""),
    // The install leaves an Info.plist that cannot be read.
    unreadableInstalls: () => writeFileSync(badInstall, ""),
    // Leaves a built app in the worktree's DerivedData.
    leaveBuiltApp: (derivedData: string) =>
      mkdirSync(
        join(derivedData, "Build/Products/Debug-iphonesimulator/emd.app"),
        {
          recursive: true,
        },
      ),
    // Whether the build writes a valid Info.plist into the container.
    buildWritesPlist: (on: boolean) => {
      if (on) writeFileSync(writePlist, "");
    },
  };
}

const onMac = test.skipIf(process.platform !== "darwin");

onMac(
  "a container with no Info.plist is built, not reused",
  () => {
    const { launch, builds, install } = rig();
    launch(); // not installed: builds and records the build
    install();
    const second = launch();
    expect(second.phases).toHaveProperty("build");
    expect(second.phases).not.toHaveProperty("reuse");
    expect(builds()).toBe(2);
  },
  120_000,
);

onMac(
  "an Info.plist that cannot be read: one build, then it launches",
  () => {
    const { launch, builds, install, buildWritesPlist } = rig();
    launch();
    install("");
    buildWritesPlist(true);
    const second = launch();
    expect(second.verdict).toBe("launched");
    expect(second.build).toEqual({
      action: "built",
      reason: "installed app could not be read",
    });
    expect(second.phases).toHaveProperty("reuse");
    expect(builds()).toBe(2);
  },
  120_000,
);

onMac(
  "the app still cannot be read after the build: launch fails",
  () => {
    const { launch, builds, install } = rig();
    launch();
    install("");
    const second = launch();
    expect(second).toMatchObject({
      verdict: "failed",
      reason: "Built, but could not capture the app's log.",
    });
    expect(builds()).toBe(2);
  },
  120_000,
);

onMac(
  "the app is gone but the build is in DerivedData: it installs, no build runs",
  () => {
    const { launch, builds, installs, leaveBuiltApp } = rig();
    const first = launch();
    leaveBuiltApp(first.derivedData);
    const second = launch();
    expect(second.verdict).toBe("launched");
    expect(second.build).toEqual({
      action: "installed",
      reason: "app not installed",
    });
    expect(second.phases).toHaveProperty("install");
    expect(second.phases).not.toHaveProperty("build");
    expect(installs()).toBe(1);
    expect(builds()).toBe(1);
  },
  120_000,
);

onMac(
  "the install fails: it builds as before",
  () => {
    const { launch, builds, leaveBuiltApp, failInstalls, buildWritesPlist } =
      rig();
    const first = launch();
    leaveBuiltApp(first.derivedData);
    failInstalls();
    buildWritesPlist(true);
    const second = launch();
    expect(second.build).toMatchObject({ action: "built" });
    expect(second.build?.reason).toMatch(
      /^app not installed; install failed: .+/,
    );
    expect(builds()).toBe(2);
  },
  120_000,
);

onMac(
  "the installed app cannot be read: one build, then it launches",
  () => {
    const {
      launch,
      builds,
      leaveBuiltApp,
      unreadableInstalls,
      buildWritesPlist,
    } = rig();
    const first = launch();
    leaveBuiltApp(first.derivedData);
    unreadableInstalls();
    buildWritesPlist(true);
    const second = launch();
    expect(second.verdict).toBe("launched");
    expect(second.build).toEqual({
      action: "built",
      reason: "installed app could not be read",
    });
    expect(builds()).toBe(2);
  },
  120_000,
);
