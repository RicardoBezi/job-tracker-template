import { login, logout, session } from "./api";
import "./style.css";

const root = document.getElementById("app")!;
const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
}[char]!));

function loginView(message = "") {
  root.innerHTML = `
    <section class="login-stage">
      <div class="login-poster" aria-labelledby="login-title">
        <div class="poster-index">転職活動記録 <span>/ PRIVATE ARCHIVE</span></div>
        <div class="login-grid">
          <div>
            <p class="edition">GOLDEN CAREER NETWORK — 2026</p>
            <h1 id="login-title">GCN</h1>
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
  root.innerHTML = `
    <div class="site-shell">
      <div class="utility-bar">
        <span lang="ja">転職活動記録</span><span>/ PRIVATE ARCHIVE / ${new Date().getFullYear()}</span>
        <span class="online"><i></i> ONLINE</span>
      </div>
      <header class="campaign-head">
        <div class="identity">
          <p class="edition">GOLDEN CAREER NETWORK</p>
          <h1>GCN</h1>
          <p lang="ja" class="campaign-line">「ゴールデン・ロード」は続く。</p>
          <p class="english-line">YOUR CAREER, IN MOTION.</p>
        </div>
        <p class="vertical-copy" lang="ja" aria-hidden="true">進捗記録</p>
        <div class="hero-stats" aria-label="Application summary">
          <div><strong id="metric-all">—</strong><span>APPLICATIONS</span><small lang="ja">応募総数</small></div>
          <div><strong id="metric-interview">—</strong><span>INTERVIEWS</span><small lang="ja">面接</small></div>
          <div><strong id="metric-offer">—</strong><span>OFFERS</span><small lang="ja">内定</small></div>
        </div>
        <div class="road" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      </header>
      <nav class="primary-nav" aria-label="Main navigation">
        <button class="active" data-tab="apps"><b>01</b><span lang="ja">応募一覧</span><small>APPLICATIONS</small></button>
        <button data-tab="history"><b>02</b><span lang="ja">実行履歴</span><small>SCAN HISTORY</small></button>
        <button class="sign-out" id="sign-out"><span lang="ja">退出</span><small>SIGN OUT</small></button>
      </nav>
      <main class="content-frame">
        <section id="tab-apps"></section>
        <section id="tab-history" hidden></section>
      </main>
      <footer class="site-foot"><span>GCN / PERSONAL CAREER ARCHIVE</span><span lang="ja">道は、まだ続いている。</span></footer>
    </div>`;

  const appsEl = root.querySelector<HTMLElement>("#tab-apps")!;
  const historyEl = root.querySelector<HTMLElement>("#tab-history")!;
  const { renderApps } = await import("./apps-view");
  await renderApps(appsEl);

  root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      root.querySelectorAll("[data-tab]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const showApps = button.dataset.tab === "apps";
      appsEl.hidden = !showApps;
      historyEl.hidden = showApps;
      if (!showApps) {
        const { renderHistory } = await import("./history-view");
        await renderHistory(historyEl);
      }
    });
  });

  root.querySelector("#sign-out")!.addEventListener("click", async () => {
    await logout().catch(() => undefined);
    loginView();
  });
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
boot();
