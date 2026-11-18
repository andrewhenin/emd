import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { delimiter, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type KeyedLedger, worktreeKey } from "../src/core/owned.ts";
import { expoProject, makeDir } from "./helpers.ts";

// `emd launch` through the built CLI with a stub dev server. The stub answers
// /status and reads a "reload" message on the /message websocket, as Expo's
// does; it logs "iOS Bundled" for it. `xcrun`, `axe` and `npx` are stubs too.
// Launch refuses to run off macOS, so the Linux CI job skips this.
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>emd</string></dict></plist>`;

const server = `const fs = require("fs");
const crypto = require("crypto");
const [, , command, ...rest] = process.argv;
const calls = process.env.CALLS;
fs.appendFileSync(calls, "expo " + command + "\\n");
if (command === "config") process.stdout.write(process.env.CONFIG);
else if (command === "start") {
  console.log("CI=" + (process.env.CI ?? "unset"));
  const http = require("http").createServer((_, r) => r.end("packager-status:running"));
  http.on("upgrade", (req, socket) => {
    const key = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + key + "\\r\\n\\r\\n");
    socket.on("data", (data) => {
      // A close frame is answered with a close frame; only text frames count.
      if ((data[0] & 15) === 8) return socket.end(Buffer.from([0x88, 0]));
      if ((data[0] & 15) !== 1) return;
      const length = data[1] & 127;
      const mask = data.subarray(2, 6);
      const text = Buffer.from(data.subarray(6, 6 + length).map((b, i) => b ^ mask[i % 4])).toString();
      if (JSON.parse(text).method === "reload") {
        fs.appendFileSync(calls, "reload\\n");
        console.log("iOS Bundled 5ms index.js (1 module)");
      }
    });
    socket.on("error", () => {});
  });
  http.listen(Number(rest[rest.indexOf("--port") + 1]));
} else if (command === "run:ios") {
  fs.mkdirSync(process.env.CONTAINER, { recursive: true });
  fs.writeFileSync(process.env.CONTAINER + "/Info.plist", process.env.PLIST);
} else process.exit(1);`;

const pids: number[] = [];
afterEach(() => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
  }
});

// A port the OS just handed out, so parallel test runs never share one.
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });

async function rig() {
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
    `case "$*" in
  "simctl list devices available --json") echo '{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-26-5":[{"udid":"BASE","name":"iPhone 17","state":"Shutdown"},{"udid":"CLONE","name":"clone","state":"Shutdown"}]}}' ;;
  "simctl clone"*) echo CLONE ;;
  "simctl get_app_container"*) [ -d "${container}" ] && echo "${container}" || exit 1 ;;
  "simctl spawn"*) echo "4242 0 UIKitApplication:com.emd.sandbox[1234][rb-legacy]" ;;
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
    "node_modules/expo/bin/cli": server,
    "node_modules/@expo/fingerprint/index.js":
      'exports.createFingerprintAsync = async () => ({ hash: "same" });',
  });
  // Parallel runs have separate state dirs; each rig holds its own Metro port.
  const root = realpathSync(project);
  const ledger: Omit<KeyedLedger, "key"> = {
    root,
    resources: [
      { kind: "port", id: String(await freePort()), state: "creating" },
    ],
  };
  mkdirSync(join(state, "owned"), { recursive: true });
  writeFileSync(
    join(state, "owned", `${worktreeKey(root)}.json`),
    JSON.stringify(ledger),
  );
  return {
    launch: () => {
      const run = spawnSync("node", ["dist/bin.js", "launch", project], {
        encoding: "utf8",
        env: {
          ...process.env,
          CI: "true",
          CALLS: calls,
          CONFIG: JSON.stringify(config),
          CONTAINER: container,
          PLIST: plist,
          EMD_STATE_DIR: state,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
        },
      });
      const result = JSON.parse(run.stdout);
      if (result.metro) pids.push(result.metro.pid);
      return result;
    },
    calls: () => readFileSync(calls, "utf8").split("\n"),
  };
}

const onMac = test.skipIf(process.platform !== "darwin");

onMac(
  "an unchanged fingerprint reloads the running app and starts no new server",
  async () => {
    const { launch, calls } = await rig();
    const first = launch();
    expect(first.build.action).toBe("built");
    // The dev server starts without CI, though CI is set around EMD.
    expect(readFileSync(join(first.logDir, "metro.log"), "utf8")).toContain(
      "CI=unset",
    );
    const second = launch();
    expect(second.reason ?? second.verdict).toBe("launched");
    expect(second.build).toEqual({ action: "reloaded" });
    expect(second.metro).toEqual(first.metro);
    expect(second.logStream).toEqual(first.logStream);
    expect(second.phases).toHaveProperty("reload");
    expect(calls().filter((line) => line === "reload")).toHaveLength(1);
    expect(calls().filter((line) => line === "expo start")).toHaveLength(1);
    expect(calls().filter((line) => line === "expo run:ios")).toHaveLength(1);
  },
  120_000,
);
