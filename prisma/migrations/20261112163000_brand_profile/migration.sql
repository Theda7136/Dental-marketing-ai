CREATE TABLE "BrandProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clinicName" TEXT NOT NULL DEFAULT 'Dental Studio',
  "primaryColor" TEXT NOT NULL DEFAULT '#116D60',
  "fontFamily" TEXT NOT NULL DEFAULT 'SANS',
  "logoDataUrl" TEXT,
  "updatedAt" DATETIME NOT NULL
);
