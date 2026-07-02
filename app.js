// Worker-URL des admin-worker.js (siehe README für Deploy-Anleitung).
const WORKER_URL = "https://landingpage.michel-brunner.workers.dev";
const TOKEN_STORAGE_KEY = "tu_session_token";
const TOOL_ORDER_STORAGE_KEY = "tu_tool_order";

let visibilityState = {};
let bootstrapAvailable = false;
let currentToken = null;
let currentUser = null; // { username, isAdmin, groupIds } oder null
let pendingFirstLoginUsername = null;
let pendingLoginUsername = null;
let groupsState = [];
let usersState = [];
let dragState = null; // aktiver Drag-Vorgang beim Verschieben einer Tool-Karte, sonst null

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
  pendingFirstLoginUsername = null;
  pendingLoginUsername = null;
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
    document.getElementById("users-count").textContent = usersState.length;
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
      <div class="ur-main">
        <span class="ur-name">${escapeHtml(u.displayName || u.username)}</span>
        <span class="muted">(${escapeHtml(u.username)})</span>
        ${u.isAdmin ? '<span class="badge-admin">Admin</span>' : ""}
        ${u.mustSetPassword ? '<span class="badge-warning">Passwort nicht gesetzt</span>' : ""}
        ${groupNames.map((n) => `<span class="group-chip">${escapeHtml(n)}</span>`).join("")}
        <button type="button" class="btn secondary small" data-toggle-user-groups="${escapeHtml(u.username)}">Gruppen</button>
        <button type="button" class="btn secondary small" data-toggle-edit-user="${escapeHtml(u.username)}">Bearbeiten</button>
        <button type="button" class="btn secondary small" data-reset-user="${escapeHtml(u.username)}">Passwort zurücksetzen</button>
        <button type="button" class="btn danger small" data-delete-user="${escapeHtml(u.username)}">Löschen</button>
      </div>
      <div class="ur-groups" data-user-groups-for="${escapeHtml(u.username)}" style="display:none;"></div>
      <div class="ur-groups" data-edit-user-for="${escapeHtml(u.username)}" style="display:none;"></div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll("[data-toggle-user-groups]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const username = btn.dataset.toggleUserGroups;
      const panel = btn.closest(".user-row").querySelector("[data-user-groups-for]");
      const isOpen = panel.style.display !== "none";
      if (isOpen) {
        panel.style.display = "none";
        return;
      }
      const user = usersState.find((u) => u.username === username);
      panel.innerHTML = `
        <div class="group-picker"></div>
        <button type="button" class="btn small" data-save-user-groups="${escapeHtml(username)}">Speichern</button>
      `;
      renderGroupCheckboxes(panel.querySelector(".group-picker"), user ? user.groupIds : []);
      panel.style.display = "block";
      panel.querySelector("[data-save-user-groups]").addEventListener("click", async () => {
        const desiredGroupIds = getCheckedValues(panel.querySelector(".group-picker"));
        const errorEl = document.getElementById("users-error");
        errorEl.style.display = "none";
        try {
          await applyUserGroupMembership(username, desiredGroupIds);
          await loadAndRenderGroups();
          await loadAndRenderUsers();
        } catch (e) {
          errorEl.textContent = e.message;
          errorEl.style.display = "block";
        }
      });
    });
  });

  container.querySelectorAll("[data-toggle-edit-user]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const username = btn.dataset.toggleEditUser;
      const panel = btn.closest(".user-row").querySelector("[data-edit-user-for]");
      const isOpen = panel.style.display !== "none";
      if (isOpen) {
        panel.style.display = "none";
        return;
      }
      const user = usersState.find((u) => u.username === username);
      panel.innerHTML = `
        <div class="form-grid" style="align-items:flex-end;">
          <div class="form-field">
            <label>Vorname</label>
            <input type="text" data-edit-user-vorname value="${escapeHtml(user.vorname || "")}" />
          </div>
          <div class="form-field">
            <label>Nachname</label>
            <input type="text" data-edit-user-nachname value="${escapeHtml(user.nachname || "")}" />
          </div>
          <div class="form-field">
            <label class="checkbox-label" style="margin-top:22px;"><input type="checkbox" data-edit-user-is-admin ${user.isAdmin ? "checked" : ""} /> Admin-Rechte</label>
          </div>
          <div class="form-field">
            <button type="button" class="btn small" data-save-edit-user="${escapeHtml(username)}">Speichern</button>
          </div>
        </div>
      `;
      panel.style.display = "block";
      panel.querySelector("[data-save-edit-user]").addEventListener("click", async () => {
        const vorname = panel.querySelector("[data-edit-user-vorname]").value.trim();
        const nachname = panel.querySelector("[data-edit-user-nachname]").value.trim();
        const isAdmin = panel.querySelector("[data-edit-user-is-admin]").checked;
        const errorEl = document.getElementById("users-error");
        errorEl.style.display = "none";
        try {
          await callWorker("update-user", { username, vorname, nachname, isAdmin });
          await loadAndRenderUsers();
        } catch (e) {
          errorEl.textContent = e.message;
          errorEl.style.display = "block";
        }
      });
    });
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

  container.querySelectorAll("[data-delete-user]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const username = btn.dataset.deleteUser;
      if (!confirm(`Nutzer "${username}" wirklich löschen?`)) return;
      const errorEl = document.getElementById("users-error");
      errorEl.style.display = "none";
      try {
        await callWorker("delete-user", { username });
        await loadAndRenderGroups();
        await loadAndRenderUsers();
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = "block";
      }
    });
  });
}

