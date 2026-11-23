import { expect, test } from "vitest";
import { cli, expoConfig, expoProject } from "./helpers.ts";

const doctor = (...args: string[]) => {
  const run = cli("doctor", ...args);
  return { status: run.status, result: JSON.parse(run.stdout) };
};

// Through the real CLI. Off macOS, the iOS checks stop at "macos" with a fix.
test.skipIf(process.platform === "darwin")(
  "off macOS, an iOS project gets Node, then macOS missing with its fix",
  () => {
    const dir = expoProject(
      expoConfig({ platforms: ["ios"], ios: { bundleIdentifier: "com.x" } }),
    );
    const { status, result } = doctor(dir);
    expect(status).toBe(1);
    expect(result).toEqual({
      verdict: "missing",
      platforms: { ios: "missing" },
      checks: [
        { name: "node", status: "ok", detail: expect.any(String) },
        {
          name: "macos",
          platform: "ios",
          status: "missing",
          detail: process.platform,
          fix: expect.stringMatching(/macOS/),
        },
      ],
    });
  },
);

test("an Android project gets only Android checks, each missing one with a fix", () => {
  const { result } = doctor("fixtures/android-native");
  expect(Object.keys(result.platforms)).toEqual(["android"]);
  const names = result.checks.map((c: { name: string }) => c.name);
  expect(names[0]).toBe("node");
  expect(names).toContain("adb");
  expect(names).not.toContain("macos");
  for (const check of result.checks) {
    if (check.status === "missing") expect(check.fix).toBeTruthy();
  }
});

test("outside a project, both platforms are checked and each missing item has a fix", () => {
  const { status, result } = doctor();
  expect(Object.keys(result.platforms).sort()).toEqual(["android", "ios"]);
  expect(status).toBe(result.verdict === "ready" ? 0 : 1);
  expect(result.verdict).toBe(
    Object.values(result.platforms).includes("ready") ? "ready" : "missing",
  );
  for (const check of result.checks) {
    if (check.status === "missing") expect(check.fix).toBeTruthy();
  }
});
