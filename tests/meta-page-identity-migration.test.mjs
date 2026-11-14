import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";

const folder = mkdtempSync(join(tmpdir(), "dental-meta-page-"));
const prisma = new PrismaClient({
  datasources: { db: { url: `file:${join(folder, "pages.db").replaceAll("\\", "/")}` } },
});

before(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Account" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "clinicId" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "providerAccountId" TEXT NOT NULL,
      "name" TEXT,
      "accessToken" TEXT NOT NULL,
      "pageId" TEXT,
      "pageName" TEXT,
      "instagramId" TEXT,
      "refreshToken" TEXT,
      "tokenExpiresAt" DATETIME,
      "grantedScopes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId")',
  );
  await prisma.account.create({
    data: {
      id: randomUUID(), clinicId: "pilot", provider: "facebook",
      providerAccountId: "manager-123", pageId: "page-789",
      pageName: "Dr Daniel Coy", accessToken: "existing-page-token", instagramId: "ig-456",
    },
  });

  const sql = readFileSync(
    new URL("../prisma/migrations/20261113110000_meta_page_identity/migration.sql", import.meta.url), "utf8",
  ).replace(/^--.*$/gm, "").trim();
  await prisma.$executeRawUnsafe(sql);
});

after(async () => {
  await prisma.$disconnect();
  rmSync(folder, { recursive: true, force: true });
});

test("Meta page migration preserves the clinic's existing token and Instagram link", async () => {
  const account = await prisma.account.findFirst({ where: { clinicId: "pilot", provider: "facebook" } });
  assert.equal(account?.providerAccountId, "page-789");
  assert.equal(account?.pageId, "page-789");
  assert.equal(account?.accessToken, "existing-page-token");
  assert.equal(account?.instagramId, "ig-456");
});

test("different clinics may connect different Pages managed by the same person", async () => {
  await prisma.account.create({
    data: {
      clinicId: "clinic-beta", provider: "facebook",
      providerAccountId: "page-999", pageId: "page-999",
      accessToken: "different-page-token",
    },
  });
  assert.equal(await prisma.account.count({ where: { provider: "facebook" } }), 2);
});

test("a Facebook Page cannot be attached to two clinics", async () => {
  await assert.rejects(
    prisma.account.create({
      data: {
        clinicId: "clinic-gamma", provider: "facebook",
        providerAccountId: "page-789", pageId: "page-789",
        accessToken: "foreign-token",
      },
    }),
  );
});
