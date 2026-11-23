import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { axeDir, axePin } from "../src/core/device/axe.ts";
import { detectEnvironment } from "../src/core/device/backend.ts";
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
const setupWith = (bin: string, dir: string, ...args: string[]) =>
  spawnSync("node", [bin, "setup", ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: dir, EMD_STATE_DIR: join(dir, ".emd") },
  });
const cli = (dir: string, ...args: string[]) =>
  setupWith("dist/bin.js", dir, ...args);

// The package as npm installs it: packed, unpacked into a node_modules folder,
// with its dependencies linked from this clone.
function installed(): string {
  const dir = realpathSync(makeDir());
  const pack = spawnSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", dir],
    { encoding: "utf8" },
  );
  const [{ filename }] = JSON.parse(pack.stdout);
  const pkg = join(dir, "node_modules", "emd-agents");
  mkdirSync(pkg, { recursive: true });
  const tar = ["-xzf", join(dir, filename), "-C", pkg, "--strip-components=1"];
  expect(spawnSync("tar", tar).status).toBe(0);
  const { dependencies } = JSON.parse(readFileSync("package.json", "utf8"));
  for (const name of Object.keys(dependencies)) {
    const link = join(dir, "node_modules", name);
    mkdirSync(join(link, ".."), { recursive: true });
    symlinkSync(join(process.cwd(), "node_modules", name), link);
  }
  return pkg;
}

test("the package has the skill, and setup from it plans its own version through npx", () => {
  const pkg = installed();
  expect(existsSync(join(pkg, "skills/emd/SKILL.md"))).toBe(true);
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const run = setupWith(join(pkg, "dist/bin.js"), home(allAgents), "--dry-run");
  const steps = JSON.parse(run.stdout).steps.join("\n");
  expect(steps).toContain(`npx -y emd-agents@${version} mcp`);
  expect(steps).toContain(`skills@1.7.6 add ${pkg}`);
}, 30_000);

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
  // From a clone, setup registers the clone's build.
  expect(steps).toContain(join(process.cwd(), "dist/bin.js"));
  // Agents tap through EMD (decision 0009): no second server.
  expect(steps.toLowerCase()).not.toContain("mobilebuildmcp");
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
// Off macOS, so setup plans no AXe.
const installers = (dir: string): SetupDeps => ({
  platform: "linux",
  axe: axePin,
  run: async (_command, args) => {
    const name = args[args.indexOf("-n") + 1];
    if (args.includes("add")) {
      mkdirSync(join(dir, ".agents/skills/emd"), { recursive: true });
      writeFileSync(join(dir, ".agents/skills/emd/SKILL.md"), "skill");
      return;
    }
    // Only the agents named with -a, as add-mcp does.
    const to = args.flatMap((a, i) => (args[i - 1] === "-a" ? [a] : []));
    const env = args.flatMap((a, i) => (args[i - 1] === "--env" ? [a] : []));
    const entry = {
      command: "npx",
      ...(env.length > 0 && {
        env: Object.fromEntries(env.map((e) => e.split("="))),
      }),
    };
    if (to.includes("claude-code")) {
      const path = join(dir, ".claude.json");
      const claude = JSON.parse(readFileSync(path, "utf8"));
      claude.mcpServers[name ?? ""] = entry;
      writeFileSync(path, JSON.stringify(claude));
    }
    if (to.includes("cursor")) {
      const path = join(dir, ".cursor/mcp.json");
      const cursor = JSON.parse(readFileSync(path, "utf8"));
      cursor.mcpServers[name ?? ""] = entry;
      writeFileSync(path, JSON.stringify(cursor));
    }
    if (to.includes("codex")) {
      const toml = join(dir, ".codex/config.toml");
      writeFileSync(
        toml,
        `${readFileSync(toml, "utf8")}\n[mcp_servers.${name}]\ncommand = "npx"\n`,
      );
    }
  },
});

const realHome = process.env.HOME;
const realState = process.env.EMD_STATE_DIR;
afterEach(() => {
  process.env.HOME = realHome;
  process.env.EMD_STATE_DIR = realState;
});

// A home with every agent, for setup called in this process.
function inProcessHome(): string {
  const dir = home(allAgents);
  process.env.HOME = dir;
  process.env.EMD_STATE_DIR = join(dir, ".emd");
  return dir;
}

