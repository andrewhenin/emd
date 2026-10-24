#!/usr/bin/env node
import { run } from "./cli/main.js";

// Composition root: the only file that knows about both the CLI and the MCP
// server. The server loads on demand so CLI commands never pay for the SDK.
const args = process.argv.slice(2);

if (args[0] === "mcp") {
  (await import("./mcp/server.js")).startServer();
} else {
  process.exitCode = await run(args);
}
