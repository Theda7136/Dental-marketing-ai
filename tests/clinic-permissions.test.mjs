import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/clinicPermissions.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
runInNewContext(`(function(require, module, exports) { ${compiled} })`, {})(() => {
  throw new Error("Unexpected runtime dependency in permissions");
}, module, module.exports);

const { canPerform } = module.exports;

test("owner and admin may manage the team and publish", () => {
  for (const role of ["OWNER", "ADMIN"]) {
    assert.equal(canPerform(role, "members:manage"), true);
    assert.equal(canPerform(role, "content:publish"), true);
  }
});

test("editors can draft content but cannot approve, publish or manage social accounts", () => {
  assert.equal(canPerform("EDITOR", "content:read"), true);
  assert.equal(canPerform("EDITOR", "content:write"), true);
  for (const permission of ["content:review", "content:publish", "connections:manage", "members:manage", "brand:manage"]) {
    assert.equal(canPerform("EDITOR", permission), false);
  }
});

test("reviewers can review but cannot publish or edit", () => {
  assert.equal(canPerform("REVIEWER", "content:read"), true);
  assert.equal(canPerform("REVIEWER", "content:review"), true);
  assert.equal(canPerform("REVIEWER", "content:publish"), false);
  assert.equal(canPerform("REVIEWER", "content:write"), false);
});

test("unknown roles and permissions fail closed", () => {
  assert.equal(canPerform("UNKNOWN", "members:manage"), false);
  assert.equal(canPerform("EDITOR", "unknown:permission"), false);
});
