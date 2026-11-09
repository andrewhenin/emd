import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { resetChecks } from "../../src/core/index.ts";

// A real build and launch on an iOS simulator, driven the way an agent does:
// `launch` starts a job, `job_status` is polled. macOS, Xcode and a fixture
// app only: `npm run test:e2e`. Skipped otherwise, so the CI check job skips it.
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

type Logs = {
  verdict: string;
  total?: number;
  lines?: { time: string; tag: string; message: string }[];
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
    let began = 0;
    let first: View;
    let final: View;
    let again: View | undefined;
    const steps = new Set<string>();

    beforeAll(async () => {
      await client.connect(
        new StdioClientTransport({
          command: "node",
          args: ["dist/bin.js", "mcp"],
          env: { ...process.env, EMD_RETRY_LIMIT: "2" } as Record<
            string,
            string
          >,
        }),
      );
      began = Date.now();
      first = await call("launch", { dir: sandbox });
      startedAfter = Date.now() - began;
      final = await finish(first, steps);
    }, minutes(21));

    afterAll(async () => {
      for (const job of [final, again]) {
        try {
          if (job?.result) process.kill(-job.result.metro.pid, "SIGTERM");
        } catch {}
      }
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

    // Async, so vitest's worker keeps answering while a tool runs for minutes.
    const run = (
      command: string,
      args: string[],
      options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
    ) =>
      new Promise<{ status: number | null; stdout: string; output: string }>(
        (resolve) => {
          const child = spawn(command, args, options);
          let stdout = "";
          let output = "";
          child.stdout.on("data", (chunk) => {
            stdout += chunk;
            output += chunk;
          });
          child.stderr.on("data", (chunk) => {
            output += chunk;
          });
          child.on("error", (error) =>
            resolve({ status: null, stdout, output: `${output}\n${error}` }),
          );
          child.on("close", (status) => resolve({ status, stdout, output }));
        },
      );

    // Tagged logs. The sandbox's tap flow restarts the app (Maestro's
    // launchApp), so the app's pid changes: a run is read by app and time.
    const tapFlow = () =>
      run(
        "maestro",
        [
          "--device",
          final.result?.device.id ?? "",
          "test",
          ".maestro/smoke.yaml",
        ],
        {
          cwd: sandbox,
          env: {
            ...process.env,
            PATH: `${process.env.HOME}/.maestro/bin:${process.env.PATH}`,
            JAVA_HOME: process.env.JAVA_HOME ?? "/opt/homebrew/opt/openjdk@17",
            MAESTRO_DRIVER_STARTUP_TIMEOUT: "300000",
          },
        },
      );

    // An agent taps through MobileBuildMCP, not EMD (decision 0008), at the
    // version e2e tests. It reads the screen's element refs, then taps the
    // ref whose identifier is the testID. A row is ref|action|role|label|value|id.
    const mobileBuildMcp = "mobilebuildmcp@2.7.1";
    const tapById = async (device: string, id: string) => {
      const ui = (tool: string, args: object) =>
        run("npx", [
          "-y",
          mobileBuildMcp,
          "ui-automation",
          tool,
          "--json",
          JSON.stringify({ simulatorId: device, ...args }),
          "--output",
          "json",
        ]);
      const snapshot = await ui("snapshot-ui", {});
      expect(snapshot.status, snapshot.output).toBe(0);
      const targets: string[] = JSON.parse(snapshot.stdout).data.capture
        .targets;
      const ref = targets
        .map((row) => row.split("|"))
        .find((row) => row[1] === "tap" && row[5] === id)?.[0];
      expect(ref, targets.join("\n")).toBeDefined();
      return ui("tap", { elementRef: ref });
    };
    const readLogs = async (jobId: string, extra: object = {}) =>
      (await client.callTool({ name: "logs", arguments: { jobId, ...extra } }))
        .structuredContent as Logs;

    test(
      "logs returns the tag the app wrote after a tap, from this run only",
      async () => {
        const tap = await tapFlow();
        expect(tap.status, tap.output).toBe(0);
        const result = await readLogs(first.jobId);
        expect(result.verdict).toBe("ok");
        expect(result.lines).toContainEqual({
          time: expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/),
          tag: "smoke",
          message: "tapped",
        });
        // The `log` command logs its own arguments, which contain the marker.
        for (const line of result.lines ?? []) {
          expect(line.message).not.toContain("log run noninteractively");
          expect(Date.parse(line.time)).toBeGreaterThanOrEqual(began);
        }
        const smoke = await readLogs(first.jobId, { tag: "smoke" });
        expect(smoke.total).toBeGreaterThanOrEqual(1);
        const other = await readLogs(first.jobId, { tag: "nothing" });
        expect(other).toMatchObject({ verdict: "ok", total: 0, lines: [] });
        expect(JSON.stringify(result).length).toBeLessThan(4000);
      },
      minutes(5),
    );

    test(
      "evidence gathers the run's check, log line, screenshot and flow, the same each time",
      async () => {
        const checked = await finish(
          await call("check", {
            jobId: first.jobId,
            name: "evidence",
            logs: [{ tag: "smoke", message: "tapped" }],
            elements: [{ id: "smoke-label" }],
          }),
          new Set(),
        );
        expect(checked.result?.verdict).toBe("passed");
        const gather = async () =>
          (
            await client.callTool({
              name: "evidence",
              arguments: { jobId: first.jobId },
            })
          ).structuredContent as {
            verdict: string;
            dir: string;
            checks: number;
            logLines: number;
            screenshots: number;
            flows: number;
          };
        const files = (dir: string) =>
          readdirSync(dir, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => join(entry.parentPath, entry.name))
            .sort()
            .map((path) => [path, readFileSync(path, "utf8")]);
        const once = await gather();
        expect(once).toMatchObject({
          verdict: "written",
          checks: 1,
          screenshots: 1,
          flows: 1,
        });
        expect(once.logLines).toBeGreaterThanOrEqual(1);
        const bundle = files(once.dir);
        expect(files((await gather()).dir)).toEqual(bundle);
      },
      minutes(5),
    );

    // The first launch's dev server is still up (#121).
    test(
      "a later launch stops the dev server the earlier one left, and its run does not see the earlier run's lines",
      async () => {
        const left = final.result?.metro;
        again = await finish(await call("launch", { dir: sandbox }), new Set());
        expect(again.status, again.result?.reason).toBe("succeeded");
        expect(again.result?.metro.port).toBe(left?.port);
        expect(() => process.kill(-(left?.pid ?? 0), 0)).toThrow();
        const later = await readLogs(again.jobId, { tag: "smoke" });
        expect(later).toMatchObject({ verdict: "ok", total: 0, lines: [] });
        const earlier = await readLogs(first.jobId, { tag: "smoke" });
        expect(earlier.total).toBeGreaterThanOrEqual(1);
      },
      minutes(10),
    );

    // Checks, on the second run: the app was just launched and nobody has
    // tapped. Each check reads the real log and the real screen (Maestro's
    // accessibility tree), so each takes about half a minute.
    type CheckView = {
      status: string;
      seconds: number;
      result?: {
        verdict: string;
        reason?: string;
        attempt?: number;
        logs?: { tag: string; message?: string; found: boolean }[];
        elements?: { found: boolean }[];
        backend?: string;
        fellBack?: { backend: string; reason: string }[];
        secondOpinion?: {
          screenshot?: string;
          agent?: string;
          agrees?: boolean;
        };
      };
    };
    const runCheck = async (args: Record<string, unknown>) =>
      (await finish(
        await call("check", { jobId: again?.jobId, ...args }),
        new Set(),
      )) as unknown as CheckView;

    // The result names the backend that read the screen (decision 0004);
    // if it is not AXe, it says why AXe was passed over. Each read picks its own.
    const expectBackendNamed = (view: CheckView) => {
      expect(["axe", "maestro"]).toContain(view.result?.backend);
      if (view.result?.backend === "maestro") {
        expect(view.result.fellBack?.[0]?.backend).toBe("axe");
      } else {
        expect(view.result?.fellBack).toBeUndefined();
      }
    };

    test(
      "a check fails before the tap and passes after it, from the real log and screen",
      async () => {
        const tappedLog = [{ tag: "smoke", message: "tapped" }];
        const before = await runCheck({
          logs: tappedLog,
          elements: [{ id: "smoke-button" }, { text: "Ready" }],
        });
        expect(before.status).toBe("failed");
        expect(before.result).toMatchObject({ verdict: "failed", attempt: 1 });
        expect(before.result?.logs).toEqual([
          { tag: "smoke", message: "tapped", found: false },
        ]);
        expect(before.result?.elements?.every((e) => e.found)).toBe(true);
        expect(existsSync(before.result?.secondOpinion?.screenshot ?? "")).toBe(
          true,
        );
        expectBackendNamed(before);

        const tap = await tapById(
          again?.result?.device.id ?? "",
          "smoke-button",
        );
        expect(tap.status, tap.output).toBe(0);
        const after = await runCheck({
          logs: tappedLog,
          elements: [{ id: "smoke-button" }, { text: "Tapped" }],
        });
        expect(after.status).toBe("succeeded");
        expect(after.result).toMatchObject({ verdict: "passed" });
        expect(after.result?.attempt).toBeUndefined();
        expectBackendNamed(after);
      },
      minutes(8),
    );

    test(
      "fix-and-retry stops at the retry limit; the agent's reading never changes the verdict",
      async () => {
        const wrong = {
          elements: [{ text: "Nope" }],
        };
        const one = await runCheck({ ...wrong, agentReading: "pass" });
        expect(one.result).toMatchObject({
          verdict: "failed",
          attempt: 1,
          secondOpinion: { agent: "pass", agrees: false },
        });
        const two = await runCheck(wrong);
        expect(two.result).toMatchObject({ verdict: "stopped", attempt: 2 });
        const three = await runCheck(wrong);
        expect(three.result).toMatchObject({ verdict: "stopped", attempt: 2 });
        expect(three.result?.reason).toContain("emd check reset");
        // It did not read the screen again.
        expect(three.seconds).toBeLessThan(20);
        expect(three.result?.secondOpinion).toBeUndefined();
      },
      minutes(8),
    );

    test(
      "only a person's reset starts the count over",
      async () => {
        resetChecks(sandbox ?? "");
        const fixed = await runCheck({ elements: [{ id: "smoke-button" }] });
        expect(fixed.result).toMatchObject({ verdict: "passed" });
      },
      minutes(4),
    );

    // Last: it stops this run's dev server.
    const answers = (port: number | undefined) =>
      fetch(`http://localhost:${port}/status`)
        .then(async (r) => (await r.text()).includes("packager-status:running"))
        .catch(() => false);
    const until = async (done: () => Promise<boolean>) => {
      for (let i = 0; i < 40 && !(await done()); i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    };

    test(
      "a dev server EMD did not start still blocks launch, and is left running",
      async () => {
        const left = again?.result?.metro;
        expect(left).toBeDefined();
        if (left) process.kill(-left.pid, "SIGTERM");
        await until(async () => !(await answers(left?.port)));
        const foreign = spawn(
          "node",
          [
            "-e",
            `require("http").createServer((q, s) => s.end("packager-status:running")).listen(${left?.port})`,
          ],
          { stdio: "ignore" },
        );
        try {
          await until(() => answers(left?.port));
          const blocked = await finish(
            await call("launch", { dir: sandbox }),
            new Set(),
          );
          expect(blocked.status).toBe("failed");
          expect(blocked.result?.reason).toContain(
            "already serves a dev server",
          );
          expect(await answers(left?.port)).toBe(true);
        } finally {
          foreign.kill();
        }
      },
      minutes(3),
    );
  },
);
