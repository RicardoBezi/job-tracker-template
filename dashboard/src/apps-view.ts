import { q } from "./db";
import { secrets } from "./main";

// Gmail resolves its own hex message id in the #all/ fragment and jumps straight
// to the message. u/0 is the first signed-in Google account in this browser —
// bump the index if the tracked mailbox ever stops being the default one.
const GMAIL_ACCOUNT = 0;
const gmailUrl = (id: string) => `https://mail.google.com/mail/u/${GMAIL_ACCOUNT}/#all/${id}`;
const STATUSES = ["applied", "assessment", "interview", "next-phase", "offer", "rejected", "withdrawn"];
const STATUS_RANK = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
const LIVE = ["applied", "assessment", "interview", "next-phase"];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

// Mirrors scripts/lib/core.mjs — ghosted is derived from silence, never stored,
// so it corrects itself the moment a reply lands.
const GHOST_DAYS = 180;

type Row = Record<string, any>;
type SortKey = "company" | "role" | "status" | "applied_at" | "last_activity_at" | "auto";

const daysQuiet = (r: Row): number | null => {
  const last = r.last_activity_at ?? r.applied_at;
  return last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400e3) : null;
};
const isGhosted = (r: Row) => {
  if (!LIVE.includes(r.status)) return false;
  const d = daysQuiet(r);
  return d !== null && d > GHOST_DAYS;
};
/** Every row falls in exactly one bucket, so the counts always sum to the total. */
const bucketOf = (r: Row) => (isGhosted(r) ? "ghosted" : r.status);
const BUCKETS = [...STATUSES, "ghosted"];

const sort: { key: SortKey; dir: 1 | -1 } = { key: "last_activity_at", dir: -1 };
let visible: Set<string> | null = null;   // null = show everything

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: "company", label: "Company" },
  { key: "role", label: "Role" },
  { key: "status", label: "Status" },
  { key: "applied_at", label: "Applied" },
  { key: "last_activity_at", label: "Last activity", title: "Links to the email that produced the update, where there is one." },
  { key: "auto", label: "Auto-update", title: "On: the daily scan may update this status. Off: your manual edit stays put." },
];

// One document-level listener for the whole page life: it looks the menu up fresh
// each click, so re-rendering the toolbar never leaves a stale handler behind.
let outsideCloseInstalled = false;
function installOutsideClose() {
  if (outsideCloseInstalled) return;
  outsideCloseInstalled = true;
  document.addEventListener("click", (e) => {
    const m = document.querySelector<HTMLDetailsElement>("#status-menu");
    if (m?.open && !m.contains(e.target as Node)) m.open = false;
  });
}

