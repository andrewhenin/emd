import { runTool } from "../tool.js";
import type { DeviceBackend, Direction, Target, Where } from "./backend.js";
import type { UiNode } from "./screen.js";

// Android's own tools through adb: `uiautomator dump` reads the screen and
// `input` taps, types and swipes. Both come with every emulator image, so
// nothing is installed on the device (#251).

type Bounds = { x1: number; y1: number; x2: number; y2: number };
type AdbNode = UiNode & { bounds?: Bounds };

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const decode = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name.startsWith("#x"))
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#"))
      return String.fromCodePoint(Number(name.slice(1)));
    return entities[name] ?? whole;
  });

// The nodes of a `uiautomator dump`, with their bounds. A node's id is its
// resource-id without a "package:id/" prefix: a Compose test tag (with
// testTagsAsResourceId) or a View's id name. Its texts are text and
// content-desc.
export function parseDump(xml: string): AdbNode[] {
  const nodes: AdbNode[] = [];
  // Quoted values may hold ">", so a tag ends at the first ">" outside quotes.
  for (const [, attrs = ""] of xml.matchAll(/<node\b((?:[^>"]|"[^"]*")*)>/g)) {
    const attr = (name: string) =>
      decode(attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? "");
    const id = attr("resource-id").replace(/^[\w.]+:id\//, "");
    const texts = [
      ...new Set([attr("text"), attr("content-desc")].filter(Boolean)),
    ];
    if (id === "" && texts.length === 0) continue;
    const box = attr("bounds").match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    nodes.push({
      id,
      texts,
      ...(box && {
        bounds: {
          x1: Number(box[1]),
          y1: Number(box[2]),
          x2: Number(box[3]),
          y2: Number(box[4]),
        },
      }),
    });
  }
  return nodes;
}

const adb = (bin: string, device: string, args: string[], seconds: number) =>
  runTool(
    `adb ${args.slice(0, 2).join(" ")}`,
    bin,
    ["-s", device, ...args],
    seconds,
  );

// The dump goes to a file on the device and comes back with cat: printing it to
// /dev/tty mixes in uiautomator's own status line.
async function dump(
  device: string,
  bin: string,
  seconds = 60,
): Promise<AdbNode[]> {
  const file = "/data/local/tmp/emd-window.xml";
  await adb(bin, device, ["shell", "uiautomator", "dump", file], seconds);
  const { stdout } = await adb(bin, device, ["exec-out", "cat", file], seconds);
  if (!stdout.includes("<hierarchy"))
    throw new Error("uiautomator wrote no hierarchy");
  return parseDump(stdout);
}

// By id or text, a tap waits up to 10 s for the element, as AXe does.
const elementWaitSeconds = 10;

async function find(
  device: string,
  bin: string,
  target: { id: string } | { text: string },
): Promise<Bounds> {
  const until = Date.now() + elementWaitSeconds * 1000;
  for (;;) {
    const node = (await dump(device, bin)).find((n) =>
      "id" in target ? n.id === target.id : n.texts.includes(target.text),
    );
    if (node?.bounds) return node.bounds;
    if (Date.now() >= until) {
      throw new Error(
        `no element with ${"id" in target ? `id "${target.id}"` : `text "${target.text}"`} on screen`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function tap(
  { device }: Where,
  bin: string,
  target: Target,
): Promise<void> {
  let point = target as { x: number; y: number };
  if (!("x" in target)) {
    const b = await find(device, bin, target);
    point = {
      x: Math.round((b.x1 + b.x2) / 2),
      y: Math.round((b.y1 + b.y2) / 2),
    };
  }
  await adb(
    bin,
    device,
    ["shell", "input", "tap", String(point.x), String(point.y)],
    30,
  );
}

// `input text` reads %s as a space and runs in the device's shell, so spaces
// become %s and shell characters are escaped. It types ASCII only; other text
// throws, so the next backend types it.
export function inputText(text: string): string {
  if (!/^[\x20-\x7e]*$/.test(text))
    throw new Error("adb input types ASCII text only");
  return text
    .replace(/[\\'"`$&|;<>()*?!#~{}[\]]/g, "\\$&")
    .replaceAll(" ", "%s");
}

async function type(
  { device }: Where,
  bin: string,
  text: string,
  seconds = 60,
): Promise<void> {
  await adb(bin, device, ["shell", "input", "text", inputText(text)], seconds);
}

// From `wm size`: the override size when set, else the physical one.
export function screenSize(stdout: string): { width: number; height: number } {
  const sizes = [...stdout.matchAll(/(\w+) size: (\d+)x(\d+)/g)];
  const size = sizes.find((m) => m[1] === "Override") ?? sizes[0];
  if (!size) throw new Error(`wm size printed no size: ${stdout.trim()}`);
  return { width: Number(size[2]), height: Number(size[3]) };
}

// A swipe through the screen's centre over half its height or width, the
// finger moving the way named, in 300 ms.
export function swipeLine(
  { width, height }: { width: number; height: number },
  direction: Direction,
): number[] {
  const [cx, cy] = [Math.round(width / 2), Math.round(height / 2)];
  const [dx, dy] = [Math.round(width / 4), Math.round(height / 4)];
  const lines: Record<Direction, number[]> = {
    up: [cx, cy + dy, cx, cy - dy],
    down: [cx, cy - dy, cx, cy + dy],
    left: [cx + dx, cy, cx - dx, cy],
    right: [cx - dx, cy, cx + dx, cy],
  };
  return lines[direction];
}

async function swipe(
  { device }: Where,
  bin: string,
  direction: Direction,
): Promise<void> {
  const { stdout } = await adb(bin, device, ["shell", "wm", "size"], 30);
  const line = swipeLine(screenSize(stdout), direction);
  await adb(
    bin,
    device,
    ["shell", "input", "swipe", ...line.map(String), "300"],
    30,
  );
}

export const adbBackend: DeviceBackend = {
  id: "adb",
  readScreen: async (device, bin, seconds) =>
    (await dump(device, bin, seconds)).map(({ id, texts }) => ({ id, texts })),
  tap,
  type,
  swipe,
};
