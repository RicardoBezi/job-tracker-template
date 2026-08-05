import { decryptSecrets, type Secrets } from "./crypto";
import { initDb } from "./db";
import "./style.css";

export let secrets: Secrets;

async function boot() {
  const app = document.getElementById("app")!;
  const blob = await (await fetch(import.meta.env.BASE_URL + "secrets.enc.json")).json();

  const cached = sessionStorage.getItem("jt_pw");
  if (cached) {
    try {
      secrets = await decryptSecrets(blob, cached);
      initDb(secrets.database_url);
      return render();
    } catch { sessionStorage.removeItem("jt_pw"); }
  }

  app.innerHTML = `
    <div class="login-stage">
      <div class="login-card">
        <div class="accent-bar"></div>
        <div class="login-body">
          <p class="kicker">Private</p>
          <h1>Job Tracker</h1>
          <p class="hint">Enter the password to continue.</p>
          <form id="gate" novalidate>
            <div class="field">
              <label for="pw">Password</label>
              <input type="password" id="pw" autocomplete="current-password" autofocus />
            </div>
            <button type="submit" class="btn-primary" id="go">Unlock</button>
            <p class="login-error" id="gate-err"></p>
          </form>
        </div>
      </div>
    </div>`;

  document.getElementById("gate")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = (document.getElementById("pw") as HTMLInputElement).value;
    const go = document.getElementById("go") as HTMLButtonElement;
    const err = document.getElementById("gate-err")!;
    if (!pw) { err.textContent = "Enter the password."; return; }
    go.disabled = true; go.textContent = "Checking…";
    try {
      secrets = await decryptSecrets(blob, pw);
      initDb(secrets.database_url);
      sessionStorage.setItem("jt_pw", pw);
      render();
    } catch {
      go.disabled = false; go.textContent = "Unlock";
      err.textContent = "That password doesn't match.";
    }
  });
}

async function render() {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="accent-bar"></div>
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <span class="brand-mark">Job Tracker</span>
          <span class="brand-sub">Application pipeline</span>
        </div>
        <nav class="tabs">
          <button data-tab="apps" class="active">Applications</button>
          <button data-tab="history">Scan history</button>
        </nav>
      </div>
    </header>
    <div class="wrap">
      <section id="tab-apps"></section>
      <section id="tab-history" hidden></section>
    </div>`;

  app.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      app.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const apps = b.dataset.tab === "apps";
      (document.getElementById("tab-apps") as HTMLElement).hidden = !apps;
      (document.getElementById("tab-history") as HTMLElement).hidden = apps;
    }));

  const { renderApps } = await import("./apps-view");
  const { renderHistory } = await import("./history-view");
  await renderApps(document.getElementById("tab-apps")!);
  await renderHistory(document.getElementById("tab-history")!);
}

boot();
