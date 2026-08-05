# job-tracker

A job application tracker that reads your own inbox and keeps itself up to date.

A [Claude Code routine](https://claude.com/claude-code) reads your Gmail once a day, decides which
messages are about *your* applications, and reports what it found. A small CLI validates that report
and writes it to Postgres. A static dashboard on GitHub Pages shows the pipeline and lets you edit it
by hand. Every row links back to the email that produced it.

```
Gmail ──▶ Claude routine ──▶ findings.json ──▶ tracker CLI ──▶ Postgres ──▶ dashboard
          (judgment)         (a plain file)    (validation,     (Neon)      (GitHub Pages)
                                                the only writer)
```

The design rule the whole thing hangs on: **the model never touches the database.** It fills in a JSON
file. A deterministic CLI decides what that file is allowed to do — schema-checked, forward-only status
transitions, idempotent on Gmail message ID. If the model hallucinates a company or invents a status,
validation drops it and logs the rejection instead of corrupting a row.

---

## What you'll need

| | |
|---|---|
| **Claude Code** | With a plan that includes cloud routines, and the Gmail connector |
| **Postgres over HTTPS** | [Neon](https://neon.tech) free tier. Must support SQL-over-HTTPS — the browser talks to it directly |
| **GitHub** | For Pages. A **private** repo needs GitHub Pro; a public repo works on Free |
| **Node 20+** | For the CLI and the build |

Budget about 30 minutes.

---

## Setup

### 1. Get the code

Click **Use this template** (or fork), then:

```bash
git clone https://github.com/YOU/job-tracker && cd job-tracker
npm install
cd dashboard && npm install && cd ..
```

### 2. Create the database

Make a Neon project, then apply the schema:

```bash
psql -X "postgresql://...your-neon-connection-string..." -f schema.sql
```

The `-X` matters — it skips `~/.psqlrc`. If yours happens to set `AUTOCOMMIT off`, the DDL silently
rolls back and you get an empty database with no error.

Three tables get created:

- **`applications`** — one row per application. Company, role, status, dates.
- **`application_events`** — every observation, with `gmail_message_id UNIQUE`. This is the idempotency
  key: rescanning the same email can never double-count.
- **`scan_runs`** — one row per scan, with an `errors` JSONB column. Failures land here, not in a log
  file you'll never read.

Optionally create the limited role at the bottom of `schema.sql`. It has table grants only, no DDL.
Use that connection string rather than the owner's — it's the one that ends up in your browser.

### 3. Encrypt your credentials

The dashboard is a static site with no backend, so the database URL has to reach the browser somehow.
It ships as an AES-GCM blob that only decrypts with your password.

```bash
cp secrets.example.json secrets.json
# edit secrets.json: put in your connection string
# leave routine_url out for now — you don't have one yet

TRACKER_PASSWORD='your-passphrase' node scripts/encrypt.mjs secrets.json dashboard/public/secrets.enc.json
```

> **Pick a real passphrase.** Four random words, not a word or a PIN. `secrets.enc.json` is served
> publicly by GitHub Pages *whether or not your repo is private* — Pages publishes what it builds, and
> access-controlled Pages requires GitHub Enterprise. So anyone with your site URL can download the
> blob and attack it offline, with no rate limit. The 600,000 PBKDF2 iterations make each guess
> expensive; they cannot save a four-digit keyspace. This is the one step where being lazy actually
> costs you something.

`secrets.json` is gitignored. `secrets.enc.json` is committed on purpose.

Also write a `.env` for local CLI use:

```bash
cp .env.example .env    # then paste the same connection string
```

### 4. Deploy the dashboard

Push, then in **Settings → Pages** set the source to **GitHub Actions**. The included workflow builds
`dashboard/` and deploys on every push to `main`.

Your site lands at `https://YOU.github.io/job-tracker/`. Open it, enter your passphrase, and you should
get an empty table.

### 5. Set up the routine

In Claude Code:

1. Run `/mcp` and authenticate the **Gmail** connector. Connecting it on claude.ai is *not* enough —
   routines only see connectors authenticated here.
2. Create a cloud environment for the routine with **custom network access**, allowing your database
   host (e.g. `api.REGION.aws.neon.tech`) plus the default package managers. The default "Trusted"
   policy blocks Neon and the routine will fail with a 403.
3. Create a routine that points at your repo, scheduled daily, with this prompt:

   > Follow the instructions in `runbook.md` exactly. Your database connection string is
   > `postgresql://...`

4. Restrict its tools to `Bash(node scripts/tracker.mjs *)`. This is what stops the routine from
   running arbitrary SQL — the CLI becomes the only door.

Then put the routine's URL into `secrets.json` as `routine_url`, re-run the encrypt command from step 3,
and push. A **Run a scan now** button appears on the dashboard.

---

## The tools the routine gets

`runbook.md` is the routine's contract. It can only call these:

| Command | Does |
|---|---|
| `scan-state` | When did the last successful scan finish? |
| `list-apps --active` | Open applications, minus ones silent past the ghost threshold |
| `find --company X [--role Y]` | Search everything, including closed and ghosted |
| `begin-run --trigger cron\|manual` | Open a scan run |
| `upsert --run ID --file findings.json` | Apply findings. Validates, dedupes, writes |
| `log-error --run ID --message ...` | Record a failure |
| `end-run --run ID` | Close the run, compute success/partial/error |

There is no delete and no direct status-set, by design. `upsert` is where every rule lives:

- Findings are parsed with a strict Zod schema. Unknown fields, bad enums, malformed dates → rejected
  and logged, never written.
- Status only moves forward. An "application received" email arriving after an interview invite cannot
  demote the row. `rejected`/`withdrawn` are reachable from anywhere and stick.
- Rows you edited by hand get `manual_override`, and the scanner stops changing their status. It still
  records that the email arrived.

## "Ghosted" is derived, not stored

An application with no word for 180 days shows as *gone quiet*. That is computed at read time from
`last_activity_at` — it is never written to the `status` column. Three reasons this is better:

- You keep the information that it died at **interview** rather than at **applied**.
- A reply un-ghosts it automatically. No cleanup job.
- Changing the threshold is a one-line edit, not a migration.

`GHOST_DAYS` lives in `scripts/lib/core.mjs` and is mirrored in `dashboard/src/apps-view.ts`.

## Local development

```bash
npm test                          # tests over the pure logic in scripts/lib/core.mjs
cd dashboard && npm run dev

node scripts/tracker.mjs list-apps --active
node scripts/tracker.mjs upsert --run <id> --file findings.json --dry-run
```

`--dry-run` prints what `upsert` would do and writes nothing. Use it when changing matching logic.

`scripts/migrate.mjs --file data.json` bulk-imports applications if you're coming from another tracker.

## Customizing

| Want to | Edit |
|---|---|
| Change the ghost threshold | `GHOST_DAYS` in `scripts/lib/core.mjs` **and** `dashboard/src/apps-view.ts` |
| Add a pipeline stage | The `job_status` enum in `schema.sql`, `STATUSES` + `RANK` in `core.mjs`, `STATUSES` + `--s-*` colors in the dashboard |
| Use a non-default Gmail account | `GMAIL_ACCOUNT` in `dashboard/src/apps-view.ts` — it's the `u/N` index of the signed-in account |
| Change what counts as a job email | The search queries in `runbook.md` |

## Security model, stated plainly

- The dashboard is static. Your browser talks straight to Postgres over HTTPS.
- Your connection string is therefore *in the browser*, decrypted from the blob with your passphrase,
  held in memory and `sessionStorage`. Anyone who learns the passphrase has your database.
- Use the limited role from `schema.sql`, not the owner role.
- **The password is the whole security boundary.** Repo visibility is not — see the warning in step 3.
- This suits a personal tracker. It is not a multi-user app and shouldn't be turned into one without a
  real backend.

## License

MIT
