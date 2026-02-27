ALTER TABLE "projects" ADD CONSTRAINT "projects_id_tenant_id_unique" UNIQUE("id","tenant_id");
--> statement-breakpoint
ALTER TABLE "project_matrix_versions" ADD CONSTRAINT "project_matrix_versions_id_project_id_unique" UNIQUE("id","project_id");
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_id_tenant_id_project_id_unique" UNIQUE("id","tenant_id","project_id");
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_batch_tenant_project_fk" FOREIGN KEY ("batch_id","tenant_id","project_id") REFERENCES "public"."batches"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_matrix_version_project_fk" FOREIGN KEY ("matrix_version_id","project_id") REFERENCES "public"."project_matrix_versions"("id","project_id") ON DELETE no action ON UPDATE no action;