import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  runTool,
  type StackAdapter,
  xcodeGenerators,
} from "../../core/index.js";

type ListInfo = { name?: string; schemes?: string[] };

// The scheme named like the project or workspace, else the only one. Several
// schemes and none named so: no guess, the caller says which exist.
export function pickScheme(list: {
  project?: ListInfo;
  workspace?: ListInfo;
}): { scheme: string } | { schemes: string[] } {
  const info = list.workspace ?? list.project ?? {};
  const schemes = info.schemes ?? [];
  const scheme =
    schemes.find((s) => s === info.name) ??
    (schemes.length === 1 ? schemes[0] : undefined);
  return scheme ? { scheme } : { schemes };
}

// A workspace wins over a project: it can hold the project and its pods.
async function xcodeProject(dir: string): Promise<string | undefined> {
  const names = await readdir(dir);
  return (
    names.find((n) => n.endsWith(".xcworkspace")) ??
    names.find((n) => n.endsWith(".xcodeproj"))
  );
}

const read = (path: string) => readFile(path, "utf8").catch(() => "");

// The shared schemes of a project or workspace, by name, with the
// configuration each one's Run action builds. A workspace adds the shared
// schemes of the projects it lists. Reading the files skips `xcodebuild
// -list`, which can take minutes on a large project.
export async function sharedSchemes(
  dir: string,
  container: string,
): Promise<Map<string, string>> {
  const containers = [join(dir, container)];
  if (container.endsWith(".xcworkspace")) {
    const contents = await read(
      join(dir, container, "contents.xcworkspacedata"),
    );
    for (const [, kind, path = ""] of contents.matchAll(
      /location\s*=\s*"(group|container|absolute):([^"]+\.xcodeproj)"/g,
    )) {
      containers.push(kind === "absolute" ? path : join(dir, path));
    }
  }
  const schemes = new Map<string, string>();
  for (const folder of containers) {
    const schemeDir = join(folder, "xcshareddata", "xcschemes");
    const files = await readdir(schemeDir).catch(() => [] as string[]);
    for (const file of files.filter((f) => f.endsWith(".xcscheme")).sort()) {
      const xml = await read(join(schemeDir, file));
      const config = xml.match(
        /<LaunchAction\b[^>]*\bbuildConfiguration\s*=\s*"([^"]+)"/,
      )?.[1];
      schemes.set(file.slice(0, -".xcscheme".length), config ?? "Debug");
    }
  }
  return schemes;
}

// A long list costs the agent tokens: the first names, then a count.
const someOf = (names: string[], shown = 15) =>
  names.length > shown
    ? `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`
    : names.join(", ");

const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

const adapter: StackAdapter = {
  id: "xcode",
  launches: ["ios"],
  async detect(dir) {
    const names = await readdir(dir);
    const tool = xcodeGenerators
      .map(([file, name]) => [names.find((n) => file.test(n)), name] as const)
      .find(([file]) => file);
    const project = await xcodeProject(dir);
    // No app ID: real apps set it through variables, xcconfig files and
    // several targets, so launch reads it from the built app.
    return {
      stack: "xcode",
      platforms: ["ios"],
      appIds: {},
      ...(tool && {
        needsPrepare: `This project makes its Xcode project with ${tool[1]} (${tool[0]}). Pass prepare: the command that makes it, as the project's docs name it.`,
      }),
      ...(project && { notes: [`Xcode project: ${project}.`] }),
    };
  },
  // No dev server: core installs the built app. Core's xcodebuild shim adds
  // the worktree's DerivedData.
  async launchPlan(
    _project,
    { dir, platform, deviceId, scheme, configuration },
  ) {
    if (platform !== "ios") return undefined;
    const project = await xcodeProject(dir);
    if (!project) return `${dir} has no Xcode project or workspace.`;
    const kind = project.endsWith(".xcworkspace") ? "-workspace" : "-project";
    const name = project.replace(/\.(xcworkspace|xcodeproj)$/, "");
    // Shared scheme files first. Without any, Xcode makes a scheme per target,
    // and only xcodebuild lists those.
    let schemes = await sharedSchemes(dir, project);
    if (schemes.size === 0) {
      const { stdout } = await runTool(
        "xcodebuild -list",
        "xcodebuild",
        ["-list", "-json", kind, join(dir, project)],
        120,
      );
      const list = JSON.parse(stdout) as {
        project?: ListInfo;
        workspace?: ListInfo;
      };
      const info = list.workspace ?? list.project ?? {};
      schemes = new Map((info.schemes ?? []).map((s) => [s, "Debug"]));
    }
    const names = [...schemes.keys()];
    const picked = scheme
      ? schemes.has(scheme)
        ? { scheme }
        : undefined
      : pickScheme({ project: { name, schemes: names } });
    if (!picked) {
      return `${project} has no scheme named "${scheme}". Schemes: ${someOf(names)}.`;
    }
    if (!("scheme" in picked)) {
      return `${project} has ${names.length} schemes and none is named like it: ${someOf(names)}. Pass scheme: the project's docs usually name the one to run.`;
    }
    return {
      build: [
        "xcodebuild",
        kind,
        quote(project),
        "-scheme",
        quote(picked.scheme),
        "-configuration",
        quote(configuration ?? schemes.get(picked.scheme) ?? "Debug"),
        `-destination id=${deviceId}`,
        "build",
      ].join(" "),
    };
  },
};

export default adapter;
