import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync(new URL("../src/lib/tiktok.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function fixture() {
  const accounts = [
    { id: "alpha-account", clinicId: "clinic-alpha", provider: "tiktok", accessToken: "token-alpha", grantedScopes: "video.publish", tokenExpiresAt: new Date(Date.now() + 600_000) },
    { id: "beta-account", clinicId: "clinic-beta", provider: "tiktok", accessToken: "token-beta", grantedScopes: "video.publish", tokenExpiresAt: new Date(Date.now() + 600_000) },
  ];
  const queries = [];
  const prisma = {
    account: {
      async findFirst({ where }) {
        queries.push(where);
        return accounts.find((account) => account.clinicId === where.clinicId && account.provider === where.provider) ?? null;
      },
      async update({ where }) {
        assert.equal(where.id, "alpha-account");
        assert.equal(where.clinicId, "clinic-alpha");
      },
    },
  };
  const module = { exports: {} };
  runInNewContext(`(function(require, module, exports) { ${compiled} })`, {
    Date, URL, URLSearchParams, AbortSignal,
    process: { env: { TIKTOK_CLIENT_KEY: "test-key", TIKTOK_CLIENT_SECRET: "test-secret" } },
  })((name) => {
    if (name === "@/lib/prisma") return { prisma };
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);

  return { ...module.exports, accounts, queries };
}

test("TikTok selects only the requesting clinic account", async () => {
  const { getTikTokAccess, queries } = fixture();
  assert.equal((await getTikTokAccess("clinic-alpha")).token, "token-alpha");
  assert.equal((await getTikTokAccess("clinic-beta")).token, "token-beta");
  assert.deepEqual(queries.map(({ clinicId }) => clinicId), ["clinic-alpha", "clinic-beta"]);
});

test("TikTok fails closed for missing clinic context", async () => {
  const { getTikTokAccess, queries } = fixture();
  await assert.rejects(getTikTokAccess(""), /contexto de clínica/i);
  assert.equal(queries.length, 0);
});

test("TikTok does not use a different clinic token when the account is missing", async () => {
  const { getTikTokAccess } = fixture();
  await assert.rejects(getTikTokAccess("clinic-gamma"), /Conecta tu cuenta/i);
});
