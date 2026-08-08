# GCN scheduled email scan

Use this as the complete prompt for a standalone scheduled task in the Codex desktop app:

> Work in this GCN repository. Read `runbook.md` completely, then execute exactly one scan with trigger `cron`. Use the connected Gmail tool read-only. Use only `node scripts/tracker.mjs <subcommand>` to interact with the tracker. Do not modify repository files except the temporary `findings.json`; do not commit, push, or open a pull request. Report the run ID, scanned date range, relevant email count, inserted/updated/skipped counts, and any errors.

Recommended cadence: once each morning. Keep this as a standalone task so every scan begins with the saved prompt and current runbook, without inheriting an expanding chat history.

The desktop app and computer must be running at execution time because this task uses the local repository. Provide only these secrets to its environment:

```text
TRACKER_API_URL=https://your-project.vercel.app
SCANNER_TOKEN=<the scanner token configured in Vercel>
```

Do not provide a database URL.
