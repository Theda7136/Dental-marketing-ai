ALTER TABLE "Account" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "Account" ADD COLUMN "tokenExpiresAt" DATETIME;
ALTER TABLE "Account" ADD COLUMN "grantedScopes" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN "tiktokStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "ScheduledPost" ADD COLUMN "tiktokPublishId" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN "tiktokError" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN "tiktokPrivacy" TEXT;
