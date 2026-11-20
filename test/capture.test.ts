import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startCapture } from "../src/core/logs.ts";
import { makeDir } from "./helpers.ts";

// startCapture with stub `xcrun` and `plutil` on PATH, so it runs on Linux.
const path = process.env.PATH;
afterEach(() => {
  process.env.PATH = path;
});

function stubs(failures: number) {
  const bin = makeDir();
  const count = join(bin, "count");
  writeFileSync(
    join(bin, "xcrun"),
    `#!/bin/sh
if [ "$2" = get_app_container ]; then
  n=$(cat "${count}" 2>/dev/null || echo 0); echo $((n + 1)) > "${count}"
  if [ "$n" -lt ${failures} ]; then echo "Unable to lookup in current state: Booting" >&2; exit 1; fi
  echo /apps/My.app; exit 0
fi
exec sleep 30
`,
  );
  writeFileSync(join(bin, "plutil"), "#!/bin/sh\necho MyApp\n");
  chmodSync(join(bin, "xcrun"), 0o755);
  chmodSync(join(bin, "plutil"), 0o755);
  process.env.PATH = `${bin}${delimiter}${path}`;
  return count;
}

test("a simulator that can't find the app yet is asked again", async () => {
  const count = stubs(2);
  const capture = await startCapture("D", "com.example.my", makeDir());
  capture.kill();
  expect(readFileSync(count, "utf8").trim()).toBe("3");
});

test("after 3 tries the error is passed on, for the caller to report", async () => {
  stubs(3);
  await expect(startCapture("D", "com.example.my", makeDir())).rejects.toThrow(
    /current state: Booting/,
  );
}, 20_000);
