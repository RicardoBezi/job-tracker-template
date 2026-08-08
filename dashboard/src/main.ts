import { login, logout, session } from "./api";
import { setEnvironmentStage, startEnvironment } from "./environment";
import { setupWeather } from "./weather";
import "./style.css";

const root = document.getElementById("app")!;
const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
}[char]!));

function loginView(message = "") {
  setEnvironmentStage("applied");
  root.innerHTML = `
    <section class="login-stage">
      <div class="login-poster" aria-labelledby="login-title">
        <div class="poster-atmosphere" aria-hidden="true"><i></i><i></i><b class="environment-glyph">道</b></div>
        <div class="poster-index">転職活動記録 <span>/ PRIVATE ARCHIVE</span></div>
        <div class="festival-stamp login-festival" hidden role="status"><span data-festival-region></span><b data-festival-native></b><small data-festival-name></small></div>
        <div class="login-grid">
          <div>
            <p class="edition">THE GOLDEN ROAD — 2026</p>
            <h1 id="login-title" data-text="GCN">GCN</h1>
            <p class="jp-title" lang="ja">「ゴールデン・ロード」は続く。</p>
            <p class="login-copy">Your career,<br />in motion.</p>
          </div>
          <div class="vertical-copy" lang="ja" aria-hidden="true">進捗記録</div>
        </div>
        <form id="login-form" class="login-form" novalidate>
          <label for="password"><span lang="ja">認証</span> / ACCESS PASSWORD</label>
          <div class="login-control">
            <input id="password" name="password" type="password" autocomplete="current-password" autofocus />
            <button type="submit">続ける <span>CONTINUE</span></button>
          </div>
          <p id="login-error" class="form-error" role="alert">${esc(message)}</p>
        </form>
        <div class="poster-foot"><span>PRIVATE SYSTEM</span><span>東京 / NEW YORK</span><span>NO. 001</span></div>
      </div>
    </section>`;

  startEnvironment();

  root.querySelector<HTMLFormElement>("#login-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = root.querySelector<HTMLInputElement>("#password")!;
    const button = root.querySelector<HTMLButtonElement>("button[type=submit]")!;
    const error = root.querySelector<HTMLElement>("#login-error")!;
    if (!input.value) { error.textContent = "パスワードを入力してください。 / Enter your password."; return; }
    button.disabled = true;
    button.innerHTML = `確認中 <span>CHECKING</span>`;
    try {
      await login(input.value);
      await appView();
    } catch (reason) {
      button.disabled = false;
      button.innerHTML = `続ける <span>CONTINUE</span>`;
      error.textContent = reason instanceof Error ? reason.message : "Login failed";
      input.select();
    }
  });
}

