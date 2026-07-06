// Worker-URL des admin-worker.js (siehe README für Deploy-Anleitung).
const WORKER_URL = "https://landingpage.michel-brunner.workers.dev";
const TOKEN_STORAGE_KEY = "tu_session_token";
const TOOL_ORDER_STORAGE_KEY = "tu_tool_order";

let visibilityState = {};
let newsState = (typeof NEWS !== "undefined" ? NEWS.slice() : []); // Server-News, initial das statische Seed/Fallback aus config.js
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
  loadCalendarWidget();
}

async function loadAndRenderUsers() {
  const errorEl = document.getElementById("users-error");
  errorEl.style.display = "none";
  try {
    const data = await callWorker("list-users", {});
    usersState = data.users.slice().sort((a, b) =>
      (a.displayName || a.username).localeCompare(b.displayName || b.username, "de")
    );
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
    const row = document.createElement("div");
    row.className = "user-row";
    row.innerHTML = `
      <div class="ur-main">
        <span class="ur-name">${escapeHtml(u.displayName || u.username)}</span>
        <span class="muted">(${escapeHtml(u.username)})</span>
        ${u.isAdmin ? '<span class="badge-admin">Admin</span>' : ""}
        ${u.mustSetPassword ? '<span class="badge-warning">Passwort nicht gesetzt</span>' : ""}
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
      const lizenzOptionen = ["", "ohne Lizenz", "Basis", "C", "B", "B Elite", "A"];
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
            <label>Trainerlizenz</label>
            <select data-edit-user-lizenz>
              ${lizenzOptionen.map((l) => `<option value="${escapeHtml(l)}" ${((user.lizenz || "") === l) ? "selected" : ""}>${l ? escapeHtml(l) : "— keine —"}</option>`).join("")}
            </select>
          </div>
          <div class="form-field">
            <label>Mannschaft(en)</label>
            <input type="text" data-edit-user-mannschaften value="${escapeHtml((user.mannschaften || []).join(", "))}" placeholder="z. B. B-Jugend, C-Jugend" />
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
        const lizenz = panel.querySelector("[data-edit-user-lizenz]").value;
        const mannschaften = panel.querySelector("[data-edit-user-mannschaften]").value
          .split(",").map((s) => s.trim()).filter(Boolean);
        const errorEl = document.getElementById("users-error");
        errorEl.style.display = "none";
        try {
          await callWorker("update-user", { username, vorname, nachname, isAdmin, lizenz, mannschaften });
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

// ---- Backfill: Lizenz & Mannschaft aus Personalkosten nachpflegen ----
// Admins dürfen jede Gateway-App per dav-load lesen (Admin-Bypass im Worker), also
// kann das Nutzer-Panel die Personalkosten-Daten laden und daraus das zentrale
// Trainerprofil (lizenz/mannschaften) der passenden Konten vorschlagen. Bewusst
// rein additiv: eine bereits gesetzte Lizenz wird NIE überschrieben, Mannschaften
// werden nur ergänzt (Vereinigung) — es geht kein manuell gepflegter Wert verloren.

function nameKey(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Baut aus den Personalkosten-Daten eine Map nameKey -> {displayName, lizenz, mannschaften[]}.
// Aggregiert über ALLE Saisons und alle drei Bereiche (Trainer/Schwerpunkt/Förderung);
// die aktuelle Saison wird zuletzt verarbeitet, damit ihre Lizenz gewinnt.
function buildPersonalkostenProfileMap(data) {
  const LIZENZEN = ["ohne Lizenz", "Basis", "C", "B", "B Elite", "A"];
  const map = new Map();
  if (!data || !data.seasons || typeof data.seasons !== "object") return map;
  const current = data.meta && data.meta.currentSeason;
  const seasonKeys = Object.keys(data.seasons)
    .sort((a, b) => (a === current ? 1 : 0) - (b === current ? 1 : 0));
  seasonKeys.forEach((sk) => {
    const season = data.seasons[sk] || {};
    ["trainer", "schwerpunkt", "foerderung"].forEach((bereich) => {
      const list = Array.isArray(season[bereich]) ? season[bereich] : [];
      list.forEach((e) => {
        const name = String((e && e.name) || "").trim();
        if (!name || name === "0") return;
        const key = nameKey(name);
        if (!map.has(key)) map.set(key, { displayName: name, lizenz: "", mannschaften: [] });
        const rec = map.get(key);
        const mannschaft = String((e && e.mannschaft) || "").trim();
        if (mannschaft && !rec.mannschaften.includes(mannschaft)) rec.mannschaften.push(mannschaft);
        const lizenz = String((e && e.lizenz) || "").trim();
        if (lizenz && LIZENZEN.includes(lizenz)) rec.lizenz = lizenz;
      });
    });
  });
  return map;
}

async function openBackfillFromPersonalkosten() {
  const panel = document.getElementById("backfill-panel");
  const errorEl = document.getElementById("users-error");
  errorEl.style.display = "none";
  panel.style.display = "block";
  panel.innerHTML = '<p class="muted">Lade Personalkosten…</p>';

  let res;
  try {
    res = await callWorker("dav-load", { app: "personalkosten" });
  } catch (e) {
    panel.innerHTML = `<p class="muted" style="color:#c0392b;">Konnte Personalkosten nicht laden: ${escapeHtml(e.message)}</p>`;
    return;
  }

  const profileMap = buildPersonalkostenProfileMap(res && res.data);
  if (profileMap.size === 0) {
    panel.innerHTML = '<p class="muted">In den Personalkosten wurden keine Personen mit Namen gefunden (schon deployed &amp; befüllt?).</p>';
    return;
  }

  const matchedKeys = new Set();
  const rows = [];
  usersState.forEach((u) => {
    const full = `${u.vorname || ""} ${u.nachname || ""}`.trim();
    const key = nameKey(full);
    if (!key || !profileMap.has(key)) return;
    matchedKeys.add(key);
    const prof = profileMap.get(key);
    const curLizenz = u.lizenz || "";
    const curTeams = Array.isArray(u.mannschaften) ? u.mannschaften : [];
    const addTeams = prof.mannschaften.filter((m) => !curTeams.includes(m));
    const lizenzChange = !curLizenz && !!prof.lizenz;
    const teamChange = addTeams.length > 0;
    if (!lizenzChange && !teamChange) return; // matched, aber nichts nachzupflegen
    rows.push({
      username: u.username, displayName: full,
      vorname: u.vorname || "", nachname: u.nachname || "", isAdmin: !!u.isAdmin,
      curLizenz, newLizenz: curLizenz || prof.lizenz, lizenzChange,
      curTeams, addTeams, newTeams: curTeams.concat(addTeams), teamChange
    });
  });

  const unmatched = [];
  profileMap.forEach((prof, key) => { if (!matchedKeys.has(key)) unmatched.push(prof.displayName); });
  unmatched.sort((a, b) => a.localeCompare(b, "de"));

  renderBackfillPanel(panel, rows, unmatched, matchedKeys.size - rows.length);
}

function renderBackfillPanel(panel, rows, unmatched, upToDateCount) {
  const unmatchedHtml = unmatched.length
    ? `<p class="muted" style="margin-top:10px;">Ohne passendes Nutzerkonto (${unmatched.length}) — bitte ggf. erst als Nutzer anlegen: ${escapeHtml(unmatched.join(", "))}</p>`
    : "";

  if (rows.length === 0) {
    panel.innerHTML =
      `<p class="muted">Nichts nachzupflegen — alle zugeordneten Nutzer sind bereits aktuell${upToDateCount > 0 ? ` (${upToDateCount})` : ""}.</p>` +
      unmatchedHtml;
    return;
  }

  const rowsHtml = rows.map((r, i) => {
    const lizenzHtml = r.lizenzChange
      ? `Lizenz: <span class="muted">—</span> → <strong>${escapeHtml(r.newLizenz)}</strong>`
      : (r.curLizenz ? `Lizenz: ${escapeHtml(r.curLizenz)} <span class="muted">(bleibt)</span>` : `Lizenz: <span class="muted">—</span>`);
    const teamHtml = r.teamChange
      ? `Mannschaft: ${r.curTeams.length ? escapeHtml(r.curTeams.join(", ")) + " " : ""}<strong>+ ${escapeHtml(r.addTeams.join(", "))}</strong>`
      : `Mannschaft: ${r.curTeams.length ? escapeHtml(r.curTeams.join(", ")) : "—"} <span class="muted">(bleibt)</span>`;
    return `
      <label class="checkbox-label" style="display:flex; gap:10px; align-items:flex-start; padding:6px 0; border-bottom:1px solid rgba(0,0,0,0.08);">
        <input type="checkbox" data-backfill-row="${i}" checked />
        <span><strong>${escapeHtml(r.displayName)}</strong><br>
        <span class="muted" style="font-size:0.9em;">${lizenzHtml} · ${teamHtml}</span></span>
      </label>`;
  }).join("");

  panel.innerHTML = `
    <p class="muted">${rows.length} Nutzer aus den Personalkosten nachpflegbar${upToDateCount > 0 ? `, ${upToDateCount} bereits aktuell` : ""}. Bestehende Lizenzen werden nicht überschrieben, Mannschaften nur ergänzt.</p>
    <div id="backfill-rows">${rowsHtml}</div>
    <div class="btn-row" style="margin-top:12px; gap:8px; justify-content:flex-start;">
      <button type="button" class="btn small" id="btn-backfill-apply">Ausgewählte übernehmen</button>
      <button type="button" class="btn secondary small" id="btn-backfill-cancel">Abbrechen</button>
    </div>
    <p class="muted" id="backfill-status" style="margin-top:10px;"></p>
    ${unmatchedHtml}`;

  document.getElementById("btn-backfill-cancel").addEventListener("click", () => {
    panel.style.display = "none";
    panel.innerHTML = "";
  });
  document.getElementById("btn-backfill-apply").addEventListener("click", () => applyBackfill(rows));
}

async function applyBackfill(rows) {
  const statusEl = document.getElementById("backfill-status");
  const applyBtn = document.getElementById("btn-backfill-apply");
  const selected = rows.filter((r, i) => {
    const cb = document.querySelector(`[data-backfill-row="${i}"]`);
    return cb && cb.checked;
  });
  if (selected.length === 0) { statusEl.textContent = "Nichts ausgewählt."; return; }

  applyBtn.disabled = true;
  let done = 0, failed = 0;
  for (const r of selected) {
    statusEl.textContent = `Übernehme… (${done + failed + 1}/${selected.length})`;
    try {
      await callWorker("update-user", {
        username: r.username, vorname: r.vorname, nachname: r.nachname, isAdmin: r.isAdmin,
        lizenz: r.newLizenz, mannschaften: r.newTeams
      });
      done++;
    } catch (_) {
      failed++;
    }
  }
  statusEl.textContent = `Fertig: ${done} übernommen${failed ? `, ${failed} fehlgeschlagen (Worker schon deployed?)` : ""}. „Aus Personalkosten übernehmen“ erneut klicken, um das Ergebnis zu prüfen.`;
  applyBtn.disabled = false;
  await loadAndRenderUsers();
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

function getCheckedValues(container, kind) {
  if (!container) return [];
  const selector = kind ? `input[type="checkbox"][data-kind="${kind}"]:checked` : 'input[type="checkbox"]:checked';
  return Array.from(container.querySelectorAll(selector)).map((cb) => cb.value);
}

// Apps, die einen serverseitigen Provisioning-Adapter haben (siehe admin-worker.js
// PROVISION_ADAPTERS) — nur für diese wird die "Auto-Eintrag"-Checkbox angeboten.
// Trainerkodex folgt in Phase 2 (braucht eine eigene Anzeige-Anpassung).
const PROVISIONABLE_APPS = ["personalkosten", "trainercheckliste", "kadermanager", "trainervertrag"];

// Fasst den Provisioning-Report ({ [app]: { [username]: ergebnis } }) knapp zusammen.
function summarizeProvisionReport(report) {
  const parts = [];
  Object.entries(report || {}).forEach(([app, byUser]) => {
    const vals = Object.values(byUser || {});
    const count = (x) => vals.filter((v) => v === x).length;
    const bits = [];
    if (count("created")) bits.push(`${count("created")} neu`);
    if (count("exists")) bits.push(`${count("exists")} vorhanden`);
    if (count("no-team")) bits.push(`${count("no-team")}× kein Team`);
    if (count("no-season")) bits.push(`${count("no-season")}× keine Saison`);
    if (count("error")) bits.push(`${count("error")} Fehler`);
    parts.push(`${app}: ${bits.join(", ") || "—"}`);
  });
  return parts.join(" · ");
}

// Berechnet den neuen Sichtbarkeits-Zustand aller Tools, nachdem im "Apps"-Bereich
// einer Gruppe die Tool-Auswahl geändert wurde. Zentrale Regel: Verliert ein Tool
// durch diese Änderung seine letzte Gruppe, wird es wieder versteckt (visible:false),
// statt für alle eingeloggten Nutzer sichtbar zu werden. Tools, die dieser Gruppe nie
// zugeordnet waren (öffentlich oder bewusst "alle Eingeloggten"), bleiben unverändert.
//
// editGroupIds (Bearbeiten-Recht) ist bewusst unabhängig von visible/loginRequired:
// eine Gruppe kann Bearbeiten-Rechte für ein Tool bekommen, ohne dessen Sichtbarkeits-
// Modus zu verändern (z.B. bei einem Tool, das ohnehin für "Alle eingeloggten Nutzer"
// sichtbar ist) — sonst würde das Vergeben eines Bearbeiten-Rechts die Sichtbarkeit
// ungewollt auf "Nur bestimmte Gruppen" verengen.
function computeGroupToolVisibility(groupId, selectedToolIds, selectedEditToolIds, selectedProvisionToolIds) {
  const updated = {};
  TOOLS.forEach((t) => {
    const entry = visibilityState[t.id] || { visible: true, loginRequired: false, groupIds: [], editGroupIds: [], provisionGroupIds: [] };
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

    const editGroupIds = new Set(entry.editGroupIds || []);
    if (selectedEditToolIds.includes(t.id)) editGroupIds.add(groupId); else editGroupIds.delete(groupId);

    // provisionGroupIds nur für provisionierbare Apps anfassen, sonst unverändert lassen.
    const provisionGroupIds = new Set(entry.provisionGroupIds || []);
    if (PROVISIONABLE_APPS.includes(t.id)) {
      if ((selectedProvisionToolIds || []).includes(t.id)) provisionGroupIds.add(groupId); else provisionGroupIds.delete(groupId);
    }

    updated[t.id] = {
      visible, loginRequired,
      groupIds: remaining,
      editGroupIds: Array.from(editGroupIds),
      provisionGroupIds: Array.from(provisionGroupIds)
    };
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
        <p class="muted" style="margin:8px 0 4px;">„Auto-Eintrag“: Mitglieder dieser Gruppe werden beim Anlegen automatisch als Eintrag in der App angelegt (z. B. Trainer-Zeile in Personalkosten).</p>
        <div class="btn-row" style="justify-content:flex-start; gap:8px;">
          <button type="button" class="btn small" data-save-group-tools="${escapeHtml(groupId)}">Speichern</button>
          <button type="button" class="btn secondary small" data-provision-group="${escapeHtml(groupId)}">Bestehende Mitglieder jetzt eintragen</button>
        </div>
        <p class="muted" data-provision-status style="margin-top:8px;"></p>
      `;
      const picker = panel.querySelector(".group-picker");
      TOOLS.forEach((t) => {
        const entry = visibilityState[t.id] || {};
        const canSee = (entry.groupIds || []).includes(groupId);
        const canEditTool = (entry.editGroupIds || []).includes(groupId);
        const canProvision = (entry.provisionGroupIds || []).includes(groupId);
        const provisionCell = PROVISIONABLE_APPS.includes(t.id)
          ? `<label class="checkbox-label"><input type="checkbox" data-kind="provision" value="${escapeHtml(t.id)}" ${canProvision ? "checked" : ""} /> Auto-Eintrag</label>`
          : "";
        const row = document.createElement("div");
        row.className = "group-picker-row";
        row.innerHTML = `
          <span class="gp-tool-name">${t.icon || "🔗"} ${escapeHtml(t.name)}</span>
          <label class="checkbox-label"><input type="checkbox" data-kind="see" value="${escapeHtml(t.id)}" ${canSee ? "checked" : ""} /> Sehen</label>
          <label class="checkbox-label"><input type="checkbox" data-kind="edit" value="${escapeHtml(t.id)}" ${canEditTool ? "checked" : ""} /> Bearbeiten</label>
          ${provisionCell}
        `;
        picker.appendChild(row);
      });
      panel.style.display = "block";
      panel.querySelector("[data-save-group-tools]").addEventListener("click", async () => {
        const selectedToolIds = getCheckedValues(picker, "see");
        const selectedEditToolIds = getCheckedValues(picker, "edit");
        const selectedProvisionToolIds = getCheckedValues(picker, "provision");
        const errorEl = document.getElementById("groups-error");
        errorEl.style.display = "none";
        try {
          const updatedTools = computeGroupToolVisibility(groupId, selectedToolIds, selectedEditToolIds, selectedProvisionToolIds);
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
      panel.querySelector("[data-provision-group]").addEventListener("click", async (ev) => {
        const statusEl = panel.querySelector("[data-provision-status]");
        const pbtn = ev.currentTarget;
        pbtn.disabled = true;
        statusEl.textContent = "Lege Einträge an…";
        try {
          const res = await callWorker("provision-group", { groupId });
          const summary = summarizeProvisionReport(res.provisioned);
          statusEl.textContent = summary
            ? `Fertig (${res.memberCount} Mitglied(er)): ${summary}`
            : "Für diese Gruppe ist keine App als „Auto-Eintrag“ markiert (oder keine Mitglieder). Erst oben anhaken + speichern.";
        } catch (e) {
          statusEl.textContent = "Fehler: " + e.message + " (Worker schon deployed?)";
        } finally {
          pbtn.disabled = false;
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

// Baut die Endgeräte-Icons (📱/💻) für eine Tool-Karte aus t.devices (["mobile","desktop"]).
function deviceIcons(devices) {
  if (!devices || !devices.length) return "";
  const icons = { mobile: "📱", desktop: "💻" };
  const labels = { mobile: "Handy", desktop: "Laptop" };
  const symbols = devices.map((d) => icons[d] || "").join("");
  const title = devices.map((d) => labels[d] || d).join(" & ");
  return `<span class="tool-devices" title="Geeignet für: ${title}">${symbols}</span>`;
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
      card.dataset.toolId = t.id;
      card.innerHTML = `
        <div class="tool-card-badges">
          <span class="tool-drag-handle" title="Verschieben" aria-hidden="true">⠿</span>
          ${deviceIcons(t.devices)}
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
    const editGroupIds = entry.editGroupIds || [];
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
      <div class="group-picker-wrap" data-field="groupIds" style="display:${mode === "groups" ? "block" : "none"};">
        <div class="gp-label">Sehen</div>
        <div class="group-picker" data-role="see-boxes"></div>
      </div>
      <div class="group-picker-wrap" data-field="editGroupIds">
        <div class="gp-label">Bearbeiten</div>
        <div class="group-picker" data-role="edit-boxes"></div>
      </div>
    `;
    container.appendChild(row);

    renderGroupCheckboxes(row.querySelector('[data-field="groupIds"] [data-role="see-boxes"]'), groupIds);
    renderGroupCheckboxes(row.querySelector('[data-field="editGroupIds"] [data-role="edit-boxes"]'), editGroupIds);

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

const NEWS_TYPE_LABELS = { neu: "Neu", update: "Update", fix: "Fix", hinweis: "Hinweis" };
const NEWS_MAX_TOTAL = 5; // insgesamt max. per Pfeil erreichbare Meldungen

// Index der aktuell im Karussell sichtbaren Meldung (0 = neueste). Rechter Pfeil
// erhöht ihn (→ ältere Meldung), linker Pfeil verringert ihn (→ neuere Meldung).
let newsCarouselIndex = 0;

function toolById(id) {
  return TOOLS.find((t) => t.id === id) || null;
}

function formatNewsDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || "");
}

function renderNews() {
  const banner = document.getElementById("news-banner");
  if (!banner) return;
  const items = newsState.slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, NEWS_MAX_TOTAL);
  if (items.length === 0) {
    banner.style.display = "none";
    return;
  }
  banner.style.display = "block";
  if (newsCarouselIndex < 0 || newsCarouselIndex >= items.length) newsCarouselIndex = 0;

  const n = items[newsCarouselIndex];
  const tool = n.toolId ? toolById(n.toolId) : null;
  const type = String(n.type || "");
  const badge = type
    ? `<span class="news-badge news-badge-${escapeHtml(type)}">${escapeHtml(NEWS_TYPE_LABELS[type] || type)}</span>`
    : "";
  const date = n.date ? `<span class="news-date">${escapeHtml(formatNewsDate(n.date))}</span>` : "";
  const link = tool ? `<span class="news-item-link">${escapeHtml(tool.name)} öffnen →</span>` : "";
  const inner = `
    <div class="news-item-head">${badge}${date}</div>
    <div class="news-item-title">${escapeHtml(n.title || "")}</div>
    ${n.text ? `<div class="news-item-text">${escapeHtml(n.text)}</div>` : ""}
    ${link}
  `;
  const itemHtml = tool
    ? `<a class="news-item" href="${escapeHtml(tool.url)}">${inner}</a>`
    : `<div class="news-item">${inner}</div>`;

  const atNewest = newsCarouselIndex === 0;
  const atOldest = newsCarouselIndex === items.length - 1;

  banner.innerHTML = `
    <div class="news-head"><h2>📣 Neuigkeiten</h2></div>
    <div class="news-carousel">
      <button type="button" class="news-nav-btn news-nav-prev" ${atNewest ? "disabled" : ""} title="Neuere Meldung" aria-label="Neuere Meldung">‹</button>
      <div class="news-carousel-item">${itemHtml}</div>
      <button type="button" class="news-nav-btn news-nav-next" ${atOldest ? "disabled" : ""} title="Ältere Meldung" aria-label="Ältere Meldung">›</button>
    </div>
    ${items.length > 1 ? `<div class="news-dots">${newsCarouselIndex + 1} / ${items.length}</div>` : ""}
  `;

  const prevBtn = banner.querySelector(".news-nav-prev");
  const nextBtn = banner.querySelector(".news-nav-next");
  if (prevBtn) prevBtn.addEventListener("click", () => { newsCarouselIndex = Math.max(0, newsCarouselIndex - 1); renderNews(); });
  if (nextBtn) nextBtn.addEventListener("click", () => { newsCarouselIndex = Math.min(items.length - 1, newsCarouselIndex + 1); renderNews(); });
}

// ---- Vereinskalender-Widget: nächste Termine links neben den Kacheln ----
// Nutzt dieselbe Sichtbarkeitsregel wie die Tool-Karte (isVisibleToUser) und
// dieselbe Gateway-Aktion (dav-load) wie die Vereinskalender-App selbst — rein
// lesend, kein eigener Worker-Code nötig. Ohne Login/Zugriff wird das Widget
// einfach ausgeblendet statt einen Fehler zu zeigen.
const CALENDAR_WIDGET_APP_ID = "vereinskalender";
const CALENDAR_WIDGET_COUNT = 8;

function calendarTerminEndIso(t) {
  return t.endDatum && /^\d{4}-\d{2}-\d{2}$/.test(t.endDatum) && t.endDatum >= t.datum ? t.endDatum : t.datum;
}

// Spiegelt terminVisibleFor() aus der Vereinskalender-App selbst: private Termine
// (seit 1.6) sieht nur der Ersteller, explizit geteilte Nutzer/Gruppen sowie
// Admins. Ohne diesen Filter würde das Widget private Termine ALLER Nutzer an
// jeden eingeloggten Nutzer mit Vereinskalender-Zugriff ausliefern.
function calendarTerminVisibleFor(t, user) {
  if (!t.privat) return true;
  if (!user) return false;
  if (user.isAdmin) return true;
  if (t.ersteller && t.ersteller === user.username) return true;
  if (Array.isArray(t.geteiltUsers) && t.geteiltUsers.includes(user.username)) return true;
  if (Array.isArray(t.geteiltGruppen) && Array.isArray(user.groupIds) &&
      t.geteiltGruppen.some((g) => user.groupIds.includes(g))) return true;
  return false;
}

function calendarSortKey(t) {
  return `${t.datum}T${(t.ganztags ? "" : t.startZeit) || "00:00"}`;
}

function formatCalendarDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}.${m[2]}.` : "";
}

// Das Widget hängt jetzt außerhalb von #tab-uebersicht (siehe index.html:
// .page-body bricht bewusst aus main heraus, damit es ganz links am
// Fensterrand steht statt nur am linken Rand des zentrierten Inhalts) und
// wird deshalb nicht mehr automatisch über die tab-section mitversteckt.
// dataset.hasContent hält fest, ob überhaupt Inhalt da ist; die tatsächliche
// Sichtbarkeit ergibt sich erst in Kombination mit dem aktiven Tab (siehe
// activateTab) — sonst würde es auch im Einstellungen-Tab durchscheinen.
function isUebersichtTabActive() {
  const section = document.getElementById("tab-uebersicht");
  return !!(section && section.classList.contains("active"));
}

async function loadCalendarWidget() {
  const widget = document.getElementById("calendar-widget");
  if (!widget) return;
  if (!currentUser || !isVisibleToUser(CALENDAR_WIDGET_APP_ID, currentUser)) {
    widget.dataset.hasContent = "0";
    widget.style.display = "none";
    widget.innerHTML = "";
    return;
  }
  try {
    const res = await callWorker("dav-load", { app: CALENDAR_WIDGET_APP_ID });
    const data = res && res.data && typeof res.data === "object" ? res.data : {};
    const termine = Array.isArray(data.termine) ? data.termine : [];
    const kategorien = Array.isArray(data.kategorien) ? data.kategorien : [];
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = termine
      .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.datum || "") && calendarTerminEndIso(t) >= today)
      .filter((t) => calendarTerminVisibleFor(t, currentUser))
      .sort((a, b) => calendarSortKey(a).localeCompare(calendarSortKey(b)));
    const oeffentlich = upcoming.filter((t) => !t.privat).slice(0, CALENDAR_WIDGET_COUNT);
    const privat = upcoming.filter((t) => t.privat).slice(0, CALENDAR_WIDGET_COUNT);
    renderCalendarWidget(widget, oeffentlich, privat, kategorien);
  } catch (e) {
    console.warn("Vereinskalender-Widget nicht ladbar:", e);
    widget.dataset.hasContent = "0";
    widget.style.display = "none";
    widget.innerHTML = "";
  }
}

function renderCalendarWidget(widget, termine, privatTermine, kategorien) {
  const tool = toolById(CALENDAR_WIDGET_APP_ID);
  const url = tool ? tool.url : "#";
  const katFarbe = (id) => {
    const k = kategorien.find((k2) => k2.id === id);
    return k ? k.farbe : "#6b7280";
  };
  const rowHtml = (t) => `
        <a class="calendar-widget-item" href="${escapeHtml(url)}">
          <span class="cw-date">${escapeHtml(formatCalendarDate(t.datum))}</span>
          <span class="cw-dot" style="background:${escapeHtml(katFarbe(t.kategorie))}"></span>
          <span class="cw-title">${escapeHtml(t.titel || "")}</span>
        </a>
      `;
  const rows = termine.length
    ? termine.map(rowHtml).join("")
    : '<p class="muted" style="padding:4px 0;">Keine anstehenden Termine.</p>';
  // Private Termine (nur für den eingeloggten Nutzer sichtbar, siehe
  // calendarTerminVisibleFor) stehen als eigener Abschnitt UNTER den normalen
  // Terminen — der Abschnitt fehlt ganz, wenn der Nutzer keine hat.
  const privateSection = privatTermine.length ? `
      <h2 class="calendar-widget-sub-heading">🔒 Private Termine</h2>
      <div class="calendar-widget-list">${privatTermine.map(rowHtml).join("")}</div>
    ` : "";
  widget.innerHTML = `
    <div class="card">
      <h2>📅 Nächste Termine</h2>
      <div class="calendar-widget-list">${rows}</div>
      ${privateSection}
    </div>
  `;
  widget.dataset.hasContent = "1";
  widget.style.display = isUebersichtTabActive() ? "block" : "none";
}

// ---- Admin: Neuigkeiten verwalten (Einstellungen-Tab) ----

function newsToolOptionsOnce() {
  const sel = document.getElementById("news-tool");
  if (!sel || sel.dataset.filled === "1") return;
  TOOLS.forEach((t) => {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = t.name;
    sel.appendChild(o);
  });
  sel.dataset.filled = "1";
}

function newsFormReset() {
  const f = document.getElementById("news-form");
  if (!f) return;
  document.getElementById("news-edit-id").value = "";
  document.getElementById("news-type").value = "neu";
  document.getElementById("news-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("news-tool").value = "";
  document.getElementById("news-title").value = "";
  document.getElementById("news-text").value = "";
  document.getElementById("btn-news-submit").textContent = "Hinzufügen";
  document.getElementById("btn-news-cancel").style.display = "none";
}

function startEditNews(id) {
  const n = newsState.find((x) => x.id === id);
  if (!n) return;
  document.getElementById("news-edit-id").value = n.id;
  document.getElementById("news-type").value = n.type || "neu";
  document.getElementById("news-date").value = /^\d{4}-\d{2}-\d{2}$/.test(n.date || "") ? n.date : new Date().toISOString().slice(0, 10);
  document.getElementById("news-tool").value = n.toolId || "";
  document.getElementById("news-title").value = n.title || "";
  document.getElementById("news-text").value = n.text || "";
  document.getElementById("btn-news-submit").textContent = "Änderung speichern";
  document.getElementById("btn-news-cancel").style.display = "inline-block";
  document.getElementById("admin-news-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function deleteNews(id) {
  if (!confirm("Diese Meldung wirklich löschen?")) return;
  const prev = newsState.slice();
  newsState = newsState.filter((x) => x.id !== id);
  await persistNews(prev);
}

// Speichert newsState serverseitig; bei Fehler Rollback auf den vorherigen Stand.
async function persistNews(prevOnError) {
  const errorEl = document.getElementById("news-error");
  const successEl = document.getElementById("news-success");
  errorEl.style.display = "none";
  successEl.style.display = "none";
  try {
    const res = await callWorker("save-news", { news: newsState });
    if (res && Array.isArray(res.news)) newsState = res.news;
    newsCarouselIndex = 0;
    renderNews();
    renderNewsAdmin();
    successEl.style.display = "block";
  } catch (err) {
    if (prevOnError) newsState = prevOnError;
    renderNewsAdmin();
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
}

function renderNewsAdmin() {
  const list = document.getElementById("news-admin-list");
  if (!list) return;
  newsToolOptionsOnce();
  const sorted = newsState.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  if (sorted.length === 0) {
    list.innerHTML = '<p class="muted">Noch keine Meldungen.</p>';
    return;
  }
  list.innerHTML = sorted.map((n) => {
    const tool = n.toolId ? toolById(n.toolId) : null;
    const type = String(n.type || "hinweis");
    return `
      <div class="news-admin-row" data-id="${escapeHtml(n.id || "")}">
        <div class="news-admin-main">
          <div class="news-item-head">
            <span class="news-badge news-badge-${escapeHtml(type)}">${escapeHtml(NEWS_TYPE_LABELS[type] || type)}</span>
            <span class="news-date">${escapeHtml(formatNewsDate(n.date))}</span>
          </div>
          <div class="news-item-title">${escapeHtml(n.title || "")}</div>
          ${n.text ? `<div class="news-item-text">${escapeHtml(n.text)}</div>` : ""}
          ${tool ? `<div class="muted" style="font-size:12px; margin-top:2px;">→ ${escapeHtml(tool.name)}</div>` : ""}
        </div>
        <div class="news-admin-actions">
          <button type="button" class="btn secondary small news-edit-btn">Bearbeiten</button>
          <button type="button" class="btn danger small news-del-btn">Löschen</button>
        </div>
      </div>`;
  }).join("");
  list.querySelectorAll(".news-admin-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".news-edit-btn").addEventListener("click", () => startEditNews(id));
    row.querySelector(".news-del-btn").addEventListener("click", () => deleteNews(id));
  });
}

function activateTab(name) {
  document.querySelectorAll("nav button[data-tab]").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-section").forEach((s) => s.classList.remove("active"));
  const btn = document.querySelector('nav button[data-tab="' + name + '"]');
  if (btn) btn.classList.add("active");
  const section = document.getElementById("tab-" + name);
  if (section) section.classList.add("active");
  // Kalender-Widget hängt außerhalb von #tab-uebersicht (siehe loadCalendarWidget) —
  // beim Tab-Wechsel Sichtbarkeit anhand des geladenen Inhalts neu bewerten.
  const widget = document.getElementById("calendar-widget");
  if (widget) widget.style.display = (name === "uebersicht" && widget.dataset.hasContent === "1") ? "block" : "none";
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
  document.getElementById("admin-groups-panel").style.display = "none";
  document.getElementById("admin-visibility-panel").style.display = "none";
  document.getElementById("admin-news-panel").style.display = "none";

  if (currentUser) {
    document.getElementById("logged-in-username").textContent = currentUser.username;
    document.getElementById("admin-logged-in-panel").style.display = "block";
    if (currentUser.isAdmin) {
      document.getElementById("admin-users-panel").style.display = "block";
      document.getElementById("admin-groups-panel").style.display = "block";
      document.getElementById("admin-visibility-panel").style.display = "block";
      document.getElementById("admin-news-panel").style.display = "block";
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
  await loadCalendarWidget();
  if (currentUser && currentUser.isAdmin) {
    await loadAndRenderGroups();
    await loadAndRenderUsers();
    renderVisibilityList();
    renderNewsAdmin();
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

  const backfillBtn = document.getElementById("btn-backfill-personalkosten");
  if (backfillBtn) backfillBtn.addEventListener("click", openBackfillFromPersonalkosten);

  document.getElementById("create-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const vorname = document.getElementById("new-user-vorname").value;
    const nachname = document.getElementById("new-user-nachname").value;
    const isAdmin = document.getElementById("new-user-is-admin").checked;
    const lizenz = document.getElementById("new-user-lizenz").value;
    const mannschaften = document.getElementById("new-user-mannschaften").value
      .split(",").map((s) => s.trim()).filter(Boolean);
    const groupIds = getCheckedValues(document.getElementById("new-user-groups"));
    const errorEl = document.getElementById("users-error");
    const successEl = document.getElementById("users-success");
    errorEl.style.display = "none";
    successEl.style.display = "none";
    try {
      const data = await callWorker("create-user", { vorname, nachname, isAdmin, lizenz, mannschaften, groupIds });
      document.getElementById("new-user-vorname").value = "";
      document.getElementById("new-user-nachname").value = "";
      document.getElementById("new-user-lizenz").value = "";
      document.getElementById("new-user-mannschaften").value = "";
      document.getElementById("new-user-is-admin").checked = false;
      const prov = summarizeProvisionReport(data.provisioned);
      successEl.textContent = `Angelegt: ${data.username}` + (prov ? ` · Auto-Einträge → ${prov}` : "");
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

  document.getElementById("btn-save-visibility").addEventListener("click", async () => {
    const tools = {};
    document.querySelectorAll("#visibility-list .visibility-row").forEach((row) => {
      const id = row.dataset.toolId;
      const mode = row.querySelector('[data-field="mode"]').value;
      const groupIds = mode === "groups" ? getCheckedValues(row.querySelector('[data-field="groupIds"]')) : [];
      const editGroupIds = getCheckedValues(row.querySelector('[data-field="editGroupIds"]'));
      const visible = mode !== "hidden";
      const loginRequired = mode === "loggedin" || mode === "groups";
      tools[id] = { visible, loginRequired, groupIds, editGroupIds };
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

  const newsForm = document.getElementById("news-form");
  if (newsForm) {
    newsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("news-title").value.trim();
      const errorEl = document.getElementById("news-error");
      document.getElementById("news-success").style.display = "none";
      errorEl.style.display = "none";
      if (!title) {
        errorEl.textContent = "Titel ist ein Pflichtfeld.";
        errorEl.style.display = "block";
        return;
      }
      const editId = document.getElementById("news-edit-id").value;
      const item = {
        id: editId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
        type: document.getElementById("news-type").value,
        date: document.getElementById("news-date").value || new Date().toISOString().slice(0, 10),
        title,
        text: document.getElementById("news-text").value.trim()
      };
      const toolId = document.getElementById("news-tool").value;
      if (toolId) item.toolId = toolId;
      const prev = newsState.slice();
      newsState = editId ? newsState.map((x) => (x.id === editId ? item : x)) : [item, ...newsState];
      newsFormReset();
      await persistNews(prev);
    });
    document.getElementById("btn-news-cancel").addEventListener("click", () => newsFormReset());
    newsFormReset();
  }
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
  document.getElementById("version-badge-nav").textContent = "v" + APP_VERSION;
  renderChangelog();
  renderNews();
  setupTabs();
  setupAuthForms();

  // fetchVisibility() (öffentlich, kein Login nötig) und checkSession() (prüft
  // ein vorhandenes Token) sind voneinander unabhängige Worker-Aufrufe — parallel
  // statt seriell spart einen kompletten Roundtrip beim Erstladen.
  const [data] = await Promise.all([fetchVisibility(), checkSession()]);
  visibilityState = (data && data.tools) || defaultVisibility();
  newsState = (data && Array.isArray(data.news)) ? data.news : newsState; // Server-News, sonst statisches Seed behalten
  bootstrapAvailable = !!(data && data.bootstrapAvailable);
  renderNews();

  renderAdminPanels();
  renderToolGrid();
  await loadCalendarWidget();
  if (currentUser && currentUser.isAdmin) {
    // Gruppen und Nutzer sind voneinander unabhängige Aktionen (Render-Funktionen
    // greifen erst beim Aufklappen einzelner Gruppen aufeinander zu, nicht hier).
    await Promise.all([loadAndRenderGroups(), loadAndRenderUsers()]);
    renderVisibilityList();
    renderNewsAdmin();
  }

  // Beim allerersten Besuch (noch kein Nutzerkonto vorhanden) direkt in den
  // Admin-Tab springen, wo das "Admin-Konto einrichten"-Formular wartet.
  if (bootstrapAvailable && !currentUser) {
    activateTab("admin");
  }
}

init();