// Gleicht die Gruppenmitgliedschaft eines Nutzers auf den gewünschten Stand
// ab, indem nur die tatsächlich geänderten Gruppen einzeln aktualisiert werden.
async function applyUserGroupMembership(username, desiredGroupIds) {
  for (const group of groupsState) {
    const isMember = group.memberUsernames.includes(username);
    const shouldBeMember = desiredGroupIds.includes(group.id);
    if (isMember === shouldBeMember) continue;
    const memberUsernames = shouldBeMember
      ? [...group.memberUsernames, username]
      : group.memberUsernames.filter((m) => m !== username);
    await callWorker("update-group-members", { groupId: group.id, memberUsernames });
  }
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

// Berechnet den neuen Sichtbarkeits-Zustand aller Tools, nachdem im "Apps"-Bereich
// einer Gruppe die Tool-Auswahl geändert wurde. Zentrale Regel: Verliert ein Tool
// durch diese Änderung seine letzte Gruppe, wird es wieder versteckt (visible:false),
// statt für alle eingeloggten Nutzer sichtbar zu werden. Tools, die dieser Gruppe nie
// zugeordnet waren (öffentlich oder bewusst "alle Eingeloggten"), bleiben unverändert.
function computeGroupToolVisibility(groupId, selectedToolIds) {
  const updated = {};
  TOOLS.forEach((t) => {
    const entry = visibilityState[t.id] || { visible: true, loginRequired: false, groupIds: [] };
    const wasInGroup = (entry.groupIds || []).includes(groupId);
    const groupIds = new Set(entry.groupIds || []);
    const shouldHaveAccess = selectedToolIds.includes(t.id);
    if (shouldHaveAccess) groupIds.add(groupId); else groupIds.delete(groupId);
    const remaining = Array.from(groupIds);

    let visible = entry.visible !== false;
    let loginRequired = !!entry.loginRequired;
    if (shouldHaveAccess) {
      // Zugriff für diese Gruppe: Tool ist sichtbar und nur für Eingeloggte.
      visible = true;
      loginRequired = true;
    } else if (wasInGroup && remaining.length === 0) {
      // Diese Gruppe war die letzte mit Zugriff — Tool wieder verstecken.
      visible = false;
    }
    updated[t.id] = { visible, loginRequired, groupIds: remaining };
  });
  return updated;
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
        <button type="button" class="btn secondary small" data-toggle-tools="${escapeHtml(g.id)}">Apps</button>
        <button type="button" class="btn secondary small" data-delete-group="${escapeHtml(g.id)}">Löschen</button>
      </div>
      <div class="gr-members" data-members-for="${escapeHtml(g.id)}" style="display:none;"></div>
      <div class="gr-members" data-tools-for="${escapeHtml(g.id)}" style="display:none;"></div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll("[data-toggle-tools]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const groupId = btn.dataset.toggleTools;
      const panel = btn.closest(".group-row").querySelector("[data-tools-for]");
      const isOpen = panel.style.display !== "none";
      if (isOpen) {
        panel.style.display = "none";
        return;
      }
      panel.innerHTML = `
        <div class="group-picker"></div>
        <button type="button" class="btn small" data-save-group-tools="${escapeHtml(groupId)}">Speichern</button>
      `;
      const picker = panel.querySelector(".group-picker");
      TOOLS.forEach((t) => {
        const entry = visibilityState[t.id] || {};
        const checked = (entry.groupIds || []).includes(groupId);
        const label = document.createElement("label");
        label.className = "checkbox-label";
        label.innerHTML = `<input type="checkbox" value="${escapeHtml(t.id)}" ${checked ? "checked" : ""} /> ${t.icon || "🔗"} ${escapeHtml(t.name)}`;
        picker.appendChild(label);
      });
      panel.style.display = "block";
      panel.querySelector("[data-save-group-tools]").addEventListener("click", async () => {
        const selectedToolIds = getCheckedValues(picker);
        const errorEl = document.getElementById("groups-error");
        errorEl.style.display = "none";
        try {
          const updatedTools = computeGroupToolVisibility(groupId, selectedToolIds);
          await callWorker("save-visibility", { tools: updatedTools });
          visibilityState = updatedTools;
          renderToolGrid();
          renderVisibilityList();
          panel.style.display = "none";
        } catch (e) {
          errorEl.textContent = e.message;
          errorEl.style.display = "block";
        }
      });
    });
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

// Reihenfolge ist eine rein lokale Anzeige-Präferenz (pro Browser via localStorage,
// kein Sync über den Worker) — jede Kategorie wird unabhängig gespeichert, da die
// Karten pro Kategorie in einem eigenen Grid liegen.
function loadToolOrder() {
  try {
    return JSON.parse(localStorage.getItem(TOOL_ORDER_STORAGE_KEY)) || {};
  } catch (_) {
    return {};
  }
}

function saveToolOrder(category, orderedIds) {
  const all = loadToolOrder();
  all[category] = orderedIds;
  try { localStorage.setItem(TOOL_ORDER_STORAGE_KEY, JSON.stringify(all)); } catch (_) { /* localStorage nicht verfügbar */ }
}

// Wendet eine gespeicherte Reihenfolge an; neue/unbekannte Tools (kein Eintrag in der
// gespeicherten Reihenfolge, z.B. weil gerade erst hinzugefügt) hängen unverändert hinten an.
function applyCustomOrder(category, tools) {
  const order = loadToolOrder()[category];
  if (!order || !order.length) return tools;
  const remaining = new Map(tools.map((t) => [t.id, t]));
  const ordered = [];
  order.forEach((id) => {
    if (remaining.has(id)) { ordered.push(remaining.get(id)); remaining.delete(id); }
  });
  tools.forEach((t) => { if (remaining.has(t.id)) ordered.push(t); });
  return ordered;
}

// Startet einen Verschiebe-Vorgang per Pointer Events (vereint Maus/Touch/Stift).
// Reordering-Technik: beim Überqueren einer anderen Karte im selben Grid wird die
// gezogene Karte per insertBefore direkt an deren Stelle im DOM verschoben — kein
// Ghost-Element/Geometrie-Berechnung nötig, bewährtes einfaches Muster.
function startCardDrag(e, card, grid, category) {
  e.preventDefault();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  dragState = { pointerId: e.pointerId, handle, card, grid, category, startX: e.clientX, startY: e.clientY, moved: false };

  const onMove = (ev) => {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    if (!dragState.moved) {
      if (Math.hypot(ev.clientX - dragState.startX, ev.clientY - dragState.startY) < 6) return;
      dragState.moved = true;
      dragState.card.classList.add("dragging");
    }
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el) return;
    const overCard = el.closest(".tool-card");
    if (overCard && overCard !== dragState.card && overCard.parentElement === dragState.grid) {
      dragState.grid.insertBefore(dragState.card, overCard);
    } else if (!overCard && el.closest(".tool-grid") === dragState.grid) {
      dragState.grid.appendChild(dragState.card);
    }
  };

  const onUp = (ev) => {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    const { card: draggedCard, grid: draggedGrid, category: draggedCategory, moved, handle: draggedHandle } = dragState;
    draggedCard.classList.remove("dragging");
    try { draggedHandle.releasePointerCapture(ev.pointerId); } catch (_) { /* schon freigegeben */ }
    if (moved) {
      draggedCard.dataset.justDragged = "1";
      setTimeout(() => { delete draggedCard.dataset.justDragged; }, 0);
      saveToolOrder(draggedCategory, Array.from(draggedGrid.children).map((c) => c.dataset.toolId));
    }
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    dragState = null;
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
}

function renderToolGrid() {
  const container = document.getElementById("tool-groups");
  container.innerHTML = "";

  const categories = [...new Set(TOOLS.map((t) => t.category))];
  let anyVisible = false;

  categories.forEach((category) => {
    const toolsUnordered = TOOLS.filter((t) => t.category === category && isVisibleToUser(t.id, currentUser));
    if (toolsUnordered.length === 0) return;
    anyVisible = true;
    const toolsInCategory = applyCustomOrder(category, toolsUnordered);

    const group = document.createElement("div");
    group.className = "category-group";
    group.innerHTML = `<h2>${escapeHtml(category)}</h2>`;

    const grid = document.createElement("div");
    grid.className = "tool-grid";
    toolsInCategory.forEach((t) => {
      const card = document.createElement("a");
      card.className = "tool-card" + (t.wip ? " wip" : "");
      card.href = t.url;
      card.target = "_blank";
      card.rel = "noopener";
      card.dataset.toolId = t.id;
      card.innerHTML = `
        <div class="tool-card-badges">
          <span class="tool-drag-handle" title="Verschieben" aria-hidden="true">⠿</span>
          ${t.version ? `<span class="tool-version">v${escapeHtml(t.version)}</span>` : ""}
        </div>
        <div class="tool-icon">${t.icon || "🔗"}</div>
        ${t.wip ? '<div class="badge-wip">🚧 In Bearbeitung</div>' : ""}
        <h3>${escapeHtml(t.name)}</h3>
        <p>${escapeHtml(t.description || "")}</p>
      `;
      card.querySelector(".tool-drag-handle").addEventListener("pointerdown", (ev) => startCardDrag(ev, card, grid, category));
      card.addEventListener("click", (ev) => { if (card.dataset.justDragged === "1") ev.preventDefault(); });
      grid.appendChild(card);
    });

    group.appendChild(grid);
    container.appendChild(group);
  });

  const emptyEl = document.getElementById("uebersicht-empty");
  emptyEl.style.display = anyVisible ? "none" : "block";
  if (!anyVisible) {
    document.getElementById("uebersicht-empty-text").textContent = currentUser
      ? "Aktuell sind keine Tools für dich sichtbar."
      : "Melde dich an, um deine Tools zu sehen.";
    document.getElementById("btn-empty-login").style.display = currentUser ? "none" : "inline-block";
  }
}

// Leitet aus visible/loginRequired/groupIds den anzuzeigenden Sichtbarkeits-Modus ab.
function visibilityMode(entry) {
  if (entry.visible === false) return "hidden";
  if (!entry.loginRequired) return "public";
  if ((entry.groupIds || []).length === 0) return "loggedin";
  return "groups";
}

function renderVisibilityList() {
  const container = document.getElementById("visibility-list");
  container.innerHTML = "";
  TOOLS.forEach((t) => {
    const entry = visibilityState[t.id] || {};
    const mode = visibilityMode(entry);
    const groupIds = entry.groupIds || [];
    const row = document.createElement("div");
    row.className = "visibility-row";
    row.dataset.toolId = t.id;
    row.innerHTML = `
      <span class="tool-icon">${t.icon || "🔗"}</span>
      <span class="vr-name">${escapeHtml(t.name)}</span>
      <span class="vr-category">${escapeHtml(t.category)}</span>
      <select data-field="mode" class="form-select">
        <option value="hidden" ${mode === "hidden" ? "selected" : ""}>Versteckt</option>
        <option value="public" ${mode === "public" ? "selected" : ""}>Öffentlich</option>
        <option value="loggedin" ${mode === "loggedin" ? "selected" : ""}>Alle eingeloggten Nutzer</option>
        <option value="groups" ${mode === "groups" ? "selected" : ""}>Nur bestimmte Gruppen</option>
      </select>
      <div class="group-picker" data-field="groupIds" style="display:${mode === "groups" ? "block" : "none"};"></div>
    `;
    container.appendChild(row);

    renderGroupCheckboxes(row.querySelector('[data-field="groupIds"]'), groupIds);

    row.querySelector('[data-field="mode"]').addEventListener("change", (e) => {
      row.querySelector('[data-field="groupIds"]').style.display = e.target.value === "groups" ? "block" : "none";
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

function activateTab(name) {
  document.querySelectorAll("nav button[data-tab]").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-section").forEach((s) => s.classList.remove("active"));
  const btn = document.querySelector('nav button[data-tab="' + name + '"]');
  if (btn) btn.classList.add("active");
  const section = document.getElementById("tab-" + name);
  if (section) section.classList.add("active");
}

function setupTabs() {
  document.querySelectorAll("nav button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
  document.getElementById("btn-empty-login").addEventListener("click", () => activateTab("admin"));
}

function renderHeaderUser() {
  const el = document.getElementById("header-user");
  if (!currentUser) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `👤 ${escapeHtml(currentUser.username)}${currentUser.isAdmin ? '<span class="version-badge">Admin</span>' : ""}`;
  el.style.display = "flex";
}

function renderAdminPanels() {
  renderHeaderUser();
  document.getElementById("admin-bootstrap-panel").style.display = "none";
  document.getElementById("admin-login-gate").style.display = "none";
  document.getElementById("login-password-panel").style.display = "none";
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
  if (pendingLoginUsername) {
    document.getElementById("login-password-username").textContent = pendingLoginUsername;
    document.getElementById("login-password-panel").style.display = "block";
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

// Passwort-Regeln (identisch im admin-worker.js dupliziert, da separates Deployment):
// min. 12 Zeichen, Groß- und Kleinbuchstabe, dazu eine Zahl ODER ein Sonderzeichen.
function validatePasswordStrength(password) {
  const pw = String(password == null ? "" : password);
  if (pw.length < 12) return "Passwort muss mindestens 12 Zeichen lang sein.";
  if (!/[A-ZÄÖÜ]/.test(pw)) return "Passwort braucht mindestens einen Großbuchstaben.";
  if (!/[a-zäöüß]/.test(pw)) return "Passwort braucht mindestens einen Kleinbuchstaben.";
  if (!/[0-9]/.test(pw) && !/[^A-Za-z0-9ÄÖÜäöüß]/.test(pw)) return "Passwort braucht mindestens eine Zahl oder ein Sonderzeichen.";
  return null;
}

function setupAuthForms() {
  document.getElementById("bootstrap-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("bootstrap-username").value;
    const password = document.getElementById("bootstrap-password").value;
    const errorEl = document.getElementById("bootstrap-error");
    errorEl.style.display = "none";
    const pwError = validatePasswordStrength(password);
    if (pwError) {
      errorEl.textContent = pwError;
      errorEl.style.display = "block";
      return;
    }
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
    const errorEl = document.getElementById("login-error");
    errorEl.style.display = "none";
    pendingFirstLoginUsername = null;
    pendingLoginUsername = null;
    try {
      const result = await login(username, "");
      if (result.needsPasswordSetup) {
        renderAdminPanels();
      } else {
        await afterAuthChange();
      }
    } catch (err) {
      // Konto existiert bereits und hat ein Passwort -> Passwort-Schritt zeigen statt Fehler.
      pendingLoginUsername = username;
      renderAdminPanels();
    }
  });

  document.getElementById("login-password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("login-password").value;
    const errorEl = document.getElementById("login-password-error");
    errorEl.style.display = "none";
    try {
      const result = await login(pendingLoginUsername, password);
      pendingLoginUsername = null;
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

  document.getElementById("btn-login-back").addEventListener("click", () => {
    pendingLoginUsername = null;
    document.getElementById("login-password").value = "";
    document.getElementById("login-username").value = "";
    renderAdminPanels();
  });

  document.getElementById("btn-first-login-back").addEventListener("click", () => {
    pendingFirstLoginUsername = null;
    document.getElementById("first-login-password").value = "";
    document.getElementById("login-username").value = "";
    renderAdminPanels();
  });

  document.getElementById("first-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("first-login-password").value;
    const errorEl = document.getElementById("first-login-error");
    errorEl.style.display = "none";
    const pwError = validatePasswordStrength(password);
    if (pwError) {
      errorEl.textContent = pwError;
      errorEl.style.display = "block";
      return;
    }
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
      renderVisibilityList();
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
      const mode = row.querySelector('[data-field="mode"]').value;
      const groupIds = mode === "groups" ? getCheckedValues(row.querySelector('[data-field="groupIds"]')) : [];
      const visible = mode !== "hidden";
      const loginRequired = mode === "loggedin" || mode === "groups";
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
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

  // Beim allerersten Besuch (noch kein Nutzerkonto vorhanden) direkt in den
  // Admin-Tab springen, wo das "Admin-Konto einrichten"-Formular wartet.
  if (bootstrapAvailable && !currentUser) {
    activateTab("admin");
  }
}

init();
