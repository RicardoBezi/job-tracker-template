import type { SeasonKey } from "./environment";

export type DayGlyph = {
  glyph: string;
  slot: "00–06" | "06–12" | "12–18" | "18–24";
  reading: string;
};

export type Festival = {
  key: string;
  start: string;
  end?: string;
  region: "JP" | "CN" | "JP · CN";
  mark: string;
  native: string;
  name: string;
  tone: "new-year" | "passage" | "folklore" | "romance" | "lantern" | "remembrance" | "journey" | "stars" | "harvest" | "national" | "night" | "commerce" | "winter";
  accent: string;
};

const GLYPHS: Record<SeasonKey, readonly [string, string, string, string]> = {
  winter: ["月", "霜", "冬", "雪"],
  spring: ["夢", "露", "桜", "花"],
  summer: ["星", "朝", "夏", "祭"],
  autumn: ["宵", "風", "秋", "紅"],
};

const SLOTS = ["00–06", "06–12", "12–18", "18–24"] as const;
const READINGS = ["NIGHT WATCH", "FIRST LIGHT", "DAY SIGNAL", "EVENING SIGNAL"] as const;

// Ordered by priority: a specific day wins over the longer period surrounding it.
export const FESTIVALS: readonly Festival[] = [
  { key: "hatsumode-2027", start: "2027-01-01", region: "JP", mark: "初", native: "初詣", name: "HATSUMŌDE", tone: "new-year", accent: "#ef3b2d" },
  { key: "shogatsu", start: "2026-01-01", end: "2026-01-03", region: "JP · CN", mark: "初", native: "正月 · 元旦", name: "SHŌGATSU / NEW YEAR", tone: "new-year", accent: "#ef3b2d" },
  { key: "seijin", start: "2026-01-12", region: "JP", mark: "成", native: "成人の日", name: "COMING OF AGE", tone: "passage", accent: "#d8a829" },
  { key: "setsubun", start: "2026-02-03", region: "JP", mark: "鬼", native: "節分", name: "SETSUBUN", tone: "folklore", accent: "#e9472f" },
  { key: "valentine", start: "2026-02-14", region: "JP · CN", mark: "愛", native: "バレンタイン", name: "VALENTINE'S DAY", tone: "romance", accent: "#ff3e83" },
  { key: "cny-eve", start: "2026-02-16", region: "CN", mark: "福", native: "除夕", name: "SPRING FESTIVAL EVE", tone: "new-year", accent: "#f0261b" },
  { key: "cny-day", start: "2026-02-17", region: "CN", mark: "春", native: "春节", name: "LUNAR NEW YEAR", tone: "new-year", accent: "#f0261b" },
  { key: "spring-festival", start: "2026-02-15", end: "2026-02-23", region: "CN", mark: "春", native: "春节假期", name: "SPRING FESTIVAL", tone: "lantern", accent: "#f33a20" },
  { key: "hina-lantern", start: "2026-03-03", region: "JP · CN", mark: "灯", native: "雛祭り · 元宵節", name: "HINA + LANTERN FESTIVAL", tone: "lantern", accent: "#f05e9c" },
  { key: "white-day", start: "2026-03-14", region: "JP", mark: "白", native: "ホワイトデー", name: "WHITE DAY", tone: "romance", accent: "#8dd9e8" },
  { key: "qingming", start: "2026-04-04", end: "2026-04-06", region: "CN", mark: "清", native: "清明节", name: "QINGMING", tone: "remembrance", accent: "#54a36a" },
  { key: "childrens-day", start: "2026-05-05", region: "JP", mark: "童", native: "こどもの日", name: "CHILDREN'S DAY", tone: "journey", accent: "#31a9db" },
  { key: "golden-week", start: "2026-04-29", end: "2026-05-06", region: "JP", mark: "金", native: "ゴールデンウィーク", name: "GOLDEN WEEK", tone: "journey", accent: "#e8b72f" },
  { key: "five-twenty", start: "2026-05-20", region: "CN", mark: "愛", native: "五二零", name: "520 DAY", tone: "romance", accent: "#ff526f" },
  { key: "dragon-boat", start: "2026-06-19", end: "2026-06-21", region: "CN", mark: "龍", native: "端午节", name: "DRAGON BOAT FESTIVAL", tone: "journey", accent: "#25a884" },
  { key: "tanabata", start: "2026-07-07", region: "JP", mark: "星", native: "七夕", name: "TANABATA", tone: "stars", accent: "#6b65e8" },
  { key: "obon", start: "2026-08-13", end: "2026-08-16", region: "JP", mark: "盆", native: "お盆", name: "OBON", tone: "lantern", accent: "#ff7347" },
  { key: "qixi", start: "2026-08-19", region: "CN", mark: "七", native: "七夕节", name: "QIXI FESTIVAL", tone: "stars", accent: "#9f65e8" },
  { key: "silver-week", start: "2026-09-19", end: "2026-09-23", region: "JP", mark: "銀", native: "シルバーウィーク", name: "SILVER WEEK", tone: "journey", accent: "#aebbc9" },
  { key: "mid-autumn", start: "2026-09-25", end: "2026-09-27", region: "CN", mark: "月", native: "中秋节", name: "MID-AUTUMN FESTIVAL", tone: "harvest", accent: "#f1b936" },
  { key: "national-week", start: "2026-10-01", end: "2026-10-07", region: "CN", mark: "国", native: "国庆节", name: "NATIONAL DAY GOLDEN WEEK", tone: "national", accent: "#f12b20" },
  { key: "halloween", start: "2026-10-31", region: "JP · CN", mark: "夜", native: "ハロウィン", name: "HALLOWEEN", tone: "night", accent: "#f47721" },
  { key: "singles-day", start: "2026-11-11", region: "CN", mark: "双", native: "双十一", name: "SINGLES' DAY", tone: "commerce", accent: "#e83c7b" },
  { key: "shichi-go-san", start: "2026-11-15", region: "JP", mark: "七", native: "七五三", name: "SHICHI-GO-SAN", tone: "passage", accent: "#e45c6c" },
  { key: "christmas-eve", start: "2026-12-24", region: "JP · CN", mark: "聖", native: "クリスマス・イブ", name: "CHRISTMAS EVE", tone: "romance", accent: "#e9364f" },
  { key: "christmas", start: "2026-12-25", region: "JP · CN", mark: "雪", native: "クリスマス", name: "CHRISTMAS", tone: "winter", accent: "#3abf83" },
  { key: "omisoka", start: "2026-12-31", region: "JP · CN", mark: "除", native: "大晦日 · 跨年夜", name: "YEAR'S END", tone: "new-year", accent: "#e5bf48" },
];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function glyphFor(date: Date, season: SeasonKey): DayGlyph {
  const index = Math.floor(date.getHours() / 6);
  return { glyph: GLYPHS[season][index], slot: SLOTS[index], reading: READINGS[index] };
}

export function festivalFor(date: Date): Festival | null {
  const key = dateKey(date);
  return FESTIVALS.find((festival) => key >= festival.start && key <= (festival.end ?? festival.start)) ?? null;
}
