export type {
  LaunchPlan,
  PackageManager,
  Platform,
  ProjectInfo,
  StackAdapter,
  StackDetection,
  StackId,
} from "./adapter.js";
export { detect } from "./detect.js";
export { launch } from "./launch.js";
export { loadedAdapters } from "./registry.js";
export {
  type DetectResult,
  detectResultSchema,
  type LaunchResult,
  launchResultSchema,
} from "./result.js";
export { version } from "./version.js";
