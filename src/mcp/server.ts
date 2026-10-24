import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { detect, detectResultSchema, version } from "../core/index.js";

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

  return server;
}

// stdout is the protocol channel: never log to it. Serves 2025-era and
// 2026-07-28 clients from the same factory.
export function startServer(): void {
  serveStdio(buildServer);
}
