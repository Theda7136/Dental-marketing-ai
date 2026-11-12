ALTER TABLE "ScheduledPost" ADD COLUMN "facebookStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "ScheduledPost" ADD COLUMN "facebookPostId" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN "facebookError" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN "instagramStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "ScheduledPost" ADD COLUMN "instagramPostId" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN "instagramError" TEXT;

-- Existing published records must not be republished automatically.
UPDATE "ScheduledPost"
SET "facebookStatus" = 'UNKNOWN', "instagramStatus" = 'UNKNOWN'
WHERE "status" = 'PUBLISHED';
