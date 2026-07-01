// Worker-URL des admin-worker.js (siehe README für Deploy-Anleitung).
const WORKER_URL = "https://landingpage.michel-brunner.workers.dev";

let visibilityState = {};
let currentPin = null;

function defaultVisibility() {
  const map = {};
  TOOLS.forEach((t) => { map[t.id] = { visible: true }; });
  return map;
}

async function fetchVisibility() {
  try {
    const resp = await fetch(WORKER_URL, { method: "GET" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    if (data && data.tools) return data.tools;
  } catch (e) {
    console.warn("Sichtbarkeits-Konfiguration nicht erreichbar, zeige alle Tools als sichtbar:", e);
  }
  return null;
}

// action "verify" prüft nur die PIN (tools bleibt weg), action "save" schreibt tools.
async function callAdminWorker(pin, tools) {
  let resp;
  try {
    resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tools ? { pin, tools } : { pin })
    });
  } catch (e) {
    throw new Error("Worker nicht erreichbar (noch nicht deployed?). Siehe README.");
  }
  if (resp.status === 401) throw new Error("Falsche PIN.");
  if (!resp.ok) throw new Error("Worker-Fehler (HTTP " + resp.status + ")");
  return resp.json();
}

function isVisible(toolId) {
  const entry = visibilityState[toolId];
  return !entry || entry.visible !== false;
}

function renderToolGrid() {
  const container = document.getElementById("tool-groups");
  container.innerHTML = "";

  const categories = [...new Set(TOOLS.map((t) => t.category))];
  let anyVisible = false;

  categories.forEach((category) => {
    const toolsInCategory = TOOLS.filter((t) => t.category === category && isVisible(t.id));
    if (toolsInCategory.length === 0) return;
    anyVisible = true;

    const group = document.createElement("div");
    group.className = "category-group";
    group.innerHTML = `<h2>${escapeHtml(category)}</h2>`;

    const grid = document.createElement("div");
    grid.className = "tool-grid";
    toolsInCategory.forEach((t) => {
      const card = document.createElement("a");
      card.className = "tool-card";
      card.href = t.url;
      card.target = "_blank";
      card.rel = "noopener";
      card.innerHTML = `
        <div class="tool-icon">${t.icon || "🔗"}</div>
        <h3>${escapeHtml(t.name)}</h3>
        <p>${escapeHtml(t.description || "")}</p>
      `;
      grid.appendChild(card);
    });

    group.appendChild(grid);
    container.appendChild(group);
  });

  document.getElementById("uebersicht-empty").style.display = anyVisible ? "none" : "block";
}

function renderVisibilityList() {
  const container = document.getElementById("visibility-list");
  container.innerHTML = "";
  TOOLS.forEach((t) => {
    const row = document.createElement("label");
    row.className = "visibility-row";
    row.innerHTML = `
      <span class="tool-icon">${t.icon || "🔗"}</span>
      <span class="vr-name">${escapeHtml(t.name)}</span>
      <span class="vr-category">${escapeHtml(t.category)}</span>
      <input type="checkbox" data-tool-id="${t.id}" ${isVisible(t.id) ? "checked" : ""} />
    `;
    container.appendChild(row);
  });
}

function renderChangelog() {
  const container = document.getElementById("changelog-list");
  container.innerHTML = APP_CHANGELOG.map((entry) => `
    <div class="changelog-entry">
      <span class="cv">v${entry.version}</span>
      ${entry.groups.map((g) => `
        <div class="changelog-group">
          <div class="cg-title">${escapeHtml(g.title)}</div>
          <ul class="cg-items">${g.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
        </div>
      `).join("")}
    </div>
  `).join("");
}

function setupTabs() {
  document.querySelectorAll("nav button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("nav button[data-tab]").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-section").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });
}

function setupPinForm() {
  document.getElementById("pin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = document.getElementById("admin-pin-input").value;
    const errorEl = document.getElementById("pin-error");
    errorEl.style.display = "none";
    try {
      const result = await callAdminWorker(pin);
      currentPin = pin;
      if (result && result.tools) visibilityState = result.tools;
      document.getElementById("admin-pin-gate").style.display = "none";
      document.getElementById("admin-visibility-panel").style.display = "block";
      renderVisibilityList();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });

  document.getElementById("btn-save-visibility").addEventListener("click", async () => {
    const tools = {};
    document.querySelectorAll("#visibility-list input[type=checkbox]").forEach((cb) => {
      tools[cb.dataset.toolId] = { visible: cb.checked };
    });
    const errorEl = document.getElementById("admin-save-error");
    const successEl = document.getElementById("admin-save-success");
    errorEl.style.display = "none";
    successEl.style.display = "none";
    try {
      await callAdminWorker(currentPin, tools);
      visibilityState = tools;
      renderToolGrid();
      successEl.style.display = "block";
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
      if (err.message === "Falsche PIN.") {
        currentPin = null;
        document.getElementById("admin-visibility-panel").style.display = "none";
        document.getElementById("admin-pin-gate").style.display = "block";
      }
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function init() {
  document.getElementById("version-badge").textContent = "v" + APP_VERSION;
  document.getElementById("version-badge-2").textContent = "v" + APP_VERSION;
  renderChangelog();
  setupTabs();
  setupPinForm();

  const remote = await fetchVisibility();
  visibilityState = remote || defaultVisibility();
  renderToolGrid();
}

init();
