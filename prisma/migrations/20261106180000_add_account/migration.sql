-- Keep this migration safe for development databases that already have Account.
CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "name" TEXT,
    "accessToken" TEXT NOT NULL,
    "pageName" TEXT,
    "pageId" TEXT,
    "instagramId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Account_provider_providerAccountId_key"
ON "Account"("provider", "providerAccountId");