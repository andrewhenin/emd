import { readdir } from "node:fs/promises";
import type { StackAdapter } from "../../core/index.js";

// Tools that generate or replace the Xcode project. EMD cannot build through
// them yet, so each one is named as the reason `launch` stops.
const generators: [file: RegExp, tool: string][] = [
  [/^Project\.swift$/, "Tuist"],
  [/^project\.yml$/, "XcodeGen"],
  [/^(MODULE\.bazel|WORKSPACE(\.bazel)?)$/, "Bazel"],
];

const adapter: StackAdapter = {
  id: "xcode",
  async detect(dir) {
    const names = await readdir(dir);
    const tool = generators.find(([file]) => names.some((n) => file.test(n)));
    // A workspace wins over a project: it can hold the project and its pods.
    const project =
      names.find((n) => n.endsWith(".xcworkspace")) ??
      names.find((n) => n.endsWith(".xcodeproj"));
    return {
      stack: "xcode",
      platforms: ["ios"],
      appIds: {},
      ...(tool && {
        problem: `The project is built with ${tool[1]}. EMD does not build through ${tool[1]} yet.`,
      }),
      notes: [
        ...(project ? [`Xcode project: ${project}.`] : []),
        // Real apps set the ID through variables, xcconfig files and targets.
        "The iOS app ID is not read from the project. Launch reads it from the built app.",
      ],
    };
  },
  launchPlan: () => undefined,
  fingerprint: () => Promise.reject(new Error("no fingerprint for Xcode yet")),
};

export default adapter;
