import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// A real build and launch on an iOS simulator. macOS, Xcode and a sandbox app
// only: `npm run test:e2e`. Skipped otherwise, so CI never runs it.
const sandbox = process.env.EMD_E2E_SANDBOX;
const minutes = (n: number) => n * 60_000;

describe.skipIf(!sandbox || process.platform !== "darwin")(
  "launch on a real iOS simulator",
  () => {
    let result: {
      verdict: string;
      device: { id: string; name: string };
      appId: string;
      appPid: number;
      metro: { pid: number; port: number };
      logDir: string;
    };
    let output = "";

    beforeAll(() => {
      const run = spawnSync("node", ["dist/bin.js", "launch", sandbox ?? ""], {
        encoding: "utf8",
        timeout: minutes(20),
      });
      output = run.stdout;
      result = JSON.parse(output);
    }, minutes(21));

    afterAll(() => {
      try {
        process.kill(-result.metro.pid, "SIGTERM");
      } catch {}
    });

    test(
      "builds, installs and launches the app",
      () => {
        expect(result).toMatchObject({
          verdict: "launched",
          appId: "com.emd.sandbox",
        });
        const apps = execFileSync(
          "xcrun",
          ["simctl", "listapps", result.device.id],
          { encoding: "utf8" },
        );
        expect(apps).toContain("com.emd.sandbox");
        const running = execFileSync(
          "xcrun",
          ["simctl", "spawn", result.device.id, "launchctl", "list"],
          { encoding: "utf8" },
        );
        expect(running).toContain(`UIKitApplication:${result.appId}`);
      },
      minutes(1),
    );

    test("leaves the dev server running for the app", async () => {
      const response = await fetch(
        `http://localhost:${result.metro.port}/status`,
      );
      expect(await response.text()).toContain("packager-status:running");
    });

    test("returns a small answer and keeps the logs on disk", () => {
      expect(output.length).toBeLessThan(800);
      expect(existsSync(join(result.logDir, "build.log"))).toBe(true);
      expect(existsSync(join(result.logDir, "metro.log"))).toBe(true);
    });

    test(
      "a second launch fails clearly while the dev server is up, over MCP too",
      async () => {
        const client = new Client({ name: "emd-e2e", version: "0.0.0" });
        await client.connect(
          new StdioClientTransport({
            command: "node",
            args: ["dist/bin.js", "mcp"],
          }),
        );
        try {
          const second = await client.callTool({
            name: "launch",
            arguments: { dir: sandbox },
          });
          expect(second.structuredContent).toMatchObject({
            verdict: "failed",
            reason: expect.stringContaining("already serves a dev server"),
          });
        } finally {
          await client.close();
        }
      },
      minutes(2),
    );
  },
);
