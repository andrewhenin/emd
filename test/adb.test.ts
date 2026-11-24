import { expect, test } from "vitest";
import {
  inputText,
  parseDump,
  screenSize,
  swipeLine,
} from "../src/core/device/adb.ts";

// The shape `uiautomator dump` writes for fixtures/android-native (Compose with
// testTagsAsResourceId), plus a View id and escaped text.
const dump = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.emd.androidfixture" content-desc="" bounds="[0,0][1080,2400]"><node index="0" text="Ready" resource-id="smoke-label" class="android.widget.TextView" bounds="[490,1100][590,1150]" /><node index="1" text="" resource-id="smoke-button" class="android.widget.Button" content-desc="" bounds="[400,1170][680,1290]"><node index="0" text="Tap me" resource-id="" class="android.widget.TextView" bounds="[440,1200][640,1260]" /></node><node index="2" text="a &gt; b &amp; &quot;c&quot;" resource-id="com.emd.app:id/title" content-desc="Title" bounds="[0,0][10,10]" /></node></hierarchy>`;

test("a dump gives ids without the package prefix, texts and bounds", () => {
  expect(parseDump(dump)).toEqual([
    {
      id: "smoke-label",
      texts: ["Ready"],
      bounds: { x1: 490, y1: 1100, x2: 590, y2: 1150 },
    },
    {
      id: "smoke-button",
      texts: [],
      bounds: { x1: 400, y1: 1170, x2: 680, y2: 1290 },
    },
    {
      id: "",
      texts: ["Tap me"],
      bounds: { x1: 440, y1: 1200, x2: 640, y2: 1260 },
    },
    {
      id: "title",
      texts: ['a > b & "c"', "Title"],
      bounds: { x1: 0, y1: 0, x2: 10, y2: 10 },
    },
  ]);
});

test("a value with > in it does not end the tag", () => {
  expect(parseDump('<node text="1 > 0" resource-id="x" />')).toEqual([
    { id: "x", texts: ["1 > 0"] },
  ]);
});

test("input text gets %s for spaces and escaped shell characters", () => {
  expect(inputText("milk and eggs")).toBe("milk%sand%seggs");
  expect(inputText(`a'b"c$(d);e&f`)).toBe(String.raw`a\'b\"c\$\(d\)\;e\&f`);
  expect(() => inputText("café")).toThrow(/ASCII/);
});

test("the screen size is the override when set, else the physical size", () => {
  expect(screenSize("Physical size: 1080x2400\n")).toEqual({
    width: 1080,
    height: 2400,
  });
  expect(
    screenSize("Physical size: 1080x2400\nOverride size: 720x1600\n"),
  ).toEqual({ width: 720, height: 1600 });
  expect(() => screenSize("error")).toThrow(/no size/);
});

test("a swipe crosses the centre, the finger moving the way named", () => {
  const size = { width: 1080, height: 2400 };
  expect(swipeLine(size, "up")).toEqual([540, 1800, 540, 600]);
  expect(swipeLine(size, "down")).toEqual([540, 600, 540, 1800]);
  expect(swipeLine(size, "left")).toEqual([810, 1200, 270, 1200]);
  expect(swipeLine(size, "right")).toEqual([270, 1200, 810, 1200]);
});
