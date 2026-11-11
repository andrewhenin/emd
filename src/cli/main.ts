import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  check,
  detect,
  doctor,
  evidence,
  gc,
  jobStatus,
  launch,
  logs,
  resetChecks,
  runJob,
  setup,
  swipe,
  tap,
  typeText,
  version,
} from "../core/index.js";

const usage =
  "Commands: detect [dir], launch [dir] [--device X] [--timeout N], job status <id>, logs <jobId> [--tag T] [--limit N], check <jobId> [--log TAG[=TEXT]] [--element id=X|text=Y] [--name N] [--agent pass|fail], check reset [dir], tap <jobId> --id X|--text Y|--x N --y N, type <jobId> [--] <text>, swipe <jobId> up|down|left|right, evidence <jobId>, gc [--apply], setup [--dry-run] [--yes] [--agent claude-code|codex|cursor], doctor, mcp";

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

const ask = async (question: string): Promise<string> => {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await prompt.question(question);
  prompt.close();
  return answer.trim();
};

// Only a person at a terminal can start the failure count over (decision 0006).
async function resetCommand(dir?: string): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("emd: check reset needs a person at a terminal.");
    return 2;
  }
  const { root } = await detect(dir);
  const typed = await ask(
    `Clear the failed-check count for ${root}? Type "reset": `,
  );
  if (typed !== "reset") {
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
    case "tap": {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
          id: { type: "string" },
          text: { type: "string" },
          x: { type: "string" },
          y: { type: "string" },
        },
      });
      const number = (raw?: string) =>
        raw === undefined ? undefined : Number(raw);
      const result = await tap({
        jobId: positionals[0] ?? "",
        id: values.id,
        text: values.text,
        x: number(values.x),
        y: number(values.y),
      });
      console.log(JSON.stringify(result));
      return result.verdict === "ok" ? 0 : 1;
    }
    case "type":
    case "swipe": {
      const { positionals } = parseArgs({ args, allowPositionals: true });
      const [jobId = "", value = ""] = positionals;
      const result =
        command === "type"
          ? await typeText({ jobId, text: value })
          : await swipe({ jobId, direction: value });
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
    case "doctor": {
      const result = await doctor();
      console.log(JSON.stringify(result));
      return result.verdict === "ready" ? 0 : 1;
    }
    case "setup": {
      const { values } = parseArgs({
        args,
        options: {
          "dry-run": { type: "boolean" },
          yes: { type: "boolean" },
          agent: { type: "string", multiple: true },
        },
      });
      const only = values.agent;
      const plan = await setup({ only });
      if (plan.verdict !== "planned" || values["dry-run"]) {
        console.log(JSON.stringify(plan));
        return plan.verdict === "failed" ? 1 : 0;
      }
      // One approval for the whole plan (decision 0002). Without a person at a
      // terminal, only --yes applies it.
      let approved = values.yes === true;
      if (!approved && process.stdin.isTTY && process.stdout.isTTY) {
        const axe = plan.axe
          ? `EMD setup will install AXe ${plan.axe.version} into ${plan.axe.dir}, from ${plan.axe.url}, SHA-256 ${plan.axe.sha256}.\n`
          : "";
        console.error(
          `${axe}EMD setup will run, for ${plan.agents.map((a) => a.id).join(", ")}:\n${plan.steps.map((s) => `  ${s}`).join("\n")}\nIt backs up each config first, in ~/.emd/backups.`,
        );
        approved = !/^n/i.test(await ask("Apply? [Y/n] "));
      }
      if (!approved) {
        console.log(JSON.stringify(plan));
        return 0;
      }
      const result = await setup({ only, apply: true });
      console.log(JSON.stringify(result));
      if (result.restart && process.stderr.isTTY) {
        for (const check of result.doctor?.checks ?? []) {
          if (check.fix) console.error(`Missing ${check.name}: ${check.fix}`);
        }
        console.error(`Restart ${result.restart.join(", ")} to load EMD.`);
      }
      return result.verdict === "done" ? 0 : 1;
    }
    default:
      console.error(`emd: unknown command "${command}". ${usage}`);
      return 2;
  }
}