function toast(msg: string) {
  const t = Object.assign(document.createElement("div"), { className: "err-toast", textContent: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 5000);
}

async function logManualEvent(appId: string, oldS: string | null, newS: string | null) {
  await q`insert into application_events (application_id, event_type, old_status, new_status, occurred_at)
          values (${appId}, 'manual_edit', ${oldS}, ${newS}, now())`;
}

function compare(a: Row, b: Row, key: SortKey): number {
  if (key === "auto") return Number(a.manual_override) - Number(b.manual_override);
  if (key === "status") return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  const av = a[key], bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return sort.dir;          // nulls last, both directions
  if (bv == null) return -sort.dir;
  if (key === "applied_at" || key === "last_activity_at") return new Date(av).getTime() - new Date(bv).getTime();
  return String(av).localeCompare(String(bv));
}

export async function renderApps(el: HTMLElement) {
  // The lateral join hangs the newest email behind each application, so the
  // "last activity" date can link straight to the message that caused it.
  const all = (await q`
    select a.id, a.company, a.role, a.status, a.applied_at, a.last_activity_at,
           a.notes, a.manual_override, a.source, e.gmail_message_id as last_email_id
    from applications a
    left join lateral (
      select gmail_message_id from application_events
      where application_id = a.id and gmail_message_id is not null
      order by occurred_at desc limit 1
    ) e on true`) as Row[];

  const counts = Object.fromEntries(BUCKETS.map((b) => [b, all.filter((r) => bucketOf(r) === b).length]));
  const present = BUCKETS.filter((b) => counts[b] > 0);

  const rows = all
    .filter((r) => !visible || visible.has(bucketOf(r)))
    .sort((a, b) => compare(a, b, sort.key) * sort.dir);

  const prevSearch = (el.querySelector("#search") as HTMLInputElement | null)?.value ?? "";
  const wasOpen = (el.querySelector("#status-menu") as HTMLDetailsElement | null)?.open ?? false;
  const arrow = (k: SortKey) => (sort.key === k ? `<span class="arr">${sort.dir === 1 ? "▲" : "▼"}</span>` : "");

  const filterLabel = !visible || visible.size === present.length
    ? "All statuses"
    : visible.size === 0
      ? "No statuses"
      : visible.size === 1
        ? [...visible][0]
        : `${visible.size} statuses`;

  el.innerHTML = `
    <section class="pipeline">
      <div class="pipeline-head">
        <span class="pipeline-count">${all.length}</span>
        <span class="pipeline-note">applications tracked</span>
      </div>
    </section>

    <div class="toolbar">
      <input type="search" id="search" placeholder="Search company or role…" value="${prevSearch}" />
      <button class="btn-ghost" id="add">+ Add application</button>
      <details class="status-menu" id="status-menu" ${wasOpen ? "open" : ""}>
        <summary class="btn-ghost">${filterLabel} <span class="caret">▾</span></summary>
        <div class="menu-panel">
          <div class="menu-actions">
            <button class="link-btn" data-pick="all">Select all</button>
            <button class="link-btn" data-pick="none">Clear</button>
          </div>
          ${present.map((b) => `
            <label class="menu-row">
              <input type="checkbox" data-bucket="${b}" ${!visible || visible.has(b) ? "checked" : ""} />
              <span class="dot${b === "ghosted" ? " dot-ghost" : ""}" style="background:var(--s-${b})"></span>
              <span class="menu-name">${b}</span>
              <span class="n">${counts[b]}</span>
            </label>`).join("")}
        </div>
      </details>
      ${secrets.routine_url ? `
        <a class="scan-link" href="${secrets.routine_url}" target="_blank" rel="noopener">
          <button class="btn-ghost">Run a scan now ↗</button>
        </a>` : ""}
      <span class="count" id="shown">${rows.length} shown</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          ${COLUMNS.map((c) => `<th class="sortable" data-sort="${c.key}" tabindex="0"${c.title ? ` title="${c.title}"` : ""}>${c.label} ${arrow(c.key)}</th>`).join("")}
          <th></th>
        </tr></thead>
        <tbody>${rows.map((r) => `
          <tr data-id="${r.id}" class="app-row${isGhosted(r) ? " is-ghosted" : ""}">
            <td class="company">${esc(r.company)}</td>
            <td class="role">${esc(r.role ?? "—")}</td>
            <td class="status-cell" data-status="${r.status}">
              <select class="status-select" data-act="status" data-current="${r.status}">
                ${STATUSES.map((s) => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}
              </select>
              ${isGhosted(r) ? `<span class="ghost-tag" title="No word for ${daysQuiet(r)} days. Clears itself if they reply.">quiet ${daysQuiet(r)}d</span>` : ""}
            </td>
            <td class="date">${fmtDate(r.applied_at)}</td>
            <td class="date">${r.last_email_id
              ? `<a class="mail-link" href="${gmailUrl(r.last_email_id)}" target="_blank" rel="noopener"
                    title="Open the email behind this update">${fmtDate(r.last_activity_at)}<span class="mail-ic">↗</span></a>`
              : fmtDate(r.last_activity_at)}</td>
            <td><input type="checkbox" class="auto-check" data-act="auto" ${r.manual_override ? "" : "checked"} title="${COLUMNS[5].title}" /></td>
            <td class="actions">
              <button class="icon-btn" data-act="timeline">History</button>
              <button class="icon-btn danger" data-act="del" title="Delete">✕</button>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${rows.length === 0 ? `<p class="empty">Nothing matches these filters.</p>` : ""}
    </div>
    <dialog class="modal" id="timeline"></dialog>
    <dialog class="modal" id="add-modal"></dialog>`;

  // ---- status filter menu ----
  const menu = el.querySelector("#status-menu") as HTMLDetailsElement;
  menu.addEventListener("change", (e) => {
    const cb = e.target as HTMLInputElement;
    if (!cb.dataset.bucket) return;
    const next = new Set(visible ?? present);
    cb.checked ? next.add(cb.dataset.bucket) : next.delete(cb.dataset.bucket);
    visible = next.size === present.length ? null : next;
    renderApps(el);
  });
  menu.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.preventDefault();
      visible = b.dataset.pick === "all" ? null : new Set();
      renderApps(el);
    }));
  installOutsideClose();

  el.querySelectorAll<HTMLElement>("th.sortable").forEach((th) => {
    const go = () => {
      const key = th.dataset.sort as SortKey;
      if (sort.key === key) sort.dir = sort.dir === 1 ? -1 : 1;
      else { sort.key = key; sort.dir = key === "company" || key === "role" ? 1 : -1; }
      renderApps(el);
    };
    th.addEventListener("click", go);
    th.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") go(); });
  });

  const search = el.querySelector("#search") as HTMLInputElement;
  search.addEventListener("input", () => {
    const v = norm(search.value);
    let shown = 0;
    el.querySelectorAll<HTMLTableRowElement>(".app-row").forEach((tr) => {
      const hit = v === "" || norm(tr.textContent ?? "").includes(v);
      tr.hidden = !hit;
      if (hit) shown++;
    });
    el.querySelector("#shown")!.textContent = `${shown} shown`;
  });

  el.querySelector("#add")!.addEventListener("click", () => openAddForm(el));

  el.querySelector("tbody")!.addEventListener("change", async (e) => {
    const t = e.target as HTMLElement, tr = t.closest("tr")!, id = tr.dataset.id!;
    try {
      if (t.dataset.act === "status") {
        const sel = t as HTMLSelectElement;
        if (sel.value === sel.dataset.current) return;   // ignore no-op / stray events
        const oldStatus = sel.dataset.current!;
        await q`update applications set status = ${sel.value}, manual_override = true, updated_at = now(), last_activity_at = now() where id = ${id}`;
        await logManualEvent(id, oldStatus, sel.value);
        renderApps(el);
      } else if (t.dataset.act === "auto") {
        await q`update applications set manual_override = ${!(t as HTMLInputElement).checked}, updated_at = now() where id = ${id}`;
      }
    } catch (err) { toast(String(err)); }
  });

  el.querySelector("tbody")!.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName !== "BUTTON") return;
    const tr = t.closest("tr")!, id = tr.dataset.id!;
    try {
      if (t.dataset.act === "del") {
        if (!confirm("Delete this application and its history?")) return;
        await q`delete from applications where id = ${id}`;
        renderApps(el);
      } else if (t.dataset.act === "timeline") {
        const evs = (await q`select event_type, old_status, new_status, email_subject, occurred_at, gmail_message_id
                             from application_events where application_id = ${id} order by occurred_at desc`) as Row[];
        const company = tr.querySelector(".company")!.textContent ?? "";
        const role = tr.querySelector(".role")!.textContent ?? "";
        openTimeline(el, company, role, evs);
      }
    } catch (err) { toast(String(err)); }
  });
}

/** Backdrop click and any [data-close] control dismiss the dialog. */
function wireModal(dlg: HTMLDialogElement) {
  // onclick, not addEventListener: reopening replaces the handler rather than
  // stacking a new one on the same dialog element.
  dlg.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t === dlg || t.closest("[data-close]")) dlg.close();
  };
  dlg.showModal();
}

function openAddForm(el: HTMLElement) {
  const dlg = el.querySelector<HTMLDialogElement>("#add-modal")!;
  const today = new Date().toISOString().slice(0, 10);
  dlg.innerHTML = `
    <div class="modal-card">
      <header class="modal-head">
        <div>
          <span class="kicker">New</span>
          <h3>Add application</h3>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </header>
      <form class="modal-body form" id="add-form" novalidate>
        <div class="field">
          <label for="f-company">Company</label>
          <input id="f-company" name="company" autocomplete="off" />
        </div>
        <div class="field">
          <label for="f-role">Role <span class="opt">optional</span></label>
          <input id="f-role" name="role" autocomplete="off" />
        </div>
        <div class="field-row">
          <div class="field">
            <label for="f-status">Status</label>
            <select id="f-status" name="status">
              ${STATUSES.map((s) => `<option ${s === "applied" ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="f-date">Applied</label>
            <input type="date" id="f-date" name="applied_at" value="${today}" max="${today}" />
          </div>
        </div>
        <p class="form-err" id="add-err"></p>
        <div class="modal-foot">
          <button type="button" class="btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn-primary" id="add-save">Add application</button>
        </div>
      </form>
    </div>`;

  const form = dlg.querySelector<HTMLFormElement>("#add-form")!;
  const err = dlg.querySelector("#add-err")!;
  const save = dlg.querySelector<HTMLButtonElement>("#add-save")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const company = String(fd.get("company") ?? "").trim();
    const role = String(fd.get("role") ?? "").trim() || null;
    const status = String(fd.get("status"));
    const appliedAt = String(fd.get("applied_at") ?? "") || today;
    if (!company) {
      err.textContent = "Enter a company name.";
      dlg.querySelector<HTMLInputElement>("#f-company")!.focus();
      return;
    }
    save.disabled = true;
    save.textContent = "Adding…";
    try {
      const [a] = (await q`insert into applications (company, company_norm, role, role_norm, status, applied_at, last_activity_at, source)
        values (${company}, ${norm(company)}, ${role}, ${role ? norm(role) : null}, ${status}, ${appliedAt}, ${appliedAt}, 'manual') returning id`) as Row[];
      await logManualEvent(a.id, null, status);
      dlg.close();
      renderApps(el);
    } catch (e) {
      save.disabled = false;
      save.textContent = "Add application";
      err.textContent = String((e as Error).message ?? e);
    }
  });

  wireModal(dlg);
  dlg.querySelector<HTMLInputElement>("#f-company")!.focus();
}

/** <dialog>.showModal() gives us the backdrop, Escape-to-close and focus trap for free. */
function openTimeline(el: HTMLElement, company: string, role: string, evs: Row[]) {
  const dlg = el.querySelector<HTMLDialogElement>("#timeline")!;
  dlg.innerHTML = `
    <div class="modal-card">
      <header class="modal-head">
        <div>
          <span class="kicker">Timeline</span>
          <h3>${esc(company)}</h3>
          ${role && role !== "—" ? `<p class="modal-sub">${esc(role)}</p>` : ""}
        </div>
        <button class="icon-btn" data-close aria-label="Close">✕</button>
      </header>
      <div class="modal-body">
        ${evs.length === 0 ? `<p class="empty">No events recorded yet.</p>` : `
          <ol class="events">${evs.map((ev) => `
            <li>
              <span class="ev-date">${fmtDate(ev.occurred_at)}</span>
              <div class="ev-main">
                <div class="ev-line">
                  <span class="ev-kind">${ev.event_type.replace(/_/g, " ")}</span>
                  <span class="ev-move">${ev.old_status ? `${ev.old_status} → ` : ""}${ev.new_status ?? ""}</span>
                </div>
                <p class="ev-subject">${ev.gmail_message_id
                  ? `<a class="mail-link" href="${gmailUrl(ev.gmail_message_id)}" target="_blank" rel="noopener"
                        >${esc(ev.email_subject || "Open in Gmail")}<span class="mail-ic">↗</span></a>`
                  : esc(ev.email_subject ?? "")}</p>
              </div>
            </li>`).join("")}</ol>`}
      </div>
    </div>`;
  wireModal(dlg);
}

function esc(s: string) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function fmtDate(d: unknown) { return d ? new Date(d as string).toISOString().slice(0, 10) : "—"; }
