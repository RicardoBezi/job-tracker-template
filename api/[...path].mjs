import { z } from "zod";
import { db } from "./_lib/db.mjs";
import {
  clearSessionCookie,
  checkLoginRate,
  clearLoginFailures,
  createSessionCookie,
  hasValidScannerToken,
  hasValidSession,
  isSameOrigin,
  recordLoginFailure,
  verifyPassword,
} from "./_lib/auth.mjs";
import {
  GHOST_DAYS,
  STATUSES,
  computeVerdict,
  daysSinceActivity,
  isGhosted,
  normalize,
  planAction,
  validateFindings,
} from "../scripts/lib/core.mjs";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const applicationInput = z.object({
  company: z.string().trim().min(1).max(200),
  role: z.string().trim().max(300).nullable().optional(),
  status: z.enum(STATUSES).default("applied"),
  applied_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
}).strict();

const applicationPatch = applicationInput.partial().extend({
  manual_override: z.boolean().optional(),
}).strict();

function send(res, status, body, extraHeaders = {}) {
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.status(status).json(body);
}

function pathParts(req) {
  return new URL(req.url, "http://gcn.local").pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
}

async function body(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      try { return JSON.parse(req.body); } catch { throw new HttpError(400, "Invalid JSON body"); }
    }
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "Invalid JSON body"); }
}

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
    throw new HttpError(400, message);
  }
  return result.data;
}

function requireMethod(req, methods) {
  if (!methods.includes(req.method)) throw new HttpError(405, "Method not allowed");
}

function requireSession(req) {
  if (!hasValidSession(req)) throw new HttpError(401, "Authentication required");
  if (!["GET", "HEAD"].includes(req.method) && !isSameOrigin(req)) throw new HttpError(403, "Origin rejected");
}

function requireScanner(req) {
  if (!hasValidScannerToken(req)) throw new HttpError(401, "Scanner authentication required");
}

function appView(row) {
  const now = Date.now();
  return { ...row, ghosted: isGhosted(row, now), days_quiet: daysSinceActivity(row, now) };
}

async function health(req, res) {
  requireMethod(req, ["GET"]);
  await db()`select 1`;
  send(res, 200, { ok: true });
}

