import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const failures: string[] = [];

const lines = (path: string): string[] =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((_, i, a) => i < a.length - 1 || a[i] !== "")
    : [];

const limit = (
  path: string,
  max: number,
  count: (l: string[]) => number,
  unit: string,
) => {
  const n = count(lines(join(root, path)));
  if (n > max) failures.push(`${path}: ${n} ${unit} (max ${max})`);
};

limit("AGENTS.md", 200, (l) => l.length, "lines");
limit("docs/vision.md", 120, (l) => l.length, "lines");
limit(
  "docs/findings.md",
  50,
  (l) => l.filter((x) => x.startsWith("- ")).length,
  "entries",
);

const decisions = join(root, "docs/decisions");
if (existsSync(decisions)) {
  for (const f of readdirSync(decisions).filter((f) => f.endsWith(".md"))) {
    limit(`docs/decisions/${f}`, 40, (l) => l.length, "lines");
  }
}

if (failures.length > 0) {
  console.error(
    `Doc size limits exceeded:\n${failures.map((f) => `- ${f}`).join("\n")}`,
  );
  process.exit(1);
}
console.log("Doc size limits OK");
