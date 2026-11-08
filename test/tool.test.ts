import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runTool } from "../src/core/tool.ts";

const running = (marker: string): boolean => {
  try {
    execFileSync("pgrep", ["-f", marker]);
    return true;
  } catch {
    return false;
  }
};

test("a timed-out call names its step and says how long it waited", async () => {
  await expect(runTool("sleeper", "sleep", ["300"], 0.3)).rejects.toThrow(
    "sleeper timed out after 0.3s",
  );
});

test("a failed call keeps the tool's own error text", async () => {
  await expect(
    runTool("failer", "sh", ["-c", "echo boom >&2; exit 3"], 5),
  ).rejects.toThrow("failer failed (exit 3): boom");
});

test("a failed or timed-out call still hands back what the tool printed", async () => {
  await expect(
    runTool("printer", "sh", ["-c", "echo tree; exit 2"], 5),
  ).rejects.toMatchObject({ stdout: "tree\n" });
  await expect(
    runTool("printer", "sh", ["-c", "echo tree; sleep 300"], 0.5),
  ).rejects.toMatchObject({
    message: "printer timed out after 0.5s",
    stdout: "tree\n",
  });
});

test("extra env reaches the tool, on top of the inherited env", async () => {
  const { stdout } = await runTool(
    "env",
    "sh",
    ["-c", 'printf "%s %s" "$EMD_EXTRA" "$HOME"'],
    5,
    { env: { EMD_EXTRA: "on" } },
  );
  expect(stdout).toBe(`on ${process.env.HOME}`);
});

test("a character split between two pipe reads stays whole", async () => {
  // One ASCII byte first, so two-byte characters cross the read boundaries.
  const { stdout } = await runTool(
    "printer",
    process.execPath,
    ["-e", "process.stdout.write('a' + 'é'.repeat(200000))"],
    10,
  );
  expect(stdout).toBe(`a${"é".repeat(200000)}`);
});

test("a timeout settles even when a child left the group and holds stdout", async () => {
  // detached makes the child call setsid, so the group kill misses it.
  const holder =
    "require('node:child_process').spawn('sleep', ['31339'], { detached: true, stdio: 'inherit' })";
  const started = Date.now();
  try {
    await expect(
      runTool("holder", process.execPath, ["-e", holder], 0.5),
    ).rejects.toThrow("holder timed out after 0.5s");
    expect(Date.now() - started).toBeLessThan(3000);
  } finally {
    try {
      const pids = execFileSync("pgrep", ["-f", "sleep 31339"], {
        encoding: "utf8",
      });
      for (const pid of pids.split("\n").filter(Boolean)) {
        process.kill(Number(pid), "SIGKILL");
      }
    } catch {}
  }
});

test("a tool that cannot start rejects with ENOENT", async () => {
  await expect(runTool("ghost", "emd-no-such-binary", [], 5)).rejects.toThrow(
    "ENOENT",
  );
});

test("a timeout leaves no process behind when the tool does not pass signals on", async () => {
  // A stand-in for xcrun: it runs the real tool as a child and waits for it.
  const dir = mkdtempSync(join(tmpdir(), "emd-tool-"));
  const fake = join(dir, "wrapper");
  writeFileSync(fake, "#!/bin/sh\nsleep 31337 &\nwait\n");
  chmodSync(fake, 0o755);
  await expect(runTool("wrapper", fake, [], 0.5)).rejects.toThrow("timed out");
  expect(running("sleep 31337")).toBe(false);
});

test.skipIf(process.platform !== "darwin")(
  "a timeout leaves no process behind through the real xcrun",
  async () => {
    await expect(
      runTool("xcrun", "xcrun", ["sleep", "31338"], 1),
    ).rejects.toThrow("xcrun timed out after 1s");
    expect(running("sleep 31338")).toBe(false);
  },
);
