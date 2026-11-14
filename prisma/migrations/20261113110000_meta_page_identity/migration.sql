-- For Facebook, the asset being linked is the Page, not the person managing it.
-- Keep existing Page tokens, Instagram associations, and pilot clinic ownership.
UPDATE "Account"
SET "providerAccountId" = "pageId"
WHERE "provider" = 'facebook'
  AND "pageId" IS NOT NULL
  AND "pageId" <> ''
  AND "providerAccountId" <> "pageId";
