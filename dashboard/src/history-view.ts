import { api } from "./api";

interface ScanRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger: "cron" | "manual";
  status: "running" | "success" | "partial" | "error";
  emails_found: number | null;
  apps_created: number;
  apps_updated: number;
  errors: Array<{ at: string; message: string; context?: string }>;
  summary: string | null;
}

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
}[char]!));
const stamp = (value: string) => new Date(value).toLocaleString(undefined, {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

export async function renderHistory(el: HTMLElement) {
  el.innerHTML = `<div class="section-loading"><i></i><span>実行履歴を読み込み中 / LOADING SCAN HISTORY</span></div>`;
  try {
    const { runs, routine_url } = await api<{ runs: ScanRun[]; routine_url: string | null }>("/scan-runs");
    const stale = (run: ScanRun) => run.status === "running" && Date.now() - new Date(run.started_at).getTime() > 30 * 60_000;
    el.innerHTML = `
      <section class="history-section">
        <header class="section-title">
          <div><span>04</span><p lang="ja">実行履歴</p><small>SCAN HISTORY</small></div>
          ${routine_url ? `<a class="run-scan" href="${esc(routine_url)}" target="_blank" rel="noopener"><b lang="ja">今すぐ実行</b><small>RUN SCAN ↗</small></a>` : ""}
        </header>
        <div class="history-meta"><b>${String(runs.length).padStart(2, "0")}</b><span>RECENT RUNS</span><p>Latest 50 automated and manual scans.</p></div>
        ${runs.length ? `<div class="history-list">${runs.map((run, index) => {
          const displayStatus = stale(run) ? "error" : run.status;
          const label = stale(run) ? "FAILED / STALE" : run.status.toUpperCase();
          return `<article class="history-row">
            <div class="history-no">${String(index + 1).padStart(2, "0")}</div>
            <div class="history-time"><time>${stamp(run.started_at)}</time><small>${run.trigger.toUpperCase()} TRIGGER</small></div>
            <div class="run-result result-${displayStatus}"><i></i><b>${label}</b><small>${esc(run.summary ?? "RUNNING")}</small></div>
            <div class="run-numbers">
              <span><b>${run.emails_found ?? "—"}</b><small>EMAILS</small></span>
              <span><b>+${run.apps_created}</b><small>ADDED</small></span>
              <span><b>${run.apps_updated}</b><small>UPDATED</small></span>
            </div>
            ${run.errors.length ? `<details><summary>${run.errors.length} ERROR${run.errors.length === 1 ? "" : "S"}</summary><pre>${esc(JSON.stringify(run.errors, null, 2))}</pre></details>` : ""}
          </article>`;
        }).join("")}</div>` : `<div class="empty-state"><b>実行履歴なし</b><p>No scans have been recorded yet.</p></div>`}
      </section>`;
  } catch (error) {
    el.innerHTML = `<div class="error-panel"><b>接続エラー / CONNECTION ERROR</b><p>${esc(error instanceof Error ? error.message : error)}</p></div>`;
  }
}
