import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

// Import boundaries from decision 0001. Usage: check-imports.ts [root]
const root = process.argv[2] ?? process.cwd();
const src = join(root, "src");
const failures: string[] = [];

type Layer = "core" | "cli" | "mcp" | `adapter:${string}`;
type Import = { spec: string; dynamic: boolean };

const listFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return listFiles(path);
        return path.endsWith(".ts") ? [path] : [];
      })
    : [];

const importsOf = (file: string): Import[] => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: Import[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push({ spec: node.moduleSpecifier.text, dynamic: false });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) {
        found.push({ spec: arg.text, dynamic: true });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const relToSrc = (path: string): string =>
  relative(src, path).split(sep).join("/");

const layerOf = (rel: string): Layer | undefined => {
  const [first, second] = rel.split("/");
  if (first === "core") return "core";
  if (first === "cli" || first === "cli.ts") return "cli";
  if (first === "mcp" || first === "mcp.ts") return "mcp";
  if (first === "adapters" && second) return `adapter:${second}`;
  return undefined;
};

for (const file of listFiles(src)) {
  const fileRel = relToSrc(file);
  const from = layerOf(fileRel);
  for (const { spec, dynamic } of importsOf(file)) {
    if (!spec.startsWith(".")) continue;
    const targetRel = relToSrc(
      resolve(dirname(file), spec.replace(/\.(js|ts)$/, "")),
    );
    const to = layerOf(targetRel);
    const fail = (why: string) =>
      failures.push(`src/${fileRel}: imports "${spec}"; ${why}`);

    if (to?.startsWith("adapter:")) {
      if (from === to) continue;
      if (from?.startsWith("adapter:"))
        fail("adapters must not import each other");
      else if (!dynamic) fail("adapters must be loaded lazily with import()");
      else if (fileRel !== "core/registry.ts") {
        fail("only core/registry.ts may import an adapter");
      }
      continue;
    }
    if (from === "core" && (to === "cli" || to === "mcp")) {
      fail(`core must not import ${to}`);
    } else if (from && from !== "core" && to === "core") {
      if (targetRel !== "core/index") {
        fail("reach core only through its public entry core/index");
      }
    } else if (from && from !== "core" && to && to !== "core" && from !== to) {
      fail(`${from.split(":")[0]} must not import ${to.split(":")[0]}`);
    }
  }
}

if (failures.length > 0) {
  console.error(
    `Import boundary violations:\n${failures.map((f) => `- ${f}`).join("\n")}`,
  );
  process.exit(1);
}
console.log("Import boundaries OK");
