import { api } from "./api";
import { setEnvironmentData, setEnvironmentStage } from "./environment";

const GMAIL_ACCOUNT = 0;
const STATUSES = ["applied", "assessment", "interview", "next-phase", "offer", "rejected", "withdrawn"] as const;
type Status = typeof STATUSES[number];

const LABELS: Record<Status | "ghosted", { ja: string; en: string }> = {
  applied: { ja: "応募済", en: "APPLIED" },
  assessment: { ja: "課題中", en: "ASSESSMENT" },
  interview: { ja: "面接中", en: "INTERVIEW" },
  "next-phase": { ja: "次段階", en: "NEXT PHASE" },
  offer: { ja: "内定", en: "OFFER" },
  rejected: { ja: "不採用", en: "REJECTED" },
  withdrawn: { ja: "辞退", en: "WITHDRAWN" },
  ghosted: { ja: "長期未更新", en: "GONE QUIET" },
};

interface Application {
  id: string;
  company: string;
  role: string | null;
  status: Status;
  applied_at: string | null;
  last_activity_at: string | null;
  notes: string | null;
  manual_override: boolean;
  source: string;
  last_email_id: string | null;
  ghosted: boolean;
  days_quiet: number | null;
}

interface AppEvent {
  id: string;
  event_type: string;
  old_status: Status | null;
  new_status: Status | null;
  email_subject: string | null;
  occurred_at: string;
  gmail_message_id: string | null;
}

let applications: Application[] = [];
let activeFilter = "all";
let query = "";

