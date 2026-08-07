import { describe, it, expect } from "vitest";
import { normalize, validateFindings, planAction, advanceStatus, statusForFinding, computeVerdict, isGhosted, daysSinceActivity, GHOST_DAYS } from "../scripts/lib/core.mjs";

const good = {
  gmail_message_id: "m1",
  email_subject: "Thanks for applying",
  email_from: "no-reply@stripe.com",
  email_date: "2026-08-01",
  company: "Stripe",
  role: "SWE Intern",
  detected_status: "applied",
  confidence: 0.9,
};

const app = (o = {}) => ({ id: "a1", company_norm: "stripe", role_norm: "swe intern", status: "applied", manual_override: false, last_activity_at: "2026-08-01", ...o });
const f = (o = {}) => ({ ...good, ...o });

describe("normalize", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalize("  Stripe, Inc.  ")).toBe("stripe inc");
    expect(normalize("Meta")).toBe("meta");
    expect(normalize(null)).toBe("");
  });
});

describe("validateFindings", () => {
  it("accepts a valid finding", () => {
    const { valid, invalid } = validateFindings([good]);
    expect(valid).toHaveLength(1);
    expect(invalid).toHaveLength(0);
  });
  it("rejects missing company, bad enum, unknown field, bad date", () => {
    const bads = [
      { ...good, company: undefined },
      { ...good, detected_status: "ghosted" },
      { ...good, extra_field: 1 },
      { ...good, email_date: "Aug 1" },
    ];
    const { valid, invalid } = validateFindings(bads);
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(4);
    for (const i of invalid) expect(i.error).toBeTruthy();
  });
  it("rejects non-array input", () => {
    expect(validateFindings({}).invalid).toHaveLength(1);
  });
  it("nullable role is fine", () => {
    expect(validateFindings([{ ...good, role: null }]).valid).toHaveLength(1);
  });
});

describe("advanceStatus", () => {
  it("advances forward", () => expect(advanceStatus("applied", "interview")).toBe("interview"));
  it("never demotes", () => expect(advanceStatus("interview", "applied")).toBe("interview"));
  it("terminal reachable from anything", () => expect(advanceStatus("offer", "rejected")).toBe("rejected"));
  it("terminal is sticky", () => expect(advanceStatus("rejected", "interview")).toBe("rejected"));
});

describe("statusForFinding", () => {
  it("does not let older mail overwrite newer state", () =>
    expect(statusForFinding("interview", "rejected", "2026-08-05", "2026-08-04")).toBe("interview"));
  it("reopens a terminal application on a later explicit progression", () =>
    expect(statusForFinding("rejected", "next-phase", "2026-08-06", "2026-08-07")).toBe("next-phase"));
  it("does not guess that same-day mail came after a terminal event", () =>
    expect(statusForFinding("rejected", "next-phase", "2026-08-07", "2026-08-07")).toBe("rejected"));
});

describe("planAction", () => {
  it("skips known message ids", () =>
    expect(planAction(f(), [app()], new Set(["m1"])).outcome).toBe("skipped_duplicate"));
  it("matches company+role exactly", () => {
    const a = planAction(f({ detected_status: "interview" }), [app()], new Set());
    expect(a).toMatchObject({ outcome: "updated", applicationId: "a1", oldStatus: "applied", newStatus: "interview", statusChanged: true });
  });
  it("company-only match when exactly one open app", () => {
    const a = planAction(f({ role: null }), [app()], new Set());
    expect(a.outcome).toBe("updated");
  });
  it("creates when company ambiguous (two open apps)", () => {
    const a = planAction(f({ role: null }), [app(), app({ id: "a2", role_norm: "pm intern" })], new Set());
    expect(a.outcome).toBe("created");
  });
  it("closed apps do not absorb company-only matches", () => {
    const a = planAction(f({ role: null }), [app({ status: "rejected" })], new Set());
    expect(a.outcome).toBe("created");
  });
  it("manual_override blocks updates", () => {
    const a = planAction(f({ detected_status: "offer" }), [app({ manual_override: true })], new Set());
    expect(a).toMatchObject({ outcome: "skipped_override", applicationId: "a1" });
  });
  it("reopens a rejected match when a later email advances it", () => {
    const a = planAction(
      f({ detected_status: "next-phase", email_date: "2026-08-07" }),
      [app({ status: "rejected", last_activity_at: "2026-08-06" })],
      new Set(),
    );
    expect(a).toMatchObject({ outcome: "updated", oldStatus: "rejected", newStatus: "next-phase", statusChanged: true });
  });
  it("no demotion → updated with statusChanged false", () => {
    const a = planAction(f({ detected_status: "applied" }), [app({ status: "interview" })], new Set());
    expect(a).toMatchObject({ outcome: "updated", statusChanged: false, newStatus: "interview" });
  });
});

describe("isGhosted", () => {
  const now = new Date("2026-08-04T00:00:00Z").getTime();
  const ago = (days) => new Date(now - days * 86400e3).toISOString();

  it("ghosts an open application past the threshold", () =>
    expect(isGhosted({ status: "applied", last_activity_at: ago(200) }, now)).toBe(true));
  it("leaves recent applications alone", () =>
    expect(isGhosted({ status: "applied", last_activity_at: ago(30) }, now)).toBe(false));
  it("is exclusive at the boundary", () => {
    expect(isGhosted({ status: "applied", last_activity_at: ago(GHOST_DAYS) }, now)).toBe(false);
    expect(isGhosted({ status: "applied", last_activity_at: ago(GHOST_DAYS + 1) }, now)).toBe(true);
  });
  it("ghosts mid-pipeline stages too", () => {
    for (const s of ["assessment", "interview", "next-phase"])
      expect(isGhosted({ status: s, last_activity_at: ago(200) }, now)).toBe(true);
  });
  it("never ghosts terminal or positive outcomes", () => {
    for (const s of ["rejected", "withdrawn", "offer"])
      expect(isGhosted({ status: s, last_activity_at: ago(400) }, now)).toBe(false);
  });
  it("falls back to applied_at when there is no activity date", () =>
    expect(isGhosted({ status: "applied", last_activity_at: null, applied_at: ago(200) }, now)).toBe(true));
  it("will not ghost a row it cannot date", () =>
    expect(isGhosted({ status: "applied", last_activity_at: null, applied_at: null }, now)).toBe(false));
  it("un-ghosts as soon as a newer email lands", () => {
    const app = { status: "applied", last_activity_at: ago(200) };
    expect(isGhosted(app, now)).toBe(true);
    app.last_activity_at = ago(1);
    expect(isGhosted(app, now)).toBe(false);
  });
  it("reports days since activity", () =>
    expect(daysSinceActivity({ last_activity_at: ago(45) }, now)).toBe(45));
});

describe("computeVerdict", () => {
  it("success with zero errors even if nothing applied", () =>
    expect(computeVerdict({ errorCount: 0, appliedCount: 0 })).toBe("success"));
  it("partial when errors but work applied", () =>
    expect(computeVerdict({ errorCount: 2, appliedCount: 1 })).toBe("partial"));
  it("error when errors and nothing applied", () =>
    expect(computeVerdict({ errorCount: 1, appliedCount: 0 })).toBe("error"));
});
