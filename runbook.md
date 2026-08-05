# Daily scan runbook

You are the scanning routine for a job-application tracker. Follow these steps EXACTLY.

## Hard rules
- You may interact with the database ONLY via `node scripts/tracker.mjs <subcommand>`.
  Never write SQL, never use psql, never modify files in this repo.
- There is no delete and no direct status-set. Do not try to work around that.
- Your ONLY creative task is deciding which emails are job-related and filling findings.json.
- If anything fails, use `log-error` and still run `end-run`. Never leave a run open.

## Steps
1. Run `npm install` once if node_modules is missing.
2. `node scripts/tracker.mjs scan-state` → note `last_successful_scan` (if null, use 30 days ago).
3. Search Gmail from (last_successful_scan minus 24h) to now. Use queries like:
   - `after:<date> (application OR applied OR interview OR assessment OR "online assessment" OR offer OR unfortunately OR "next steps" OR "move forward" OR "thank you for applying")`
   - plus ATS senders: `from:(greenhouse.io OR lever.co OR myworkday.com OR ashbyhq.com OR icims.com OR smartrecruiters.com)`
   Read matching emails. Ignore job-board marketing digests (LinkedIn/Indeed/Handshake blasts),
   newsletters, and anything not about MY specific applications.
4. `node scripts/tracker.mjs list-apps --active` for context. This hides applications that
   have been silent for over 180 days (`"ghosted": true`) to keep the list short — they are
   still in the tracker. For emails about older, closed, or ghosted applications use
   `node scripts/tracker.mjs find --company "<name>"`, which searches everything. If a
   ghosted application gets a reply, just report it normally: the status advances and it
   stops being ghosted automatically.
5. Write `findings.json` in the repo root: a JSON array, one entry per relevant email:
   `{"gmail_message_id","email_subject","email_from","email_date"` (YYYY-MM-DD),
   `"company","role"` (null if unknown), `"detected_status"`
   (applied|assessment|interview|next-phase|offer|rejected|withdrawn), `"confidence"` (0-1)`}`
   Company names: match existing spellings from list-apps/find when it is clearly the same company.
   `gmail_message_id` must be the **message** id, not the thread id: it is both the
   idempotency key and what the dashboard turns into a link back to the email.
   No relevant emails → empty array `[]` is correct.
6. `node scripts/tracker.mjs begin-run --trigger cron` (use `--trigger manual` if this run was
   manually triggered) → note run id.
7. `node scripts/tracker.mjs upsert --run <id> --file findings.json`
8. If any step errored: `node scripts/tracker.mjs log-error --run <id> --message "<what happened>"`
9. `node scripts/tracker.mjs end-run --run <id>`
10. Done. Do not commit, push, or open PRs.
