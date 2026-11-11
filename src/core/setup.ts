import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { axeDir, axePin } from "./device/axe.js";
import { detectEnvironment } from "./device/backend.js";
import { type DoctorResult, doctor } from "./doctor.js";
import { firstLine } from "./log.js";
import { homeDir } from "./state.js";
import { runTool } from "./tool.js";

// The installers `setup` calls (decision 0002), pinned like AXe and Maestro.
const addMcp = "add-mcp@2.6.1";
const skillsCli = "skills@1.7.6";

type AgentId = "claude-code" | "codex" | "cursor";

// The agents `setup` supports (vision.md), each found by its home folder.
const agents: { id: AgentId; dir: string; config: string }[] = [
  { id: "claude-code", dir: ".claude", config: ".claude.json" },
  { id: "codex", dir: ".codex", config: ".codex/config.toml" },
  { id: "cursor", dir: ".cursor", config: ".cursor/mcp.json" },
];

export type SetupResult = {
  verdict: "planned" | "done" | "failed";
  reason?: string;
  agents: { id: AgentId; config: string; backup?: string }[];
  // Each command `setup` runs, in order, as the user would type it.
  steps: string[];
  // The AXe release `setup` installs before those steps, and where. Only on
  // macOS without AXe: the iOS simulator's device tool (decisions 0005, 0009).
  axe?: typeof axePin & { dir: string };
  // Agents to restart so they load the new servers.
  restart?: AgentId[];
  // What this machine still lacks, checked when setup is done.
  doctor?: DoctorResult;
};

export type SetupOptions = {
  apply?: boolean;
  // Only these agents. Default: every agent found.
  only?: string[];
};

export type SetupDeps = {
  run: (command: string, args: string[]) => Promise<void>;
  platform: NodeJS.Platform;
  axe: typeof axePin;
};

// Each installer downloads its package on first use, so it gets 5 minutes.
const installSeconds = 300;

const realDeps: SetupDeps = {
  run: async (command, args) => {
    const installer = args.find((a) => /^(add-mcp|skills)@/.test(a)) ?? command;
    await runTool(installer, command, args, installSeconds);
  },
  platform: process.platform,
  axe: axePin,
};

// Downloads the pinned archive, checks its SHA-256, unpacks it next to its
// final folder and moves it there, so a failed install leaves nothing that
// `detectEnvironment` would find. Then it runs the installed AXe.
async function installAxe(
  axe: NonNullable<SetupResult["axe"]>,
  run: SetupDeps["run"],
): Promise<void> {
  const archive = `${axe.dir}.tar.gz`;
  const partial = `${axe.dir}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  try {
    await run("curl", ["-fsSL", "--retry", "3", "-o", archive, axe.url]);
    const sha = createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex");
    if (sha !== axe.sha256) {
      throw new Error(`AXe's archive has SHA-256 ${sha}, not ${axe.sha256}.`);
    }
    await run("tar", ["-xzf", archive, "-C", partial]);
    rmSync(axe.dir, { recursive: true, force: true });
    renameSync(partial, axe.dir);
  } finally {
    rmSync(archive, { force: true });
    rmSync(partial, { recursive: true, force: true });
  }
  try {
    const bin = join(axe.dir, "axe");
    const { stdout } = await runTool("axe --version", bin, ["--version"], 60);
    if (!stdout.split("\n").includes(axe.version)) {
      throw new Error(`AXe printed ${firstLine(stdout)}, not ${axe.version}.`);
    }
  } catch (error) {
    rmSync(axe.dir, { recursive: true, force: true });
    throw error;
  }
}

// Until EMD is on npm (#28), setup registers this checkout's build and installs
// this checkout's skill.
const emdServer = () =>
  `${process.execPath} ${fileURLToPath(new URL("../bin.js", import.meta.url))} mcp`;
const skillSource = () => fileURLToPath(new URL("../../", import.meta.url));

