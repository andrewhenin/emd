import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { detect, version } from "../core/index.js";

export async function startServer(): Promise<void> {
  const server = new McpServer({ name: "emd", version: version() });

  server.registerTool(
    "detect",
    {
      description:
        "Detect the mobile stack of a project directory. Returns a small verdict, not file contents.",
      inputSchema: {
        dir: z
          .string()
          .optional()
          .describe(
            "Project directory. Defaults to the server's working directory.",
          ),
      },
      outputSchema: {
        verdict: z.enum(["detected", "none"]),
        root: z.string(),
        stack: z.enum(["expo"]).optional(),
      },
    },
    async ({ dir }) => {
      const result = await detect(dir);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  await server.connect(new StdioServerTransport());
}