async function auth(req, res, action) {
  if (action === "login") {
    requireMethod(req, ["POST"]);
    if (!isSameOrigin(req)) throw new HttpError(403, "Origin rejected");
    const rate = checkLoginRate(req);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfter));
      throw new HttpError(429, "Too many attempts. Try again later.");
    }
    const input = parse(z.object({ password: z.string().min(1).max(1024) }).strict(), await body(req));
    if (!verifyPassword(input.password)) {
      recordLoginFailure(rate.key);
      throw new HttpError(401, "Password not recognized");
    }
    clearLoginFailures(rate.key);
    send(res, 200, { authenticated: true }, { "Set-Cookie": createSessionCookie(), "Cache-Control": "no-store" });
    return;
  }
  if (action === "logout") {
    requireMethod(req, ["POST"]);
    if (!isSameOrigin(req)) throw new HttpError(403, "Origin rejected");
    send(res, 200, { authenticated: false }, { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" });
    return;
  }
  if (action === "session") {
    requireMethod(req, ["GET"]);
    send(res, 200, { authenticated: hasValidSession(req) }, { "Cache-Control": "no-store" });
    return;
  }
  throw new HttpError(404, "Not found");
}

async function applications(req, res, id, child) {
  requireSession(req);
  const sql = db();

  if (!id && req.method === "GET") {
    const rows = await sql`
      select a.id, a.company, a.role, a.status, a.applied_at, a.last_activity_at,
             a.notes, a.manual_override, a.source, e.gmail_message_id as last_email_id
      from applications a
      left join lateral (
        select gmail_message_id from application_events
        where application_id = a.id and gmail_message_id is not null
        order by occurred_at desc limit 1
      ) e on true
      order by a.last_activity_at desc nulls last, a.created_at desc`;
    send(res, 200, { applications: rows.map(appView), ghost_days: GHOST_DAYS });
    return;
  }

  if (!id && req.method === "POST") {
    const input = parse(applicationInput, await body(req));
    const role = input.role || null;
    const appliedAt = input.applied_at ?? new Date().toISOString().slice(0, 10);
    const [created] = await sql`
      with created as (
        insert into applications (company, company_norm, role, role_norm, status, applied_at, last_activity_at, source, notes, manual_override)
        values (${input.company}, ${normalize(input.company)}, ${role}, ${role ? normalize(role) : null}, ${input.status}, ${appliedAt}, ${appliedAt}, 'manual', ${input.notes ?? null}, true)
        returning *
      ), recorded as (
        insert into application_events (application_id, event_type, new_status, occurred_at)
        select id, 'manual_edit', status, now() from created returning id
      )
      select created.* from created, recorded`;
    send(res, 201, { application: appView(created) });
    return;
  }

  if (!id) throw new HttpError(405, "Method not allowed");
  const [existing] = await sql`select * from applications where id = ${id}`;
  if (!existing) throw new HttpError(404, "Application not found");

  if (child === "events") {
    requireMethod(req, ["GET"]);
    const events = await sql`
      select id, event_type, old_status, new_status, email_subject, email_from, occurred_at, gmail_message_id
      from application_events where application_id = ${id} order by occurred_at desc`;
    send(res, 200, { events });
    return;
  }

  if (req.method === "PATCH") {
    const input = parse(applicationPatch, await body(req));
    if (!Object.keys(input).length) throw new HttpError(400, "No changes supplied");
    const company = input.company ?? existing.company;
    const role = Object.hasOwn(input, "role") ? (input.role || null) : existing.role;
    const status = input.status ?? existing.status;
    const statusChanged = status !== existing.status;
    const manualOverride = statusChanged ? true : (input.manual_override ?? existing.manual_override);
    const [updated] = await sql`
      with updated as (
        update applications set
          company = ${company}, company_norm = ${normalize(company)},
          role = ${role}, role_norm = ${role ? normalize(role) : null},
          status = ${status}, applied_at = ${Object.hasOwn(input, "applied_at") ? input.applied_at : existing.applied_at},
          notes = ${Object.hasOwn(input, "notes") ? input.notes : existing.notes},
          manual_override = ${manualOverride},
          last_activity_at = ${statusChanged ? new Date().toISOString() : existing.last_activity_at}, updated_at = now()
        where id = ${id} returning *
      ), recorded as (
        insert into application_events (application_id, event_type, old_status, new_status, occurred_at)
        select id, 'manual_edit', ${statusChanged ? existing.status : null}, ${statusChanged ? status : null}, now() from updated returning id
      )
      select updated.* from updated, recorded`;
    send(res, 200, { application: appView(updated) });
    return;
  }

  if (req.method === "DELETE") {
    await sql`delete from applications where id = ${id}`;
    send(res, 200, { deleted: true });
    return;
  }

  throw new HttpError(405, "Method not allowed");
}

async function scanRuns(req, res) {
  requireSession(req);
  requireMethod(req, ["GET"]);
  const runs = await db()`
    select id, started_at, finished_at, trigger, status, emails_found, apps_created, apps_updated, errors, summary
    from scan_runs order by started_at desc limit 50`;
  send(res, 200, { runs, routine_url: process.env.ROUTINE_URL || null });
}

async function scanner(req, res, parts, url) {
  requireScanner(req);
  const sql = db();
  const [resource, id, action] = parts;

  if (resource === "state") {
    requireMethod(req, ["GET"]);
    const [last] = await sql`select finished_at from scan_runs where status in ('success','partial') order by finished_at desc nulls last limit 1`;
    const stale = await sql`select id, started_at from scan_runs where status = 'running' and started_at < now() - interval '30 minutes'`;
    send(res, 200, { last_successful_scan: last?.finished_at ?? null, stale_running_runs: stale });
    return;
  }

  if (resource === "applications" && !id) {
    requireMethod(req, ["GET"]);
    const active = url.searchParams.get("active") === "true";
    const includeGhosted = url.searchParams.get("include_ghosted") === "true";
    const rows = active
      ? await sql`select id, company, role, status, applied_at, last_activity_at from applications where status not in ('rejected','withdrawn') order by last_activity_at desc nulls last`
      : await sql`select id, company, role, status, applied_at, last_activity_at from applications order by last_activity_at desc nulls last`;
    const tagged = rows.map(appView);
    send(res, 200, { applications: active && !includeGhosted ? tagged.filter((row) => !row.ghosted) : tagged });
    return;
  }

  if (resource === "find") {
    requireMethod(req, ["GET"]);
    const company = url.searchParams.get("company");
    const role = url.searchParams.get("role");
    if (!company) throw new HttpError(400, "company is required");
    const companyLike = `%${normalize(company)}%`;
    const rows = role
      ? await sql`select id, company, role, status, applied_at, last_activity_at, manual_override from applications where company_norm like ${companyLike} and role_norm like ${`%${normalize(role)}%`}`
      : await sql`select id, company, role, status, applied_at, last_activity_at, manual_override from applications where company_norm like ${companyLike}`;
    send(res, 200, { applications: rows.map(appView) });
    return;
  }

  if (resource === "runs" && !id) {
    requireMethod(req, ["POST"]);
    const input = parse(z.object({ trigger: z.enum(["cron", "manual"]) }).strict(), await body(req));
    const [run] = await sql`insert into scan_runs (trigger) values (${input.trigger}) returning id, started_at`;
    send(res, 201, { run });
    return;
  }

  if (resource === "runs" && id && action === "findings") {
    requireMethod(req, ["POST"]);
    const [openRun] = await sql`select id, status from scan_runs where id = ${id}`;
    if (!openRun) throw new HttpError(404, "Run not found");
    if (openRun.status !== "running") throw new HttpError(409, "Run is already finished");
    const raw = await body(req);
    const findings = Array.isArray(raw) ? raw : raw.findings;
    const { valid, invalid } = validateFindings(findings);
    const apps = await sql`select id, company_norm, role_norm, status, manual_override from applications`;
    const ids = valid.map((finding) => finding.gmail_message_id);
    const knownRows = ids.length ? await sql`select gmail_message_id from application_events where gmail_message_id = any(${ids})` : [];
    const known = new Set(knownRows.map((row) => row.gmail_message_id));
    const results = [];
    let created = 0, updated = 0;

    const logError = async (message, context) => {
      const entry = [{ at: new Date().toISOString(), message, context }];
      await sql`update scan_runs set errors = errors || ${JSON.stringify(entry)}::jsonb where id = ${id}`;
    };

    for (const invalidFinding of invalid) {
      results.push({ outcome: "rejected_invalid", error: invalidFinding.error });
      await logError(`invalid finding: ${invalidFinding.error}`, JSON.stringify(invalidFinding.finding).slice(0, 500));
    }

    for (const finding of valid) {
      const planned = planAction(finding, apps, known);
      const result = { gmail_message_id: finding.gmail_message_id, company: finding.company, outcome: planned.outcome };
      try {
        if (planned.outcome === "created") {
          const [createdApp] = await sql`
            with created as (
              insert into applications (company, company_norm, role, role_norm, status, applied_at, last_activity_at, source)
              values (${finding.company}, ${planned.company_norm}, ${finding.role}, ${planned.role_norm}, ${finding.detected_status}, ${finding.email_date}, ${finding.email_date}, 'email') returning id
            ), recorded as (
              insert into application_events (application_id, scan_run_id, event_type, new_status, gmail_message_id, email_subject, email_from, occurred_at)
              select id, ${id}, 'created', ${finding.detected_status}, ${finding.gmail_message_id}, ${finding.email_subject}, ${finding.email_from}, ${finding.email_date} from created returning application_id
            )
            select id from created`;
          apps.push({ id: createdApp.id, company_norm: planned.company_norm, role_norm: planned.role_norm, status: finding.detected_status, manual_override: false });
          created++;
        } else if (planned.outcome === "updated") {
          await sql`
            with updated as (
              update applications set status = ${planned.newStatus}, last_activity_at = ${finding.email_date}, updated_at = now()
              where id = ${planned.applicationId} returning id
            )
            insert into application_events (application_id, scan_run_id, event_type, old_status, new_status, gmail_message_id, email_subject, email_from, occurred_at)
            select id, ${id}, ${planned.statusChanged ? "status_change" : "email_detected"}, ${planned.oldStatus}, ${planned.statusChanged ? planned.newStatus : null}, ${finding.gmail_message_id}, ${finding.email_subject}, ${finding.email_from}, ${finding.email_date} from updated`;
          const matched = apps.find((app) => app.id === planned.applicationId);
          if (planned.statusChanged && matched) matched.status = planned.newStatus;
          updated++;
        } else if (planned.outcome === "skipped_override") {
          await sql`
            insert into application_events (application_id, scan_run_id, event_type, gmail_message_id, email_subject, email_from, occurred_at)
            values (${planned.applicationId}, ${id}, 'email_detected', ${finding.gmail_message_id}, ${finding.email_subject}, ${finding.email_from}, ${finding.email_date})`;
        }
        known.add(finding.gmail_message_id);
      } catch (error) {
        result.outcome = "error";
        result.error = String(error?.message ?? error);
        await logError(result.error, finding.gmail_message_id);
      }
      results.push(result);
    }
    await sql`
      update scan_runs set apps_created = apps_created + ${created}, apps_updated = apps_updated + ${updated},
      emails_found = coalesce(emails_found, 0) + ${valid.length + invalid.length} where id = ${id}`;
    send(res, 200, { created, updated, results });
    return;
  }

  if (resource === "runs" && id && action === "errors") {
    requireMethod(req, ["POST"]);
    const input = parse(z.object({ message: z.string().min(1).max(2000), context: z.string().max(5000).nullable().optional() }).strict(), await body(req));
    const entry = [{ at: new Date().toISOString(), message: input.message, context: input.context ?? null }];
    const rows = await sql`update scan_runs set errors = errors || ${JSON.stringify(entry)}::jsonb where id = ${id} and status = 'running' returning id`;
    if (!rows.length) throw new HttpError(404, "Open run not found");
    send(res, 200, { logged: true });
    return;
  }

  if (resource === "runs" && id && action === "finish") {
    requireMethod(req, ["POST"]);
    const [run] = await sql`select apps_created, apps_updated, errors from scan_runs where id = ${id}`;
    if (!run) throw new HttpError(404, "Run not found");
    const verdict = computeVerdict({ errorCount: run.errors.length, appliedCount: run.apps_created + run.apps_updated });
    const summary = `${run.apps_created} created, ${run.apps_updated} updated, ${run.errors.length} errors`;
    await sql`update scan_runs set finished_at = now(), status = ${verdict}, summary = ${summary} where id = ${id}`;
    send(res, 200, { run_id: id, status: verdict, summary });
    return;
  }

  throw new HttpError(404, "Not found");
}

async function route(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  try {
    const url = new URL(req.url, "http://gcn.local");
    const parts = pathParts(req);
    if (parts[0] === "health") return await health(req, res);
    if (parts[0] === "auth") return await auth(req, res, parts[1]);
    if (parts[0] === "applications") return await applications(req, res, parts[1], parts[2]);
    if (parts[0] === "scan-runs") return await scanRuns(req, res);
    if (parts[0] === "scanner") return await scanner(req, res, parts.slice(1), url);
    throw new HttpError(404, "Not found");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error("API error", error);
    send(res, status, { error: status === 500 ? "Internal server error" : error.message });
  }
}

// Vercel's current Node runtime uses the web-standard fetch handler. Keeping the
// small response adapter here lets the router remain easy to exercise without a
// framework while exposing the supported deployment interface.
export default {
  async fetch(request) {
    const headers = Object.fromEntries(request.headers.entries());
    const requestUrl = new URL(request.url);
    headers.host ??= requestUrl.host;
    headers["x-forwarded-proto"] ??= requestUrl.protocol.slice(0, -1);
    const rawBody = ["GET", "HEAD"].includes(request.method) ? undefined : await request.text();
    const req = { method: request.method, url: request.url, headers, body: rawBody, socket: {} };
    let status = 200;
    let payload;
    const responseHeaders = new Headers();
    const res = {
      setHeader(name, value) { responseHeaders.set(name, String(value)); },
      status(value) { status = value; return this; },
      json(value) { payload = value; },
    };
    await route(req, res);
    return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
  },
};
