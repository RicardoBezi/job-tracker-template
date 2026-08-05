#!/usr/bin/env node
// One-time migration of CareerSync (old Supabase) applications into Neon.
// The old rows are exported to JSON first (they were pulled via the Supabase MCP,
// since direct Postgres auth to that project was unavailable), then fed in here:
//   node scripts/migrate.mjs --file old-apps.json [--dry-run]
//
// Old shape: { company, role, status, source_email, gmail_message_ids[], last_email_date, manual_override }
// Notes on mapping:
//   - role "Unknown" -> null (junk value that would pollute matching)
//   - applied_at stays null: the old `first_seen` is when the old scanner ran, not when
//     you applied, and `last_email_date` is the latest email (often the rejection).
//     Inventing an applied date would be worse than leaving it blank.
//   - each gmail_message_id becomes a `migrated` event, which is what stops a later
//     historical backfill from re-creating these same applications as duplicates.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { normalize, STATUSES } from "./lib/core.mjs";

const dry = process.argv.includes("--dry-run");
const fileIdx = process.argv.indexOf("--file");
const file = fileIdx > -1 ? process.argv[fileIdx + 1] : undefined;
if (!file) { console.error("usage: node scripts/migrate.mjs --file <old-apps.json> [--dry-run]"); process.exit(1); }

let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  try {
    const line = readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
    if (line) DATABASE_URL = line.slice("DATABASE_URL=".length).trim();
  } catch {}
}
if (!DATABASE_URL && !dry) { console.error("DATABASE_URL not set (env var or .env)"); process.exit(1); }

const oldRows = JSON.parse(readFileSync(file, "utf8"));
console.log(`loaded ${oldRows.length} old rows from ${file}`);

const mapped = oldRows.map((r) => {
  const status = STATUSES.includes(r.status) ? r.status : "applied";
  if (status !== r.status) console.warn(`  ! unmapped status "${r.status}" -> applied (${r.company})`);
  const role = r.role && r.role.toLowerCase() !== "unknown" ? r.role : null;
  return {
    company: r.company,
    company_norm: normalize(r.company),
    role,
    role_norm: role ? normalize(role) : null,
    status,
    last_activity_at: r.last_email_date ?? null,
    manual_override: !!r.manual_override,
    notes: `migrated from CareerSync${r.source_email ? ` (source: ${r.source_email})` : ""}`,
    message_ids: Array.isArray(r.gmail_message_ids) ? r.gmail_message_ids.filter(Boolean) : [],
  };
});

if (dry) {
  console.log("\n--- dry run: would insert ---");
  for (const m of mapped) console.log(`  ${m.status.padEnd(11)} ${m.company} / ${m.role ?? "(no role)"}  [${m.message_ids.length} msg id(s)]`);
  const seen = new Set(), dupes = [];
  for (const m of mapped) for (const id of m.message_ids) { if (seen.has(id)) dupes.push({ id, company: m.company, role: m.role }); else seen.add(id); }
  if (dupes.length) {
    console.log("\n! shared gmail_message_id across rows (old-data duplicates; app still created, extra event skipped):");
    for (const d of dupes) console.log(`  ${d.id} -> ${d.company} / ${d.role ?? "(no role)"}`);
  }
  console.log(`\ntotal: ${mapped.length} applications, ${seen.size} unique message ids`);
  process.exit(0);
}

const sql = neon(DATABASE_URL);
const existingRows = await sql`select gmail_message_id from application_events where gmail_message_id is not null`;
const usedIds = new Set(existingRows.map((r) => r.gmail_message_id));
let inserted = 0, skipped = 0, events = 0, skippedEvents = 0;

for (const m of mapped) {
  const dupe = await sql`select id from applications
    where company_norm = ${m.company_norm} and role_norm is not distinct from ${m.role_norm} and source = 'migrated'`;
  if (dupe.length) { skipped++; continue; }

  const [a] = await sql`insert into applications (company, company_norm, role, role_norm, status, applied_at, last_activity_at, source, notes, manual_override)
    values (${m.company}, ${m.company_norm}, ${m.role}, ${m.role_norm}, ${m.status}, null, ${m.last_activity_at}, 'migrated', ${m.notes}, ${m.manual_override})
    returning id`;
  inserted++;

  const occurred = m.last_activity_at ?? new Date().toISOString();
  let wroteEvent = false;
  for (const id of m.message_ids) {
    if (usedIds.has(id)) { skippedEvents++; continue; }
    usedIds.add(id);
    await sql`insert into application_events (application_id, event_type, new_status, gmail_message_id, email_from, occurred_at)
      values (${a.id}, 'migrated', ${m.status}, ${id}, ${m.notes}, ${occurred})`;
    events++; wroteEvent = true;
  }
  if (!wroteEvent) {
    await sql`insert into application_events (application_id, event_type, new_status, occurred_at)
      values (${a.id}, 'migrated', ${m.status}, ${occurred})`;
    events++;
  }
}

console.log(`done: ${inserted} applications inserted, ${skipped} skipped (already migrated), ${events} events written, ${skippedEvents} duplicate message ids skipped`);
