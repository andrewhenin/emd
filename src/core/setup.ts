import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { firstLine } from "./log.js";
import { homeDir } from "./state.js";
import { runTool } from "./tool.js";
import { version } from "./version.js";

// The installers `setup` calls (decision 0002), pinned like AXe and Maestro.
const addMcp = "add-mcp@2.6.1";
const skillsCli = "skills@1.7.6";
const mobileBuildMcp = "mobilebuildmcp@2.7.1";

type AgentId = "claude-code" | "codex" | "cursor";

// The agents `setup` supports (vision.md), each found by its home folder.
const agents: { id: AgentId; dir: string; config: string }[] = [
  { id: "claude-code", dir: ".claude", config: ".claude.json" },
  { id: "codex", dir: ".codex", config: ".codex/config.toml" },
  { id: "cursor", dir: ".cursor", config: ".cursor/mcp.json" },
];

export type SetupResult = {
  verdict: "planned" | "done" | "nothing-to-do" | "failed";
  reason?: string;
  agents: { id: AgentId; config: string; backup?: string }[];
  // Each command `setup` runs, in order, as the user would type it.
  steps: string[];
  // Agents to restart so they load the new servers.
  restart?: AgentId[];
};

export type SetupOptions = {
  apply?: boolean;
  // Only these agents. Default: every agent found.
  only?: string[];
};

export type SetupDeps = {
  run: (command: string, args: string[]) => Promise<void>;
};

const realDeps: SetupDeps = {
  run: async (command, args) => {
    await runTool(`${command} ${args[1] ?? ""}`, command, args, 300);
  },
};

// From npx, setup registers the pinned package and the skill of the same
// release. From a git checkout, it registers that build and its own skill.
const bin = fileURLToPath(new URL("../bin.js", import.meta.url));
const fromPackage = bin.includes(`${sep}node_modules${sep}`);
const emdServer = () =>
  fromPackage
    ? `npx -y emd-agents@${version()} mcp`
    : `${process.execPath} ${bin} mcp`;
const skillSource = () =>
  fromPackage
    ? `andrewhenin/emd#emd-agents-v${version()}`
    : fileURLToPath(new URL("../../", import.meta.url));

function commands(ids: AgentId[]): [string, string[]][] {
  const to = ids.flatMap((id) => ["-a", id]);
  return [
    ["npx", ["-y", addMcp, emdServer(), "-n", "emd", "-g", ...to, "-y"]],
    [
      "npx",
      [
        "-y",
        addMcp,
        `npx -y ${mobileBuildMcp} mcp`,
        "-n",
        "mobilebuildmcp",
        "--env",
        "MOBILEBUILDMCP_ENABLED_WORKFLOWS=simulator,ui-automation",
        "-g",
        ...to,
        "-y",
      ],
    ],
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

// Codex waits 10 s for a server by default, less than a first npx download.
// add-mcp can't set it for a local server, so setup does.
function codexTimeouts(path: string): void {
  const lines = readFileSync(path, "utf8").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i] ?? "");
    const header = /^\[mcp_servers\.(emd|mobilebuildmcp)\]\s*$/.exec(
      lines[i] ?? "",
    );
    if (!header) continue;
    const rest = lines.slice(i + 1);
    const end = rest.findIndex((l) => /^\s*\[/.test(l));
    const table = end < 0 ? rest : rest.slice(0, end);
    if (!table.some((l) => /^\s*startup_timeout_sec\s*=/.test(l))) {
      out.push("startup_timeout_sec = 30");
    }
  }
  writeFileSync(path, out.join("\n"));
}

// Whether an agent has both servers, read back from its config.
function registered(path: string): boolean {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, "utf8");
  return ["emd", "mobilebuildmcp"].every((name) =>
    path.endsWith(".toml")
      ? text.includes(`[mcp_servers.${name}]`)
      : Boolean(JSON.parse(text).mcpServers?.[name]),
  );
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
      verdict: "nothing-to-do",
      reason: "No supported agent found (Claude Code, Codex or Cursor).",
      agents: [],
      steps: [],
    };
  }
  const steps = commands(picked.map((a) => a.id));
  const plan = { agents: listed, steps: steps.map(shown) };
  const broken = listed.filter((a) => unreadable(a.config));
  if (broken.length > 0) {
    return {
      verdict: "failed",
      reason: `Not valid JSON, so nothing was changed: ${broken.map((a) => a.config).join(", ")}.`,
      ...plan,
    };
  }
  if (!options.apply) return { verdict: "planned", ...plan };

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
    const codex = listed.find((a) => a.id === "codex");
    if (codex && existsSync(codex.config)) codexTimeouts(codex.config);
  } catch (error) {
    return {
      verdict: "failed",
      reason: `${firstLine(error)} Backups: ${backups}.`,
      agents: withBackups,
      steps: plan.steps,
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
      agents: withBackups,
      steps: plan.steps,
    };
  }
  return {
    verdict: "done",
    agents: withBackups,
    steps: plan.steps,
    restart: listed.map((a) => a.id),
  };
}
