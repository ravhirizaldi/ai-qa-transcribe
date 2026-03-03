DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'tenant_role'
  ) THEN
    CREATE TYPE "public"."tenant_role" AS ENUM ('owner', 'admin', 'member', 'viewer');
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenant_memberships'
      AND column_name = 'role'
      AND udt_name = 'text'
  ) THEN
    ALTER TABLE "tenant_memberships"
      ALTER COLUMN "role" TYPE "tenant_role"
      USING (
        CASE
          WHEN "role" IN ('owner', 'admin', 'member', 'viewer') THEN "role"::"tenant_role"
          ELSE 'member'::"tenant_role"
        END
      );
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "tenant_memberships"
  ADD COLUMN IF NOT EXISTS "role" "tenant_role";
--> statement-breakpoint
UPDATE "tenant_memberships"
SET "role" = 'member'
WHERE "role" IS NULL;
--> statement-breakpoint
ALTER TABLE "tenant_memberships"
  ALTER COLUMN "role" SET DEFAULT 'member';
--> statement-breakpoint
ALTER TABLE "tenant_memberships"
  ALTER COLUMN "role" SET NOT NULL;
