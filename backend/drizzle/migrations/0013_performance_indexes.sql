CREATE INDEX IF NOT EXISTS jobs_batch_status_idx ON jobs (batch_id, status);
CREATE INDEX IF NOT EXISTS jobs_batch_created_idx ON jobs (batch_id, created_at);
CREATE INDEX IF NOT EXISTS jobs_project_created_idx ON jobs (project_id, created_at);
CREATE INDEX IF NOT EXISTS batches_project_created_idx ON batches (project_id, created_at);
CREATE INDEX IF NOT EXISTS job_segments_job_segment_idx ON job_segments (job_id, segment_index);
CREATE INDEX IF NOT EXISTS job_evaluation_rows_job_row_idx ON job_evaluation_rows (job_id, row_index);
CREATE INDEX IF NOT EXISTS project_matrix_versions_project_call_active_idx ON project_matrix_versions (project_id, call_type, is_active);
