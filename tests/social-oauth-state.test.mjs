import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/socialOAuthState.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
runInNewContext(`(function(require, module, exports) { ${compiled} })`, { Buffer })(
  (name) => {
    if (name === "node:crypto") return { createHmac, timingSafeEqual };
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports,
);

const { oauthBinding, isValidOAuthCallback } = module.exports;
const state = "a".repeat(64);
const sessionToken = "session-token-1";
const bound = oauthBinding("meta", state, sessionToken, "clinic-alpha", "user-1");

test("Meta OAuth state matches the initiating session and clinic", () => {
  assert.equal(isValidOAuthCallback("meta", state, state, bound, sessionToken, "clinic-alpha", "user-1"), true);
});

test("OAuth callback rejects cross-clinic, user, session and provider swaps", () => {
  for (const [provider, token, clinic, user] of [
    ["meta", sessionToken, "clinic-beta", "user-1"],
    ["meta", sessionToken, "clinic-alpha", "user-2"],
    ["meta", "session-token-2", "clinic-alpha", "user-1"],
    ["tiktok", sessionToken, "clinic-alpha", "user-1"],
  ]) {
    assert.equal(isValidOAuthCallback(provider, state, state, bound, token, clinic, user), false);
  }
});

test("OAuth callback rejects altered state, malformed cookies and missing session", () => {
  assert.equal(isValidOAuthCallback("meta", "b".repeat(64), state, bound, sessionToken, "clinic-alpha", "user-1"), false);
  assert.equal(isValidOAuthCallback("meta", state, state, "invalid", sessionToken, "clinic-alpha", "user-1"), false);
  assert.equal(isValidOAuthCallback("meta", state, state, bound, "", "clinic-alpha", "user-1"), false);
});

test("TikTok OAuth binds independently and validates legitimate callback", () => {
  const signed = oauthBinding("tiktok", state, sessionToken, "clinic-beta", "user-4");
  assert.equal(isValidOAuthCallback("tiktok", state, state, signed, sessionToken, "clinic-beta", "user-4"), true);
});
