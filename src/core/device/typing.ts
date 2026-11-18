import type { UiNode } from "./screen.js";

// AXe and Maestro return when they have sent the keys, not when the app has
// them. On a busy simulator keys arrive 10 to 27 s late, or only the first
// does (issue 163). So `type` reads the screen until the text shows.

// Secure fields show bullets in place of the text.
const bullets = /^[•●·*∙]+$/;

const allTexts = (nodes: UiNode[]) => nodes.flatMap((node) => node.texts);

const showsText = (nodes: UiNode[], text: string): boolean =>
  allTexts(nodes).some((shown) => shown.includes(text));

// Bullets at least as long as the text: a secure field that took it.
const showsBullets = (nodes: UiNode[], text: string): boolean =>
  allTexts(nodes).some(
    (shown) => bullets.test(shown) && shown.length >= text.length,
  );

// How many leading characters of `text` end some node's text: the part of a
// partly typed text that arrived. Zero when none did.
function typedPrefix(nodes: UiNode[], text: string): number {
  const shown = allTexts(nodes);
  for (let length = text.length - 1; length > 0; length--) {
    const prefix = text.slice(0, length);
    if (shown.some((value) => value.endsWith(prefix))) return length;
  }
  return 0;
}

// What the screen shows, in one short phrase, for a failure message.
function describeScreen(nodes: UiNode[]): string {
  const texts = [...new Set(allTexts(nodes))].slice(0, 8);
  return texts.length > 0
    ? `the screen shows ${texts.map((t) => JSON.stringify(t.slice(0, 40))).join(", ")}`
    : "the screen shows no text";
}

export type Typing = {
  // Types the text, as one backend call.
  type(text: string): Promise<void>;
  read(): Promise<UiNode[]>;
  sleep(ms: number): Promise<void>;
};

export type Typed = {
  verdict: "shown" | "secure" | "missing";
  seconds: number;
  // The rest of the text, when it was typed a second time.
  retyped?: string;
  // What the screen showed last, when the text never showed.
  screen?: string;
};

// Types `text`, then reads until it shows, for up to `limitSeconds`. If only
// part of it shows and that part stays the same for two reads, types the
// rest once. Waiting for the part to stall keeps late keys from doubling.
export async function typeUntilShown(
  io: Typing,
  text: string,
  limitSeconds = 30,
  pauseMs = 1000,
): Promise<Typed> {
  const start = Date.now();
  const seconds = () => Math.round((Date.now() - start) / 100) / 10;
  await io.type(text);
  let last: UiNode[] = [];
  let before = -1;
  let retyped: string | undefined;
  const extra = () => (retyped ? { retyped } : {});
  for (;;) {
    try {
      last = await io.read();
      if (showsText(last, text)) {
        return { verdict: "shown", seconds: seconds(), ...extra() };
      }
      if (showsBullets(last, text)) {
        return { verdict: "secure", seconds: seconds() };
      }
      const have = typedPrefix(last, text);
      if (have > 0 && have === before && retyped === undefined) {
        retyped = text.slice(have);
        await io.type(retyped);
      }
      before = have;
    } catch {
      // A failed read says nothing about the text; read again.
    }
    if (Date.now() - start >= limitSeconds * 1000) {
      return {
        verdict: "missing",
        seconds: seconds(),
        ...extra(),
        screen: describeScreen(last),
      };
    }
    await io.sleep(pauseMs);
  }
}
