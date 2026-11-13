import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/instagramAccount.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function resolver() {
  const exports = {};
  const module = { exports };
  const loader = runInNewContext(`(function(require,module,exports){ ${compiled} })`, {
    URL, AbortSignal, Error,
  });
  loader(() => { throw new Error("Unexpected dependency"); }, module, exports);
  return module.exports.resolvePageInstagramAccount;
}

test("looks up the professional account on the chosen Facebook Page", async () => {
  const resolve = resolver();
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url: url.toString(), token: options.headers.Authorization });
    return { ok: true, json: async () => ({
      id: "123", instagram_business_account: { id: "17840000000000000" },
    }) };
  };
  const id = await resolve("123", "page-token", request);
  assert.equal(id, "17840000000000000");
  assert.match(calls[0].url, /\/123\?/);
  assert.match(calls[0].url, /instagram_business_account/);
  assert.equal(calls[0].token, "Bearer page-token");
  assert.doesNotMatch(calls[0].url, /page-token/);
});

test("does not invent a professional Instagram ID when the Page lacks one", async () => {
  const resolve = resolver();
  const id = await resolve("123", "token", async () => ({
    ok: true, json: async () => ({ id: "123" }),
  }));
  assert.equal(id, null);
});

test("surfaces permission errors without silently setting Instagram disconnected", async () => {
  const resolve = resolver();
  await assert.rejects(
    resolve("123", "token", async () => ({
      ok: false, json: async () => ({ error: { message: "Permission denied" } }),
    })),
    /verificar la vinculación/,
  );
});

test("rejects a response for a different Facebook Page", async () => {
  const resolve = resolver();
  await assert.rejects(
    resolve("123", "token", async () => ({
      ok: true, json: async () => ({
        id: "999", instagram_business_account: { id: "1784" },
      }),
    })),
    /Página distinta/,
  );
});
