CREATE TYPE "public"."ce_scoring_policy" AS ENUM('strict_zero_all_ce_if_any_fail', 'weighted_ce_independent');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "ce_scoring_policy" "ce_scoring_policy" DEFAULT 'strict_zero_all_ce_if_any_fail' NOT NULL;
