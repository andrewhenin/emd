import { readdir } from "node:fs/promises";
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

const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

const adapter: StackAdapter = {
  id: "xcode",
  async detect(dir) {
    const names = await readdir(dir);
    const tool = xcodeGenerators.find(([file]) =>
      names.some((n) => file.test(n)),
    );
    const project = await xcodeProject(dir);
    // No app ID: real apps set it through variables, xcconfig files and
    // several targets, so launch reads it from the built app.
    return {
      stack: "xcode",
      platforms: ["ios"],
      appIds: {},
      ...(tool && {
        problem: `The project is built with ${tool[1]}. EMD does not build through ${tool[1]} yet.`,
      }),
      ...(project && { notes: [`Xcode project: ${project}.`] }),
    };
  },
  // No dev server: core installs the built app. Core's xcodebuild shim adds
  // the worktree's DerivedData.
  async launchPlan(_project, { dir, platform, deviceId }) {
    const project = await xcodeProject(dir);
    if (platform !== "ios" || !project) return undefined;
    const kind = project.endsWith(".xcworkspace") ? "-workspace" : "-project";
    const { stdout } = await runTool(
      "xcodebuild -list",
      "xcodebuild",
      ["-list", "-json", kind, join(dir, project)],
      120,
    );
    const picked = pickScheme(JSON.parse(stdout));
    if (!("scheme" in picked)) {
      return `${project} has several schemes and none is named like it: ${picked.schemes.join(", ")}.`;
    }
    return {
      build: [
        "xcodebuild",
        kind,
        quote(project),
        "-scheme",
        quote(picked.scheme),
        "-configuration Debug",
        `-destination id=${deviceId}`,
        "build",
      ].join(" "),
    };
  },
};

export default adapter;
