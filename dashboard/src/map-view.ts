import { api } from "./api";
import { setEnvironmentStage } from "./environment";

type Status = "applied" | "assessment" | "interview" | "next-phase" | "offer" | "rejected" | "withdrawn";

interface Application {
  id: string;
  company: string;
  role: string | null;
  status: Status;
  applied_at: string | null;
  last_activity_at: string | null;
  ghosted: boolean;
  days_quiet: number | null;
}

type RouteKey = Status | "ghosted";

const STAGES: Array<{ key: Status; x: number; no: string; ja: string; en: string }> = [
  { key: "applied", x: 130, no: "01", ja: "出発", en: "DEPARTURE" },
  { key: "assessment", x: 365, no: "02", ja: "試練", en: "TRIAL" },
  { key: "interview", x: 600, no: "03", ja: "対話", en: "ENCOUNTER" },
  { key: "next-phase", x: 835, no: "04", ja: "上昇", en: "ASCENT" },
  { key: "offer", x: 1070, no: "05", ja: "黄金", en: "GOLDEN GATE" },
];

const LABELS: Record<RouteKey, { ja: string; en: string }> = {
  applied: { ja: "応募済", en: "APPLIED" },
  assessment: { ja: "課題中", en: "ASSESSMENT" },
  interview: { ja: "面接中", en: "INTERVIEW" },
  "next-phase": { ja: "次段階", en: "NEXT PHASE" },
  offer: { ja: "内定", en: "OFFER" },
  rejected: { ja: "不採用", en: "REJECTED" },
  withdrawn: { ja: "辞退", en: "WITHDRAWN" },
  ghosted: { ja: "静寂", en: "GONE QUIET" },
};

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
}[char]!));
const routeKey = (app: Application): RouteKey => app.ghosted ? "ghosted" : app.status;
const shortDate = (value: string | null) => value ? new Date(value).toISOString().slice(0, 10).replaceAll("-", ".") : "—";

function activeCoordinates(applications: Application[]) {
  const groups = new Map<Status, Application[]>();
  STAGES.forEach(({ key }) => groups.set(key, applications.filter((app) => routeKey(app) === key)));
  const maxRows = Math.max(1, ...[...groups.values()].map((apps) => Math.ceil(apps.length / 2)));
  const archive = applications.filter((app) => ["rejected", "withdrawn", "ghosted"].includes(routeKey(app)));
  const activeBottom = 230 + maxRows * 70;
  const archiveTop = activeBottom + 135;
  const archiveRows = Math.max(1, Math.ceil(archive.length / 5));
  const height = archiveTop + archiveRows * 72 + 130;

  const points = new Map<string, { x: number; y: number; archive: boolean }>();
  for (const stage of STAGES) {
    groups.get(stage.key)!.forEach((app, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      points.set(app.id, { x: stage.x + (column ? 56 : -56), y: 225 + row * 70, archive: false });
    });
  }
  archive.forEach((app, index) => {
    points.set(app.id, { x: 130 + (index % 5) * 235, y: archiveTop + 85 + Math.floor(index / 5) * 72, archive: true });
  });
  return { points, height, archiveTop, archive };
}

function featuredApplication(applications: Application[]) {
  const weight: Record<string, number> = { applied: 1, assessment: 2, interview: 3, "next-phase": 4, offer: 5 };
  return [...applications].filter((app) => !["rejected", "withdrawn"].includes(app.status) && !app.ghosted).sort((a, b) => {
    const stage = (weight[b.status] ?? 0) - (weight[a.status] ?? 0);
    if (stage) return stage;
    return new Date(b.last_activity_at ?? 0).getTime() - new Date(a.last_activity_at ?? 0).getTime();
  })[0] ?? applications[0] ?? null;
}

function selectionMarkup(app: Application) {
  const key = routeKey(app);
  const label = LABELS[key];
  return `
    <span><i></i>${label.ja} / ${label.en}</span>
    <strong>${esc(app.company)}</strong>
    <p>${esc(app.role ?? "役職未設定 / ROLE UNSET")}</p>
    <dl><div><dt>APPLIED</dt><dd>${shortDate(app.applied_at)}</dd></div><div><dt>LAST SIGNAL</dt><dd>${shortDate(app.last_activity_at)}</dd></div></dl>
    <button type="button" data-open-record="${esc(app.id)}"><b>記録を開く</b><small>OPEN DOSSIER ↗</small></button>`;
}

