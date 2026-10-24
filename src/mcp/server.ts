import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  detect,
  detectResultSchema,
  launch,
  launchResultSchema,
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
        "Build the app, install it on an iOS simulator and launch it, leaving its dev server running. Can take minutes. Returns a verdict, the device, app ID and log directory; on failure, the first relevant error lines, not the log.",
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
      outputSchema: launchResultSchema,
    },
    async (input) => {
      const result = await launch(input);
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
