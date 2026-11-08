import { z } from "zod";

// A step is the JSON form of one Maestro command (decision 0008): tapOn,
// inputText, or the bare string "scroll" (Maestro refuses `scroll:` with no
// value).

const maxSteps = 20;
const maxTarget = 200;

const target = z.string().max(maxTarget).regex(/\S/);

const tapStep = z
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

// Maestro runs `${…}` in a string as JavaScript, so a replay would type
// something else.
const typeStep = z
  .object({
    inputText: z
      .string()
      .min(1)
      .max(maxTarget)
      .regex(/^(?![\s\S]*\$\{)/)
      .describe("Text to type into the field that has focus; tap it first."),
  })
  .strict();

export const stepSchema = z.union([
  tapStep,
  typeStep,
  z.literal("scroll").describe("Scroll down once: a swipe up from the center."),
]);

export type Step = z.infer<typeof stepSchema>;

export const stepsSchema = z.array(stepSchema).min(1).max(maxSteps);

export const stepsHelp = `Give 1 to ${maxSteps} steps. Each is a Maestro command; supported now: tapOn with a testID, {"tapOn":{"id":"x"}}, or with exact text, {"tapOn":"Tap me"}; inputText into the field that has focus (tap it first), {"inputText":"hello"}, without "\${"; and "scroll". Text at most ${maxTarget} characters.`;

// What a tap aims at: the element's testID, or its exact visible text or label.
export type Target = { id: string } | { text: string };

export const targetOf = ({ tapOn }: z.infer<typeof tapStep>): Target =>
  typeof tapOn === "string" ? { text: tapOn } : tapOn;

// Maestro matches id and text as whole regular expressions; escaping makes
// them exact, as AXe's are.
const exact = (text: string) =>
  JSON.stringify(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

const flowLine = (step: Step): string => {
  if (step === "scroll") return "- scroll";
  if ("inputText" in step)
    return `- inputText: ${JSON.stringify(step.inputText)}`;
  const aim = targetOf(step);
  return "id" in aim
    ? `- tapOn:\n    id: ${exact(aim.id)}`
    : `- tapOn: ${exact(aim.text)}`;
};

// A Maestro flow that replays the steps: `maestro test flow.yaml`.
export function maestroFlow(appId: string, steps: Step[]): string {
  return `appId: ${appId}\n---\n${steps.map(flowLine).join("\n")}\n`;
}