test("applied, setup backs up each config, runs the installers and checks the result", async () => {
  const dir = inProcessHome();
  const result = await setup({ apply: true }, installers(dir));
  expect(result.verdict).toBe("done");
  expect(result.restart).toEqual(["claude-code", "codex", "cursor"]);
  expect(result.axe).toBeUndefined();
  // doctor runs at the end.
  expect(result.doctor?.checks.length).toBeGreaterThan(0);
  // Backups hold the configs as they were.
  const backup = result.agents.find((a) => a.id === "codex")?.backup ?? "";
  expect(readFileSync(backup, "utf8")).toBe('model = "gpt-5"\n');
  // Unrelated entries stay.
  const claude = JSON.parse(readFileSync(join(dir, ".claude.json"), "utf8"));
  expect(claude.numStartups).toBe(3);
  expect(Object.keys(claude.mcpServers)).toEqual(["other", "emd"]);
  // #223: Claude Code gets the long wait; Cursor and Codex keep the short one.
  expect(claude.mcpServers.emd.env).toEqual({ EMD_WAIT_SECONDS: "100" });
  const cursor = JSON.parse(
    readFileSync(join(dir, ".cursor/mcp.json"), "utf8"),
  );
  expect(cursor.mcpServers.emd.env).toBeUndefined();
  expect(readFileSync(join(dir, ".codex/config.toml"), "utf8")).not.toContain(
    "EMD_WAIT_SECONDS",
  );
});

test("when an installer fails, setup fails and names the backups", async () => {
  const dir = inProcessHome();
  const result = await setup(
    { apply: true },
    {
      ...installers(dir),
      run: async () => {
        throw new Error("npx add-mcp failed (exit 1): offline");
      },
    },
  );
  expect(result.verdict).toBe("failed");
  expect(result.reason).toMatch(/offline.*Backups: /);
  expect(readdirSync(join(dir, ".emd/backups"))).toHaveLength(1);
});

// A Mac may have a real AXe, which setup would keep; e2e covers macOS.
const offMac = test.skipIf(process.platform === "darwin");

// An archive laid out like AXe's: `axe` at the top, printing its version.
function fakeAxeArchive(): { path: string; sha256: string } {
  const dir = makeDir();
  mkdirSync(join(dir, "in/Frameworks"), { recursive: true });
  writeFileSync(join(dir, "in/axe"), `#!/bin/sh\necho ${axePin.version}\n`, {
    mode: 0o755,
  });
  const path = join(dir, "axe.tar.gz");
  spawnSync("tar", ["-czf", path, "-C", join(dir, "in"), "."]);
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  return { path, sha256 };
}

// macOS deps: curl copies the archive, tar is the real one.
const onMac = (dir: string, archive: string, sha256: string): SetupDeps => ({
  ...installers(dir),
  platform: "darwin",
  axe: { ...axePin, sha256 },
  run: async (command, args) => {
    if (command === "curl") {
      copyFileSync(archive, args[args.indexOf("-o") + 1] ?? "");
    } else if (command === "tar") {
      expect(spawnSync("tar", args).status).toBe(0);
    } else {
      await installers(dir).run(command, args);
    }
  },
});

offMac(
  "on macOS without AXe, setup installs the pinned archive where EMD finds it",
  async () => {
    const dir = inProcessHome();
    const archive = fakeAxeArchive();
    const deps = onMac(dir, archive.path, archive.sha256);
    const plan = await setup({}, deps);
    expect(plan.axe).toMatchObject({ url: axePin.url, dir: axeDir() });

    const result = await setup({ apply: true }, deps);
    expect(result.verdict).toBe("done");
    expect((await detectEnvironment()).axe).toBe(join(axeDir(), "axe"));
    expect(existsSync(join(axeDir(), "Frameworks"))).toBe(true);
    expect(readdirSync(join(dir, ".emd/tools"))).toEqual([
      `axe-${axePin.version}`,
    ]);
  },
);

offMac(
  "on macOS, setup for a project that targets only Android installs no AXe",
  async () => {
    const dir = inProcessHome();
    const archive = fakeAxeArchive();
    const plan = await setup(
      { dir: "fixtures/android-native" },
      onMac(dir, archive.path, archive.sha256),
    );
    expect(plan.verdict).toBe("planned");
    expect(plan.axe).toBeUndefined();
  },
);

offMac(
  "an AXe archive with the wrong SHA-256 stops setup before any config changes",
  async () => {
    const dir = inProcessHome();
    const archive = fakeAxeArchive();
    const result = await setup(
      { apply: true },
      onMac(dir, archive.path, axePin.sha256),
    );
    expect(result.verdict).toBe("failed");
    expect(result.reason).toMatch(/SHA-256 [0-9a-f]{64}, not /);
    expect(readdirSync(join(dir, ".emd/tools"))).toEqual([]);
    expect(existsSync(join(dir, ".emd/backups"))).toBe(false);
    expect(readFileSync(join(dir, ".codex/config.toml"), "utf8")).toBe(
      'model = "gpt-5"\n',
    );
  },
);
