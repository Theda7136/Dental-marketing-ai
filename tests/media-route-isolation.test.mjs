import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync(new URL("../src/app/api/media/[id]/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText;

const postId = "7f7331e8-422d-4277-a51b-0343fcbb1487";
const clinicPosts = new Map([
  ["clinic-alpha", { id: postId, mediaType: "VIDEO" }],
  ["clinic-beta", { id: "23c7331e-422d-4277-a51b-0343fcbb1487", mediaType: "VIDEO" }],
]);

function harness({ clinicId = null, signedClinic = null, postRecords = clinicPosts } = {}) {
  const lookedUp = [];
  const mediaReads = [];
  const permissions = [];
  const prisma = {
    scheduledPost: {
      async findUnique({ where }) {
        lookedUp.push(where);
        const post = postRecords.get(where.clinicId);
        return post?.id === where.id ? post : null;
      },
    },
  };
  const exported = { exports: {} };
  const loader = runInNewContext(
    `(function(require, module, exports) { ${compiled} })`,
    { Buffer, URL, Response, Uint8Array, console, process: { env: {} } },
  );
  loader((name) => {
    if (name === "next/server") {
      return { NextResponse: class extends Response {
        static json(payload, options = {}) {
          return new Response(JSON.stringify(payload), {
            status: options.status || 200,
            headers: { "content-type": "application/json" },
          });
        }
      } };
    }
    if (name === "sharp") return { __esModule: true, default: () => { throw new Error("Unexpected image conversion"); } };
    if (name === "../../../../lib/prisma") return { prisma };
    if (name === "@/lib/studioAccess") return {
      getStudioAccess: async (permission) => {
        permissions.push(permission);
        return clinicId ? { clinic: { id: clinicId } } : null;
      },
    };
    if (name === "../../../../lib/mediaSignature") {
      return { isValidMediaSignature: (sourceClinic) => Boolean(signedClinic && sourceClinic === signedClinic) };
    }
    if (name === "../../../../services/mediaStorage") {
      return {
        readPostMedia: async (mediaClinic, id, kind) => {
          mediaReads.push({ mediaClinic, id, kind });
          return Uint8Array.from([1, 2, 3]);
        },
      };
    }
    throw new Error(`Unexpected import: ${name}`);
  }, exported, exported.exports);

  async function getMedia(query = "") {
    return exported.exports.GET(
      new Request(`https://dental.example.test/api/media/${postId}${query}`),
      { params: Promise.resolve({ id: postId }) },
    );
  }

  return { getMedia, lookedUp, mediaReads, permissions };
}

test("clinic alpha session reads only alpha media", async () => {
  const route = harness({ clinicId: "clinic-alpha" });
  const response = await route.getMedia();
  assert.equal(response.status, 200);
  assert.deepEqual(route.lookedUp, [{ id: postId, clinicId: "clinic-alpha" }]);
  assert.deepEqual(route.mediaReads, [{ mediaClinic: "clinic-alpha", id: postId, kind: "video" }]);
  assert.deepEqual(route.permissions, ["content:read"]);
});

test("clinic beta session cannot read alpha media even when the post ID is known", async () => {
  const route = harness({ clinicId: "clinic-beta" });
  const response = await route.getMedia();
  assert.equal(response.status, 404);
  assert.equal(route.mediaReads.length, 0);
  assert.deepEqual(route.lookedUp, [{ id: postId, clinicId: "clinic-beta" }]);
});

test("unauthenticated requests cannot reach the database or storage", async () => {
  const route = harness();
  const response = await route.getMedia();
  assert.equal(response.status, 401);
  assert.equal(route.lookedUp.length, 0);
  assert.equal(route.mediaReads.length, 0);
});

test("signed media resolves ownership from signed clinic, not an unrelated browser session", async () => {
  const route = harness({ clinicId: "clinic-beta", signedClinic: "clinic-alpha" });
  const response = await route.getMedia("?clinic=clinic-alpha&expires=9999999999&signature=test");
  assert.equal(response.status, 200);
  assert.deepEqual(route.lookedUp, [{ id: postId, clinicId: "clinic-alpha" }]);
  assert.deepEqual(route.mediaReads, [{ mediaClinic: "clinic-alpha", id: postId, kind: "video" }]);
  assert.equal(route.permissions.length, 0);
});

test("signed links cannot access a post owned by another clinic", async () => {
  const route = harness({ signedClinic: "clinic-beta" });
  const response = await route.getMedia("?clinic=clinic-beta&expires=9999999999&signature=test");
  assert.equal(response.status, 404);
  assert.equal(route.mediaReads.length, 0);
});

test("a missing clinic post is never read from storage even if the file exists", async () => {
  const route = harness({ clinicId: "clinic-alpha", postRecords: new Map() });
  const response = await route.getMedia();
  assert.equal(response.status, 404);
  assert.equal(route.mediaReads.length, 0);
});
