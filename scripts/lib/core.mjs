import { z } from "zod";

export const STATUSES = ["applied", "assessment", "interview", "next-phase", "offer", "rejected", "withdrawn"];
export const TERMINAL = ["rejected", "withdrawn"];

// "Ghosted" is derived, never stored: it is an observation about silence, not a
// pipeline stage. Keeping it out of `status` preserves how far an application got
// before it went quiet, un-ghosts itself the moment a reply lands, and lets the
// threshold change without rewriting any rows.
export const GHOST_DAYS = 180;
export const GHOSTABLE = ["applied", "assessment", "interview", "next-phase"];

export function daysSinceActivity(app, now = Date.now()) {
  const last = app.last_activity_at ?? app.applied_at;
  if (!last) return null;
  return Math.floor((now - new Date(last).getTime()) / 86400e3);
}

export function isGhosted(app, now = Date.now()) {
  if (!GHOSTABLE.includes(app.status)) return false;
  const days = daysSinceActivity(app, now);
  return days !== null && days > GHOST_DAYS;
}

const RANK = { applied: 0, assessment: 1, interview: 2, "next-phase": 3, offer: 4 };

export const findingSchema = z.object({
  gmail_message_id: z.string().min(1),
  email_subject: z.string().default(""),
  email_from: z.string().default(""),
  email_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  company: z.string().min(1),
  role: z.string().nullable(),
  detected_status: z.enum(STATUSES),
  confidence: z.number().min(0).max(1),
}).strict();

export function normalize(s) {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export function validateFindings(raw) {
  const valid = [], invalid = [];
  if (!Array.isArray(raw)) return { valid, invalid: [{ finding: raw, error: "findings.json must be a JSON array" }] };
  for (const f of raw) {
    const r = findingSchema.safeParse(f);
    if (r.success) valid.push(r.data);
    else invalid.push({ finding: f, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  return { valid, invalid };
}

export function advanceStatus(current, detected) {
  if (TERMINAL.includes(current)) return current;
  if (TERMINAL.includes(detected)) return detected;
  return RANK[detected] > RANK[current] ? detected : current;
}

export function statusForFinding(current, detected, lastActivityAt, emailDate) {
  const currentTime = lastActivityAt ? new Date(lastActivityAt).getTime() : null;
  const findingTime = new Date(`${emailDate}T00:00:00Z`).getTime();

  // Historical mail can still be recorded in the timeline, but it must not
  // rewrite the state established by a newer message.
  if (currentTime !== null && findingTime < currentTime) return current;

  // A clear later response can revive a closed application (for example, a
  // requisition-error rejection followed by a reactivation). With date-only
  // findings, require a strictly later day to avoid guessing within one day.
  if (TERMINAL.includes(current) && !TERMINAL.includes(detected)) {
    return currentTime === null || findingTime > currentTime ? detected : current;
  }

  return advanceStatus(current, detected);
}

export function planAction(finding, apps, knownMessageIds) {
  if (knownMessageIds.has(finding.gmail_message_id)) return { outcome: "skipped_duplicate" };
  const company_norm = normalize(finding.company);
  const role_norm = finding.role ? normalize(finding.role) : null;
  let match = role_norm
    ? apps.find((a) => a.company_norm === company_norm && a.role_norm === role_norm) ?? null
    : null;
  if (!match) {
    const open = apps.filter((a) => a.company_norm === company_norm && !TERMINAL.includes(a.status));
    if (open.length === 1 && (!role_norm || open[0].role_norm === null)) match = open[0];
  }
  if (!match) return { outcome: "created", company_norm, role_norm };
  if (match.manual_override) return { outcome: "skipped_override", applicationId: match.id };
  const newStatus = statusForFinding(match.status, finding.detected_status, match.last_activity_at, finding.email_date);
  return { outcome: "updated", applicationId: match.id, oldStatus: match.status, newStatus, statusChanged: newStatus !== match.status };
}

export function computeVerdict({ errorCount, appliedCount }) {
  if (errorCount === 0) return "success";
  return appliedCount > 0 ? "partial" : "error";
}
