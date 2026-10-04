import { isAbsolute, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import MagicString from "magic-string";
import { normalizePath, type Plugin } from "vite";

const methods = new Set(["mock", "unmock", "doMock", "doUnmock", "importActual", "importMock"]);

/** Vitest 3's stack parser loses Bun's relative mock importer. */
export function normalizeBunMockImports(code: string, id: string) {
  const file = id.startsWith("file:") ? fileURLToPath(new URL(id)) : id.split("?")[0]!;
  if (!isAbsolute(file) || !normalizePath(file).includes("/__tests__/") || !/\.[cm]?tsx?$/.test(file)) return;
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // The binder identifies imported aliases and excludes parameters/locals that
  // shadow them. Module resolution and library loading are unnecessary.
  const host: ts.CompilerHost = {
    getSourceFile: name => name === file ? source : undefined,
    getDefaultLibFileName: () => "", writeFile() {}, getCurrentDirectory: () => dirname(file),
    getDirectories: () => [], fileExists: name => name === file, readFile: name => name === file ? code : undefined,
    getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
  };
  const checker = ts.createProgram([file], { noResolve: true, noLib: true }, host).getTypeChecker();
  const output = new MagicString(code);
  let changed = false;
  const isVitestImport = (identifier: ts.Identifier) => checker.getSymbolAtLocation(identifier)?.declarations?.some(declaration => {
    if (!ts.isImportSpecifier(declaration) || !["vi", "vitest"].includes((declaration.propertyName ?? declaration.name).text)) return false;
    const imported = declaration.parent.parent.parent;
    return ts.isImportDeclaration(imported) && ts.isStringLiteral(imported.moduleSpecifier) && imported.moduleSpecifier.text === "vitest";
  });
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && isVitestImport(node.expression.expression)
      && methods.has(node.expression.name.text)) {
      const argument = node.arguments[0];
      const literal = argument && ts.isCallExpression(argument) && argument.expression.kind === ts.SyntaxKind.ImportKeyword
        ? argument.arguments[0] : argument;
      if (literal && ts.isStringLiteral(literal) && (literal.text.startsWith("./") || literal.text.startsWith("../"))) {
        output.overwrite(literal.getStart(source), literal.getEnd(), JSON.stringify(normalizePath(resolve(dirname(file), literal.text))));
        changed = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (changed) return { code: output.toString(), map: output.generateMap({ hires: true, source: id, includeContent: true }) };
}

export function bunMockImporter(): Plugin {
  return { name: "adapter:bun-mock-importer", enforce: "pre", transform: normalizeBunMockImports };
}
