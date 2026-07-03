CREATE INDEX IF NOT EXISTS "Contact_project_status_lastCalledAt_idx" ON "Contact"("projectId", "status", "lastCalledAt");
CREATE INDEX IF NOT EXISTS "Contact_callerId_idx" ON "Contact"("callerId");
CREATE INDEX IF NOT EXISTS "CallLog_callerId_timestamp_idx" ON "CallLog"("callerId", "timestamp");
CREATE INDEX IF NOT EXISTS "CallLog_projectId_timestamp_idx" ON "CallLog"("projectId", "timestamp");
