-- Preserve all existing pilot branding values, including the uploaded logo.
UPDATE "BrandProfile"
SET "id" = "clinicId"
WHERE "id" = 'default' AND "clinicId" = 'pilot';

CREATE UNIQUE INDEX "BrandProfile_clinicId_key" ON "BrandProfile"("clinicId");
