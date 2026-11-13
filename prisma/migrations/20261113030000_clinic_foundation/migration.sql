CREATE TABLE "Clinic" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

INSERT INTO "Clinic" ("id", "name", "status", "createdAt", "updatedAt")
VALUES ('pilot', 'Clínica piloto', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "Account" ADD COLUMN "clinicId" TEXT NOT NULL DEFAULT 'pilot';
ALTER TABLE "ScheduledPost" ADD COLUMN "clinicId" TEXT NOT NULL DEFAULT 'pilot';
ALTER TABLE "BrandProfile" ADD COLUMN "clinicId" TEXT NOT NULL DEFAULT 'pilot';

CREATE INDEX "Account_clinicId_idx" ON "Account"("clinicId");
CREATE INDEX "ScheduledPost_clinicId_status_createdAt_idx" ON "ScheduledPost"("clinicId", "status", "createdAt");
