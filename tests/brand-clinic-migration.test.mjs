import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";

const testDirectory = mkdtempSync(join(tmpdir(), "dental-brand-clinics-"));
const prisma = new PrismaClient({
  datasources: { db: { url: `file:${join(testDirectory, "brands.db").replaceAll("\\", "/")}` } },
});

before(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "BrandProfile" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "clinicId" TEXT NOT NULL DEFAULT 'pilot',
      "clinicName" TEXT NOT NULL DEFAULT 'Dental Studio',
      "primaryColor" TEXT NOT NULL DEFAULT '#116D60',
      "fontFamily" TEXT NOT NULL DEFAULT 'SANS',
      "logoDataUrl" TEXT,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    "INSERT INTO BrandProfile (id, clinicId, clinicName, logoDataUrl) VALUES (?, ?, ?, ?)",
    "default", "pilot", "Dr Daniel Coy", "data:image/png;base64,cGlsb3Q=",
  );
  const migration = readFileSync(
    new URL("../prisma/migrations/20261113100000_brand_per_clinic/migration.sql", import.meta.url), "utf8",
  );
  for (const command of migration.split(";").map((sql) => sql.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(command);
  }
});

after(async () => {
  await prisma.$disconnect();
  rmSync(testDirectory, { recursive: true, force: true });
});

test("migration preserves pilot brand, logo and clinic association", async () => {
  const brand = await prisma.brandProfile.findUnique({ where: { clinicId: "pilot" } });
  assert.equal(brand?.id, "pilot");
  assert.equal(brand?.clinicName, "Dr Daniel Coy");
  assert.equal(brand?.logoDataUrl, "data:image/png;base64,cGlsb3Q=");
});

test("two clinics keep independent brand identities", async () => {
  const clinicId = `clinic-${randomUUID()}`;
  const brand = await prisma.brandProfile.create({
    data: { id: clinicId, clinicId, clinicName: "Clínica B", primaryColor: "#123456" },
  });
  assert.equal(brand.clinicName, "Clínica B");
  assert.equal((await prisma.brandProfile.findUnique({ where: { clinicId: "pilot" } }))?.clinicName, "Dr Daniel Coy");
  await prisma.brandProfile.update({
    where: { clinicId },
    data: { clinicName: "Clínica B renovada" },
  });
  assert.equal((await prisma.brandProfile.findUnique({ where: { clinicId } }))?.clinicName, "Clínica B renovada");
  assert.equal((await prisma.brandProfile.findUnique({ where: { clinicId: "pilot" } }))?.clinicName, "Dr Daniel Coy");
});

test("database refuses a second brand record for the same clinic", async () => {
  await assert.rejects(
    prisma.brandProfile.create({
      data: { id: "duplicate-pilot", clinicId: "pilot", clinicName: "Duplicado" },
    }),
  );
});
