ALTER TABLE "ScheduledPost" ADD COLUMN "facebookRetryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ScheduledPost" ADD COLUMN "instagramRetryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ScheduledPost" ADD COLUMN "facebookLastRetryAt" DATETIME;
ALTER TABLE "ScheduledPost" ADD COLUMN "instagramLastRetryAt" DATETIME;