const STATUS_WEIGHT: Record<string, number> = {
  applied: 1, assessment: 2, interview: 3, "next-phase": 4, offer: 5,
};

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
}[char]!));
const norm = (value: string) => value.toLowerCase().normalize("NFKC").replace(/[^a-z0-9\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
const date = (value: string | null) => value ? new Date(value).toISOString().slice(0, 10).replaceAll("-", ".") : "—";
const inputDate = (value: string | null) => value ? new Date(value).toISOString().slice(0, 10) : "";
const bucket = (app: Application) => app.ghosted ? "ghosted" : app.status;
const gmailUrl = (id: string) => `https://mail.google.com/mail/u/${GMAIL_ACCOUNT}/#all/${encodeURIComponent(id)}`;

function toast(message: string) {
  const element = Object.assign(document.createElement("div"), { className: "toast", textContent: message });
  document.body.append(element);
  setTimeout(() => element.remove(), 5000);
}

function updateMetrics() {
  setEnvironmentData(applications);
  const set = (id: string, value: number) => { const el = document.getElementById(id); if (el) el.textContent = String(value).padStart(2, "0"); };
  set("metric-all", applications.length);
  set("metric-interview", applications.filter((app) => app.status === "interview").length);
  set("metric-offer", applications.filter((app) => app.status === "offer").length);

  const featured = featuredApplication();
  if (!featured) return;
  const recordNumber = applications.indexOf(featured) + 1;
  const featuredStatus = bucket(featured) as keyof typeof LABELS;
  const record = document.getElementById("hero-record");
  const company = document.getElementById("hero-company");
  const role = document.getElementById("hero-role");
  const stage = document.getElementById("hero-stage");
  if (record) record.textContent = `NO. ${String(recordNumber).padStart(3, "0")}`;
  if (company) company.textContent = featured.company;
  if (role) role.textContent = featured.role ?? "ROLE UNSET / 役職未設定";
  if (stage) stage.textContent = `${LABELS[featuredStatus].ja} / ${LABELS[featuredStatus].en}`;
  setSignal(featuredStatus);
}

function featuredApplication() {
  return [...applications].sort((a, b) => {
    const stageDelta = (STATUS_WEIGHT[b.status] ?? 0) - (STATUS_WEIGHT[a.status] ?? 0);
    if (stageDelta) return stageDelta;
    return new Date(b.last_activity_at ?? b.applied_at ?? 0).getTime() - new Date(a.last_activity_at ?? a.applied_at ?? 0).getTime();
  })[0] ?? null;
}

function currentSignal() {
  if (activeFilter !== "all") return activeFilter;
  const featured = featuredApplication();
  return featured ? bucket(featured) : "applied";
}

function setSignal(status: string) {
  setEnvironmentStage(status);
}

function syncPipeline(el: HTMLElement) {
  el.querySelectorAll<HTMLButtonElement>("[data-pipeline]").forEach((button) => {
    const selected = activeFilter === button.dataset.pipeline;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function statusMark(app: Application) {
  const key = bucket(app) as keyof typeof LABELS;
  const label = LABELS[key];
  return `<span class="status-mark status-${key}"><i></i><span lang="ja">${label.ja}</span><small>${label.en}</small></span>`;
}

function visibleApps() {
  const needle = norm(query);
  return applications.filter((app) => {
    const statusMatches = activeFilter === "all" || bucket(app) === activeFilter;
    const textMatches = !needle || norm(`${app.company} ${app.role ?? ""}`).includes(needle);
    return statusMatches && textMatches;
  });
}

function listMarkup(rows: Application[]) {
  if (!rows.length) return `<div class="empty-state"><b>該当なし</b><p>No applications match this view.</p></div>`;
  return `
    <div class="application-table" role="table" aria-label="Applications">
      <div class="application-head" role="row">
        <span>DATE</span><span>COMPANY / ROLE</span><span>STATUS</span><span>LAST ACTIVITY</span><span></span>
      </div>
      ${rows.map((app, index) => `
        <button class="application-row${app.ghosted ? " is-quiet" : ""}" data-id="${esc(app.id)}" data-status="${esc(bucket(app))}" data-record="${String(index + 1).padStart(2, "0")}" role="row">
          <span class="row-index"><b>${String(index + 1).padStart(2, "0")}</b>${date(app.applied_at)}</span>
          <span class="app-name"><strong>${esc(app.company)}</strong><small>${esc(app.role ?? "役職未設定 / ROLE UNSET")}</small></span>
          ${statusMark(app)}
          <span class="last-date">${date(app.last_activity_at)}${app.ghosted ? `<small>${app.days_quiet} DAYS QUIET</small>` : ""}</span>
          <span class="row-arrow" aria-hidden="true">↗</span>
        </button>`).join("")}
    </div>`;
}

function drawList(el: HTMLElement) {
  const rows = visibleApps();
  const list = el.querySelector<HTMLElement>("#application-list");
  if (list) list.innerHTML = listMarkup(rows);
  const count = el.querySelector("#shown-count");
  if (count) count.textContent = `${String(rows.length).padStart(2, "0")} / ${String(applications.length).padStart(2, "0")}`;
  syncPipeline(el);
  wireRows(el);
}

function wireRows(el: HTMLElement) {
  el.querySelectorAll<HTMLButtonElement>(".application-row").forEach((row) => {
    row.addEventListener("click", () => openDetails(el, row.dataset.id!));
    row.addEventListener("pointerenter", () => setSignal(row.dataset.status ?? currentSignal()));
    row.addEventListener("pointerleave", () => setSignal(currentSignal()));
  });
}

export async function renderApps(el: HTMLElement) {
  if (el.dataset.dossierListener !== "true") {
    el.dataset.dossierListener = "true";
    el.addEventListener("gcn:open-application", (event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (id) openDetails(el, id);
    });
  }
  el.innerHTML = `<div class="section-loading"><i></i><span>応募情報を読み込み中 / LOADING APPLICATIONS</span></div>`;
  try {
    const result = await api<{ applications: Application[] }>("/applications");
    applications = result.applications;
  } catch (error) {
    el.innerHTML = `<div class="error-panel"><b>接続エラー / CONNECTION ERROR</b><p>${esc(error instanceof Error ? error.message : error)}</p></div>`;
    return;
  }
  updateMetrics();
  const counts = Object.fromEntries([...STATUSES, "ghosted"].map((status) => [status, applications.filter((app) => bucket(app) === status).length]));

  el.innerHTML = `
    <section class="pipeline-section" aria-labelledby="pipeline-title">
      <header class="section-title">
        <div><span>01</span><p lang="ja">進捗状況</p><small id="pipeline-title">PIPELINE</small></div>
        <p>STATUS AS OF <time>${date(new Date().toISOString())}</time></p>
      </header>
      <div class="pipeline-track">
        ${(["applied", "assessment", "interview", "next-phase", "offer"] as Status[]).map((status, index) => `
          <button data-pipeline="${status}" data-route="${String(index + 1).padStart(2, "0")}" class="stage stage-${status}" aria-pressed="false">
            <span>${String(index + 1).padStart(2, "0")}</span>
            <i></i><strong>${String(counts[status]).padStart(2, "0")}</strong>
            <b lang="ja">${LABELS[status].ja}</b><small>${LABELS[status].en}</small>
          </button>`).join("")}
      </div>
    </section>

    <section class="records-section" aria-labelledby="records-title">
      <header class="section-title">
        <div><span>02</span><p lang="ja">応募一覧</p><small id="records-title">APPLICATION RECORDS</small></div>
        <button class="add-button" id="add-application"><span>＋</span><b lang="ja">新規追加</b><small>ADD NEW</small></button>
      </header>
      <div class="record-tools">
        <label class="search-box"><span lang="ja">検索</span><small>SEARCH</small><input id="app-search" type="search" placeholder="会社名・職種" value="${esc(query)}" /></label>
        <label class="filter-box"><span lang="ja">状況</span><small>FILTER</small>
          <select id="status-filter">
            <option value="all">すべて / ALL</option>
            ${[...STATUSES, "ghosted"].map((status) => `<option value="${status}" ${activeFilter === status ? "selected" : ""}>${LABELS[status].ja} / ${LABELS[status].en} (${counts[status]})</option>`).join("")}
          </select>
        </label>
        <div class="shown"><span lang="ja">表示件数</span><small>SHOWING</small><strong id="shown-count">—</strong></div>
      </div>
      <div id="application-list">${listMarkup(visibleApps())}</div>
    </section>
    <dialog class="record-dialog" id="record-dialog"></dialog>`;

  el.querySelector<HTMLInputElement>("#app-search")!.addEventListener("input", (event) => {
    query = (event.target as HTMLInputElement).value;
    drawList(el);
  });
  el.querySelector<HTMLSelectElement>("#status-filter")!.addEventListener("change", (event) => {
    activeFilter = (event.target as HTMLSelectElement).value;
    setSignal(currentSignal());
    drawList(el);
  });
  el.querySelectorAll<HTMLButtonElement>("[data-pipeline]").forEach((button) => button.addEventListener("click", () => {
    activeFilter = activeFilter === button.dataset.pipeline ? "all" : button.dataset.pipeline!;
    setSignal(currentSignal());
    const select = el.querySelector<HTMLSelectElement>("#status-filter")!;
    select.value = activeFilter;
    drawList(el);
    el.querySelector(".records-section")?.scrollIntoView({ behavior: "smooth" });
  }));
  el.querySelectorAll<HTMLButtonElement>("[data-pipeline]").forEach((button) => {
    button.addEventListener("pointerenter", () => setSignal(button.dataset.pipeline ?? currentSignal()));
    button.addEventListener("pointerleave", () => setSignal(currentSignal()));
  });
  el.querySelector("#add-application")!.addEventListener("click", () => openEditor(el));
  wireRows(el);
  drawList(el);
}

function dialogFrame(titleJa: string, titleEn: string, body: string) {
  return `<article class="record-sheet">
    <header><div><span>GCN / RECORD</span><h2 lang="ja">${esc(titleJa)}</h2><p>${esc(titleEn)}</p></div><button class="dialog-close" data-close aria-label="Close">×</button></header>
    ${body}
  </article>`;
}

function showDialog(dialog: HTMLDialogElement) {
  dialog.onclick = (event) => {
    const target = event.target as HTMLElement;
    if (target === dialog || target.closest("[data-close]")) dialog.close();
  };
  dialog.showModal();
}

function editorForm(app?: Application) {
  const today = new Date().toISOString().slice(0, 10);
  return `<form class="record-form" id="record-form">
    <label><span lang="ja">会社名</span><small>COMPANY</small><input name="company" value="${esc(app?.company ?? "")}" required maxlength="200" /></label>
    <label><span lang="ja">職種</span><small>ROLE</small><input name="role" value="${esc(app?.role ?? "")}" maxlength="300" /></label>
    <div class="form-pair">
      <label><span lang="ja">状況</span><small>STATUS</small><select name="status">${STATUSES.map((status) => `<option value="${status}" ${app?.status === status ? "selected" : ""}>${LABELS[status].ja} / ${LABELS[status].en}</option>`).join("")}</select></label>
      <label><span lang="ja">応募日</span><small>APPLIED</small><input name="applied_at" type="date" value="${inputDate(app?.applied_at ?? today)}" /></label>
    </div>
    <label><span lang="ja">メモ</span><small>NOTES</small><textarea name="notes" maxlength="5000">${esc(app?.notes ?? "")}</textarea></label>
    ${app ? `<label class="toggle-line"><input name="automatic" type="checkbox" ${app.manual_override ? "" : "checked"} /><i></i><span><b lang="ja">自動更新</b><small>ALLOW SCANNER TO UPDATE STATUS</small></span></label>` : ""}
    <p class="form-error" id="record-error" role="alert"></p>
    <footer>
      ${app ? `<button type="button" class="delete-button" id="delete-record"><span lang="ja">削除</span> / DELETE</button>` : ""}
      <button type="button" class="text-button" data-close>取消 / CANCEL</button>
      <button type="submit" class="save-button"><span lang="ja">保存</span> / SAVE</button>
    </footer>
  </form>`;
}

function openEditor(el: HTMLElement, app?: Application) {
  const dialog = el.querySelector<HTMLDialogElement>("#record-dialog")!;
  dialog.innerHTML = dialogFrame(app ? "応募情報を編集" : "新しい応募", app ? "EDIT APPLICATION" : "NEW APPLICATION", editorForm(app));
  const form = dialog.querySelector<HTMLFormElement>("#record-form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const payload: Record<string, unknown> = {
      company: String(data.get("company") ?? "").trim(),
      role: String(data.get("role") ?? "").trim() || null,
      status: String(data.get("status")),
      applied_at: String(data.get("applied_at") ?? "") || null,
      notes: String(data.get("notes") ?? "").trim() || null,
    };
    if (app) payload.manual_override = data.get("automatic") !== "on";
    const error = form.querySelector<HTMLElement>("#record-error")!;
    const save = form.querySelector<HTMLButtonElement>(".save-button")!;
    if (!payload.company) { error.textContent = "会社名を入力してください。 / Company is required."; return; }
    save.disabled = true;
    try {
      if (app) await api(`/applications/${encodeURIComponent(app.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api("/applications", { method: "POST", body: JSON.stringify(payload) });
      dialog.close();
      await renderApps(el);
    } catch (reason) {
      save.disabled = false;
      error.textContent = reason instanceof Error ? reason.message : String(reason);
    }
  });
  if (app) dialog.querySelector("#delete-record")!.addEventListener("click", async () => {
    if (!confirm(`Delete ${app.company} and its complete history?`)) return;
    try {
      await api(`/applications/${encodeURIComponent(app.id)}`, { method: "DELETE", body: "{}" });
      dialog.close();
      await renderApps(el);
    } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
  });
  showDialog(dialog);
  dialog.querySelector<HTMLInputElement>("input[name=company]")!.focus();
}

async function openDetails(el: HTMLElement, id: string) {
  const app = applications.find((item) => item.id === id);
  if (!app) return;
  const dialog = el.querySelector<HTMLDialogElement>("#record-dialog")!;
  dialog.innerHTML = dialogFrame(app.company, app.role ?? "APPLICATION RECORD", `<div class="sheet-loading">読み込み中 / LOADING</div>`);
  showDialog(dialog);
  try {
    const result = await api<{ events: AppEvent[] }>(`/applications/${encodeURIComponent(id)}/events`);
    dialog.innerHTML = dialogFrame(app.company, app.role ?? "APPLICATION RECORD", `
      <div class="record-summary">
        <div><small>CURRENT STATUS</small>${statusMark(app)}</div>
        <dl>
          <div><dt lang="ja">応募日</dt><dd>${date(app.applied_at)}</dd></div>
          <div><dt lang="ja">最終更新</dt><dd>${date(app.last_activity_at)}</dd></div>
          <div><dt lang="ja">更新方法</dt><dd>${app.manual_override ? "固定 / MANUAL" : "自動 / AUTO"}</dd></div>
        </dl>
        ${app.notes ? `<div class="record-notes"><small>NOTES</small><p>${esc(app.notes)}</p></div>` : ""}
      </div>
      <section class="timeline">
        <div class="subhead"><span lang="ja">活動記録</span><small>TIMELINE / ${String(result.events.length).padStart(2, "0")}</small></div>
        ${result.events.length ? `<ol>${result.events.map((event) => `
          <li><time>${date(event.occurred_at)}</time><i></i><div><b>${esc(event.event_type.replaceAll("_", " "))}</b>
            ${event.old_status || event.new_status ? `<p>${event.old_status ? LABELS[event.old_status].ja : ""}${event.old_status && event.new_status ? " → " : ""}${event.new_status ? LABELS[event.new_status].ja : ""}</p>` : ""}
            ${event.gmail_message_id ? `<a href="${gmailUrl(event.gmail_message_id)}" target="_blank" rel="noopener">${esc(event.email_subject || "メールを見る")} ↗</a>` : event.email_subject ? `<p>${esc(event.email_subject)}</p>` : ""}
          </div></li>`).join("")}</ol>` : `<p class="timeline-empty">記録はまだありません。 / NO EVENTS YET</p>`}
      </section>
      <footer class="sheet-actions">
        ${app.last_email_id ? `<a href="${gmailUrl(app.last_email_id)}" target="_blank" rel="noopener">メールを見る / OPEN MAIL ↗</a>` : "<span></span>"}
        <button id="edit-record">編集する / EDIT</button>
      </footer>`);
    dialog.querySelector("#edit-record")!.addEventListener("click", () => { dialog.close(); openEditor(el, app); });
  } catch (error) {
    dialog.querySelector(".sheet-loading")!.textContent = error instanceof Error ? error.message : String(error);
  }
}
