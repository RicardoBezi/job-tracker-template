#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { normalize, validateFindings, planAction, computeVerdict, isGhosted, daysSinceActivity, GHOST_DAYS } from "./lib/core.mjs";

function fail(msg) { console.error(JSON.stringify({ error: msg })); process.exit(1); }
function out(obj) { console.log(JSON.stringify(obj, null, 2)); }
function arg(name) { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; }
function hasFlag(name) { return process.argv.includes(`--${name}`); }

const cmd = process.argv[2];
const commands = { "scan-state": scanState, "list-apps": listApps, "find": find, "begin-run": beginRun, "upsert": upsert, "log-error": logError, "end-run": endRun };
if (!commands[cmd]) fail(`unknown command: ${String(cmd)}. valid: ${Object.keys(commands).join(", ")}`);
if (!process.env.DATABASE_URL) {
  // routine sandboxes can't export env vars across Bash calls; fall back to gitignored .env
  try {
    const line = readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
    if (line) process.env.DATABASE_URL = line.slice("DATABASE_URL=".length).trim();
  } catch {}
}
if (!process.env.DATABASE_URL) fail("DATABASE_URL not set (env var or .env line DATABASE_URL=...)");
const sql = neon(process.env.DATABASE_URL);
await commands[cmd]();

async function scanState() {
  const [last] = await sql`select finished_at from scan_runs where status in ('success','partial') order by finished_at desc nulls last limit 1`;
  const stale = await sql`select id, started_at from scan_runs where status = 'running' and started_at < now() - interval '30 minutes'`;
  out({ last_successful_scan: last?.finished_at ?? null, stale_running_runs: stale });
}

async function listApps() {
  const rows = hasFlag("active")
    ? await sql`select id, company, role, status, applied_at, last_activity_at from applications where status not in ('rejected','withdrawn') order by last_activity_at desc nulls last`
    : await sql`select id, company, role, status, applied_at, last_activity_at from applications order by last_activity_at desc nulls last`;
  const now = Date.now();
  const tagged = rows.map((r) => ({ ...r, ghosted: isGhosted(r, now), days_quiet: daysSinceActivity(r, now) }));
  // --active means "worth the scanner's attention": drop rows silent past the threshold
  // unless asked for. They stay findable via `find`, which searches everything.
  out(hasFlag("active") && !hasFlag("include-ghosted") ? tagged.filter((r) => !r.ghosted) : tagged);
}

async function find() {
  const company = arg("company") ?? fail("--company required");
  const role = arg("role");
  const c = `%${normalize(company)}%`;
  const rows = role
    ? await sql`select id, company, role, status, applied_at, last_activity_at, manual_override from applications where company_norm like ${c} and role_norm like ${"%" + normalize(role) + "%"}`
    : await sql`select id, company, role, status, applied_at, last_activity_at, manual_override from applications where company_norm like ${c}`;
  const now = Date.now();
  out(rows.map((r) => ({ ...r, ghosted: isGhosted(r, now), days_quiet: daysSinceActivity(r, now) })));
}

async function beginRun() {
  const trigger = arg("trigger") ?? fail("--trigger cron|manual required");
  if (!["cron", "manual"].includes(trigger)) fail("--trigger must be cron or manual");
  const [run] = await sql`insert into scan_runs (trigger) values (${trigger}) returning id, started_at`;
  out(run);
}

async function logError() {
  const runId = arg("run") ?? fail("--run required");
  const message = arg("message") ?? fail("--message required");
  const entry = [{ at: new Date().toISOString(), message, context: arg("context") ?? null }];
  await sql`update scan_runs set errors = errors || ${JSON.stringify(entry)}::jsonb where id = ${runId}`;
  out({ logged: true });
}

async function endRun() {
  const runId = arg("run") ?? fail("--run required");
  const [run] = await sql`select apps_created, apps_updated, errors from scan_runs where id = ${runId}`;
  if (!run) fail("run not found");
  const verdict = computeVerdict({ errorCount: run.errors.length, appliedCount: run.apps_created + run.apps_updated });
  const summary = `${run.apps_created} created, ${run.apps_updated} updated, ${run.errors.length} errors`;
  await sql`update scan_runs set finished_at = now(), status = ${verdict}, summary = ${summary} where id = ${runId}`;
  out({ run_id: runId, status: verdict, summary });
}

