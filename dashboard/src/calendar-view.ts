import { api } from "./api";
import { festivalFor } from "./calendar";
import type { CinematicApplication } from "./cinematic";

interface CalendarApplication extends CinematicApplication {
  applied_at: string | null;
}

interface ScanRun {
  id: string;
  started_at: string;
  status: "running" | "success" | "partial" | "error";
  emails_found: number | null;
  apps_created: number;
  apps_updated: number;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_JA = ["睦月", "如月", "弥生", "卯月", "皐月", "水無月", "文月", "葉月", "長月", "神無月", "霜月", "師走"];
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
}[char]!));

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function groupByDate<T>(items: T[], key: (item: T) => string | null) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    const date = value.slice(0, 10);
    grouped.set(date, [...(grouped.get(date) ?? []), item]);
  }
  return grouped;
}

function scanDate(run: ScanRun) {
  return dateKey(new Date(run.started_at));
}

function detailMarkup(key: string, applications: CalendarApplication[], activity: CalendarApplication[], runs: ScanRun[]) {
  const date = new Date(`${key}T12:00:00`);
  const festival = festivalFor(date);
  return `
    <div class="calendar-detail-date"><span>${key.replaceAll("-", ".")}</span><b>${String(date.getDate()).padStart(2, "0")}</b><small>${date.toLocaleDateString(undefined, { weekday: "long" }).toUpperCase()}</small></div>
    ${festival ? `<div class="calendar-detail-festival" style="--event-accent:${festival.accent}"><b>${festival.mark}</b><span>${esc(festival.native)}</span><small>${esc(festival.name)} · ${festival.region}</small></div>` : ""}
    <div class="calendar-detail-counts"><span><b>${applications.length}</b>APPLICATIONS</span><span><b>${activity.length}</b>ACTIVITY</span><span><b>${runs.length}</b>SCANS</span></div>
    ${applications.length ? `<section><small>NEW ROUTES</small>${applications.slice(0, 5).map((app) => `<p><b>${esc(app.company)}</b><span>${esc(app.role ?? "ROLE UNSET")}</span></p>`).join("")}</section>` : ""}
    ${activity.length ? `<section><small>ACTIVE SIGNALS</small>${activity.slice(0, 5).map((app) => `<p><b>${esc(app.company)}</b><span>${esc(app.status.toUpperCase())}</span></p>`).join("")}</section>` : ""}
    ${runs.length ? `<section><small>SCAN TRANSMISSIONS</small>${runs.slice(0, 4).map((run) => `<p><b>${run.status.toUpperCase()}</b><span>${run.emails_found ?? 0} MAIL · +${run.apps_created} / ${run.apps_updated} UPDATED</span></p>`).join("")}</section>` : ""}
    ${!festival && !applications.length && !activity.length && !runs.length ? `<div class="calendar-detail-empty">NO RECORDED SIGNALS</div>` : ""}`;
}

