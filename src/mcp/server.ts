import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  detect,
  detectResultSchema,
  jobStatus,
  jobViewSchema,
  logs,
  logsResultSchema,
  startJob,
  version,
} from "../core/index.js";

function buildServer(): McpServer {
  const server = new McpServer({ name: "emd", version: version() });

  server.registerTool(
    "detect",
    {
      description:
        "Detect the mobile stack of a project directory and what launching it needs: platforms, app IDs, run commands, package manager. Returns a small result, not file contents.",
      inputSchema: z.object({
        dir: z
          .string()
          .optional()
          .describe(
            "Project directory. Defaults to the server's working directory.",
          ),
      }),
      outputSchema: detectResultSchema,
    },
    async ({ dir }) => {
      const result = await detect(dir);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "launch",
    {
      description:
        "Start building the app, installing it on an iOS simulator and launching it, leaving its dev server running. Returns a job within seconds; the work takes up to minutes. Call job_status with the jobId every 5 to 10 seconds until status is succeeded or failed.",
      inputSchema: z.object({
        dir: z
          .string()
          .optional()
          .describe(
            "Project directory. Defaults to the server's working directory.",
          ),
        device: z
          .string()
          .optional()
          .describe(
            "Simulator name or UDID. Default: a booted iPhone, else the newest iPhone.",
          ),
        timeoutSeconds: z
          .number()
          .positive()
          .optional()
          .describe("How long the build may take. Default 900."),
      }),
      outputSchema: jobViewSchema,
    },
    async (input) => {
      const job = startJob("launch", input);
      return {
        content: [{ type: "text", text: JSON.stringify(job) }],
        structuredContent: job,
      };
    },
  );

  server.registerTool(
    "job_status",
    {
      description:
        "Where a job is: queued, running (with the current step and seconds), succeeded or failed. When finished, includes the result: for launch, the device, app ID and log directory, or on failure the reason and the first relevant error lines, not the log.",
      inputSchema: z.object({
        jobId: z.string().describe("The jobId a tool such as launch returned."),
      }),
      outputSchema: jobViewSchema,
    },
    async ({ jobId }) => {
      const job = jobStatus(jobId);
      if (!job) {
        return {
          isError: true,
          content: [{ type: "text", text: `No job with id "${jobId}".` }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(job) }],
        structuredContent: job,
      };
    },
  );

  server.registerTool(
    "logs",
    {
      description:
        "Tagged log lines an app wrote during a run: lines containing [EMD:<tag>], as written by console.log in the app, with time, tag and message. A run is a launch job, so pass the jobId from launch; only that app's lines since the job started are returned, never an earlier run's or another app's. Returns the most recent lines and the total count.",
      inputSchema: z.object({
        jobId: z
          .string()
          .optional()
          .describe("The launch job whose run to read. Preferred."),
        device: z
          .string()
          .optional()
          .describe(
            "Simulator UDID, with appId and since, instead of a jobId.",
          ),
        appId: z.string().optional().describe("App ID, with device and since."),
        since: z
          .string()
          .optional()
          .describe(
            "ISO time to read from. Defaults to the job's start; use it to read only what is new.",
          ),
        tag: z
          .string()
          .optional()
          .describe("Only lines tagged [EMD:<tag>], e.g. smoke."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("How many of the most recent lines to return. Default 50."),
      }),
      outputSchema: logsResultSchema,
    },
    async (input) => {
      const result = await logs(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  return server;
}

// stdout is the protocol channel: never log to it. Serves 2025-era and
// 2026-07-28 clients from the same factory.
export function startServer(): void {
  serveStdio(buildServer);
}
