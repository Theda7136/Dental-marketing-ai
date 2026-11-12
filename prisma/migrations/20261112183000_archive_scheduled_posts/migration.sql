ALTER TABLE "ScheduledPost" ADD COLUMN "archivedAt" DATETIME;
CREATE INDEX "ScheduledPost_archivedAt_idx" ON "ScheduledPost"("archivedAt");
