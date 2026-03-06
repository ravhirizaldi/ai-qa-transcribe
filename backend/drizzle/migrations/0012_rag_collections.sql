ALTER TABLE "global_provider_settings" ADD COLUMN "xai_management_api_key" text;--> statement-breakpoint
ALTER TABLE "global_provider_settings" ADD COLUMN "xai_rag_model" text DEFAULT 'grok-4-1-fast-reasoning';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "xai_collection_id" text;--> statement-breakpoint
CREATE TYPE "public"."rag_doc_sync_status" AS ENUM('pending', 'synced', 'failed', 'deleted');--> statement-breakpoint
CREATE TABLE "project_rag_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"job_score_edit_history_id" uuid NOT NULL,
	"job_evaluation_row_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"area" text NOT NULL,
	"parameter" text NOT NULL,
	"old_score" integer NOT NULL,
	"new_score" integer NOT NULL,
	"max_score" integer NOT NULL,
	"reason_note" text NOT NULL,
	"file_name" text NOT NULL,
	"doc_sha256" text NOT NULL,
	"xai_collection_id" text,
	"xai_file_id" text,
	"sync_status" "rag_doc_sync_status" DEFAULT 'pending' NOT NULL,
	"sync_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"uploaded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_rag_documents_job_score_edit_history_id_unique" UNIQUE("job_score_edit_history_id")
);
--> statement-breakpoint
CREATE INDEX "project_rag_documents_project_status_created_idx" ON "project_rag_documents" USING btree ("project_id","sync_status","created_at");--> statement-breakpoint
CREATE INDEX "project_rag_documents_job_created_idx" ON "project_rag_documents" USING btree ("job_id","created_at");
