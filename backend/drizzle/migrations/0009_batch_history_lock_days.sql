ALTER TABLE "projects"
ADD COLUMN "batch_history_lock_days" integer DEFAULT 2 NOT NULL;
