import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";

const testFolder = mkdtempSync(join(tmpdir(), "dental-meta-sqlite-"));
const sqliteUrl = `file:${join(testFolder, "delivery.db").replaceAll("\\", "/")}`;

function connect() {
  return new PrismaClient({ datasources: { db: { url: sqliteUrl } } });
}

let prisma;

before(async () => {
  prisma = connect();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ScheduledPost" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "procedureName" TEXT NOT NULL,
      "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
      "mediaUrl" TEXT NOT NULL,
      "generatedCaption" TEXT NOT NULL,
      "educationalCaption" TEXT,
      "commercialCaption" TEXT,
      "selectedStyle" TEXT NOT NULL DEFAULT 'EDUCATIONAL',
      "visualSummary" TEXT,
      "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "approvedAt" DATETIME,
      "facebookStatus" TEXT NOT NULL DEFAULT 'PENDING',
      "facebookPostId" TEXT,
      "facebookError" TEXT,
      "instagramStatus" TEXT NOT NULL DEFAULT 'PENDING',
      "instagramPostId" TEXT,
      "instagramError" TEXT,
      "facebookReviewOutcome" TEXT,
      "facebookReviewEvidence" TEXT,
      "facebookReviewedAt" DATETIME,
      "instagramReviewOutcome" TEXT,
      "instagramReviewEvidence" TEXT,
      "instagramReviewedAt" DATETIME,
      "facebookRetryCount" INTEGER NOT NULL DEFAULT 0,
      "instagramRetryCount" INTEGER NOT NULL DEFAULT 0,
      "facebookLastRetryAt" DATETIME,
      "instagramLastRetryAt" DATETIME
    )
  `);
});

after(async () => {
  await prisma?.$disconnect();
  rmSync(testFolder, { recursive: true, force: true });
});

async function makePost() {
  return prisma.scheduledPost.create({
    data: {
      id: randomUUID(),
      procedureName: "Prueba automatizada",
      generatedCaption: "Contenido simulado",
      mediaUrl: "https://example.test/fixture.jpg",
    },
  });
}

async function claimFacebook(client, id) {
  return client.scheduledPost.updateMany({
    where: { id, facebookStatus: "PENDING" },
    data: { facebookStatus: "IN_PROGRESS" },
  });
}

test("SQLite grants only one atomic claim across simultaneous Prisma clients", async () => {
  const post = await makePost();
  const otherClient = connect();

  try {
    const attempts = await Promise.allSettled([
      claimFacebook(prisma, post.id),
      claimFacebook(otherClient, post.id),
    ]);
    const successfulClaims = attempts
      .filter((attempt) => attempt.status === "fulfilled")
      .reduce((total, attempt) => total + attempt.value.count, 0);

    assert.equal(successfulClaims, 1);
    assert.equal((await prisma.scheduledPost.findUnique({ where: { id: post.id } })).facebookStatus, "IN_PROGRESS");
  } finally {
    await otherClient.$disconnect();
  }
});

test("an interrupted in-progress delivery remains blocked after reopening SQLite", async () => {
  const post = await makePost();
  assert.equal((await claimFacebook(prisma, post.id)).count, 1);

  const restartedClient = connect();
  try {
    const reloaded = await restartedClient.scheduledPost.findUnique({ where: { id: post.id } });
    assert.equal(reloaded.facebookStatus, "IN_PROGRESS");
    assert.equal((await claimFacebook(restartedClient, post.id)).count, 0);
  } finally {
    await restartedClient.$disconnect();
  }
});

test("a confirmed Facebook ID persists and does not block the untouched Instagram network", async () => {
  const post = await makePost();

  assert.equal((await claimFacebook(prisma, post.id)).count, 1);
  await prisma.scheduledPost.update({
    where: { id: post.id },
    data: { facebookStatus: "SUCCEEDED", facebookPostId: "123_999" },
  });

  const restartedClient = connect();
  try {
    const reloaded = await restartedClient.scheduledPost.findUnique({ where: { id: post.id } });
    assert.equal(reloaded.facebookStatus, "SUCCEEDED");
    assert.equal(reloaded.facebookPostId, "123_999");
    assert.equal((await claimFacebook(restartedClient, post.id)).count, 0);

    const instagramClaim = await restartedClient.scheduledPost.updateMany({
      where: { id: post.id, instagramStatus: "PENDING" },
      data: { instagramStatus: "IN_PROGRESS" },
    });
    assert.equal(instagramClaim.count, 1);
  } finally {
    await restartedClient.$disconnect();
  }
});

test("an uncertain publication cannot be reclaimed after saving review evidence", async () => {
  const post = await makePost();
  await prisma.scheduledPost.update({
    where: { id: post.id },
    data: { facebookStatus: "UNKNOWN", facebookError: "Respuesta de Meta inconclusa" },
  });
  await prisma.scheduledPost.update({
    where: { id: post.id },
    data: {
      facebookReviewOutcome: "NOT_FOUND",
      facebookReviewEvidence: "Consulta manual sin resultados concluyentes",
      facebookReviewedAt: new Date(),
    },
  });

  assert.equal((await claimFacebook(prisma, post.id)).count, 0);
  const saved = await prisma.scheduledPost.findUnique({ where: { id: post.id } });
  assert.equal(saved.facebookStatus, "UNKNOWN");
  assert.equal(saved.facebookReviewOutcome, "NOT_FOUND");
});
