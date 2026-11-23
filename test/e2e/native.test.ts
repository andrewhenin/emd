import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// The ios-native pair (decision 0007): a real build, launch and check of
// fixtures/ios-native on an iOS simulator, through the MCP server. It runs in
// `npm run test:e2e` on macOS with Xcode; skipped elsewhere.
type Job = {
  jobId: string;
  status: string;
  result?: { verdict: string; metro?: unknown; [key: string]: unknown };
};

describe.skipIf(!process.env.EMD_E2E_SANDBOX || process.platform !== "darwin")(
  "native iOS on a real simulator",
  () => {
    const client = new Client({ name: "emd-e2e-native", version: "0.0.0" });
    // Starts a tool's job and waits on job_status until it ends.
    const run = async (tool: string, args: object): Promise<Job> => {
      const view = async (name: string, input: object) =>
        (
          await client.callTool(
            { name, arguments: input as Record<string, unknown> },
            { timeout: 150_000 },
          )
        ).structuredContent as Job;
      let job = await view(tool, args);
      while (job.status !== "succeeded" && job.status !== "failed") {
        job = await view("job_status", { jobId: job.jobId });
      }
      return job;
    };
    let launched: Job;

    beforeAll(async () => {
      await client.connect(
        new StdioClientTransport({
          command: "node",
          args: ["dist/bin.js", "mcp"],
          env: { ...process.env, EMD_WAIT_SECONDS: "100" } as Record<
            string,
            string
          >,
        }),
      );
      launched = await run("launch", { dir: resolve("fixtures/ios-native") });
    }, 20 * 60_000);

    afterAll(() => client.close());

    test("launch builds, installs and opens the app, with no dev server", () => {
      expect(launched.status, JSON.stringify(launched.result)).toBe(
        "succeeded",
      );
      expect(launched.result).toMatchObject({
        verdict: "launched",
        appId: "com.emd.nativefixture",
        build: { action: "built" },
      });
      expect(launched.result?.metro).toBeUndefined();
    });

    test(
      "a check taps the button, then finds the tagged log line and the new label",
      async () => {
        const checked = await run("check", {
          jobId: launched.jobId,
          name: "native",
          actions: [{ tap: { id: "smoke-button" } }],
          logs: [{ tag: "smoke", message: "tapped" }],
          elements: [{ text: "Tapped" }],
        });
        expect(checked.result?.verdict, JSON.stringify(checked.result)).toBe(
          "passed",
        );
      },
      5 * 60_000,
    );
  },
);
