ALTER TABLE "ScheduledPost" ADD COLUMN "scheduledFor" DATETIME;
CREATE INDEX "ScheduledPost_scheduledFor_idx" ON "ScheduledPost"("scheduledFor");
