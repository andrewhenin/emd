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

    // Tagged logs. The sandbox's tap flow restarts the app (Maestro's
    // launchApp), so the app's pid changes: a run is read by app and time.
    // Async, so vitest's worker keeps answering while Maestro runs for minutes.
    const maestroTest = (flow: string, device = final.result?.device.id) =>
      new Promise<{ status: number | null; output: string }>((resolve) => {
        const child = spawn(
          "maestro",
          ["--device", device ?? "", "test", flow],
          {
            cwd: sandbox,
            env: {
              ...process.env,
              PATH: `${process.env.HOME}/.maestro/bin:${process.env.PATH}`,
              JAVA_HOME:
                process.env.JAVA_HOME ?? "/opt/homebrew/opt/openjdk@17",
              MAESTRO_DRIVER_STARTUP_TIMEOUT: "300000",
            },
          },
        );
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
        });
        child.stderr.on("data", (chunk) => {
          output += chunk;
        });
        child.on("error", (error) =>
          resolve({ status: null, output: `${output}\n${error}` }),
        );
        child.on("close", (status) => resolve({ status, output }));
      });
    const tapFlow = () => maestroTest(".maestro/smoke.yaml");
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

    test(
      "a later run does not see an earlier run's lines",
      async () => {
        if (final.result) process.kill(-final.result.metro.pid, "SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 3000));
        again = await finish(await call("launch", { dir: sandbox }), new Set());
        expect(again.status).toBe("succeeded");
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

    // Steps (decision 0008): EMD taps, through the backend it picks.
    type StepsView = {
      status: string;
      result?: {
        verdict: string;
        dir: string;
        steps: {
          backend?: string;
          fellBack?: { backend: string; reason: string }[];
          screenshot?: string;
          total: number;
          lines: { tag: string; message: string }[];
          error?: string;
        }[];
      };
    };
    let stepsDir: string | undefined;

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

        const tapped = (await finish(
          await call("steps", {
            jobId: again?.jobId,
            steps: [{ tapOn: { id: "smoke-button" } }],
          }),
          new Set(),
        )) as unknown as StepsView;
        expect(tapped.status, JSON.stringify(tapped.result)).toBe("succeeded");
        const result = tapped.result;
        stepsDir = result?.dir;
        expect(result?.verdict).toBe("ran");
        const [step] = result?.steps ?? [];
        expect(["axe", "maestro"]).toContain(step?.backend);
        if (step?.backend === "maestro") {
          expect(step.fellBack?.[0]?.backend).toBe("axe");
        }
        expect(step?.lines).toContainEqual(
          expect.objectContaining({ tag: "smoke", message: "tapped" }),
        );
        expect(existsSync(join(stepsDir ?? "", step?.screenshot ?? "-"))).toBe(
          true,
        );
        expect(JSON.stringify(result).length).toBeLessThan(1000);
        // Data for the 1 s waits: from each step's start to its first line.
        const saved = JSON.parse(
          readFileSync(join(stepsDir ?? "", "steps.json"), "utf8"),
        ) as { steps: { start: string; lines: { time: string }[] }[] };
        saved.steps.forEach((s, i) => {
          const first = s.lines[0]?.time;
          const delay = first
            ? Date.parse(first) - Date.parse(s.start)
            : "none";
          console.log(
            `[e2e] step ${i + 1}: first tagged line after ${delay} ms`,
          );
        });

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

    // Scroll and type through `steps`. Scroll first, so the keyboard that
    // typing opens cannot cover the swipe's start point.
    let scrollDir: string | undefined;
    let typeDir: string | undefined;
    const runSteps = async (steps: unknown[]) => {
      const view = (await finish(
        await call("steps", { jobId: again?.jobId, steps }),
        new Set(),
      )) as unknown as StepsView;
      expect(view.status, JSON.stringify(view.result)).toBe("succeeded");
      expect(view.result?.verdict).toBe("ran");
      expect(JSON.stringify(view.result).length).toBeLessThan(1000);
      return view.result;
    };
    // The step names its backend, has a screenshot, and got the app's line.
    const expectActed = (
      result: StepsView["result"],
      index: number,
      line: { tag: string; message: string },
    ) => {
      const step = result?.steps[index];
      expect(["axe", "maestro"]).toContain(step?.backend);
      if (step?.backend === "maestro") {
        expect(step.fellBack?.[0]?.backend).toBe("axe");
      }
      expect(step?.lines).toContainEqual(expect.objectContaining(line));
      expect(existsSync(join(result?.dir ?? "", step?.screenshot ?? "-"))).toBe(
        true,
      );
    };

    test(
      "a scroll step scrolls the list, from the real log and screen",
      async () => {
        const result = await runSteps(["scroll"]);
        scrollDir = result?.dir;
        expectActed(result, 0, { tag: "scroll", message: "scrolled" });
        const after = await runCheck({
          elements: [{ id: "scroll-label", text: "Scrolled" }],
        });
        expect(after.result).toMatchObject({ verdict: "passed" });
      },
      minutes(5),
    );

    test(
      "a type step types into the field a tap focused, from the real log and screen",
      async () => {
        const result = await runSteps([
          { tapOn: { id: "smoke-input" } },
          { inputText: "hello" },
        ]);
        typeDir = result?.dir;
        expectActed(result, 1, { tag: "input", message: "hello" });
        const after = await runCheck({
          elements: [{ id: "smoke-input", text: "hello" }],
        });
        expect(after.result).toMatchObject({ verdict: "passed" });
      },
      minutes(5),
    );

    // Last, so a Maestro flake (#94) fails only this test.
    test(
      "the saved steps replay as Maestro flows",
      async () => {
        const app = "appId: com.emd.sandbox\n---\n";
        const saved: [string | undefined, string][] = [
          [stepsDir, '- tapOn:\n    id: "smoke-button"\n'],
          [scrollDir, "- scroll\n"],
          [typeDir, '- tapOn:\n    id: "smoke-input"\n- inputText: "hello"\n'],
        ];
        for (const [dir, steps] of saved) {
          const flow = join(dir ?? "", "flow.yaml");
          expect(readFileSync(flow, "utf8")).toBe(app + steps);
          const replay = await maestroTest(flow, again?.result?.device.id);
          expect(replay.status, replay.output).toBe(0);
        }
      },
      minutes(12),
    );
  },
);
