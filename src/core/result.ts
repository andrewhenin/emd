import { z } from "zod";
import { packageManagers, platforms, stackIds } from "./adapter.js";

const perPlatform = z.object({
  ios: z.string().optional(),
  android: z.string().optional(),
});

// One schema for the result: the CLI prints it, the MCP tool declares it.
export const detectResultSchema = z.object({
  verdict: z.enum(["detected", "none"]),
  root: z.string(),
  stack: z.enum(stackIds).optional(),
  platforms: z.array(z.enum(platforms)).optional(),
  appIds: perPlatform.optional(),
  commands: z.object({ run: perPlatform, server: z.string() }).optional(),
  packageManager: z.enum(packageManagers).optional(),
  maestroFlows: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
});

export type DetectResult = z.infer<typeof detectResultSchema>;