async function upsert() {
  const runId = arg("run") ?? fail("--run required");
  const file = arg("file") ?? fail("--file required");
  const dry = hasFlag("dry-run");
  let raw;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (e) { fail(`cannot read/parse ${file}: ${e.message}`); }
  const { valid, invalid } = validateFindings(raw);
  const apps = await sql`select id, company_norm, role_norm, status, manual_override from applications`;
  const ids = valid.map((f) => f.gmail_message_id);
  const knownRows = ids.length ? await sql`select gmail_message_id from application_events where gmail_message_id = any(${ids})` : [];
  const known = new Set(knownRows.map((r) => r.gmail_message_id));
  const results = [];
  let created = 0, updated = 0;

  const logErr = async (message, context) => {
    if (dry) return;
    const entry = [{ at: new Date().toISOString(), message, context }];
    await sql`update scan_runs set errors = errors || ${JSON.stringify(entry)}::jsonb where id = ${runId}`;
  };

  for (const inv of invalid) {
    results.push({ outcome: "rejected_invalid", error: inv.error });
    await logErr(`invalid finding: ${inv.error}`, JSON.stringify(inv.finding).slice(0, 500));
  }

  for (const f of valid) {
    const action = planAction(f, apps, known);
    const res = { gmail_message_id: f.gmail_message_id, company: f.company, outcome: action.outcome };
    try {
      if (action.outcome === "created") {
        if (!dry) {
          const [a] = await sql`insert into applications (company, company_norm, role, role_norm, status, applied_at, last_activity_at, source)
            values (${f.company}, ${action.company_norm}, ${f.role}, ${action.role_norm}, ${f.detected_status}, ${f.email_date}, ${f.email_date}, 'email') returning id`;
          await sql`insert into application_events (application_id, scan_run_id, event_type, new_status, gmail_message_id, email_subject, email_from, occurred_at)
            values (${a.id}, ${runId}, 'created', ${f.detected_status}, ${f.gmail_message_id}, ${f.email_subject}, ${f.email_from}, ${f.email_date})`;
          apps.push({ id: a.id, company_norm: action.company_norm, role_norm: action.role_norm, status: f.detected_status, manual_override: false });
        }
        created++;
      } else if (action.outcome === "updated") {
        if (!dry) {
          if (action.statusChanged)
            await sql`update applications set status = ${action.newStatus}, last_activity_at = ${f.email_date}, updated_at = now() where id = ${action.applicationId}`;
          else
            await sql`update applications set last_activity_at = ${f.email_date}, updated_at = now() where id = ${action.applicationId}`;
          await sql`insert into application_events (application_id, scan_run_id, event_type, old_status, new_status, gmail_message_id, email_subject, email_from, occurred_at)
            values (${action.applicationId}, ${runId}, ${action.statusChanged ? "status_change" : "email_detected"}, ${action.oldStatus}, ${action.statusChanged ? action.newStatus : null}, ${f.gmail_message_id}, ${f.email_subject}, ${f.email_from}, ${f.email_date})`;
          const a = apps.find((x) => x.id === action.applicationId);
          if (action.statusChanged) a.status = action.newStatus;
        }
        updated++;
      } else if (action.outcome === "skipped_override" && !dry) {
        await sql`insert into application_events (application_id, scan_run_id, event_type, gmail_message_id, email_subject, email_from, occurred_at)
          values (${action.applicationId}, ${runId}, 'email_detected', ${f.gmail_message_id}, ${f.email_subject}, ${f.email_from}, ${f.email_date})`;
      }
      known.add(f.gmail_message_id);
    } catch (e) {
      res.outcome = "error";
      res.error = String(e.message ?? e);
      await logErr(res.error, f.gmail_message_id);
    }
    results.push(res);
  }

  if (!dry) await sql`update scan_runs set apps_created = apps_created + ${created}, apps_updated = apps_updated + ${updated}, emails_found = coalesce(emails_found, 0) + ${valid.length + invalid.length} where id = ${runId}`;
  out({ dry_run: dry, created, updated, results });
}
