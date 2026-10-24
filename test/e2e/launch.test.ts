import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// A real build and launch on an iOS simulator, driven the way an agent does:
// `launch` starts a job, `job_status` is polled. macOS, Xcode and a sandbox
// app only: `npm run test:e2e`. Skipped otherwise, so CI never runs it.
const sandbox = process.env.EMD_E2E_SANDBOX;
const minutes = (n: number) => n * 60_000;

type View = {
  jobId: string;
  status: string;
  step?: string;
  seconds: number;
  result?: {
    verdict: string;
    reason?: string;
    device: { id: string; name: string };
    appId: string;
    appPid: number;
    metro: { pid: number; port: number };
    logDir: string;
  };
};

describe.skipIf(!sandbox || process.platform !== "darwin")(
  "launch on a real iOS simulator",
  () => {
    const client = new Client({ name: "emd-e2e", version: "0.0.0" });
    const call = async (name: string, args: Record<string, unknown>) =>
      (await client.callTool({ name, arguments: args }))
        .structuredContent as View;
    const finish = async (job: View, steps: Set<string>): Promise<View> => {
      let view = job;
      while (!["succeeded", "failed"].includes(view.status)) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        view = await call("job_status", { jobId: job.jobId });
        if (view.step) steps.add(view.step);
      }
      return view;
    };

    let startedAfter = 0;
    let first: View;
    let final: View;
    const steps = new Set<string>();

    beforeAll(async () => {
      await client.connect(
        new StdioClientTransport({
          command: "node",
          args: ["dist/bin.js", "mcp"],
        }),
      );
      const began = Date.now();
      first = await call("launch", { dir: sandbox });
      startedAfter = Date.now() - began;
      final = await finish(first, steps);
    }, minutes(21));

    afterAll(async () => {
      try {
        if (final.result) process.kill(-final.result.metro.pid, "SIGTERM");
      } catch {}
      await client.close();
    });

    test("launch returns a job within seconds, not when the build is done", () => {
      expect(startedAfter).toBeLessThan(10_000);
      expect(first.status).toMatch(/queued|running/);
      expect(first.result).toBeUndefined();
    });

    test("job_status reports progress while the build runs", () => {
      expect(steps).toContain("building and installing the app");
    });

    test(
      "the job ends succeeded: the app is installed and running",
      () => {
        expect(final.status).toBe("succeeded");
        const result = final.result;
        expect(result).toMatchObject({
          verdict: "launched",
          appId: "com.emd.sandbox",
        });
        const apps = execFileSync(
          "xcrun",
          ["simctl", "listapps", result?.device.id ?? ""],
          { encoding: "utf8" },
        );
        expect(apps).toContain("com.emd.sandbox");
        const running = execFileSync(
          "xcrun",
          ["simctl", "spawn", result?.device.id ?? "", "launchctl", "list"],
          { encoding: "utf8" },
        );
        expect(running).toContain("UIKitApplication:com.emd.sandbox");
      },
      minutes(1),
    );

    test("leaves the dev server running for the app", async () => {
      const port = final.result?.metro.port;
      const response = await fetch(`http://localhost:${port}/status`);
      expect(await response.text()).toContain("packager-status:running");
    });

    test("the answer stays small and the logs stay on disk", () => {
      expect(JSON.stringify(final).length).toBeLessThan(900);
      const dir = final.result?.logDir ?? "";
      expect(existsSync(join(dir, "build.log"))).toBe(true);
      expect(existsSync(join(dir, "metro.log"))).toBe(true);
    });

    test(
      "a second launch ends failed, clearly, while the dev server is up",
      async () => {
        const second = await finish(
          await call("launch", { dir: sandbox }),
          new Set(),
        );
        expect(second.status).toBe("failed");
        expect(second.result?.reason).toContain("already serves a dev server");
      },
      minutes(2),
    );
  },
);
