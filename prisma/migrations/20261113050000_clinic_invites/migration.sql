CREATE TABLE "ClinicInvite" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clinicId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "acceptedAt" DATETIME,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  CONSTRAINT "ClinicInvite_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ClinicInvite_tokenHash_key" ON "ClinicInvite"("tokenHash");
CREATE INDEX "ClinicInvite_clinicId_email_idx" ON "ClinicInvite"("clinicId", "email");
