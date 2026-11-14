import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync(new URL("../src/lib/mediaSignature.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const module = { exports: {} };
runInNewContext(`(function(require, module, exports) { ${compiled} })`, {
  Buffer, Date, URL,
  process: { env: { DENTAL_MEDIA_SIGNING_SECRET: "test-secret-for-media-signing-with-32-bytes" }, NODE_ENV: "test" },
})((name) => {
  if (name === "node:crypto") return { createHmac, timingSafeEqual };
  throw new Error(`Unexpected dependency: ${name}`);
}, module, module.exports);

const { createSignedMediaUrl, isValidMediaSignature } = module.exports;
const id = "7f7331e8-422d-4277-a51b-0343fcbb1487";

test("media signatures bind to clinic and post", () => {
  const signed = new URL(createSignedMediaUrl("clinic-alpha", id, "https://example.test"));
  const expires = signed.searchParams.get("expires");
  const signature = signed.searchParams.get("signature");

  assert.equal(signed.searchParams.get("clinic"), "clinic-alpha");
  assert.equal(isValidMediaSignature("clinic-alpha", id, expires, signature), true);
  assert.equal(isValidMediaSignature("clinic-beta", id, expires, signature), false);
  assert.equal(isValidMediaSignature("clinic-alpha", "another-post", expires, signature), false);
  assert.equal(isValidMediaSignature(null, id, expires, signature), false);
});

test("expired or malformed media links are rejected", () => {
  const signed = new URL(createSignedMediaUrl("pilot", id, "https://example.test"));
  assert.equal(isValidMediaSignature("pilot", id, "1000000000", signed.searchParams.get("signature")), false);
  assert.equal(isValidMediaSignature("../outside", id, signed.searchParams.get("expires"), signed.searchParams.get("signature")), false);
});
