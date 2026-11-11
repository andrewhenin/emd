import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type SetupDeps, setup } from "../src/core/setup.ts";
import { makeDir } from "./helpers.ts";

// A home folder with the given agents' folders and configs.
function home(files: Record<string, string>): string {
  const dir = makeDir();
  for (const [path, text] of Object.entries(files)) {
    const folder = path.endsWith("/") ? path : join(path, "..");
    mkdirSync(join(dir, folder), { recursive: true });
    if (!path.endsWith("/")) writeFileSync(join(dir, path), text);
  }
  return dir;
}

const allAgents = {
  ".claude.json": '{"numStartups":3,"mcpServers":{"other":{"command":"x"}}}',
  ".claude/": "",
  ".codex/config.toml": 'model = "gpt-5"\n',
  ".cursor/mcp.json": '{"mcpServers":{}}',
};

// `emd setup` through the real CLI, with HOME and EMD's state in temp folders.
const cli = (dir: string, ...args: string[]) =>
  spawnSync("node", ["dist/bin.js", "setup", ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: dir, EMD_STATE_DIR: join(dir, ".emd") },
  });

test("without --yes and without a terminal, setup prints its plan and changes nothing", () => {
  const dir = home(allAgents);
  const run = cli(dir);
  expect(run.status).toBe(0);
  const plan = JSON.parse(run.stdout);
  expect(plan.verdict).toBe("planned");
  expect(plan.agents.map((a: { id: string }) => a.id)).toEqual([
    "claude-code",
    "codex",
    "cursor",
  ]);
  const steps = plan.steps.join("\n");
  expect(steps).toContain("add-mcp@2.6.1");
  expect(steps).toContain("mobilebuildmcp@2.7.1");
  expect(steps).toContain(
    "MOBILEBUILDMCP_ENABLED_WORKFLOWS=simulator,ui-automation",
  );
  expect(steps).toContain("skills@1.7.6 add");
  expect(readFileSync(join(dir, ".codex/config.toml"), "utf8")).toBe(
    'model = "gpt-5"\n',
  );
  expect(existsSync(join(dir, ".emd"))).toBe(false);
});

test("--agent picks agents; an unknown one or no agent at all changes nothing", () => {
  const dir = home(allAgents);
  const codex = JSON.parse(cli(dir, "--dry-run", "--agent", "codex").stdout);
  expect(codex.agents.map((a: { id: string }) => a.id)).toEqual(["codex"]);
  expect(codex.steps.join("\n")).not.toContain("claude-code");

  const unknown = cli(dir, "--agent", "zed");
  expect(unknown.status).toBe(1);
  expect(JSON.parse(unknown.stdout).reason).toMatch(/Unknown agent: zed/);

  const none = cli(home({}), "--yes");
  expect(none.status).toBe(1);
  expect(JSON.parse(none.stdout).reason).toMatch(/No supported agent/);
});

test("a config that is not valid JSON stops setup before any write", () => {
  const dir = home({ ...allAgents, ".cursor/mcp.json": "{not json" });
  const run = cli(dir, "--yes");
  expect(run.status).toBe(1);
  expect(JSON.parse(run.stdout).reason).toMatch(/Not valid JSON/);
  expect(existsSync(join(dir, ".emd"))).toBe(false);
});

// Installers that write what add-mcp and skills write, without the network.
const installers = (dir: string): SetupDeps => ({
  run: async (_command, args) => {
    const name = args[args.indexOf("-n") + 1];
    if (args.includes("add")) {
      mkdirSync(join(dir, ".agents/skills/emd"), { recursive: true });
      writeFileSync(join(dir, ".agents/skills/emd/SKILL.md"), "skill");
      return;
    }
    const claude = JSON.parse(readFileSync(join(dir, ".claude.json"), "utf8"));
    claude.mcpServers[name ?? ""] = { command: "npx" };
    writeFileSync(join(dir, ".claude.json"), JSON.stringify(claude));
    const cursor = JSON.parse(
      readFileSync(join(dir, ".cursor/mcp.json"), "utf8"),
    );
    cursor.mcpServers[name ?? ""] = { command: "npx" };
    writeFileSync(join(dir, ".cursor/mcp.json"), JSON.stringify(cursor));
    const toml = join(dir, ".codex/config.toml");
    writeFileSync(
      toml,
      `${readFileSync(toml, "utf8")}\n[mcp_servers.${name}]\ncommand = "npx"\n`,
    );
  },
});

const realHome = process.env.HOME;
const realState = process.env.EMD_STATE_DIR;
afterEach(() => {
  process.env.HOME = realHome;
  process.env.EMD_STATE_DIR = realState;
});

test("applied, setup backs up each config, runs the installers and checks the result", async () => {
  const dir = home(allAgents);
  process.env.HOME = dir;
  process.env.EMD_STATE_DIR = join(dir, ".emd");
  const result = await setup({ apply: true }, installers(dir));
  expect(result.verdict).toBe("done");
  expect(result.restart).toEqual(["claude-code", "codex", "cursor"]);
  // Backups hold the configs as they were.
  const backup = result.agents.find((a) => a.id === "codex")?.backup ?? "";
  expect(readFileSync(backup, "utf8")).toBe('model = "gpt-5"\n');
  // Codex waits 30 s for each EMD server, not its default 10 s.
  const toml = readFileSync(join(dir, ".codex/config.toml"), "utf8");
  expect(toml.match(/startup_timeout_sec = 30/g)).toHaveLength(2);
  // Unrelated entries stay.
  const claude = JSON.parse(readFileSync(join(dir, ".claude.json"), "utf8"));
  expect(claude.numStartups).toBe(3);
  expect(Object.keys(claude.mcpServers)).toEqual([
    "other",
    "emd",
    "mobilebuildmcp",
  ]);
});

test("when an installer fails, setup fails and names the backups", async () => {
  const dir = home(allAgents);
  process.env.HOME = dir;
  process.env.EMD_STATE_DIR = join(dir, ".emd");
  const result = await setup(
    { apply: true },
    {
      run: async () => {
        throw new Error("npx add-mcp failed (exit 1): offline");
      },
    },
  );
  expect(result.verdict).toBe("failed");
  expect(result.reason).toMatch(/offline.*Backups: /);
  expect(readdirSync(join(dir, ".emd/backups"))).toHaveLength(1);
});
