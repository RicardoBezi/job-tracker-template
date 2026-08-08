import { environmentFor } from "./environment";

export interface CinematicApplication {
  id: string;
  company: string;
  role: string | null;
  status: string;
  last_activity_at: string | null;
  last_email_id: string | null;
  source: string;
  ghosted: boolean;
}

export type TransmissionArrival = CinematicApplication & { arrival: "new" | "updated" };
export type TransmissionSnapshot = Record<string, string>;

const SNAPSHOT_KEY = "gcn-transmission-snapshot-v1";
const OPENING_PREFIX = "gcn-daily-opening-";
const STATUS_LABELS: Record<string, string> = {
  applied: "応募受信 / APPLICATION RECEIVED",
  assessment: "課題信号 / ASSESSMENT SIGNAL",
  interview: "面接招集 / INTERVIEW CALL",
  "next-phase": "次段階 / NEXT PHASE",
  offer: "黄金到達 / OFFER ARRIVED",
  rejected: "経路終了 / ROUTE CLOSED",
  withdrawn: "進路変更 / ROUTE WITHDRAWN",
  ghosted: "静寂信号 / GONE QUIET",
};

const SEASON_COPY: Record<string, { line: string; code: string }> = {
  winter: { line: "The road endures beneath the frost.", code: "COLD ROUTE / CLEAR WILL" },
  spring: { line: "Every signal begins in bloom.", code: "NEW ROUTE / FIRST LIGHT" },
  summer: { line: "Move while the signal burns bright.", code: "HIGH ENERGY / FORWARD" },
  autumn: { line: "Read the wind. Choose the next road.", code: "AMBER ROUTE / TRANSITION" },
};

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
}[char]!));

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fingerprint(app: CinematicApplication) {
  return `${app.last_email_id ?? "none"}|${app.status}|${app.ghosted ? "quiet" : "active"}`;
}

export function snapshotFor(applications: CinematicApplication[]): TransmissionSnapshot {
  return Object.fromEntries(applications.map((app) => [app.id, fingerprint(app)]));
}

export function diffTransmissionSnapshots(previous: TransmissionSnapshot | null, applications: CinematicApplication[]) {
  if (!previous) return [];
  return applications.filter((app) => previous[app.id] !== fingerprint(app)).map((app) => ({
    ...app,
    arrival: previous[app.id] ? "updated" as const : "new" as const,
  }));
}

export function captureTransmissionArrivals(applications: CinematicApplication[]) {
  let previous: TransmissionSnapshot | null = null;
  try { previous = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? "null") as TransmissionSnapshot | null; } catch {}
  const arrivals = diffTransmissionSnapshots(previous, applications);
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshotFor(applications))); } catch {}
  return arrivals;
}

function removeOverlay(element: HTMLElement, resolve: () => void) {
  element.classList.add("is-leaving");
  window.setTimeout(() => {
    element.remove();
    document.body.classList.remove("cinematic-lock");
    resolve();
  }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 360);
}

