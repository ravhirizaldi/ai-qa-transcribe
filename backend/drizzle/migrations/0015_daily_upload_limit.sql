ALTER TABLE "projects"
ADD COLUMN IF NOT EXISTS "daily_upload_limit" integer DEFAULT 100 NOT NULL;
