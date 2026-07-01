// Worker-URL des admin-worker.js (siehe README für Deploy-Anleitung).
const WORKER_URL = "https://landingpage.michel-brunner.workers.dev";
const TOKEN_STORAGE_KEY = "tu_session_token";

let visibilityState = {};
let bootstrapAvailable = false;
let currentToken = null;
let currentUser = null; // { username, isAdmin, groupIds } oder null
let pendingFirstLoginUsername = null;
let groupsState = [];
let usersState = [];

function defaultVisibility() {
  const map = {};
  TOOLS.forEach((t) => { map[t.id] = { visible: true, loginRequired: false, groupIds: [] }; });
  return map;
}

async function fetchVisibility() {
  try {
    const resp = await fetch(WORKER_URL, { method: "GET" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json();
  } catch (e) {
    console.warn("Sichtbarkeits-Konfiguration nicht erreichbar, zeige alle Tools als sichtbar:", e);
    return null;
  }
}

async function callWorker(action, payload) {
  let resp;
  try {
    const headers = { "Content-Type": "application/json" };
    if (currentToken) headers["Authorization"] = "Bearer " + currentToken;
    resp = await fetch(WORKER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, ...payload })
    });
  } catch (e) {
    throw new Error("Worker nicht erreichbar (noch nicht deployed?). Siehe README.");
  }
  let data = null;
  try { data = await resp.json(); } catch (_) { /* kein JSON-Body */ }
  if (!resp.ok) {
    throw new Error((data && data.error) || ("Worker-Fehler (HTTP " + resp.status + ")"));
  }
  return data;
}

function loadStoredToken() {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY); } catch (_) { return null; }
}

function storeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch (_) { /* localStorage nicht verfügbar */ }
}

async function checkSession() {
  const token = loadStoredToken();
  if (!token) return;
  currentToken = token;
  try {
    const data = await callWorker("me", {});
    currentUser = { username: data.username, isAdmin: !!data.isAdmin, groupIds: data.groupIds || [] };
  } catch (e) {
    currentToken = null;
    currentUser = null;
    storeToken(null);
  }
}

async function login(username, password) {
  const data = await callWorker("login", { username, password });
  if (data.needsPasswordSetup) {
    pendingFirstLoginUsername = username;
    return { needsPasswordSetup: true };
  }
  currentToken = data.token;
  currentUser = { username: data.username, isAdmin: !!data.isAdmin, groupIds: data.groupIds || [] };
  storeToken(currentToken);
  return { success: true };
}

async function setFirstPassword(username, password) {
  const data = await callWorker("set-password", { username, password });
  currentToken = data.token;
  currentUser = { username: data.username, isAdmin: !!data.isAdmin, groupIds: data.groupIds || [] };
  storeToken(currentToken);
  pendingFirstLoginUsername = null;
}

async function bootstrapAdmin(username, password) {
  const data = await callWorker("bootstrap-admin", { username, password });
  currentToken = data.token;
  currentUser = { username: data.username, isAdmin: !!data.isAdmin, groupIds: data.groupIds || [] };
  storeToken(currentToken);
  bootstrapAvailable = false;
}

function logout() {
  currentToken = null;
  currentUser = null;
  storeToken(null);
  renderAdminPanels();
  renderToolGrid();
}

async function loadAndRenderUsers() {
  const errorEl = document.getElementById("users-error");
  errorEl.style.display = "none";
  try {
    const data = await callWorker("list-users", {});
    usersState = data.users;
    renderUsersList(usersState);
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  }
}

