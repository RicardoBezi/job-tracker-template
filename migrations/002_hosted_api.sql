-- Apply this migration when upgrading an existing job-tracker database.
-- No data is rewritten; these indexes support the hosted API read paths.

create index if not exists applications_match_idx
  on applications (company_norm, role_norm);
create index if not exists applications_activity_idx
  on applications (last_activity_at desc);
create index if not exists application_events_timeline_idx
  on application_events (application_id, occurred_at desc);
create index if not exists scan_runs_started_idx
  on scan_runs (started_at desc);

-- After the hosted API is live, rotate the old dashboard-role password in Neon.
-- Do not put the replacement credential in any browser asset or repository file.
