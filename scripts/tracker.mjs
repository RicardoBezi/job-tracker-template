#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateFindings } from "./lib/core.mjs";

function fail(message) { console.error(JSON.stringify({ error: message })); process.exit(1); }
function out(value) { console.log(JSON.stringify(value, null, 2)); }
function arg(name) { const index = process.argv.indexOf(`--${name}`); return index > -1 ? process.argv[index + 1] : undefined; }
function hasFlag(name) { return process.argv.includes(`--${name}`); }

function loadEnv() {
  for (const file of ["../.env.local", "../.env"]) {
    try {
      for (const line of readFileSync(new URL(file, import.meta.url), "utf8").split(/\r?\n/)) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && !process.env[match[1]]) {
          const raw = match[2].trim();
          process.env[match[1]] = raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
            ? raw.slice(1, -1)
            : raw;
        }
      }
    } catch {}
  }
}

loadEnv();
const baseUrl = process.env.TRACKER_API_URL?.replace(/\/$/, "");
const token = process.env.SCANNER_TOKEN;

async function request(path, options = {}) {
  if (!baseUrl) fail("TRACKER_API_URL not set (env var or .env)");
  if (!token) fail("SCANNER_TOKEN not set (env var or .env)");
  let response;
  try {
    response = await fetch(`${baseUrl}/api/scanner${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (error) {
    fail(`cannot reach tracker API: ${error.message}`);
  }
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) fail(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

const command = process.argv[2];
const commands = {
  "scan-state": scanState,
  "list-apps": listApps,
  find,
  "begin-run": beginRun,
  upsert,
  "log-error": logError,
  "end-run": endRun,
};
if (!commands[command]) fail(`unknown command: ${String(command)}. valid: ${Object.keys(commands).join(", ")}`);
await commands[command]();

async function scanState() {
  out(await request("/state"));
}

async function listApps() {
  const params = new URLSearchParams();
  if (hasFlag("active")) params.set("active", "true");
  if (hasFlag("include-ghosted")) params.set("include_ghosted", "true");
  const result = await request(`/applications?${params}`);
  out(result.applications);
}

async function find() {
  const company = arg("company") ?? fail("--company required");
  const params = new URLSearchParams({ company });
  if (arg("role")) params.set("role", arg("role"));
  const result = await request(`/find?${params}`);
  out(result.applications);
}

async function beginRun() {
  const trigger = arg("trigger") ?? fail("--trigger cron|manual required");
  const result = await request("/runs", { method: "POST", body: JSON.stringify({ trigger }) });
  out(result.run);
}

async function upsert() {
  const runId = arg("run") ?? fail("--run required");
  const file = arg("file") ?? fail("--file required");
  let findings;
  try { findings = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { fail(`cannot read/parse ${file}: ${error.message}`); }

  if (hasFlag("dry-run")) {
    const { valid, invalid } = validateFindings(findings);
    out({ dry_run: true, valid: valid.length, invalid });
    return;
  }
  out(await request(`/runs/${encodeURIComponent(runId)}/findings`, { method: "POST", body: JSON.stringify({ findings }) }));
}

async function logError() {
  const runId = arg("run") ?? fail("--run required");
  const message = arg("message") ?? fail("--message required");
  out(await request(`/runs/${encodeURIComponent(runId)}/errors`, {
    method: "POST",
    body: JSON.stringify({ message, context: arg("context") ?? null }),
  }));
}

async function endRun() {
  const runId = arg("run") ?? fail("--run required");
  out(await request(`/runs/${encodeURIComponent(runId)}/finish`, { method: "POST", body: "{}" }));
}
