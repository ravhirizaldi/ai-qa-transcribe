ALTER TABLE "users"
ADD COLUMN "fullname" text DEFAULT 'User' NOT NULL;
--> statement-breakpoint
UPDATE "users"
SET "fullname" = 'User'
WHERE "fullname" IS NULL OR btrim("fullname") = '';
