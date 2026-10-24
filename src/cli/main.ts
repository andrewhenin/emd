import { parseArgs } from "node:util";
import { detect, jobStatus, launch, runJob, version } from "../core/index.js";

const usage =
  "Commands: detect [dir], launch [dir] [--device X] [--timeout N], job status <id>, mcp";

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
    default:
      console.error(`emd: unknown command "${command}". ${usage}`);
      return 2;
  }
}
