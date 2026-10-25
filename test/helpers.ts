import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll } from "vitest";

export function makeDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "emd-test-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

// An Expo project; `files` add to or override the default package.json.
export const expoProject = (files: Record<string, string> = {}) =>
  makeDir({
    "package.json": JSON.stringify({ dependencies: { expo: "~58.0.0" } }),
    ...files,
  });

export const appJson = (expo: object) => JSON.stringify({ expo });

export const cli = (...args: string[]) =>
  spawnSync("node", ["dist/bin.js", ...args], { encoding: "utf8" });

export type View = {
  jobId: string;
  kind: string;
  status: string;
  step?: string;
  seconds: number;
  result?: Record<string, unknown>;
};

// The real MCP server over stdio, connected for the file's tests. `finished`
// polls a job until it succeeds or fails.
export function mcpSession(state: string) {
  const client = new Client({ name: "emd-test", version: "0.0.0" });

  beforeAll(async () => {
    await client.connect(
      new StdioClientTransport({
        command: "node",
        args: ["dist/bin.js", "mcp"],
        env: { ...process.env, EMD_STATE_DIR: state } as Record<string, string>,
      }),
    );
  });

  afterAll(async () => {
    await client.close();
  });

  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args }))
      .structuredContent as View;

  const finished = async (jobId: string): Promise<View> => {
    let job = await call("job_status", { jobId });
    for (
      let i = 0;
      i < 80 && !["succeeded", "failed"].includes(job.status);
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      job = await call("job_status", { jobId });
    }
    return job;
  };

  return { client, call, finished };
}
