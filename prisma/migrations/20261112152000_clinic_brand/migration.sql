CREATE TABLE "ClinicBrand" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "clinicName" TEXT NOT NULL DEFAULT 'Dental Studio',
    "primaryColor" TEXT NOT NULL DEFAULT '#147c72',
    "backgroundColor" TEXT NOT NULL DEFAULT '#0a1817',
    "fontFamily" TEXT NOT NULL DEFAULT 'sans',
    "logoDataUrl" TEXT,
    "updatedAt" DATETIME NOT NULL
);