async function appView() {
  setEnvironmentStage("applied");
  root.innerHTML = `
    <div class="weather-layer" aria-hidden="true"></div>
    <div class="site-shell">
      <div class="utility-bar">
        <span lang="ja">転職活動記録</span><span>/ PRIVATE ARCHIVE / ${new Date().getFullYear()}</span>
        <div class="environment-readout" aria-label="Local time and seasonal atmosphere">
          <time id="environment-time">--:--</time>
          <span id="environment-phase">現在時刻 / LOCAL TIME</span>
          <span id="environment-season">季節 / SEASON</span>
          <small id="environment-date">----.--.--</small>
        </div>
        <button class="weather-toggle" id="weather-toggle" type="button" aria-pressed="false" title="Use approximate browser location for current weather. Coordinates are not stored.">
          <i id="weather-mark">◎</i><span id="weather-label">天候 / AMBIENT</span><small id="weather-detail">ENABLE LOCAL WEATHER</small>
        </button>
        <span class="online"><i></i> ONLINE</span>
      </div>
      <div class="signal-ticker" aria-label="The Golden Road campaign message">
        <div>
          <span>THE GOLDEN ROAD</span><i>◆</i><span lang="ja">ゴールデン・ロードは続く</span><i>◆</i><span>LIVE PROGRESS ARCHIVE</span><i>◆</i>
          <span aria-hidden="true">THE GOLDEN ROAD</span><i aria-hidden="true">◆</i><span lang="ja" aria-hidden="true">ゴールデン・ロードは続く</span><i aria-hidden="true">◆</i><span aria-hidden="true">LIVE PROGRESS ARCHIVE</span><i aria-hidden="true">◆</i>
        </div>
      </div>
      <header class="campaign-head">
        <div class="campaign-atmosphere" aria-hidden="true"><b class="environment-glyph">道</b><i></i><i></i><i></i></div>
        <div class="identity">
          <p class="edition">THE GOLDEN ROAD / CURRENT SIGNAL</p>
          <h1 data-text="GCN">GCN</h1>
          <p lang="ja" class="campaign-line">「ゴールデン・ロード」は続く。</p>
          <p class="english-line">YOUR CAREER, IN MOTION.</p>
          <div class="festival-stamp" hidden role="status"><span data-festival-region></span><b data-festival-native></b><small data-festival-name></small></div>
        </div>
        <p class="vertical-copy" lang="ja" aria-hidden="true">進捗記録</p>
        <section class="hero-focus" aria-label="Featured active application">
          <div class="hero-focus-top"><span>注目記録 / FEATURED RECORD</span><b id="hero-record">NO. —</b></div>
          <strong id="hero-company">LOADING SIGNAL</strong>
          <p id="hero-role">Retrieving the latest active route.</p>
          <footer><span id="hero-stage">CURRENT STAGE —</span><i></i><small>LIVE</small></footer>
        </section>
        <div class="hero-stats" aria-label="Application summary">
          <div><strong id="metric-all">—</strong><span>APPLICATIONS</span><small lang="ja">応募総数</small></div>
          <div><strong id="metric-interview">—</strong><span>INTERVIEWS</span><small lang="ja">面接</small></div>
          <div><strong id="metric-offer">—</strong><span>OFFERS</span><small lang="ja">内定</small></div>
        </div>
        <div class="road" aria-hidden="true"><span></span><i></i><i></i><i></i><i></i><i></i></div>
      </header>
      <nav class="primary-nav" aria-label="Main navigation">
        <button class="active" data-tab="apps"><b>01</b><span lang="ja">応募一覧</span><small>APPLICATIONS</small></button>
        <button data-tab="map"><b>02</b><span lang="ja">黄金経路</span><small>ROAD MAP</small></button>
        <button data-tab="calendar"><b>03</b><span lang="ja">年間信号</span><small>YEAR SIGNAL</small></button>
        <button data-tab="history"><b>04</b><span lang="ja">実行履歴</span><small>SCAN HISTORY</small></button>
        <button class="sign-out" id="sign-out"><span lang="ja">退出</span><small>SIGN OUT</small></button>
      </nav>
      <main class="content-frame">
        <section id="tab-apps"></section>
        <section id="tab-map" hidden></section>
        <section id="tab-calendar" hidden></section>
        <section id="tab-history" hidden></section>
      </main>
      <footer class="site-foot"><span>GCN / PERSONAL CAREER ARCHIVE</span><span lang="ja">道は、まだ続いている。</span></footer>
    </div>`;

  startEnvironment();
  setupWeather();

  const appsEl = root.querySelector<HTMLElement>("#tab-apps")!;
  const mapEl = root.querySelector<HTMLElement>("#tab-map")!;
  const calendarEl = root.querySelector<HTMLElement>("#tab-calendar")!;
  const historyEl = root.querySelector<HTMLElement>("#tab-history")!;
  const { renderApps } = await import("./apps-view");
  const initialApps = await renderApps(appsEl) ?? [];

  const showTab = async (tab: string) => {
    root.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", (item as HTMLElement).dataset.tab === tab));
    appsEl.hidden = tab !== "apps";
    mapEl.hidden = tab !== "map";
    calendarEl.hidden = tab !== "calendar";
    historyEl.hidden = tab !== "history";
    if (tab === "map" && mapEl.dataset.ready !== "true") {
      mapEl.dataset.ready = "true";
      const { renderMap } = await import("./map-view");
      await renderMap(mapEl, async (id) => {
        await showTab("apps");
        appsEl.dispatchEvent(new CustomEvent("gcn:open-application", { detail: { id } }));
      });
    }
    if (tab === "calendar" && calendarEl.dataset.ready !== "true") {
      calendarEl.dataset.ready = "true";
      const [{ renderCalendar }, { playDailyOpening }] = await Promise.all([import("./calendar-view"), import("./cinematic")]);
      await renderCalendar(calendarEl, () => void playDailyOpening(initialApps, true));
    }
    if (tab === "history" && historyEl.dataset.ready !== "true") {
      historyEl.dataset.ready = "true";
      const { renderHistory } = await import("./history-view");
      await renderHistory(historyEl);
    }
  };

  root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => void showTab(button.dataset.tab!));
  });

  root.querySelector("#sign-out")!.addEventListener("click", async () => {
    await logout().catch(() => undefined);
    loginView();
  });

  void (async () => {
    const { captureTransmissionArrivals, playDailyOpening, playTransmissionArrivals } = await import("./cinematic");
    const arrivals = captureTransmissionArrivals(initialApps);
    await playDailyOpening(initialApps);
    await playTransmissionArrivals(arrivals);
  })();
}

async function boot() {
  root.innerHTML = `<div class="boot"><span>GCN</span><i></i><p>読み込み中 / LOADING</p></div>`;
  try {
    const state = await session();
    state.authenticated ? await appView() : loginView();
  } catch {
    loginView("Service unavailable. Check the hosted API configuration.");
  }
}

window.addEventListener("gcn:unauthorized", () => loginView("Session expired. Please sign in again."));
startEnvironment();
boot();
