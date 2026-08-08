export type WeatherKind = "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm";

type CurrentWeather = {
  temperature_2m: number;
  apparent_temperature: number;
  is_day: number;
  precipitation: number;
  rain: number;
  snowfall: number;
  weather_code: number;
  cloud_cover: number;
  wind_speed_10m: number;
};

type WeatherResponse = { current: CurrentWeather };

const STORAGE_KEY = "gcn-ambient-weather";
const LABELS: Record<WeatherKind, { ja: string; en: string; mark: string }> = {
  clear: { ja: "晴", en: "CLEAR", mark: "○" },
  cloudy: { ja: "曇", en: "CLOUD", mark: "◒" },
  fog: { ja: "霧", en: "FOG", mark: "≋" },
  rain: { ja: "雨", en: "RAIN", mark: "//" },
  snow: { ja: "雪", en: "SNOW", mark: "＊" },
  storm: { ja: "雷", en: "STORM", mark: "ϟ" },
};

let refreshTimer: number | undefined;
let lastPosition: { latitude: number; longitude: number } | null = null;

export function classifyWeather(code: number): WeatherKind {
  if (code === 0) return "clear";
  if (code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "rain";
}

function storedPreference() {
  try { return localStorage.getItem(STORAGE_KEY) === "on"; } catch { return false; }
}

function rememberPreference(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, "on");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function position(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Geolocation is unavailable")); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: Number(coords.latitude.toFixed(2)), longitude: Number(coords.longitude.toFixed(2)) }),
      (error) => reject(error),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 30 * 60_000 },
    );
  });
}

async function currentWeather(coords: { latitude: number; longitude: number }) {
  const current = "temperature_2m,apparent_temperature,is_day,precipitation,rain,snowfall,weather_code,cloud_cover,wind_speed_10m";
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(coords.latitude));
  url.searchParams.set("longitude", String(coords.longitude));
  url.searchParams.set("current", current);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather service returned ${response.status}`);
  return (await response.json() as WeatherResponse).current;
}

function control() {
  return {
    button: document.getElementById("weather-toggle") as HTMLButtonElement | null,
    mark: document.getElementById("weather-mark"),
    label: document.getElementById("weather-label"),
    detail: document.getElementById("weather-detail"),
  };
}

function clearWeather() {
  const root = document.documentElement;
  delete root.dataset.weather;
  delete root.dataset.weatherDay;
  delete root.dataset.weatherLive;
  root.style.removeProperty("--weather-intensity");
  root.style.removeProperty("--weather-wind");
  const ui = control();
  if (ui.button) {
    ui.button.classList.remove("is-live", "is-loading");
    ui.button.setAttribute("aria-pressed", "false");
    ui.button.title = "Use approximate browser location for current weather. Coordinates are not stored.";
  }
  if (ui.mark) ui.mark.textContent = "◎";
  if (ui.label) ui.label.textContent = "天候 / AMBIENT";
  if (ui.detail) ui.detail.textContent = "ENABLE LOCAL WEATHER";
}

function renderWeather(weather: CurrentWeather) {
  const kind = classifyWeather(weather.weather_code);
  const label = LABELS[kind];
  const precipitation = Math.max(weather.precipitation, weather.rain, weather.snowfall * 2);
  const base = kind === "clear" ? .2 : kind === "cloudy" ? weather.cloud_cover / 160 : kind === "fog" ? .65 : kind === "storm" ? .95 : .45;
  const intensity = Math.min(1, Math.max(.16, base + precipitation / 8));
  const root = document.documentElement;
  root.dataset.weather = kind;
  root.dataset.weatherDay = weather.is_day ? "day" : "night";
  root.dataset.weatherLive = "true";
  root.style.setProperty("--weather-intensity", intensity.toFixed(3));
  root.style.setProperty("--weather-wind", `${Math.min(42, Math.max(8, 52 - weather.wind_speed_10m))}s`);
  const ui = control();
  if (ui.button) {
    ui.button.classList.add("is-live");
    ui.button.classList.remove("is-loading");
    ui.button.setAttribute("aria-pressed", "true");
    ui.button.title = `Feels like ${Math.round(weather.apparent_temperature)}°C. Weather data by Open-Meteo. Click to turn off.`;
  }
  if (ui.mark) ui.mark.textContent = label.mark;
  if (ui.label) ui.label.textContent = `${label.ja} / ${label.en}`;
  if (ui.detail) ui.detail.textContent = `${Math.round(weather.temperature_2m)}°C · OPEN-METEO`;
}

async function enableWeather() {
  const ui = control();
  if (ui.button) ui.button.classList.add("is-loading");
  if (ui.label) ui.label.textContent = "現在地を確認中 / LOCATING";
  if (ui.detail) ui.detail.textContent = "LOCATION IS USED ONCE · NOT STORED";
  try {
    lastPosition = lastPosition ?? await position();
    renderWeather(await currentWeather(lastPosition));
    rememberPreference(true);
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(async () => {
      try { if (lastPosition) renderWeather(await currentWeather(lastPosition)); } catch {}
    }, 15 * 60_000);
  } catch (error) {
    rememberPreference(false);
    clearWeather();
    const failed = control();
    if (failed.label) failed.label.textContent = "天候取得不可 / UNAVAILABLE";
    if (failed.detail) failed.detail.textContent = error instanceof Error ? error.message.toUpperCase() : "LOCATION DENIED";
  }
}

export function setupWeather() {
  const ui = control();
  if (!ui.button) return;
  clearWeather();
  ui.button.addEventListener("click", () => {
    if (document.documentElement.dataset.weatherLive === "true") {
      rememberPreference(false);
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
      refreshTimer = undefined;
      clearWeather();
    } else {
      void enableWeather();
    }
  });
  if (storedPreference()) void enableWeather();
}
