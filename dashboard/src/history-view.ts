import { q } from "./db";

type Row = Record<string, any>;

export async function renderHistory(el: HTMLElement) {
  const runs = (await q`select id, started_at, finished_at, trigger, status, emails_found, apps_created, apps_updated, errors, summary
                        from scan_runs order by started_at desc limit 50`) as Row[];

  const stale = (r: Row) => r.status === "running" && Date.now() - new Date(r.started_at).getTime() > 30 * 60e3;
  const label = (r: Row) => (stale(r) ? "failed" : r.status);
  const cls = (r: Row) => (stale(r) ? "stale" : r.status);

  el.innerHTML = `
    <div class="toolbar">
      <span class="count">${runs.length} run${runs.length === 1 ? "" : "s"}</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Started</th><th>Trigger</th><th>Result</th>
          <th>Emails</th><th>Added</th><th>Updated</th><th>Summary</th>
        </tr></thead>
        <tbody>${runs.map((r) => `
          <tr>
            <td class="date">${fmtStamp(r.started_at)}</td>
            <td>${r.trigger}</td>
            <td><span class="badge ${cls(r)}">${label(r)}</span></td>
            <td class="date">${r.emails_found ?? "—"}</td>
            <td class="date">${r.apps_created}</td>
            <td class="date">${r.apps_updated}</td>
            <td>${r.errors.length
              ? `<details class="errors"><summary>${esc(r.summary ?? "")} — ${r.errors.length} error${r.errors.length === 1 ? "" : "s"}</summary><pre>${esc(JSON.stringify(r.errors, null, 2))}</pre></details>`
              : esc(r.summary ?? "")}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${runs.length === 0 ? `<p class="empty">No scans yet. The routine runs every morning at 8am.</p>` : ""}
    </div>`;
}

function esc(s: string) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function fmtStamp(d: unknown) {
  const dt = new Date(d as string);
  return dt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
