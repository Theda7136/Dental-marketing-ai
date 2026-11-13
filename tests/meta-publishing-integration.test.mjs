import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { platformCaptions } from "../src/lib/platformCopy.mjs";
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
  deliveryFormat = "FEED",
  facebookPostId = null,
  instagramPostId = null,
  reviewed = true,
  archived = false,
  clinicId = "pilot",
  respond,
  publicMediaUrl = "https://demo.example.test",
  mediaContentType = "image/png",
  mediaStatus = 200,
} = {}) {
  const saved = {
    id: draft.id,
    clinicId,
    facebookStatus,
    instagramStatus,
    deliveryFormat,
    facebookPostId,
    instagramPostId,
    generatedCaption: draft.generatedCaption,
    clinicalVerifiedAt: reviewed ? new Date() : null,
    archivedAt: archived ? new Date() : null,
  };
  const requests = [];
  const account = { clinicId, provider: "facebook", accessToken: "test-token", pageId: "123", instagramId: instagram ? "456" : null };

  const prisma = {
    account: { findFirst: async ({ where }) => Object.entries(where).every(([field, expected]) => account[field] === expected) ? account : null },
    scheduledPost: {
      findUnique: async ({ where }) => Object.entries(where).every(([field, expected]) => saved[field] === expected) ? { ...saved } : null,
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
        assert.equal(where.clinicId, saved.clinicId);
        Object.assign(saved, data);
        return { ...saved };
      },
    },
  };

  const fetchMock = async (url, options) => {
    const path = new URL(url).pathname;
    if (new URL(url).hostname === "example.test") {
      const contentType = new URL(url).searchParams.has("format") ? "image/jpeg" : mediaContentType;
      return {
        status: mediaStatus,
        ok: mediaStatus >= 200 && mediaStatus < 300,
        headers: new Headers({ "content-type": contentType }),
        body: { cancel: async () => {} },
      };
    }
    requests.push({ path, method: options?.method ?? "GET", body: options?.body?.toString() || "" });
    if (respond) return respond(path, options);
    if (path === "/v26.0/123/photos") return graphResponse({ id: "123_999" });
    if (path === "/v26.0/123/photo_stories") return graphResponse({ success: true, post_id: "123_777" });
    if (path === "/v26.0/456/media") return graphResponse({ id: "container-7" });
    if (path === "/v26.0/container-7") return graphResponse({ status_code: "FINISHED" });
    if (path === "/v26.0/456/media_publish") return graphResponse({ id: "789" });
    throw new Error(`Unexpected Meta call: ${path}`);
  };

  const module = { exports: {} };
  const loaded = runInNewContext(
    `(function(require, module, exports) { ${compiledPublisher} })`,
    { fetch: fetchMock, AbortSignal, URL, URLSearchParams, process: { env: { ...process.env, META_PUBLIC_MEDIA_URL: publicMediaUrl } }, setTimeout, console },
    { filename: "metaPublish.compiled.js" },
  );
  loaded((name) => {
    if (name === "@/lib/prisma") return { prisma };
    if (name === "@/lib/platformCopy.mjs") return { platformCaptions };
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
    "/v26.0/container-7",
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

test("localhost media URL fails before claiming a network or calling Meta", async () => {
  const { publishToMeta, saved, requests } = harness({ publicMediaUrl: "http://localhost:3000" });

  await assert.rejects(publishToMeta(draft), /URL HTTPS pública/);
  assert.equal(saved.facebookStatus, "PENDING");
  assert.equal(saved.instagramStatus, "PENDING");
  assert.equal(requests.length, 0);
});

test("unavailable public media does not claim delivery or contact Meta", async () => {
  const { publishToMeta, saved, requests } = harness({ mediaStatus: 503 });
  await assert.rejects(publishToMeta(draft, "facebook"), /archivo público no está disponible/i);
  assert.equal(saved.facebookStatus, "PENDING");
  assert.equal(saved.instagramStatus, "PENDING");
  assert.equal(requests.length, 0);
});

test("a public HTTPS media URL is accepted without changing the OAuth callback", async () => {
  const { publishToMeta, saved, requests } = harness({ publicMediaUrl: "https://sample.trycloudflare.com" });
  const outcome = await publishToMeta(draft, "facebook");

  assert.equal(outcome.facebookId, "123_999");
  assert.equal(saved.facebookStatus, "SUCCEEDED");
  assert.equal(requests.length, 1);
});

test("unreviewed clinical media never reaches Meta", async () => {
  const { publishToMeta, requests } = harness({ reviewed: false });
  await assert.rejects(publishToMeta(draft), /correspondencia clínica/i);
  assert.equal(requests.length, 0);
});

test("network-specific captions have distinct calls to action and hashtag limits", () => {
  const caption = "Un tratamiento se planifica después de una valoración profesional.\n\n#Dental #SaludOral #Sonrisa #Clínica #Medellín #Paciente\n\nHaz clic en el enlace de nuestra biografía para agendar.";
  const result = platformCaptions(caption);
  assert.match(result.facebook, /Escríbenos/);
  assert.doesNotMatch(result.facebook, /biografía/);
  assert.match(result.instagram, /mensaje directo/);
  assert.ok((result.facebook.match(/#/g) || []).length <= 2);
  assert.ok((result.instagram.match(/#/g) || []).length <= 5);
});

test("Meta receives a different caption for each supported network", async () => {
  const { publishToMeta, requests } = harness({ instagram: true });
  await publishToMeta(draft);
  const ig = requests.find((request) => request.path.endsWith("/456/media"));
  const fb = requests.find((request) => request.path.endsWith("/123/photos"));
  assert.ok(ig);
  assert.ok(fb);
  const igCaption = new URLSearchParams(ig.body).get("caption");
  const fbCaption = new URLSearchParams(fb.body).get("caption");
  assert.notEqual(igCaption, fbCaption);
  assert.match(igCaption, /mensaje directo/);
  assert.match(fbCaption, /Escríbenos/);
  const instagramMedia = new URLSearchParams(ig.body).get("image_url") || "";
  const facebookMedia = new URLSearchParams(fb.body).get("url") || "";
  assert.match(instagramMedia, /[?&]format=jpeg(?:&|$)/);
  assert.doesNotMatch(facebookMedia, /[?&]format=jpeg(?:&|$)/);
});

test("archived proposals are rejected before contacting Meta", async () => {
  const { publishToMeta, requests } = harness({ archived: true });
  await assert.rejects(publishToMeta(draft), /archivada/i);
  assert.equal(requests.length, 0);
});

test("Instagram image Story uses STORIES instead of a feed container", async () => {
  const { publishToMeta, saved, requests } = harness({ instagram: true, deliveryFormat: "STORY" });
  await publishToMeta(draft, "instagram");

  const container = requests.find((request) => request.path.endsWith("/456/media"));
  assert.ok(container);
  const params = new URLSearchParams(container.body);
  assert.equal(params.get("media_type"), "STORIES");
  assert.equal(params.has("video_url"), false);
  assert.match(params.get("image_url") || "", /[?&]format=jpeg(?:&|$)/);
  assert.equal(saved.instagramStatus, "SUCCEEDED");
  assert.equal(saved.facebookStatus, "PENDING");
  assert.deepEqual(requests.map((request) => request.path), [
    "/v26.0/456/media",
    "/v26.0/container-7",
    "/v26.0/456/media_publish",
  ]);
});

test("Facebook photo Story uploads unpublished media, then publishes a Story", async () => {
  const { publishToMeta, saved, requests } = harness({ deliveryFormat: "STORY" });
  const published = await publishToMeta(draft, "facebook");

  assert.equal(published.facebookId, "123_777");
  assert.equal(saved.facebookStatus, "SUCCEEDED");
  assert.equal(saved.instagramStatus, "PENDING");
  assert.deepEqual(requests.map((request) => request.path), [
    "/v26.0/123/photos",
    "/v26.0/123/photo_stories",
  ]);
  const photoParams = new URLSearchParams(requests[0].body);
  assert.equal(photoParams.get("published"), "false");
  assert.match(photoParams.get("url") || "", /[?&]format=jpeg(?:&|$)/);
  assert.equal(new URLSearchParams(requests[1].body).get("photo_id"), "123_999");
});

test("Facebook video Story uses the video_stories upload flow", async () => {
  const { publishToMeta, saved, requests } = harness({
    deliveryFormat: "STORY",
    mediaContentType: "video/mp4",
    respond: async (path, options) => {
      if (path === "/v26.0/123/video_stories") {
        const phase = new URLSearchParams(options.body).get("upload_phase");
        return phase === "start"
          ? graphResponse({ video_id: "555", upload_url: "https://rupload.facebook.com/upload" })
          : graphResponse({ success: true, post_id: "123_888" });
      }
      if (path === "/upload") return graphResponse({ success: true });
      if (path === "/v26.0/555") return graphResponse({ status: { publishing_phase: { status: "complete" } } });
      throw new Error(`Unexpected Meta call: ${path}`);
    },
  });

  const published = await publishToMeta({ ...draft, mediaKind: "video" }, "facebook");
  assert.equal(published.facebookId, "123_888");
  assert.equal(saved.facebookStatus, "SUCCEEDED");
  assert.deepEqual(requests.map((request) => request.path), [
    "/v26.0/123/video_stories",
    "/upload",
    "/v26.0/123/video_stories",
    "/v26.0/555",
  ]);
  assert.equal(new URLSearchParams(requests[2].body).get("video_state"), null);
});

test("Facebook Stories do not fall back to feed when the story endpoint fails", async () => {
  const { publishToMeta, saved, requests } = harness({
    deliveryFormat: "STORY",
    respond: async (path) => {
      if (path === "/v26.0/123/photos") return graphResponse({ id: "123_999" });
      if (path === "/v26.0/123/photo_stories") return graphResponse({ error: { message: "Rejected" } }, 400);
      throw new Error(`Unexpected call: ${path}`);
    },
  });
  await assert.rejects(publishToMeta(draft, "facebook"), /no confirmó/i);
  assert.equal(saved.facebookStatus, "UNKNOWN");
  assert.equal(requests.filter((request) => request.path.endsWith("/photos")).length, 1);
  assert.equal(requests.filter((request) => request.path.endsWith("/feed")).length, 0);
});

test("Meta never publishes a post owned by another clinic", async () => {
  const { publishToMeta, requests } = harness({ clinicId: "another-clinic" });
  await assert.rejects(publishToMeta(draft), /Vuelve a conectar|ya no existe/);
  assert.equal(requests.length, 0);
});
