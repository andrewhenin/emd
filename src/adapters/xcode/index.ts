import { readdir } from "node:fs/promises";
import { type StackAdapter, xcodeGenerators } from "../../core/index.js";

const adapter: StackAdapter = {
  id: "xcode",
  async detect(dir) {
    const names = await readdir(dir);
    const tool = xcodeGenerators.find(([file]) =>
      names.some((n) => file.test(n)),
    );
    // A workspace wins over a project: it can hold the project and its pods.
    const project =
      names.find((n) => n.endsWith(".xcworkspace")) ??
      names.find((n) => n.endsWith(".xcodeproj"));
    // No app ID: real apps set it through variables, xcconfig files and
    // several targets, so launch reads it from the built app (#196).
    return {
      stack: "xcode",
      platforms: ["ios"],
      appIds: {},
      // launch stops on `problem` before it makes a simulator or DerivedData.
      problem: tool
        ? `The project is built with ${tool[1]}. EMD does not build through ${tool[1]} yet.`
        : "EMD detects native iOS apps but does not launch them yet.",
      ...(project && { notes: [`Xcode project: ${project}.`] }),
    };
  },
  launchPlan: () => undefined,
  fingerprint: () => Promise.reject(new Error("no fingerprint for Xcode yet")),
};

export default adapter;
