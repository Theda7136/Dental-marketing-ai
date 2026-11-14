import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync(new URL("../src/app/api/health/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const module = { exports: {} };
runInNewContext(`(function(require, module, exports) { ${compiled} })`, { Response })(
  (name) => {
    if (name === "next/server") {
      return { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } };
    }
    throw new Error(`Unexpected import: ${name}`);
  },
  module,
  module.exports,
);

test("health endpoint returns only availability without clinical metadata", async () => {
  const response = module.exports.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
});
