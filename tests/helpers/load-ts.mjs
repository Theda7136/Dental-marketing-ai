import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export function loadTs(file, mocks = {}) {
  const filename = file instanceof URL ? fileURLToPath(file) : file;
  const require = createRequire(filename);
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  const customRequire = specifier => {
    if (specifier in mocks) return mocks[specifier];
    if (specifier.startsWith(".")) return loadTs(path.resolve(path.dirname(filename), specifier + ".ts"), mocks);
    if (specifier.startsWith("@/")) return loadTs(new URL("../../src/" + specifier.slice(2) + ".ts", import.meta.url), mocks);
    return require(specifier);
  };
  new Function("require", "module", "exports", code)(customRequire, module, module.exports);
  return module.exports;
}
