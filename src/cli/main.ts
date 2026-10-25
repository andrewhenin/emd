import { parseArgs } from "node:util";
import {
  check,
  detect,
  evidence,
  jobStatus,
  launch,
  logs,
  runJob,
  version,
} from "../core/index.js";

const usage =
  "Commands: detect [dir], launch [dir] [--device X] [--timeout N], job status <id>, logs <jobId> [--tag T] [--limit N], check <jobId> [--log TAG[=TEXT]] [--element id=X|text=Y] [--retry-limit N] [--name N] [--agent pass|fail] [--reset], evidence <jobId>, mcp";

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
          since: { type: "string" },
          device: { type: "string" },
          app: { type: "string" },
        },
      });
      const result = await logs({
        jobId: positionals[0],
        tag: values.tag,
        since: values.since,
        device: values.device,
        appId: values.app,
        limit: values.limit === undefined ? undefined : Number(values.limit),
      });
      console.log(JSON.stringify(result));
      return result.verdict === "ok" ? 0 : 1;
    }
    case "check": {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
          log: { type: "string", multiple: true },
          element: { type: "string", multiple: true },
          "retry-limit": { type: "string" },
          name: { type: "string" },
          agent: { type: "string" },
          reset: { type: "boolean" },
          since: { type: "string" },
          device: { type: "string" },
          app: { type: "string" },
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
      const retryLimit = values["retry-limit"];
      const result = await check({
        jobId: positionals[0],
        device: values.device,
        appId: values.app,
        since: values.since,
        logs: (values.log ?? []).map(logSpec),
        elements,
        retryLimit: retryLimit === undefined ? undefined : Number(retryLimit),
        name: values.name,
        reset: values.reset,
        agentReading: values.agent as "pass" | "fail" | undefined,
      });
      console.log(JSON.stringify(result));
      return result.verdict === "passed" ? 0 : 1;
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
    default:
      console.error(`emd: unknown command "${command}". ${usage}`);
      return 2;
  }
}
