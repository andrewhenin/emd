import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { parseAxe } from "../../src/core/device/axe.ts";
import { resetChecks } from "../../src/core/index.ts";
import { parseTagged } from "../../src/core/logs.ts";

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

    // #130: when a test fails, the job log alone says why. It prints what was
    // on screen and the run's last log lines, and saves a screenshot to the
    // run folder (uploaded with the artifact). A passing test prints nothing.
    const lastLines = (path: string) => {
      try {
        return readFileSync(path, "utf8")
          .trimEnd()
          .split("\n")
          .slice(-20)
          .map((line) => line.slice(0, 400))
          .join("\n");
      } catch {
        return "(none)";
      }
    };
    // #163: the time the app wrote each line and the time each input returned,
    // so the job log shows whether an input reached the app late or the check
    // missed a line. A raw app.ndjson line is cut before its time.
    const inputs: string[] = [];
    const appLines = (path: string) => {
      try {
        const text = readFileSync(path, "utf8");
        const lines = parseTagged(text);
        const events = text.split("\n").filter((l) => l.startsWith("{"));
        return [
          `read ${lines.length} of ${events.length} events`,
          ...lines
            .slice(-20)
            .map((l) => `${l.time} [${l.tag}] ${l.message.slice(0, 200)}`),
        ].join("\n");
      } catch {
        return "(none)";
      }
    };
    const explain = async () => {
      const latest = (again ?? final)?.result;
      const dir = latest?.logDir;
      const device = latest?.device?.id;
      const out = ["==== e2e failure: state at the failure ===="];
      if (device && dir) {
        const png = join(dir, `failure-${Date.now()}.png`);
        const shot = await run("xcrun", [
          "simctl",
          "io",
          device,
          "screenshot",
          png,
        ]);
        out.push(`screenshot: ${shot.status === 0 ? png : shot.output.trim()}`);
        const tree = await run("axe", ["describe-ui", "--udid", device]);
        out.push(
          "-- screen (axe describe-ui)",
          tree.status === 0
            ? parseAxe(tree.stdout)
                .slice(0, 40)
                .map((node) => JSON.stringify(node))
                .join("\n")
            : tree.output.trim().slice(0, 600),
        );
      }
      for (const name of ["checks.jsonl", "metro.log"]) {
        out.push(
          `-- ${name}, last 20 lines`,
          dir ? lastLines(join(dir, name)) : "(no run)",
        );
      }
      out.push(
        "-- app.ndjson, last 20 tagged lines, at the time the app wrote each",
        dir ? appLines(join(dir, "app.ndjson")) : "(no run)",
        "-- inputs, at the time each returned",
        inputs.join("\n") || "(none)",
      );
      console.log(out.join("\n"));
    };
    beforeEach(({ onTestFailed }) => onTestFailed(explain, minutes(1)));

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

    // An agent taps, types and swipes through EMD's own tools (decision 0009).
    type Input = { verdict: string; reason?: string; backend?: string };
    const input = async (name: string, args: Record<string, unknown>) => {
      const result = (
        await client.callTool({
          name,
          arguments: { jobId: again?.jobId ?? "", ...args },
        })
      ).structuredContent as Input;
      inputs.push(
        `${new Date().toISOString()} ${name} ${JSON.stringify(args)}: ${result.verdict} (${result.backend})`,
      );
      expect(result.verdict, result.reason).toBe("ok");
      expect(["axe", "maestro"]).toContain(result.backend);
      return result;
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
        waited?: number;
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
        resetChecks(sandbox ?? "");
        const tappedLog = [{ tag: "smoke", message: "tapped" }];
        const before = await runCheck({
          name: "before-tap",
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

        await input("tap", { id: "smoke-button" });
        const after = await runCheck({
          name: "after-tap",
          logs: tappedLog,
          elements: [{ id: "smoke-button" }, { text: "Tapped" }],
        });
        // #140: logged to measure how long a check reads again after a tap.
        console.log(
          `after the tap: the check waited ${after.result?.waited ?? 0} s`,
        );
        expect(after.status).toBe("succeeded");
        expect(after.result).toMatchObject({ verdict: "passed" });
        expect(after.result?.attempt).toBeUndefined();
        expectBackendNamed(after);
      },
      minutes(8),
    );

    test(
      "types into a field and swipes, through EMD's tools",
      async () => {
        // A fresh count, so a failure in the test before does not stop this
        // check before it reads (#163, Nov 12 nightly).
        resetChecks(sandbox ?? "");
        await input("tap", { id: "smoke-input" });
        await input("type", { text: "hello" });
        const typed = await runCheck({
          name: "typed",
          logs: [{ tag: "typed", message: "hello" }],
        });
        expect(typed.result).toMatchObject({ verdict: "passed" });
        // The sandbox has nothing to scroll: this shows only that the swipe ran.
        await input("swipe", { direction: "up" });
      },
      minutes(4),
    );

    test(
      "fix-and-retry stops at the retry limit; the agent's reading never changes the verdict",
      async () => {
        // A fresh count, so a failure in the test before does not fail this one.
        resetChecks(sandbox ?? "");
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