function commands(ids: AgentId[]): [string, string[]][] {
  const to = ids.flatMap((id) => ["-a", id]);
  return [
    ["npx", ["-y", addMcp, emdServer(), "-n", "emd", "-g", ...to, "-y"]],
    ["npx", ["-y", skillsCli, "add", skillSource(), "-g", ...to, "-y"]],
  ];
}

const shown = ([command, args]: [string, string[]]) =>
  [command, ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" ");

// A JSON config that doesn't parse stops setup before any write.
function unreadable(path: string): boolean {
  if (!path.endsWith(".json") || !existsSync(path)) return false;
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return false;
  } catch {
    return true;
  }
}

// Whether an agent has EMD's server, read back from its config.
function registered(path: string): boolean {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, "utf8");
  return path.endsWith(".toml")
    ? text.includes("[mcp_servers.emd]")
    : Boolean(JSON.parse(text).mcpServers?.emd);
}

export async function setup(
  options: SetupOptions = {},
  deps: SetupDeps = realDeps,
): Promise<SetupResult> {
  const home = homedir();
  const found = agents.filter((a) => existsSync(join(home, a.dir)));
  const unknown = (options.only ?? []).filter(
    (id) => !agents.some((a) => a.id === id),
  );
  if (unknown.length > 0) {
    return {
      verdict: "failed",
      reason: `Unknown agent: ${unknown.join(", ")}. Supported: ${agents.map((a) => a.id).join(", ")}.`,
      agents: [],
      steps: [],
    };
  }
  const picked = options.only
    ? found.filter((a) => options.only?.includes(a.id))
    : found;
  const listed = picked.map((a) => ({
    id: a.id,
    config: join(home, a.config),
  }));
  if (picked.length === 0) {
    return {
      verdict: "failed",
      reason: "No supported agent found (Claude Code, Codex or Cursor).",
      agents: [],
      steps: [],
    };
  }
  const steps = commands(picked.map((a) => a.id));
  // Every supported stack on macOS is iOS today, so a Mac gets AXe.
  const axe =
    deps.platform === "darwin" && !(await detectEnvironment()).axe
      ? { ...deps.axe, dir: axeDir() }
      : undefined;
  const plan = {
    agents: listed,
    steps: steps.map(shown),
    ...(axe && { axe }),
  };
  const broken = listed.filter((a) => unreadable(a.config));
  if (broken.length > 0) {
    return {
      verdict: "failed",
      reason: `Not valid JSON, so nothing was changed: ${broken.map((a) => a.config).join(", ")}.`,
      ...plan,
    };
  }
  if (!options.apply) return { verdict: "planned", ...plan };

  // AXe first: if it fails, no agent config has changed.
  if (axe) {
    try {
      await installAxe(axe, deps.run);
    } catch (error) {
      return {
        verdict: "failed",
        reason: `AXe was not installed: ${firstLine(error)}`,
        ...plan,
      };
    }
  }

  // Back up each config that exists, then change it.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backups = join(homeDir(), "backups", stamp);
  const withBackups = listed.map((a) => {
    if (!existsSync(a.config)) return a;
    const backup = join(backups, a.id, a.config.split(sep).at(-1) ?? "");
    mkdirSync(dirname(backup), { recursive: true });
    copyFileSync(a.config, backup);
    return { ...a, backup };
  });
  try {
    for (const [command, args] of steps) await deps.run(command, args);
  } catch (error) {
    return {
      verdict: "failed",
      reason: `${firstLine(error)} Backups: ${backups}.`,
      ...plan,
      agents: withBackups,
    };
  }
  const skill = [".agents", ".claude"].some((dir) =>
    existsSync(join(home, dir, "skills", "emd", "SKILL.md")),
  );
  const missing = listed
    .filter((a) => !registered(a.config))
    .map((a) => a.id as string)
    .concat(skill ? [] : ["the skill"]);
  if (missing.length > 0) {
    return {
      verdict: "failed",
      reason: `Not in place after setup: ${missing.join(", ")}. Backups: ${backups}.`,
      ...plan,
      agents: withBackups,
    };
  }
  return {
    verdict: "done",
    ...plan,
    agents: withBackups,
    restart: listed.map((a) => a.id),
    doctor: await doctor(),
  };
}
