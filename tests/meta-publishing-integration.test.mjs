import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const publisherFile = new URL("../src/lib/metaPublish.ts", import.meta.url);
const compiledPublisher = ts.transpileModule(readFileSync(publisherFile, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const draft = {
  id: "post-1",
  mediaUrl: "private-media",
  generatedCaption: "Contenido de prueba aprobado",
  mediaKind: "image",
};

function harness({
  instagram = false,
  facebookStatus = "PENDING",
  instagramStatus = "PENDING",
  facebookPostId = null,
  instagramPostId = null,
  respond,
} = {}) {
  const saved = {
    id: draft.id,
    facebookStatus,
    instagramStatus,
    facebookPostId,
    instagramPostId,
  };
  const requests = [];
  const account = { accessToken: "test-token", pageId: "123", instagramId: instagram ? "456" : null };

  const prisma = {
    account: { findFirst: async () => account },
    scheduledPost: {
      findUnique: async ({ where }) => where.id === saved.id ? { ...saved } : null,
      updateMany: async ({ where, data }) => {
        if (where.id !== saved.id) return { count: 0 };
        for (const [field, expected] of Object.entries(where)) {
          if (field !== "id" && saved[field] !== expected) return { count: 0 };
        }
        Object.assign(saved, data);
        return { count: 1 };
      },
      update: async ({ where, data }) => {
        assert.equal(where.id, saved.id);
        Object.assign(saved, data);
        return { ...saved };
      },
    },
  };

  const fetchMock = async (url, options) => {
    const path = new URL(url).pathname;
    requests.push({ path, method: options?.method ?? "GET" });
    if (respond) return respond(path, options);
    if (path === "/v26.0/123/photos") return graphResponse({ id: "123_999" });
    if (path === "/v26.0/456/media") return graphResponse({ id: "container-7" });
    if (path === "/v26.0/456/media_publish") return graphResponse({ id: "789" });
    throw new Error(`Unexpected Meta call: ${path}`);
  };

  const module = { exports: {} };
  const loaded = runInNewContext(
    `(function(require, module, exports) { ${compiledPublisher} })`,
    { fetch: fetchMock, AbortSignal, URL, URLSearchParams, process, setTimeout, console },
    { filename: "metaPublish.compiled.js" },
  );
  loaded((name) => {
    if (name === "@/lib/prisma") return { prisma };
    if (name === "@/lib/mediaSignature") {
      return { createSignedMediaUrl: () => "https://example.test/private-image" };
    }
    if (name === "@/lib/metaDeliveryPolicy.mjs") {
      return { canSendToNetwork: (status) => status === "PENDING" };
    }
    throw new Error(`Unexpected import: ${name}`);
  }, module, module.exports);

  return { publishToMeta: module.exports.publishToMeta, saved, requests };
}

function graphResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("confirmed Facebook photo is not sent twice", async () => {
  const { publishToMeta, saved, requests } = harness();
  const first = await publishToMeta(draft);
  const second = await publishToMeta(draft);

  assert.equal(first.facebookId, "123_999");
  assert.equal(second.facebookId, "123_999");
  assert.equal(saved.facebookStatus, "SUCCEEDED");
  assert.equal(saved.facebookPostId, "123_999");
  assert.equal(requests.filter((request) => request.path.endsWith("/photos")).length, 1);
});

test("an ambiguous Facebook response blocks future sends", async () => {
  const { publishToMeta, saved, requests } = harness({
    respond: async () => { throw new Error("Connection lost after Meta accepted request"); },
  });

  await assert.rejects(publishToMeta(draft), /No se confirmó/);
  assert.equal(saved.facebookStatus, "UNKNOWN");
  await assert.rejects(publishToMeta(draft), /No se confirmó/);
  assert.equal(requests.length, 1);
});

test("Instagram failure still permits Facebook, then blocks repeating Instagram", async () => {
  const { publishToMeta, saved, requests } = harness({
    instagram: true,
    respond: async (path) => {
      if (path.endsWith("/456/media")) return graphResponse({ error: { message: "Timeout" } }, 503);
      if (path.endsWith("/123/photos")) return graphResponse({ id: "123_999" });
      throw new Error("Unexpected URL");
    },
  });

  const first = await publishToMeta(draft);
  const second = await publishToMeta(draft);
  assert.equal(first.facebookId, "123_999");
  assert.equal(second.facebookId, "123_999");
  assert.equal(saved.instagramStatus, "UNKNOWN");
  assert.equal(saved.facebookStatus, "SUCCEEDED");
  assert.equal(requests.length, 2);
});

test("selective Instagram send leaves a previously successful Facebook untouched", async () => {
  const { publishToMeta, saved, requests } = harness({
    instagram: true,
    facebookStatus: "SUCCEEDED",
    facebookPostId: "123_999",
  });

  const completed = await publishToMeta(draft, "instagram");
  assert.equal(completed.instagramId, "789");
  assert.equal(saved.facebookPostId, "123_999");
  assert.equal(saved.instagramStatus, "SUCCEEDED");
  assert.deepEqual(requests.map((request) => request.path), [
    "/v26.0/456/media",
    "/v26.0/456/media_publish",
  ]);
});

test("concurrent requests can claim a pending Facebook publication only once", async () => {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  let firstCall;
  const called = new Promise((resolve) => { firstCall = resolve; });
  const { publishToMeta, saved, requests } = harness({
    respond: async () => {
      firstCall();
      await barrier;
      return graphResponse({ id: "123_999" });
    },
  });

  const primary = publishToMeta(draft);
  await called;
  const duplicate = publishToMeta(draft);
  const duplicateResult = await Promise.allSettled([duplicate]);
  release();
  const primaryResult = await primary;

  assert.equal(duplicateResult[0].status, "rejected");
  assert.equal(primaryResult.facebookId, "123_999");
  assert.equal(saved.facebookStatus, "SUCCEEDED");
  assert.equal(requests.length, 1);
});