function renderUsersList(users) {
  const container = document.getElementById("users-list");
  container.innerHTML = "";
  users.forEach((u) => {
    const groupNames = (u.groupIds || []).map((gid) => {
      const g = groupsState.find((gr) => gr.id === gid);
      return g ? g.name : gid;
    });
    const row = document.createElement("div");
    row.className = "user-row";
    row.innerHTML = `
      <span class="ur-name">${escapeHtml(u.displayName || u.username)}</span>
      <span class="muted">(${escapeHtml(u.username)})</span>
      ${u.isAdmin ? '<span class="badge-admin">Admin</span>' : ""}
      ${u.mustSetPassword ? '<span class="badge-warning">Passwort nicht gesetzt</span>' : ""}
      ${groupNames.map((n) => `<span class="group-chip">${escapeHtml(n)}</span>`).join("")}
      <button type="button" class="btn secondary small" data-reset-user="${escapeHtml(u.username)}">Passwort zurücksetzen</button>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll("[data-reset-user]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const errorEl = document.getElementById("users-error");
      errorEl.style.display = "none";
      try {
        await callWorker("reset-password", { username: btn.dataset.resetUser });
        await loadAndRenderUsers();
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = "block";
      }
    });
  });
}

async function loadAndRenderGroups() {
  const errorEl = document.getElementById("groups-error");
  errorEl.style.display = "none";
  try {
    const data = await callWorker("list-groups", {});
    groupsState = data.groups;
    renderGroupsList();
    renderGroupCheckboxes(document.getElementById("new-user-groups"), []);
    renderGroupCheckboxes(document.getElementById("bulk-import-groups"), []);
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  }
}

function renderGroupCheckboxes(container, selectedIds) {
  if (!container) return;
  container.innerHTML = "";
  if (groupsState.length === 0) {
    container.innerHTML = '<span class="muted">Keine Gruppen vorhanden.</span>';
    return;
  }
  groupsState.forEach((g) => {
    const label = document.createElement("label");
    label.className = "checkbox-label";
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(g.id)}" ${selectedIds && selectedIds.includes(g.id) ? "checked" : ""} /> ${escapeHtml(g.name)}`;
    container.appendChild(label);
  });
}

function getCheckedValues(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
}

