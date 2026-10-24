export type {
  PackageManager,
  Platform,
  ProjectInfo,
  StackAdapter,
  StackDetection,
  StackId,
} from "./adapter.js";
export { detect } from "./detect.js";
export { loadedAdapters } from "./registry.js";
export { type DetectResult, detectResultSchema } from "./result.js";
export { version } from "./version.js";