export async function renderMap(el: HTMLElement, onOpen: (id: string) => void) {
  el.innerHTML = `<div class="section-loading"><i></i><span>経路を構築中 / BUILDING THE GOLDEN ROAD</span></div>`;
  let applications: Application[];
  try {
    ({ applications } = await api<{ applications: Application[] }>("/applications"));
  } catch (error) {
    el.innerHTML = `<div class="error-panel"><b>地図接続エラー / MAP CONNECTION ERROR</b><p>${esc(error instanceof Error ? error.message : error)}</p></div>`;
    return;
  }

  const { points, height, archiveTop, archive } = activeCoordinates(applications);
  const featured = featuredApplication(applications);
  const activeCount = applications.length - archive.length;
  const routePaths = applications.map((app) => {
    const point = points.get(app.id)!;
    if (point.archive) return `<path class="map-branch map-branch-archive" d="M600 130 C600 ${archiveTop - 65}, ${point.x} ${archiveTop - 45}, ${point.x} ${point.y}" />`;
    const stage = STAGES.find((item) => item.key === app.status)!;
    return `<path class="map-branch" data-route-status="${app.status}" d="M${stage.x} 132 C${stage.x} ${point.y - 46}, ${point.x} ${point.y - 38}, ${point.x} ${point.y}" />`;
  }).join("");

  el.innerHTML = `
    <section class="map-section" aria-labelledby="map-title">
      <header class="map-titlebar">
        <div><span>02</span><p lang="ja">黄金経路</p><small id="map-title">THE GOLDEN ROAD MAP</small></div>
        <div class="map-live"><i></i><span>ROUTE LIVE</span><b>${String(activeCount).padStart(2, "0")}</b><small>ACTIVE SIGNALS</small></div>
      </header>
      <div class="map-broadcast">
        <div><b>進路を選べ。</b><strong>CHOOSE YOUR ROUTE.</strong></div>
        <p>Every application is a station. Every response changes the road.</p>
        <div class="map-legend">${STAGES.map((stage) => `<span data-legend="${stage.key}"><i></i>${stage.no} ${stage.en}</span>`).join("")}<span data-legend="archive"><i></i>× ARCHIVE</span></div>
      </div>
      <div class="route-map-frame">
        <div class="route-map-scroll" tabindex="0" aria-label="Interactive application route map">
          <div class="route-map" style="--map-height:${height}px">
            <svg viewBox="0 0 1200 ${height}" preserveAspectRatio="none" aria-hidden="true">
              <path class="map-spine-shadow" d="M70 132 L250 132 L305 94 L485 94 L540 132 L720 132 L775 94 L955 94 L1010 132 L1140 132" />
              <path class="map-spine" d="M70 132 L250 132 L305 94 L485 94 L540 132 L720 132 L775 94 L955 94 L1010 132 L1140 132" />
              ${routePaths}
              <path class="map-archive-line" d="M600 132 L600 ${archiveTop - 28} L1120 ${archiveTop - 28}" />
            </svg>
            ${STAGES.map((stage) => `<div class="map-landmark" data-landmark="${stage.key}" style="--x:${stage.x}px"><span>${stage.no}</span><b>${stage.ja}</b><small>${stage.en}</small><i></i></div>`).join("")}
            <div class="map-archive-title" style="--archive-top:${archiveTop}px"><span>地下記録 / ARCHIVE UNDERGROUND</span><b>${String(archive.length).padStart(2, "0")}</b></div>
            ${applications.map((app, index) => {
              const point = points.get(app.id)!;
              const key = routeKey(app);
              return `<button type="button" class="map-node${app.id === featured?.id ? " is-selected" : ""}" data-map-id="${esc(app.id)}" data-status="${key}" style="--x:${point.x}px;--y:${point.y}px" aria-label="${esc(app.company)}, ${LABELS[key].en}">
                <i></i><span>${String(index + 1).padStart(2, "0")}</span><b>${esc(app.company)}</b><small>${LABELS[key].en}</small>
              </button>`;
            }).join("")}
          </div>
        </div>
        <aside class="map-selection" aria-live="polite">${featured ? selectionMarkup(featured) : `<strong>NO ACTIVE ROUTES</strong>`}</aside>
      </div>
    </section>`;

  const selection = el.querySelector<HTMLElement>(".map-selection")!;
  const select = (id: string) => {
    const app = applications.find((item) => item.id === id);
    if (!app) return;
    el.querySelectorAll(".map-node").forEach((node) => node.classList.toggle("is-selected", (node as HTMLElement).dataset.mapId === id));
    selection.innerHTML = selectionMarkup(app);
    setEnvironmentStage(routeKey(app));
  };
  el.querySelectorAll<HTMLButtonElement>(".map-node").forEach((node) => {
    node.addEventListener("pointerenter", () => select(node.dataset.mapId!));
    node.addEventListener("focus", () => select(node.dataset.mapId!));
    node.addEventListener("click", () => select(node.dataset.mapId!));
  });
  selection.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-open-record]");
    if (button) onOpen(button.dataset.openRecord!);
  });
}
