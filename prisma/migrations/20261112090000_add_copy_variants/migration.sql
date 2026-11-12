ALTER TABLE "ScheduledPost" ADD COLUMN "educationalCaption" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN "commercialCaption" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN "selectedStyle" TEXT NOT NULL DEFAULT 'EDUCATIONAL';
ALTER TABLE "ScheduledPost" ADD COLUMN "visualSummary" TEXT;