export function playDailyOpening(applications: CinematicApplication[], force = false) {
  const now = new Date();
  const key = `${OPENING_PREFIX}${localDateKey(now)}`;
  try { if (!force && localStorage.getItem(key) === "seen") return Promise.resolve(false); } catch {}
  try { localStorage.setItem(key, "seen"); } catch {}

  const environment = environmentFor(now);
  const active = applications.filter((app) => !["rejected", "withdrawn"].includes(app.status) && !app.ghosted).length;
  const offers = applications.filter((app) => app.status === "offer").length;
  const interviews = applications.filter((app) => app.status === "interview").length;
  const copy = SEASON_COPY[environment.season.key];
  const element = document.createElement("section");
  element.className = "daily-opening";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", "Daily GCN opening title");
  element.innerHTML = `
    <div class="opening-slice opening-slice-a"></div><div class="opening-slice opening-slice-b"></div>
    <div class="opening-kanji" aria-hidden="true">${environment.glyph.glyph}</div>
    <button type="button" class="opening-skip">SKIP <span>×</span></button>
    <div class="opening-index"><span>${environment.date}</span><span>${environment.time} / ${environment.phase.en}</span><span>GCN DAILY SIGNAL</span></div>
    <div class="opening-title">
      <p>${environment.season.ja} / ${environment.season.en} · ${copy.code}</p>
      <h1 data-text="GCN">GCN</h1>
      <strong>「ゴールデン・ロード」は続く。</strong>
      <small>${copy.line}</small>
    </div>
    <div class="opening-counts"><span><b>${String(active).padStart(2, "0")}</b>ACTIVE</span><span><b>${String(interviews).padStart(2, "0")}</b>INTERVIEWS</span><span><b>${String(offers).padStart(2, "0")}</b>OFFERS</span></div>
    ${environment.festival ? `<div class="opening-festival"><b>${environment.festival.mark}</b><span>${esc(environment.festival.native)}</span><small>${esc(environment.festival.name)}</small></div>` : ""}`;
  document.body.append(element);
  document.body.classList.add("cinematic-lock");

  return new Promise<boolean>((resolve) => {
    let closed = false;
    let timer = 0;
    const onKeydown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKeydown);
      window.clearTimeout(timer);
      removeOverlay(element, () => resolve(true));
    };
    const skip = element.querySelector<HTMLButtonElement>(".opening-skip")!;
    skip.addEventListener("click", close);
    document.addEventListener("keydown", onKeydown);
    skip.focus({ preventScroll: true });
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1800 : 4600;
    timer = window.setTimeout(close, duration);
  });
}

function arrivalMarkup(arrival: TransmissionArrival, index: number, total: number) {
  const status = arrival.ghosted ? "ghosted" : arrival.status;
  return `
    <div class="transmission-sequence"><span>${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span><i></i><b>${arrival.arrival === "new" ? "NEW ROUTE" : "ROUTE UPDATE"}</b></div>
    <div class="transmission-copy"><small>受信完了 / INCOMING TRANSMISSION</small><strong>${esc(arrival.company)}</strong><p>${esc(arrival.role ?? "ROLE UNSET")}</p></div>
    <div class="transmission-status"><span>${STATUS_LABELS[status] ?? status.toUpperCase()}</span><b>${arrival.source === "email" ? "EMAIL SIGNAL" : "MANUAL SIGNAL"}</b></div>`;
}

export function playTransmissionArrivals(arrivals: TransmissionArrival[]) {
  if (!arrivals.length) return Promise.resolve(false);
  const queue = arrivals.slice(0, 8);
  const element = document.createElement("section");
  element.className = "transmission-arrival";
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.innerHTML = `<button type="button" class="transmission-close" aria-label="Dismiss transmissions">×</button><div class="transmission-body">${arrivalMarkup(queue[0], 0, queue.length)}</div>`;
  document.body.append(element);

  return new Promise<boolean>((resolve) => {
    let index = 0;
    let closed = false;
    let timer: number;
    const onKeydown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKeydown);
      window.clearTimeout(timer);
      removeOverlay(element, () => resolve(true));
    };
    const advance = () => {
      index += 1;
      if (index >= queue.length) { close(); return; }
      const body = element.querySelector<HTMLElement>(".transmission-body")!;
      body.classList.add("is-switching");
      window.setTimeout(() => { body.innerHTML = arrivalMarkup(queue[index], index, queue.length); body.classList.remove("is-switching"); }, 180);
      timer = window.setTimeout(advance, 2300);
    };
    const dismiss = element.querySelector<HTMLButtonElement>(".transmission-close")!;
    dismiss.addEventListener("click", close);
    document.addEventListener("keydown", onKeydown);
    dismiss.focus({ preventScroll: true });
    timer = window.setTimeout(advance, 2600);
  });
}