export async function renderCalendar(el: HTMLElement, replayOpening: () => void) {
  el.innerHTML = `<div class="section-loading"><i></i><span>年間信号を集計中 / COMPILING YEAR SIGNAL</span></div>`;
  let applications: CalendarApplication[];
  let runs: ScanRun[];
  try {
    const [applicationResult, runResult] = await Promise.all([
      api<{ applications: CalendarApplication[] }>("/applications"),
      api<{ runs: ScanRun[] }>("/scan-runs"),
    ]);
    applications = applicationResult.applications;
    runs = runResult.runs;
  } catch (error) {
    el.innerHTML = `<div class="error-panel"><b>暦接続エラー / CALENDAR CONNECTION ERROR</b><p>${esc(error instanceof Error ? error.message : error)}</p></div>`;
    return;
  }

  const year = new Date().getFullYear();
  const today = dateKey(new Date());
  const applied = groupByDate(applications, (app) => app.applied_at);
  const activity = groupByDate(applications, (app) => app.last_activity_at);
  const scans = groupByDate(runs, scanDate);
  const activeDays = new Set([...applied.keys(), ...activity.keys(), ...scans.keys()].filter((key) => key.startsWith(`${year}-`)));

  const months = MONTHS.map((month, monthIndex) => {
    const total = new Date(year, monthIndex + 1, 0).getDate();
    const offset = new Date(year, monthIndex, 1).getDay();
    const cells = Array.from({ length: offset }, () => `<span class="signal-day is-empty"></span>`);
    for (let day = 1; day <= total; day += 1) {
      const date = new Date(year, monthIndex, day, 12);
      const key = dateKey(date);
      const festival = festivalFor(date);
      const appCount = applied.get(key)?.length ?? 0;
      const activityCount = activity.get(key)?.length ?? 0;
      const scanCount = scans.get(key)?.length ?? 0;
      const heat = Math.min(1, appCount * .35 + activityCount * .22 + scanCount * .13);
      const classes = ["signal-day", key === today ? "is-today" : "", festival ? "has-festival" : "", heat ? "has-signal" : ""].filter(Boolean).join(" ");
      const label = `${key}, ${festival?.name ?? "no festival"}, ${appCount} applications, ${activityCount} activities, ${scanCount} scans`;
      cells.push(`<button type="button" class="${classes}" data-calendar-date="${key}" style="--heat:${heat};--heat-alpha:${(heat * .26).toFixed(3)};${festival ? `--event-accent:${festival.accent}` : ""}" aria-label="${esc(label)}"><span>${day}</span>${festival ? `<b>${festival.mark}</b>` : ""}<i></i></button>`);
    }
    return `<article class="signal-month"><header><span>${String(monthIndex + 1).padStart(2, "0")}</span><div><b>${MONTHS_JA[monthIndex]}</b><small>${month}</small></div><em>${String([...activeDays].filter((key) => key.startsWith(`${year}-${String(monthIndex + 1).padStart(2, "0")}`)).length).padStart(2, "0")}</em></header><div class="weekday-row">${DAYS.map((day) => `<span>${day}</span>`).join("")}</div><div class="month-days">${cells.join("")}</div></article>`;
  }).join("");

  const selectedKey = today.startsWith(`${year}-`) ? today : `${year}-01-01`;
  el.innerHTML = `
    <section class="year-signal" aria-labelledby="year-signal-title">
      <header class="year-titlebar">
        <div><span>03</span><p lang="ja">年間信号</p><small id="year-signal-title">YEAR SIGNAL CALENDAR</small></div>
        <strong>${year}</strong>
        <button type="button" id="replay-opening"><b>再生</b><small>REPLAY DAILY TITLE</small></button>
      </header>
      <div class="year-intro"><p>365 DAYS. ONE CONTINUING ROAD.</p><div><span><i class="legend-festival"></i>FESTIVAL</span><span><i class="legend-application"></i>APPLICATION</span><span><i class="legend-activity"></i>ACTIVITY</span><span><i class="legend-today"></i>TODAY</span></div></div>
      <div class="year-layout">
        <div class="year-grid">${months}</div>
        <aside class="calendar-detail" aria-live="polite">${detailMarkup(selectedKey, applied.get(selectedKey) ?? [], activity.get(selectedKey) ?? [], scans.get(selectedKey) ?? [])}</aside>
      </div>
    </section>`;

  const detail = el.querySelector<HTMLElement>(".calendar-detail")!;
  el.querySelectorAll<HTMLButtonElement>("[data-calendar-date]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.calendarDate!;
    el.querySelectorAll(".signal-day.is-selected").forEach((day) => day.classList.remove("is-selected"));
    button.classList.add("is-selected");
    detail.innerHTML = detailMarkup(key, applied.get(key) ?? [], activity.get(key) ?? [], scans.get(key) ?? []);
  }));
  el.querySelector<HTMLButtonElement>(`[data-calendar-date="${selectedKey}"]`)?.classList.add("is-selected");
  el.querySelector("#replay-opening")!.addEventListener("click", replayOpening);
}
