import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  check,
  detect,
  evidence,
  gc,
  jobStatus,
  launch,
  logs,
  resetChecks,
  runJob,
  steps,
  version,
} from "../core/index.js";

const usage =
  "Commands: detect [dir], launch [dir] [--device X] [--timeout N], job status <id>, logs <jobId> [--tag T] [--limit N], check <jobId> [--log TAG[=TEXT]] [--element id=X|text=Y] [--name N] [--agent pass|fail], check reset [dir], steps <jobId> --step JSON..., evidence <jobId>, gc [--apply], mcp";

// --log smoke   or   --log smoke=tapped
const logSpec = (raw: string) => {
  const at = raw.indexOf("=");
  return at < 0
    ? { tag: raw }
    : { tag: raw.slice(0, at), message: raw.slice(at + 1) };
};

// --element id=smoke-button   or   text=Tapped   or   '{"id":"x","text":"y"}'
const elementSpec = (raw: string): { id?: string; text?: string } => {
  if (raw.startsWith("{")) return JSON.parse(raw);
  const at = raw.indexOf("=");
  const key = raw.slice(0, at);
  if (at < 0 || (key !== "id" && key !== "text")) {
    throw new Error(`--element wants id=X, text=Y or JSON, not "${raw}"`);
  }
  return { [key]: raw.slice(at + 1) };
};

// Only a person at a terminal can start the failure count over (decision 0006).
async function resetCommand(dir?: string): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("emd: check reset needs a person at a terminal.");
    return 2;
  }
  const { root } = await detect(dir);
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const typed = await prompt.question(
    `Clear the failed-check count for ${root}? Type "reset": `,
  );
  prompt.close();
  if (typed.trim() !== "reset") {
    console.error("emd: not reset.");
    return 1;
  }
  resetChecks(root);
  console.log(JSON.stringify({ verdict: "reset", root }));
  return 0;
}

export async function run(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case undefined:
      console.log(`emd ${version()}`);
      return 0;
    case "detect":
      console.log(JSON.stringify(await detect(args[0])));
      return 0;
    case "launch": {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
          device: { type: "string" },
          timeout: { type: "string" },
        },
      });
      const timeoutSeconds = values.timeout
        ? Number(values.timeout)
        : undefined;
      if (timeoutSeconds !== undefined && !(timeoutSeconds > 0)) {
        console.error(`emd: --timeout must be a number of seconds. ${usage}`);
        return 2;
      }
      const result = await launch({
        dir: positionals[0],
        device: values.device,
        timeoutSeconds,
      });
      console.log(JSON.stringify(result));
      return result.verdict === "launched" ? 0 : 1;
    }
    case "job": {
      const [action, id] = args;
      if (action === "run" && id) {
        // Internal: the worker process that a started job runs in.
        await runJob(id);
        return 0;
      }
      if (action === "status" && id) {
        const job = jobStatus(id);
        if (!job) {
          console.error(`emd: no job "${id}".`);
          return 1;
        }
        console.log(JSON.stringify(job));
        return 0;
      }
      console.error(`emd: usage: job status <id>. ${usage}`);
      return 2;
    }
    case "logs": {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
          tag: { type: "string" },
          limit: { type: "string" },
        },
      });
      const jobId = positionals[0];
      if (!jobId) {
        console.error(`emd: usage: logs <jobId>. ${usage}`);
        return 2;
      }
      const result = await logs({
        jobId,
        tag: values.tag,
        limit: values.limit === undefined ? undefined : Number(values.limit),
      });
      console.log(JSON.stringify(result));
      return result.verdict === "ok" ? 0 : 1;
    }
    case "check": {
      if (args[0] === "reset") return resetCommand(args[1]);
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
          log: { type: "string", multiple: true },
          element: { type: "string", multiple: true },
          agent: { type: "string" },
          name: { type: "string" },
        },
      });
      if (values.agent && values.agent !== "pass" && values.agent !== "fail") {
        console.error(`emd: --agent is pass or fail. ${usage}`);
        return 2;
      }
      let elements: { id?: string; text?: string }[];
      try {
        elements = (values.element ?? []).map(elementSpec);
      } catch (error) {
        console.error(`emd: ${(error as Error).message}`);
        return 2;
      }
      const jobId = positionals[0];
      if (!jobId) {
        console.error(`emd: usage: check <jobId>. ${usage}`);
        return 2;
      }
      const result = await check({
        jobId,
        logs: (values.log ?? []).map(logSpec),
        elements,
        name: values.name,
        agentReading: values.agent as "pass" | "fail" | undefined,
      });
      console.log(JSON.stringify(result));
      return result.verdict === "passed" ? 0 : 1;
    }
    case "steps": {
      // --step '{"tapOn":{"id":"smoke-button"}}' --step '{"tapOn":"Tap me"}'
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: { step: { type: "string", multiple: true } },
      });
      const jobId = positionals[0];
      if (!jobId) {
        console.error(`emd: usage: steps <jobId> --step JSON. ${usage}`);
        return 2;
      }
      let asked: unknown[];
      try {
        asked = (values.step ?? []).map((raw) => JSON.parse(raw));
      } catch {
        console.error(
          `emd: each --step is a Maestro command as JSON. ${usage}`,
        );
        return 2;
      }
      const result = await steps({
        jobId,
        steps: asked as Parameters<typeof steps>[0]["steps"],
      });
      console.log(JSON.stringify(result));
      return result.verdict === "ran" ? 0 : 1;
    }
    case "evidence": {
      const jobId = args[0];
      if (!jobId) {
        console.error(`emd: usage: evidence <jobId>. ${usage}`);
        return 2;
      }
      const result = await evidence({ jobId });
      console.log(JSON.stringify(result));
      return result.verdict === "written" ? 0 : 1;
    }
    case "gc": {
      const { values } = parseArgs({
        args,
        options: { apply: { type: "boolean" } },
      });
      const result = await gc({ apply: values.apply });
      console.log(JSON.stringify(result));
      const failed =
        result.verdict === "failed" ||
        result.entries.some((e) => e.status === "failed");
      return failed ? 1 : 0;
    }
    default:
      console.error(`emd: unknown command "${command}". ${usage}`);
      return 2;
  }
}
