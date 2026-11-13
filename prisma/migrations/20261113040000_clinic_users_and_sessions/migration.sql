CREATE TABLE "StudioUser" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "disabledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "StudioUser_email_key" ON "StudioUser"("email");

CREATE TABLE "ClinicMembership" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clinicId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicMembership_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClinicMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StudioUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ClinicMembership_clinicId_userId_key" ON "ClinicMembership"("clinicId", "userId");
CREATE INDEX "ClinicMembership_userId_idx" ON "ClinicMembership"("userId");

CREATE TABLE "LoginSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" DATETIME,
  CONSTRAINT "LoginSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StudioUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LoginSession_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LoginSession_tokenHash_key" ON "LoginSession"("tokenHash");
CREATE INDEX "LoginSession_userId_expiresAt_idx" ON "LoginSession"("userId", "expiresAt");
CREATE INDEX "LoginSession_clinicId_expiresAt_idx" ON "LoginSession"("clinicId", "expiresAt");
