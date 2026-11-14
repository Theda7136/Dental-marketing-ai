import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(
  readFileSync(new URL("../src/services/mediaStorage.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText;

const directory = mkdtempSync(join(tmpdir(), "dental-tenant-media-"));
const module = { exports: {} };
runInNewContext(`(function(require, module, exports) { ${compiled} })`, {
  Uint8Array,
  process: { cwd: () => directory, env: {} },
})((name) => {
  if (name === "@aws-sdk/client-s3") return {};
  return require(name);
}, module, module.exports);

const { storePostMedia, readPostMedia, deletePostMedia } = module.exports;
const postId = "7f7331e8-422d-4277-a51b-0343fcbb1487";

test("media is stored in its clinic namespace and never read from another clinic", async () => {
  await storePostMedia("clinic-alpha", postId, "image", Uint8Array.from([1, 2, 3]));
  await storePostMedia("clinic-beta", postId, "image", Uint8Array.from([4, 5, 6]));
  assert.deepEqual(Array.from(await readPostMedia("clinic-alpha", postId, "image")), [1, 2, 3]);
  assert.deepEqual(Array.from(await readPostMedia("clinic-beta", postId, "image")), [4, 5, 6]);
  await deletePostMedia("clinic-alpha", postId, "image");
  await assert.rejects(readPostMedia("clinic-alpha", postId, "image"), /ENOENT/);
  assert.deepEqual(Array.from(await readPostMedia("clinic-beta", postId, "image")), [4, 5, 6]);
});

test("legacy files remain readable by pilot only", async () => {
  const legacyDirectory = join(directory, "storage", "posts");
  mkdirSync(legacyDirectory, { recursive: true });
  writeFileSync(join(legacyDirectory, `${postId}.png`), Uint8Array.from([7, 8]));
  assert.deepEqual(Array.from(await readPostMedia("pilot", postId, "image")), [7, 8]);
  await assert.rejects(readPostMedia("clinic-gamma", postId, "image"), /ENOENT/);
});

test("invalid clinic segments cannot escape storage directory", async () => {
  await assert.rejects(storePostMedia("../outside", postId, "image", Uint8Array.of(1)), /Identificador/);
  await assert.rejects(readPostMedia("../outside", postId, "image"), /Identificador/);
});

test.after(() => rmSync(directory, { recursive: true, force: true }));
