import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
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

test("a tool that cannot start rejects without killing anything", async () => {
  const kill = vi.spyOn(process, "kill");
  try {
    await expect(runTool("ghost", "emd-no-such-binary", [], 5)).rejects.toThrow(
      "ENOENT",
    );
    expect(kill).not.toHaveBeenCalled();
  } finally {
    kill.mockRestore();
  }
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
