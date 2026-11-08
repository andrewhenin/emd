import { z } from "zod";

// A step is the JSON form of one Maestro command (decision 0008). Only tapOn
// so far; inputText and scroll join this union when a fixture can prove them.

const maxSteps = 20;
const maxTarget = 200;

const target = z.string().max(maxTarget).regex(/\S/);

export const stepSchema = z
  .object({
    tapOn: z.union([
      target.describe("The element's exact visible text or label."),
      z.object({ id: target.describe("The element's testID.") }).strict(),
      z
        .object({
          text: target.describe("The element's exact visible text or label."),
        })
        .strict(),
    ]),
  })
  .strict();

export type Step = z.infer<typeof stepSchema>;

export const stepsSchema = z.array(stepSchema).min(1).max(maxSteps);

export const stepsHelp = `Give 1 to ${maxSteps} steps. Each is a Maestro command; supported now: tapOn with a testID, {"tapOn":{"id":"x"}}, or with exact text, {"tapOn":"Tap me"}, at most ${maxTarget} characters.`;

// What a tap aims at: the element's testID, or its exact visible text or label.
export type Target = { id: string } | { text: string };

export const targetOf = ({ tapOn }: Step): Target =>
  typeof tapOn === "string" ? { text: tapOn } : tapOn;

// Maestro matches id and text as whole regular expressions; escaping makes
// them exact, as AXe's are.
const exact = (text: string) =>
  JSON.stringify(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

// A Maestro flow that replays the steps: `maestro test flow.yaml`.
export function maestroFlow(appId: string, steps: Step[]): string {
  const lines = steps.map((step) => {
    const aim = targetOf(step);
    return "id" in aim
      ? `- tapOn:\n    id: ${exact(aim.id)}`
      : `- tapOn: ${exact(aim.text)}`;
  });
  return `appId: ${appId}\n---\n${lines.join("\n")}\n`;
}