function renderGroupsList() {
  const container = document.getElementById("groups-list");
  container.innerHTML = "";
  if (groupsState.length === 0) {
    container.innerHTML = '<p class="muted">Noch keine Gruppen angelegt.</p>';
    return;
  }
  groupsState.forEach((g) => {
    const row = document.createElement("div");
    row.className = "group-row";
    row.dataset.groupId = g.id;
    row.innerHTML = `
      <div class="gr-header">
        <span class="gr-name">${escapeHtml(g.name)}</span>
        <span class="muted">${g.memberUsernames.length} Mitglied(er)</span>
        <button type="button" class="btn secondary small" data-toggle-members="${escapeHtml(g.id)}">Mitglieder</button>
        <button type="button" class="btn secondary small" data-delete-group="${escapeHtml(g.id)}">Löschen</button>
      </div>
      <div class="gr-members" data-members-for="${escapeHtml(g.id)}" style="display:none;"></div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll("[data-toggle-members]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const groupId = btn.dataset.toggleMembers;
      const membersEl = row_findMembersEl(container, groupId);
      const isOpen = membersEl.style.display !== "none";
      if (isOpen) {
        membersEl.style.display = "none";
        return;
      }
      const group = groupsState.find((g) => g.id === groupId);
      membersEl.innerHTML = `
        <div class="group-picker">
          ${usersState.map((u) => `
            <label class="checkbox-label">
              <input type="checkbox" value="${escapeHtml(u.username)}" ${group.memberUsernames.includes(u.username) ? "checked" : ""} />
              ${escapeHtml(u.displayName || u.username)}
            </label>
          `).join("")}
        </div>
        <button type="button" class="btn small" data-save-members="${escapeHtml(groupId)}">Speichern</button>
      `;
      membersEl.style.display = "block";
      membersEl.querySelector("[data-save-members]").addEventListener("click", async () => {
        const memberUsernames = getCheckedValues(membersEl.querySelector(".group-picker"));
        const errorEl = document.getElementById("groups-error");
        errorEl.style.display = "none";
        try {
          await callWorker("update-group-members", { groupId, memberUsernames });
          await loadAndRenderGroups();
          await loadAndRenderUsers();
        } catch (e) {
          errorEl.textContent = e.message;
          errorEl.style.display = "block";
        }
      });
    });
  });

  container.querySelectorAll("[data-delete-group]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".group-row");
      const name = row.querySelector(".gr-name").textContent;
      if (!confirm(`Gruppe "${name}" wirklich löschen?`)) return;
      const errorEl = document.getElementById("groups-error");
      errorEl.style.display = "none";
      try {
        await callWorker("delete-group", { groupId: btn.dataset.deleteGroup });
        await loadAndRenderGroups();
        await loadAndRenderUsers();
        renderVisibilityList();
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = "block";
      }
    });
  });
}

function row_findMembersEl(container, groupId) {
  return Array.from(container.querySelectorAll("[data-members-for]")).find((el) => el.dataset.membersFor === groupId);
}

function isVisibleToUser(toolId, user) {
  const entry = visibilityState[toolId] || {};
  if (entry.visible === false) return false;
  if (!entry.loginRequired) return true;
  if (!user) return false;
  if (user.isAdmin) return true;
  const groupIds = entry.groupIds || [];
  if (groupIds.length === 0) return true;
  return groupIds.some((gid) => (user.groupIds || []).includes(gid));
}

function renderToolGrid() {
  const container = document.getElementById("tool-groups");
  container.innerHTML = "";

  const categories = [...new Set(TOOLS.map((t) => t.category))];
  let anyVisible = false;

  categories.forEach((category) => {
    const toolsInCategory = TOOLS.filter((t) => t.category === category && isVisibleToUser(t.id, currentUser));
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
    const entry = visibilityState[t.id] || {};
    const visible = entry.visible !== false;
    const loginRequired = !!entry.loginRequired;
    const groupIds = entry.groupIds || [];
    const row = document.createElement("div");
    row.className = "visibility-row";
    row.dataset.toolId = t.id;
    row.innerHTML = `
      <span class="tool-icon">${t.icon || "🔗"}</span>
      <span class="vr-name">${escapeHtml(t.name)}</span>
      <span class="vr-category">${escapeHtml(t.category)}</span>
      <label class="checkbox-label" style="margin-right:6px;"><input type="checkbox" data-field="visible" ${visible ? "checked" : ""} /> sichtbar</label>
      <label class="checkbox-label"><input type="checkbox" data-field="loginRequired" ${loginRequired ? "checked" : ""} /> nur eingeloggt</label>
      <div class="group-picker" data-field="groupIds" style="display:${loginRequired ? "flex" : "none"};"></div>
    `;
    container.appendChild(row);

    const groupPicker = row.querySelector('[data-field="groupIds"]');
    renderGroupCheckboxes(groupPicker, groupIds);

    const loginCheckbox = row.querySelector('[data-field="loginRequired"]');
    loginCheckbox.addEventListener("change", () => {
      groupPicker.style.display = loginCheckbox.checked ? "flex" : "none";
    });
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

function renderAdminPanels() {
  document.getElementById("admin-bootstrap-panel").style.display = "none";
  document.getElementById("admin-login-gate").style.display = "none";
  document.getElementById("first-login-panel").style.display = "none";
  document.getElementById("admin-logged-in-panel").style.display = "none";
  document.getElementById("admin-users-panel").style.display = "none";
  document.getElementById("admin-bulk-import-panel").style.display = "none";
  document.getElementById("admin-groups-panel").style.display = "none";
  document.getElementById("admin-visibility-panel").style.display = "none";

  if (currentUser) {
    document.getElementById("logged-in-username").textContent = currentUser.username;
    document.getElementById("admin-logged-in-panel").style.display = "block";
    if (currentUser.isAdmin) {
      document.getElementById("admin-users-panel").style.display = "block";
      document.getElementById("admin-bulk-import-panel").style.display = "block";
      document.getElementById("admin-groups-panel").style.display = "block";
      document.getElementById("admin-visibility-panel").style.display = "block";
    }
    return;
  }
  if (pendingFirstLoginUsername) {
    document.getElementById("first-login-username").textContent = pendingFirstLoginUsername;
    document.getElementById("first-login-panel").style.display = "block";
    return;
  }
  if (bootstrapAvailable) {
    document.getElementById("admin-bootstrap-panel").style.display = "block";
    return;
  }
  document.getElementById("admin-login-gate").style.display = "block";
}

async function afterAuthChange() {
  renderAdminPanels();
  renderToolGrid();
  if (currentUser && currentUser.isAdmin) {
    await loadAndRenderGroups();
    await loadAndRenderUsers();
    renderVisibilityList();
  }
}

function setupAuthForms() {
  document.getElementById("bootstrap-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("bootstrap-username").value;
    const password = document.getElementById("bootstrap-password").value;
    const errorEl = document.getElementById("bootstrap-error");
    errorEl.style.display = "none";
    try {
      await bootstrapAdmin(username, password);
      await afterAuthChange();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;
    const errorEl = document.getElementById("login-error");
    errorEl.style.display = "none";
    try {
      const result = await login(username, password);
      if (result.needsPasswordSetup) {
        renderAdminPanels();
      } else {
        await afterAuthChange();
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });

  document.getElementById("first-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("first-login-password").value;
    const errorEl = document.getElementById("first-login-error");
    errorEl.style.display = "none";
    try {
      await setFirstPassword(pendingFirstLoginUsername, password);
      await afterAuthChange();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });

  document.getElementById("btn-logout").addEventListener("click", () => {
    logout();
  });

  document.getElementById("create-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const vorname = document.getElementById("new-user-vorname").value;
    const nachname = document.getElementById("new-user-nachname").value;
    const isAdmin = document.getElementById("new-user-is-admin").checked;
    const groupIds = getCheckedValues(document.getElementById("new-user-groups"));
    const errorEl = document.getElementById("users-error");
    const successEl = document.getElementById("users-success");
    errorEl.style.display = "none";
    successEl.style.display = "none";
    try {
      const data = await callWorker("create-user", { vorname, nachname, isAdmin, groupIds });
      document.getElementById("new-user-vorname").value = "";
      document.getElementById("new-user-nachname").value = "";
      document.getElementById("new-user-is-admin").checked = false;
      successEl.textContent = `Angelegt: ${data.username}`;
      successEl.style.display = "block";
      await loadAndRenderGroups();
      await loadAndRenderUsers();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });

  document.getElementById("create-group-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-group-name").value;
    const errorEl = document.getElementById("groups-error");
    errorEl.style.display = "none";
    try {
      await callWorker("create-group", { name });
      document.getElementById("new-group-name").value = "";
      await loadAndRenderGroups();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });

  document.getElementById("btn-bulk-import").addEventListener("click", async () => {
    const text = document.getElementById("bulk-import-text").value;
    const isAdmin = document.getElementById("bulk-import-is-admin").checked;
    const groupIds = getCheckedValues(document.getElementById("bulk-import-groups"));
    const entries = text.split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.lastIndexOf(" ");
        if (idx === -1) return { vorname: line, nachname: "" };
        return { vorname: line.slice(0, idx).trim(), nachname: line.slice(idx + 1).trim() };
      });
    const errorEl = document.getElementById("bulk-import-error");
    const resultEl = document.getElementById("bulk-import-result");
    errorEl.style.display = "none";
    resultEl.innerHTML = "";
    if (entries.length === 0) {
      errorEl.textContent = "Bitte mindestens eine Zeile eingeben.";
      errorEl.style.display = "block";
      return;
    }
    try {
      const data = await callWorker("bulk-create-users", { entries, isAdmin, groupIds });
      resultEl.innerHTML = `
        <p>${data.created.length} angelegt${data.skipped.length ? `, ${data.skipped.length} übersprungen` : ""}.</p>
        ${data.created.length ? `<ul>${data.created.map((c) => `<li>${escapeHtml(c.vorname)} ${escapeHtml(c.nachname)} → ${escapeHtml(c.username)}</li>`).join("")}</ul>` : ""}
        ${data.skipped.length ? `<ul class="muted">${data.skipped.map((s) => `<li>übersprungen: "${escapeHtml(s.vorname || "")} ${escapeHtml(s.nachname || "")}" (${escapeHtml(s.reason)})</li>`).join("")}</ul>` : ""}
      `;
      document.getElementById("bulk-import-text").value = "";
      await loadAndRenderUsers();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });

  document.getElementById("btn-save-visibility").addEventListener("click", async () => {
    const tools = {};
    document.querySelectorAll("#visibility-list .visibility-row").forEach((row) => {
      const id = row.dataset.toolId;
      const visible = row.querySelector('[data-field="visible"]').checked;
      const loginRequired = row.querySelector('[data-field="loginRequired"]').checked;
      const groupIds = getCheckedValues(row.querySelector('[data-field="groupIds"]'));
      tools[id] = { visible, loginRequired, groupIds };
    });
    const errorEl = document.getElementById("admin-save-error");
    const successEl = document.getElementById("admin-save-success");
    errorEl.style.display = "none";
    successEl.style.display = "none";
    try {
      await callWorker("save-visibility", { tools });
      visibilityState = tools;
      renderToolGrid();
      successEl.style.display = "block";
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
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
  setupAuthForms();

  const data = await fetchVisibility();
  visibilityState = (data && data.tools) || defaultVisibility();
  bootstrapAvailable = !!(data && data.bootstrapAvailable);

  await checkSession();

  renderAdminPanels();
  renderToolGrid();
  if (currentUser && currentUser.isAdmin) {
    await loadAndRenderGroups();
    await loadAndRenderUsers();
    renderVisibilityList();
  }
}

init();
