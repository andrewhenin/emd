import type { UiNode } from "./screen.js";

// AXe and Maestro return when they have sent the keys, not when the app has
// them. On a busy simulator keys arrive 10 to 27 s late, or never (issue 163).
// So `type` reads the screen until the text shows.
//
// Only nodes whose text changed since the read before typing count, so text
// that was already on screen never confirms. A changed node confirms when its
// text is its old text plus the typed text, or the typed text alone (the field
// was empty or showed a placeholder).

type Typing = {
  // Types the text, as one backend call that may take at most `seconds`.
  type(text: string, seconds: number): Promise<void>;
  // Reads the screen, in at most `seconds`.
  read(seconds: number): Promise<UiNode[]>;
  sleep(ms: number): Promise<void>;
  now(): number;
};

type Typed = { seconds: number; retyped?: string } & (
  | { verdict: "shown" }
  // A secure field: its bullets grew by the length of the text.
  | { verdict: "secure" }
  | { verdict: "failed"; reason: string }
);

type Judged =
  | { kind: "shown" | "secure" | "none" }
  // Some keys arrived: `have` is how many characters, `key` which node.
  | { kind: "partial"; key: string; have: number; shown: string }
  | { kind: "extra"; shown: string };

const bullets = /^•+$/;

// A node is its id plus its place among nodes with that id.
function keyed(nodes: UiNode[]): Map<string, string[]> {
  const seen = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const node of nodes) {
    const n = seen.get(node.id) ?? 0;
    seen.set(node.id, n + 1);
    out.set(`${node.id}#${n}`, node.texts);
  }
  return out;
}

function judge(
  before: Map<string, string[]>,
  nodes: UiNode[],
  text: string,
): Judged {
  let found: Judged = { kind: "none" };
  for (const [key, texts] of keyed(nodes)) {
    const old = before.get(key) ?? [];
    const olds = ["", ...old];
    for (const shown of texts.filter((t) => !old.includes(t))) {
      if (olds.some((o) => shown === o + text || shown === text)) {
        return { kind: "shown" };
      }
      const oldBullets = Math.max(
        0,
        ...old.filter((o) => bullets.test(o)).map((o) => o.length),
      );
      if (bullets.test(shown) && shown.length === oldBullets + text.length) {
        return { kind: "secure" };
      }
      if (shown.includes(text)) found = { kind: "extra", shown };
      else if (found.kind === "none") {
        for (const o of olds) {
          const rest = shown.startsWith(o) ? shown.slice(o.length) : "";
          if (rest && rest.length < text.length && text.startsWith(rest)) {
            found = { kind: "partial", key, have: rest.length, shown };
            break;
          }
        }
      }
    }
  }
  return found;
}

// What the screen shows, in one short phrase, for a failure message.
function describeScreen(nodes: UiNode[]): string {
  const texts = [...new Set(nodes.flatMap((node) => node.texts))].slice(0, 8);
  return texts.length > 0
    ? `the screen shows ${texts.map((t) => JSON.stringify(t.slice(0, 40))).join(", ")}`
    : "the screen shows no text";
}

// Types `text`, then reads until it shows. The whole call, from the read before
// typing, takes at most `limitSeconds`: each step gets only the time left, and
// no step starts after the limit. The MCP client gives up at 60 s.
//
// If the screen stays the same for half the limit, types the missing rest once
// (all of it when no key arrived). Late keys come 10 to 27 s late, so a shorter
// wait doubles text. Doubled text fails the exact match, so a retype can never
// give a false `ok`.
export async function typeUntilShown(
  io: Typing,
  text: string,
  limitSeconds = 40,
  pauseMs = 1000,
): Promise<Typed> {
  const start = io.now();
  const end = start + limitSeconds * 1000;
  const left = () => Math.max(0, (end - io.now()) / 1000);
  const seconds = () => Math.round((io.now() - start) / 100) / 10;
  let retyped: string | undefined;
  const failed = (reason: string): Typed => ({
    verdict: "failed",
    seconds: seconds(),
    ...(retyped ? { retyped } : {}),
    reason,
  });

  let last = await io.read(left());
  const before = keyed(last);
  if (left() === 0) {
    return failed(`Reading the screen before typing took ${seconds()} s.`);
  }
  await io.type(text, left());
  let lastError = "";
  let state = "";
  let since = io.now();
  for (;;) {
    if (left() === 0) {
      const error = lastError
        ? `; the last read failed: ${lastError.split("\n")[0]}`
        : "";
      return failed(
        `The text did not show on screen after ${seconds()} s${retyped ? " and one retype" : ""}; ${describeScreen(last)}${error}.`,
      );
    }
    let rest: string | undefined;
    try {
      last = await io.read(left());
      lastError = "";
      const judged = judge(before, last, text);
      if (judged.kind === "shown" || judged.kind === "secure") {
        return {
          verdict: judged.kind,
          seconds: seconds(),
          ...(retyped ? { retyped } : {}),
        };
      }
      if (judged.kind === "extra") {
        return failed(
          `The field shows ${JSON.stringify(judged.shown.slice(0, 80))}: more than the typed text.`,
        );
      }
      const now =
        judged.kind === "partial" ? `${judged.key}=${judged.shown}` : "";
      if (now !== state) {
        state = now;
        since = io.now();
      } else if (!retyped && io.now() - since >= (end - start) / 2) {
        rest = text.slice(judged.kind === "partial" ? judged.have : 0);
      }
    } catch (error) {
      // A failed read says nothing about the text; read again.
      lastError = error instanceof Error ? error.message : String(error);
    }
    // Outside the try: a failed retype must fail the call, not be read again.
    if (rest && left() > 0) {
      retyped = rest;
      await io.type(rest, left());
    }
    if (left() > 0) await io.sleep(Math.min(pauseMs, left() * 1000));
  }
}
