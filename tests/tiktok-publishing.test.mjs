import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const publisher = ts.transpileModule(readFileSync(new URL("../src/lib/tiktokPublisher.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(mediaType = "IMAGE") {
  const post = {
    id: "post-12345678",
    mediaUrl: "/api/media/post-12345678",
    mediaType,
    generatedCaption: "Resultado final de diseño de sonrisa en cerámica #DiseñoDeSonrisa",
    procedureName: "Diseño de Sonrisa",
    archivedAt: null,
    status: "PENDING_APPROVAL",
    tiktokStatus: "PENDING",
    tiktokPublishId: null,
  };
  const requests = [];
  let confirmation = "PROCESSING_DOWNLOAD";
  const prisma = {
    scheduledPost: {
      findUnique: async ({ where }) => where.id === post.id ? { ...post } : null,
      updateMany: async ({ where, data }) => {
        if (Object.entries(where).some(([field, value]) => post[field] !== value)) return { count: 0 };
        Object.assign(post, data);
        return { count: 1 };
      },
      update: async ({ where, data }) => {
        assert.equal(where.id, post.id);
        Object.assign(post, data);
        return { ...post };
      },
    },
  };
  const module = { exports: {} };
  const load = runInNewContext(
    `(function(require, module, exports) { ${publisher} })`,
    { console, URL, process: { env: { TIKTOK_PUBLIC_MEDIA_URL: "https://verified.example.com" } }, Date, Boolean },
  );
  load((id) => {
    if (id === "@/lib/prisma") return { prisma };
    if (id === "@/lib/mediaSignature") return { createSignedMediaUrl: () => "https://verified.example.com/photo.png?signature=test" };
    if (id === "@/lib/tiktok") return {
      getTikTokCreator: async () => ({
        token: "token",
        creator: { privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"] },
      }),
      getTikTokAccess: async () => ({ token: "token" }),
      tikTokRequest: async (endpoint, token, payload) => {
        requests.push({ endpoint, payload });
        if (endpoint.endsWith("/status/fetch/")) return { status: confirmation };
        return { publish_id: "pub-123" };
      },
    };
    throw new Error("Unexpected dependency: " + id);
  }, module, module.exports);
  return {
    post, requests,
    ...module.exports,
    setConfirmation: (value) => { confirmation = value; },
  };
}

test("TikTok refuses privacy levels unavailable for the account", async () => {
  const { post, requests, publishToTikTok } = fixture();
  await assert.rejects(
    publishToTikTok(post.id, "MUTUAL_FOLLOW_FRIENDS", { disableComment: false, disableDuet: false, disableStitch: false }),
    /privacidad/i,
  );
  assert.equal(requests.length, 0);
  assert.equal(post.tiktokStatus, "PENDING");
});

test("a photo is sent once and is not marked published until confirmed", async () => {
  const { post, requests, publishToTikTok, refreshTikTokPostStatus, setConfirmation } = fixture();
  const options = { disableComment: true, disableDuet: false, disableStitch: false };
  const first = await publishToTikTok(post.id, "SELF_ONLY", options);
  assert.equal(first.status, "PROCESSING");
  assert.equal(post.status, "PENDING_APPROVAL");
  assert.equal(requests[0].payload.media_type, "PHOTO");
  assert.equal(requests[0].payload.post_info.disable_comment, true);
  await assert.rejects(publishToTikTok(post.id, "SELF_ONLY", options), /ya recibió un intento/i);
  assert.equal(requests.length, 1);

  await refreshTikTokPostStatus(post.id);
  assert.equal(post.tiktokStatus, "PROCESSING");
  setConfirmation("PUBLISH_COMPLETE");
  await refreshTikTokPostStatus(post.id);
  assert.equal(post.tiktokStatus, "SUCCEEDED");
  assert.equal(post.status, "PUBLISHED");
});

test("TikTok video requests use video/init and verified HTTPS URL", async () => {
  const { post, requests, publishToTikTok } = fixture("VIDEO");
  await publishToTikTok(post.id, "SELF_ONLY", { disableComment: false, disableDuet: true, disableStitch: true });
  assert.equal(requests[0].endpoint, "/v2/post/publish/video/init/");
  assert.match(requests[0].payload.source_info.video_url, /^https:\/\/verified\.example\.com/);
  assert.equal(requests[0].payload.post_info.disable_duet, true);
});
