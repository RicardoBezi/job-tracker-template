-- job-tracker schema. Apply once as the Neon project owner:
--   psql "$NEON_OWNER_URL" -f schema.sql   (or paste into the Neon SQL editor)

create extension if not exists pgcrypto;

create type job_status as enum
  ('applied','assessment','interview','next-phase','offer','rejected','withdrawn');

create table applications (
  id               uuid primary key default gen_random_uuid(),
  company          text not null,
  company_norm     text not null,            -- lowercased/stripped, for matching
  role             text,
  role_norm        text,
  status           job_status not null default 'applied',
  applied_at       date,
  last_activity_at timestamptz,
  source           text not null check (source in ('email','manual','migrated')),
  notes            text,
  manual_override  boolean not null default false,  -- routine may not change status
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table scan_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  trigger       text not null check (trigger in ('cron','manual')),
  status        text not null default 'running'
                check (status in ('running','success','partial','error')),
  emails_found  integer,
  apps_created  integer not null default 0,
  apps_updated  integer not null default 0,
  errors        jsonb not null default '[]',   -- [{at, message, context}]
  summary       text
);

create table application_events (
  id               uuid primary key default gen_random_uuid(),
  application_id   uuid not null references applications(id) on delete cascade,
  scan_run_id      uuid references scan_runs(id),
  event_type       text not null check (event_type in
                     ('created','email_detected','status_change','manual_edit','migrated')),
  old_status       job_status,
  new_status       job_status,
  gmail_message_id text unique,               -- idempotency key; null for manual events
  email_subject    text,
  email_from       text,
  occurred_at      timestamptz not null,
  created_at       timestamptz not null default now()
);

-- Run once as owner after tables exist (fill in a generated password, do not commit it):
-- create role app_rw with login password '<GENERATED>';
-- grant usage on schema public to app_rw;
-- grant select, insert, update, delete on applications, application_events, scan_runs to app_rw;
