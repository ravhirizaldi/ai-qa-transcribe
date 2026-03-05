CREATE TYPE "public"."job_score_edit_change_source" AS ENUM('manual', 'ce_strict_auto');--> statement-breakpoint
CREATE TABLE "job_score_edit_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"job_evaluation_row_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"area" text NOT NULL,
	"parameter" text NOT NULL,
	"old_score" integer NOT NULL,
	"new_score" integer NOT NULL,
	"max_score" integer NOT NULL,
	"reason_note" text NOT NULL,
	"change_source" "job_score_edit_change_source" NOT NULL,
	"edited_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_score_edit_history" ADD CONSTRAINT "job_score_edit_history_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_score_edit_history" ADD CONSTRAINT "job_score_edit_history_job_evaluation_row_id_job_evaluation_rows_id_fk" FOREIGN KEY ("job_evaluation_row_id") REFERENCES "public"."job_evaluation_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_score_edit_history" ADD CONSTRAINT "job_score_edit_history_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_score_edit_history_job_created_idx" ON "job_score_edit_history" USING btree ("job_id","created_at");
