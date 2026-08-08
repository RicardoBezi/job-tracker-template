export type SeasonKey = "winter" | "spring" | "summer" | "autumn";

type Season = {
  key: SeasonKey;
  ja: string;
  en: string;
  condition: string;
  hueOffset: number;
  paper: string;
};

const SEASONS: Record<SeasonKey, Season> = {
  winter: { key: "winter", ja: "冬", en: "WINTER", condition: "FROST SIGNAL", hueOffset: 14, paper: "#e9edf0" },
  spring: { key: "spring", ja: "春", en: "SPRING", condition: "BLOOM SIGNAL", hueOffset: -7, paper: "#f4ebe8" },
  summer: { key: "summer", ja: "夏", en: "SUMMER", condition: "HEAT SIGNAL", hueOffset: 8, paper: "#f2efdc" },
  autumn: { key: "autumn", ja: "秋", en: "AUTUMN", condition: "AMBER SIGNAL", hueOffset: -18, paper: "#eee5d6" },
};

const CHROMATIC_STOPS = [
  [0, 232], [0.18, 272], [0.27, 332], [0.36, 22], [0.5, 48],
  [0.65, 178], [0.76, 8], [0.84, 285], [1, 232],
] as const;

const STAGE_OFFSETS: Record<string, number> = {
  applied: 0,
  assessment: 12,
  interview: 38,
  "next-phase": -12,
  offer: 6,
  rejected: -24,
  withdrawn: 72,
  ghosted: 92,
};

const PHASES = [
  [0, "深夜", "MIDNIGHT"], [0.18, "夜明け前", "PRE-DAWN"], [0.27, "日の出", "SUNRISE"],
  [0.36, "朝", "MORNING"], [0.5, "正午", "HIGH NOON"], [0.65, "午後", "AFTERNOON"],
  [0.76, "夕暮れ", "SUNSET"], [0.84, "夜", "EVENING"],
] as const;

let currentStage = "applied";
let dataEnergy = 0.35;
let timer: number | undefined;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const normalizeHue = (value: number) => ((value % 360) + 360) % 360;

function interpolateHue(a: number, b: number, amount: number) {
  const delta = ((b - a + 540) % 360) - 180;
  return normalizeHue(a + delta * amount);
}

function chromaticHue(progress: number) {
  const nextIndex = CHROMATIC_STOPS.findIndex(([stop]) => stop >= progress);
  const endIndex = nextIndex <= 0 ? 1 : nextIndex;
  const [startAt, startHue] = CHROMATIC_STOPS[endIndex - 1];
  const [endAt, endHue] = CHROMATIC_STOPS[endIndex];
  return interpolateHue(startHue, endHue, (progress - startAt) / (endAt - startAt));
}

function hslToRgb(hue: number, saturation: number, lightness: number) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = hue / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r1, g1, b1] = sector < 1 ? [chroma, x, 0]
    : sector < 2 ? [x, chroma, 0]
      : sector < 3 ? [0, chroma, x]
        : sector < 4 ? [0, x, chroma]
          : sector < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const m = l - chroma / 2;
  return [r1, g1, b1].map((channel) => Math.round((channel + m) * 255));
}

export function seasonFor(date: Date): Season {
  const month = date.getMonth() + 1;
  if (month === 11 || month === 12 || month <= 2) return SEASONS.winter;
  if (month <= 5) return SEASONS.spring;
  if (month <= 8) return SEASONS.summer;
  return SEASONS.autumn;
}

export function environmentFor(date: Date, stage = "applied", energy = 0.35) {
  const seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  const dayProgress = seconds / 86400;
  const season = seasonFor(date);
  const hue = normalizeHue(chromaticHue(dayProgress) + season.hueOffset + (STAGE_OFFSETS[stage] ?? 0));
  const normalizedEnergy = clamp(energy);
  const saturation = Math.round(72 + normalizedEnergy * 16);
  const lightness = Math.round(48 + normalizedEnergy * 7);
  const rgb = hslToRgb(hue, saturation, lightness);
  const secondaryHue = normalizeHue(hue + 58);
  const phase = [...PHASES].reverse().find(([start]) => dayProgress >= start) ?? PHASES[0];
  const daylight = clamp(Math.sin((dayProgress - 0.25) * Math.PI * 2) * 0.5 + 0.5);

  return {
    season,
    phase: { ja: phase[1], en: phase[2] },
    dayProgress,
    daylight,
    hue,
    signal: `hsl(${hue.toFixed(1)} ${saturation}% ${lightness}%)`,
    signalRgb: rgb.join(", "),
    secondary: `hsl(${secondaryHue.toFixed(1)} ${Math.max(58, saturation - 8)}% ${Math.min(66, lightness + 6)}%)`,
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
    date: `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`,
  };
}

function renderEnvironment(now = new Date()) {
  const environment = environmentFor(now, currentStage, dataEnergy);
  const root = document.documentElement;
  root.dataset.season = environment.season.key;
  root.dataset.dayPhase = environment.phase.en.toLowerCase().replaceAll(" ", "-");
  root.style.setProperty("--signal", environment.signal);
  root.style.setProperty("--signal-rgb", environment.signalRgb);
  root.style.setProperty("--signal-secondary", environment.secondary);
  root.style.setProperty("--paper", environment.season.paper);
  root.style.setProperty("--void", `hsl(${environment.hue.toFixed(1)} 22% ${6 + environment.daylight * 2}%)`);
  root.style.setProperty("--void-soft", `hsl(${environment.hue.toFixed(1)} 18% ${9 + environment.daylight * 3}%)`);
  root.style.setProperty("--day-progress", `${(environment.dayProgress * 100).toFixed(3)}%`);
  root.style.setProperty("--daylight", environment.daylight.toFixed(3));
  root.style.setProperty("--data-energy", dataEnergy.toFixed(3));

  const time = document.getElementById("environment-time");
  const phase = document.getElementById("environment-phase");
  const season = document.getElementById("environment-season");
  const date = document.getElementById("environment-date");
  if (time) time.textContent = environment.time;
  if (phase) phase.textContent = `${environment.phase.ja} / ${environment.phase.en}`;
  if (season) season.textContent = `${environment.season.ja} / ${environment.season.en} · ${environment.season.condition}`;
  if (date) date.textContent = environment.date;
}

export function startEnvironment() {
  renderEnvironment();
  if (timer === undefined) timer = window.setInterval(() => renderEnvironment(), 30_000);
}

export function setEnvironmentStage(stage: string) {
  currentStage = stage;
  document.documentElement.dataset.signal = stage;
  renderEnvironment();
}

export function setEnvironmentData(applications: Array<{ status: string; ghosted?: boolean }>) {
  if (!applications.length) {
    dataEnergy = 0.18;
  } else {
    const weights: Record<string, number> = { applied: 0.15, assessment: 0.38, interview: 0.68, "next-phase": 0.82, offer: 1 };
    const active = applications.filter((app) => !["rejected", "withdrawn"].includes(app.status) && !app.ghosted);
    const momentum = active.reduce((sum, app) => sum + (weights[app.status] ?? 0.08), 0) / Math.max(1, active.length);
    dataEnergy = clamp(0.2 + Math.min(active.length / 55, 0.48) + momentum * 0.26, 0.18, 1);
  }
  renderEnvironment();
}
