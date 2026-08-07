# GCN — 「ゴールデン・ロード」は続く。

A private, cloud-hosted job application tracker with a Japanese editorial interface.

GCN reads findings prepared by a Claude Code Gmail routine, validates them in deterministic application code, and stores the accepted changes in Neon Postgres. The browser talks only to a same-origin API; database credentials never reach the frontend.

GCN covers **The Golden Road**. The acronym is intentionally left unexpanded in public-facing copy.

```text
Gmail → Claude cloud routine → tracker CLI → hosted API → Neon Postgres
                                              ↑
                                  authenticated GCN dashboard
```

## Design rules

- The model never writes to the database.
- Every finding is checked with a strict Zod schema.
- Gmail message IDs make ingestion idempotent.
- Pipeline statuses move forward and terminal outcomes remain terminal.
- Manual status changes stop automatic status changes until re-enabled.
- “Gone quiet” is derived after 180 silent days and is never stored as a status.
- Browser sessions and scanner access use separate credentials.

## Stack

- Vite and TypeScript frontend
- Vercel Functions API
- Neon serverless Postgres driver
- Signed, secure, HTTP-only owner session
- Bearer-token authentication for the scanner
- Vitest for rule and security tests

## First deployment

### 1. Install and test

Node 22 is recommended.

```bash
npm ci
npm --prefix dashboard ci
npm test
npm run build
```

### 2. Create the database

Create a Neon project and apply the schema as the owner:

```bash
psql -X "postgresql://OWNER_CONNECTION" -f schema.sql
```

Create the limited application role shown at the bottom of `schema.sql`, then use that role's connection string for `DATABASE_URL`. Do not use the Neon owner role in the application.

For an existing installation, apply:

```bash
psql -X "postgresql://OWNER_CONNECTION" -f migrations/002_hosted_api.sql
```

### 3. Generate secrets

Generate the login password hash:

```bash
npm run password -- "a-long-owner-password"
```

Generate independent random values for the session and scanner:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Run that command twice. Never reuse the owner password, session secret, or scanner token.

### 4. Deploy to Vercel

Import the repository as a Vercel project and keep the repository root as the project root. `vercel.json` builds `dashboard/` and deploys `api/` as same-origin functions.

Configure these production environment variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection supplied by the integration; server-side only |
| `GCN_DATABASE_URL` | Preferred restricted application-role URL used at runtime |
| `AUTH_PASSWORD_HASH` | Output from `npm run password` |
| `SESSION_SECRET` | Random session-signing secret |
| `SCANNER_TOKEN` | Independent random scanner credential |
| `ROUTINE_URL` | Optional link displayed in scan history |

Pushes to the connected production branch deploy automatically. Pull requests run tests and a dashboard build through `.github/workflows/ci.yml`.

### 5. Configure the Claude routine

Give the cloud environment only:

```text
TRACKER_API_URL=https://your-project.vercel.app
SCANNER_TOKEN=<the scanner token configured in Vercel>
```

Connect Gmail, point the routine at this repository, restrict it to `Bash(node scripts/tracker.mjs *)`, and instruct it to follow `runbook.md` exactly. The routine does not need a database connection string.

### 6. Retire an older browser-direct deployment

If this repository previously served `secrets.enc.json`, complete all of these steps after the hosted API works:

1. Rotate the old Neon role password.
2. Confirm the replacement URL exists only in Vercel environment variables.
3. Disable the previous GitHub Pages deployment.
4. Revoke the old role if it is no longer needed.
5. Redeploy and confirm no encrypted-secret asset is present.

Deleting the old file alone is insufficient because deployed artifacts and Git history may retain it.

## Local development

Copy `.env.example` to `.env.local`, fill in test credentials, and use a non-production Neon branch.

```bash
npm run dev
```

This invokes the Vercel development server so the Vite frontend and `/api` functions share an origin. A globally installed Vercel CLI avoids `npx` downloading it on first use.

Useful checks:

```bash
npm test
npm run build
node scripts/tracker.mjs upsert --run <id> --file findings.json --dry-run
```

The dry run performs local schema validation only. It does not query the hosted database or test duplicate detection.

## API boundaries

Owner-session routes:

```text
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/session
GET    /api/applications
POST   /api/applications
PATCH  /api/applications/:id
DELETE /api/applications/:id
GET    /api/applications/:id/events
GET    /api/scan-runs
```

Scanner-token routes live under `/api/scanner/` and correspond one-to-one with the commands documented in `runbook.md`.

## Security notes

- `DATABASE_URL`, `GCN_DATABASE_URL`, `SESSION_SECRET`, and `SCANNER_TOKEN` are server-only values.
- Login sessions expire after 12 hours and use `Secure`, `HttpOnly`, and `SameSite=Lax` cookies.
- State-changing browser requests are checked for same-origin access.
- Login attempts receive a short in-process rate limit; production deployments should also enable platform-level rate limiting or firewall rules.
- Security headers, including a restrictive Content Security Policy, are set in `vercel.json`.
- This remains a personal single-owner tracker. Add a real identity provider and row-level authorization before supporting multiple users.

## License

MIT
