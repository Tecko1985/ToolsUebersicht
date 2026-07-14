// Worker-URL des admin-worker.js (siehe README für Deploy-Anleitung).
const WORKER_URL = "https://landingpage.michel-brunner.workers.dev";
const WIKI_WORKER_URL = "https://vereinswiki.michel-brunner.workers.dev";
const TOKEN_STORAGE_KEY = "tu_session_token";
const TOOL_ORDER_STORAGE_KEY = "tu_tool_order";

let visibilityState = {};
let newsState = (typeof NEWS !== "undefined" ? NEWS.slice() : []); // Server-News, initial das statische Seed/Fallback aus config.js
let bootstrapAvailable = false;
let currentToken = null;
let currentUser = null; // { username, isAdmin, groupIds, realIsAdmin, viewAsGroupId } oder null
let trainerdatenStatus = null; // Antwort von my-trainerdaten-status für die Badge-Anzeige auf der Trainerdaten-Kachel, null = kein Badge
let _trainerdatenStatusLastFetch = 0; // Date.now() der letzten loadTrainerdatenStatus()-Abfrage, siehe visibilitychange-Listener unten
let testspielplanerStatus = null; // Antwort von my-testspielplaner-status (Badge "Gegner eintragen" auf der Testspielplaner-Kachel), null = kein Badge
let _testspielplanerStatusLastFetch = 0; // analog _trainerdatenStatusLastFetch
let directoryGroupsState = []; // { id, name }[], für den Testansicht-Umschalter im Header (auch während aktiver Testansicht ladbar)

// isAdmin/groupIds sind die effektive Identität (siehe set-view-as im Worker);
// realIsAdmin bleibt der echte Admin-Status, damit der Testansicht-Umschalter
// selbst auch waehrend einer aktiven Testansicht sichtbar/bedienbar bleibt.
function buildCurrentUser(data) {
  return {
    username: data.username,
    isAdmin: !!data.isAdmin,
    groupIds: data.groupIds || [],
    realIsAdmin: !!data.realIsAdmin,
    viewAsGroupId: data.viewAsGroupId || null
  };
}
let pendingFirstLoginUsername = null;
let pendingLoginUsername = null;
let groupsState = [];
let usersState = [];
let dragState = null; // aktiver Drag-Vorgang beim Verschieben einer Tool-Karte, sonst null
let feedbackState = []; // Feedback-/Wunsch-Einträge, nur für eingeloggte Admins geladen (siehe loadAndRenderFeedback)

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
    const err = new Error((data && data.error) || ("Worker-Fehler (HTTP " + resp.status + ")"));
    if (data && data.archived) err.archived = true;
    throw err;
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
    currentUser = buildCurrentUser(data);
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
  currentUser = buildCurrentUser(data);
  storeToken(currentToken);
  return { success: true };
}

async function setFirstPassword(username, password) {
  const data = await callWorker("set-password", { username, password });
  currentToken = data.token;
  currentUser = buildCurrentUser(data);
  storeToken(currentToken);
  pendingFirstLoginUsername = null;
}

async function bootstrapAdmin(username, password) {
  const data = await callWorker("bootstrap-admin", { username, password });
  currentToken = data.token;
  currentUser = buildCurrentUser(data);
  storeToken(currentToken);
  bootstrapAvailable = false;
}

function logout() {
  currentToken = null;
  currentUser = null;
  trainerdatenStatus = null;
  pendingFirstLoginUsername = null;
  pendingLoginUsername = null;
  storeToken(null);
  renderAdminPanels();
  renderToolGrid();
  renderFeedbackTab();
  loadSidebarWidget();
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
    renderMannschaftSuggestions();
    document.getElementById("users-count").textContent = usersState.length;
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  }
}

// Füllt das <datalist> für die Mannschaft(en)-Felder (Anlegen + Bearbeiten) mit allen
// bereits vergebenen Mannschaftsnamen — Autovervollständigung, die zugleich hilft,
// konsistente Namen zu treffen (wichtig fürs Kadermanager-Team-Matching beim Auto-Provisioning).
function renderMannschaftSuggestions() {
  const dl = document.getElementById("mannschaft-suggestions");
  if (!dl) return;
  const set = new Set();
  usersState.forEach((u) => (u.mannschaften || []).forEach((m) => {
    const t = String(m || "").trim();
    if (t) set.add(t);
  }));
  const names = Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
  dl.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}

// Baut eine einzelne Nutzer-Zeile (Bearbeiten/Passwort/Löschen) — von
// renderUsersList sowohl für die flache als auch die nach Gruppen sortierte
// Darstellung verwendet.
function buildUserRow(u) {
  const row = document.createElement("div");
  row.className = "user-row";
  row.innerHTML = `
    <div class="ur-main">
      <span class="ur-name">${escapeHtml(u.displayName || u.username)}</span>
      <span class="muted">(${escapeHtml(u.username)})</span>
      ${u.isAdmin ? '<span class="badge-admin">Admin</span>' : ""}
      ${u.mustSetPassword ? '<span class="badge-warning">Passwort nicht gesetzt</span>' : ""}
      <button type="button" class="btn secondary small" data-toggle-edit-user="${escapeHtml(u.username)}">Bearbeiten</button>
      <button type="button" class="btn secondary small" data-reset-user="${escapeHtml(u.username)}">Passwort zurücksetzen</button>
      <button type="button" class="btn danger small" data-delete-user="${escapeHtml(u.username)}">Löschen</button>
    </div>
    <div class="ur-groups" data-edit-user-for="${escapeHtml(u.username)}" style="display:none;"></div>
  `;
  return row;
}

// Aufklappbarer Abschnitt für eine Gruppe innerhalb der Nutzerliste. Ein
// Nutzer in mehreren Gruppen erscheint entsprechend in mehreren Abschnitten —
// konsistent damit, dass auch die Mitglieder-Auswahl einer Gruppe unabhängig
// von anderen Mitgliedschaften des Nutzers ist.
function buildUserGroupSection(name, members) {
  const details = document.createElement("details");
  details.className = "collapsible user-group-section";
  const summary = document.createElement("summary");
  summary.textContent = `${name} (${members.length})`;
  details.appendChild(summary);
  if (members.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Keine Mitglieder.";
    details.appendChild(empty);
  } else {
    members.forEach((u) => details.appendChild(buildUserRow(u)));
  }
  return details;
}

function renderUsersList(users) {
  const container = document.getElementById("users-list");
  container.innerHTML = "";

  if (groupsState.length === 0) {
    // Keine Gruppen angelegt — Gruppierung wäre nur ein einzelner "Ohne
    // Gruppe"-Abschnitt und damit reine Mehrarbeit beim Aufklappen.
    users.forEach((u) => container.appendChild(buildUserRow(u)));
  } else {
    const sortedGroups = groupsState.slice().sort((a, b) => a.name.localeCompare(b.name, "de"));
    const groupedUsernames = new Set();
    sortedGroups.forEach((g) => {
      const members = users.filter((u) => (u.groupIds || []).includes(g.id));
      members.forEach((u) => groupedUsernames.add(u.username));
      container.appendChild(buildUserGroupSection(g.name, members));
    });
    const ohneGruppe = users.filter((u) => !groupedUsernames.has(u.username));
    if (ohneGruppe.length > 0) {
      container.appendChild(buildUserGroupSection("Keine Gruppe", ohneGruppe));
    }
  }

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
        <div class="gp-label">Gruppen</div>
        <div class="group-picker"></div>
        <div class="form-grid" style="align-items:flex-end; margin-top:12px;">
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
            <input type="text" data-edit-user-mannschaften list="mannschaft-suggestions" value="${escapeHtml((user.mannschaften || []).join(", "))}" placeholder="z. B. B-Jugend, C-Jugend" />
          </div>
          <div class="form-field">
            <label class="checkbox-label" style="margin-top:22px;"><input type="checkbox" data-edit-user-is-admin ${user.isAdmin ? "checked" : ""} /> Admin-Rechte</label>
          </div>
          <div class="form-field">
            <label class="checkbox-label" style="margin-top:22px;"><input type="checkbox" data-edit-user-vertrag-benoetigt ${user.vertragBenoetigt ? "checked" : ""} /> Vertrag benötigt</label>
          </div>
          <div class="form-field">
            <button type="button" class="btn small" data-save-edit-user="${escapeHtml(username)}">Speichern</button>
          </div>
        </div>
      `;
      renderGroupCheckboxes(panel.querySelector(".group-picker"), user ? user.groupIds : []);
      panel.style.display = "block";
      panel.querySelector("[data-save-edit-user]").addEventListener("click", async () => {
        const vorname = panel.querySelector("[data-edit-user-vorname]").value.trim();
        const nachname = panel.querySelector("[data-edit-user-nachname]").value.trim();
        const isAdmin = panel.querySelector("[data-edit-user-is-admin]").checked;
        const lizenz = panel.querySelector("[data-edit-user-lizenz]").value;
        const mannschaften = panel.querySelector("[data-edit-user-mannschaften]").value
          .split(",").map((s) => s.trim()).filter(Boolean);
        const vertragBenoetigt = panel.querySelector("[data-edit-user-vertrag-benoetigt]").checked;
        const desiredGroupIds = getCheckedValues(panel.querySelector(".group-picker"));
        const errorEl = document.getElementById("users-error");
        errorEl.style.display = "none";
        try {
          const result = await callWorker("update-user", { username, vorname, nachname, isAdmin, lizenz, mannschaften, vertragBenoetigt });
          // Bei Namensänderung zieht der Worker den Login-Nutzernamen automatisch mit
          // (usernameRename.applied) — die Gruppenmitgliedschaft muss dann unter dem
          // NEUEN Nutzernamen gepflegt werden, sonst fällt der Nutzer beim folgenden
          // update-group-members-Aufruf aus jeder Gruppe raus (unbekannter alter Key,
          // siehe handleUpdateGroupMembers-Filter im Worker).
          const rename = result.usernameRename;
          const effectiveUsername = (rename && rename.applied) ? rename.to : username;
          await applyUserGroupMembership(username, effectiveUsername, desiredGroupIds);
          await loadAndRenderGroups();
          await loadAndRenderUsers();
          renderAccessOverview();
          if (rename) {
            errorEl.style.color = rename.applied ? "#2c5e2e" : "#c0392b";
            errorEl.textContent = rename.applied
              ? `Hinweis: Login-Nutzername wurde von „${rename.from}“ zu „${rename.to}“ angepasst (Namensänderung).`
              : `Name gespeichert, aber der Login-Nutzername „${rename.to}“ ist bereits durch ein anderes Konto belegt und konnte nicht automatisch angepasst werden — bitte das andere Konto prüfen.`;
            errorEl.style.display = "block";
          }
        } catch (e) {
          errorEl.style.color = "#c0392b";
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
      if (!confirm(`Nutzer "${username}" wirklich löschen?\n\nDas entfernt das Konto vollständig (inkl. aller Gruppen) und kann NICHT rückgängig gemacht werden. "Passwort zurücksetzen" funktioniert danach nicht mehr — für einen Neustart muss der Nutzer über "Nutzer anlegen" komplett neu angelegt werden.`)) return;
      const errorEl = document.getElementById("users-error");
      errorEl.style.display = "none";
      try {
        await callWorker("delete-user", { username });
        await loadAndRenderGroups();
        await loadAndRenderUsers();
        renderAccessOverview();
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
// groupsState ist der Stand VOR dieser Bearbeitung und kennt bei einer
// Umbenennung nur den alten Nutzernamen; Mitgliedschaft deshalb unter dem
// alten Namen prüfen (passend zum Cache) und in memberUsernames immer beide
// Varianten herausfiltern, bevor ggf. der neue Name wieder ergänzt wird —
// sonst überlebt eine im selben Speichervorgang entfernte Gruppe die
// Umbenennung unbemerkt (der Server hat den alten Namen zu diesem Zeitpunkt
// serverseitig schon in jede bisherige Gruppe umgetragen).
async function applyUserGroupMembership(oldUsername, newUsername, desiredGroupIds) {
  for (const group of groupsState) {
    const isMember = group.memberUsernames.includes(oldUsername);
    const shouldBeMember = desiredGroupIds.includes(group.id);
    if (isMember === shouldBeMember) continue;
    const memberUsernames = group.memberUsernames.filter((m) => m !== oldUsername && m !== newUsername);
    if (shouldBeMember) memberUsernames.push(newUsername);
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
const PROVISIONABLE_APPS = ["personalkosten", "trainercheckliste", "kadermanager", "trainerdaten", "trainerkodex"];

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
          renderAccessOverview();
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
          renderAccessOverview();
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
        renderAccessOverview();
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
  // Kein gespeicherter Eintrag (z.B. Tool per Code-Push neu hinzugefügt, aber
  // noch nie im Sichtbarkeits-Panel gespeichert) gilt als versteckt, nicht als
  // öffentlich — passend zu userMayAccessTool() im Worker, das den WebDAV-
  // Gatewayzugriff für genau diesen Fall schon immer verweigert hat.
  const entry = visibilityState[toolId];
  if (!entry || entry.visible === false) return false;
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
        ${t.id === "trainerdaten" && trainerdatenStatus ? (
          trainerdatenStatus.trainerdatenGesamtOk
            ? '<div class="badge-status-ok">✓ Daten vollständig<button type="button" class="badge-refresh" title="Status aktualisieren" aria-label="Status aktualisieren">⟳</button></div>'
            : '<div class="badge-status-fail">✗ Daten unvollständig<button type="button" class="badge-refresh" title="Status aktualisieren" aria-label="Status aktualisieren">⟳</button></div>'
        ) : ""}
        ${t.id === "testspielplaner" && testspielplanerStatus
          ? `<div class="badge-status-fail">✗ ${testspielplanerStatus.anstehendOhneGegner}× Gegner eintragen</div>`
          : ""}
        <h3>${escapeHtml(t.name)}</h3>
        <p>${escapeHtml(t.description || "")}</p>
      `;
      card.querySelector(".tool-drag-handle").addEventListener("pointerdown", (ev) => startCardDrag(ev, card, grid, category));
      card.addEventListener("click", (ev) => { if (card.dataset.justDragged === "1") ev.preventDefault(); });
      const badgeRefreshBtn = card.querySelector(".badge-refresh");
      if (badgeRefreshBtn) {
        // Eigener Klick-Handler statt Karten-Navigation -- erlaubt ein sofortiges
        // Neuladen des Ampel-Status (my-trainerdaten-status), ohne die Seite neu
        // zu laden. loadTrainerdatenStatus() ruft am Ende selbst renderToolGrid()
        // auf, baut diesen Button also gleich wieder frisch auf -- kein manuelles
        // Zurücksetzen von disabled/Text nötig.
        badgeRefreshBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          badgeRefreshBtn.disabled = true;
          badgeRefreshBtn.textContent = "…";
          loadTrainerdatenStatus();
        });
      }
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

// Vereinswiki hat seit 1.3 keine eigene Kachel mehr, braucht aber weiterhin eine
// Sichtbarkeits-Konfiguration fuer die Frage-Box in "Feedback & Hilfe" (siehe
// renderFeedbackTab) -- sonst kann ein Admin sie nie (wieder) einstellen.
const VIRTUAL_VISIBILITY_ENTRIES = [
  { id: "vereinswiki", name: "Toolbox Wiki (Frage-Funktion in „Feedback & Hilfe“)", icon: "📚", category: "Verein" }
];

function renderVisibilityList() {
  const container = document.getElementById("visibility-list");
  container.innerHTML = "";
  TOOLS.concat(VIRTUAL_VISIBILITY_ENTRIES).forEach((t) => {
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
      <details class="collapsible visibility-groups">
        <summary>Gruppen (${groupIds.length} sehen, ${editGroupIds.length} bearbeiten)</summary>
        <div class="group-picker-wrap" data-field="groupIds" style="display:${mode === "groups" ? "block" : "none"};">
          <div class="gp-label">Sehen</div>
          <div class="group-picker" data-role="see-boxes"></div>
        </div>
        <div class="group-picker-wrap" data-field="editGroupIds">
          <div class="gp-label">Bearbeiten</div>
          <div class="group-picker" data-role="edit-boxes"></div>
        </div>
      </details>
    `;
    container.appendChild(row);

    renderGroupCheckboxes(row.querySelector('[data-field="groupIds"] [data-role="see-boxes"]'), groupIds);
    renderGroupCheckboxes(row.querySelector('[data-field="editGroupIds"] [data-role="edit-boxes"]'), editGroupIds);

    row.querySelector('[data-field="mode"]').addEventListener("change", (e) => {
      const isGroups = e.target.value === "groups";
      row.querySelector('[data-field="groupIds"]').style.display = isGroups ? "block" : "none";
      if (isGroups) row.querySelector(".visibility-groups").open = true;
    });
  });
}

// Reine Lese-Ansicht "wer hat worauf Zugriff" -- fasst zusammen, was Gruppen- und
// Sichtbarkeits-Panel bereits einzeln speichern, ohne das nochmal zusammenzurechnen
// (dieselben visibilityState/groupsState-Daten, kein neuer Worker-Aufruf nötig).
function groupChipsHtml(ids) {
  if (!ids || ids.length === 0) return "";
  return ids.map((id) => {
    const g = groupsState.find((x) => x.id === id);
    const label = g ? `${g.name} (${g.memberUsernames.length})` : id;
    return `<span class="access-chip">${escapeHtml(label)}</span>`;
  }).join("");
}

function renderAccessOverview() {
  const container = document.getElementById("access-overview-list");
  if (!container) return;
  container.innerHTML = "";
  TOOLS.concat(VIRTUAL_VISIBILITY_ENTRIES).forEach((t) => {
    const entry = visibilityState[t.id] || {};
    const mode = visibilityMode(entry);
    const editGroupIds = entry.editGroupIds || [];
    const modeLabel = {
      hidden: "Versteckt",
      public: "Öffentlich (auch ohne Login)",
      loggedin: "Alle eingeloggten Nutzer",
      groups: ""
    }[mode];
    const seeHtml = mode === "groups" ? groupChipsHtml(entry.groupIds) : `<span class="muted">${modeLabel}</span>`;
    const editHtml = editGroupIds.length > 0 ? groupChipsHtml(editGroupIds) : `<span class="muted">Nur Admin</span>`;
    const row = document.createElement("div");
    row.className = "access-row";
    row.innerHTML = `
      <div class="ar-header">
        <span class="tool-icon">${t.icon || "🔗"}</span>
        <span class="ar-name">${escapeHtml(t.name)}</span>
      </div>
      <div class="ar-cols">
        <div class="ar-col"><div class="gp-label">Sehen</div><div class="access-chips">${seeHtml}</div></div>
        <div class="ar-col"><div class="gp-label">Bearbeiten</div><div class="access-chips">${editHtml}</div></div>
      </div>
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

// ---- Sidebar-Widget: nächste Termine + Abwesenheiten links neben den Kacheln ----
// Nutzt dieselbe Sichtbarkeitsregel wie die Tool-Karte (isVisibleToUser) und
// dieselbe Gateway-Aktion (dav-load) wie die jeweilige App selbst — rein
// lesend, kein eigener Worker-Code nötig. Kalender- und Abwesenheiten-Teil sind
// UNABHÄNGIG voneinander sichtbar (unterschiedliche Apps, unterschiedliche
// Sichtbarkeits-Gruppen) — ein Nutzer mit nur einer der beiden Berechtigungen
// sieht trotzdem den für ihn zutreffenden Teil, siehe loadSidebarWidget.
const CALENDAR_WIDGET_APP_ID = "vereinskalender";
const CALENDAR_WIDGET_COUNT = 8;
const ABSENCE_WIDGET_APP_ID = "abwesenheitskalender";
const ABSENCE_WIDGET_COUNT = 4;

function absenceSortKey(a) { return `${a.von}_${a.bis}`; }

// Kompakte Zeitraum-Anzeige ohne Jahr (analog formatCalendarDate) -- "17.–20.08."
// bzw. "28.02.–02.03." bzw. nur "17.08." bei eintägiger Abwesenheit (von===bis).
function formatAbsenceRange(von, bis) {
  const mv = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(von || ""));
  const mb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(bis || ""));
  if (!mv) return "";
  if (!mb || bis === von) return `${mv[3]}.${mv[2]}.`;
  if (mv[2] === mb[2]) return `${mv[3]}.–${mb[3]}.${mv[2]}.`;
  return `${mv[3]}.${mv[2]}.–${mb[3]}.${mb[2]}.`;
}

function absencePersonName(a) {
  return (a.vorname || a.nachname) ? `${a.vorname || ""} ${a.nachname || ""}`.trim() : (a.erstelltVon || "Unbekannt");
}

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

// Liefert die Namen aller Trainer, die laut Trainerdaten HEUTE Geburtstag haben
// (list-birthdays-today, siehe admin-worker.js) -- kein Geburtsjahr, keine
// anderen Felder. Scheitert die Abfrage, wird das Widget dadurch NICHT
// ausgeblendet (anders als ein Fehler bei dav-load) -- Geburtstage sind reine
// Zusatzinfo, kein Grund die Termine selbst zu verstecken.
async function loadBirthdaysToday() {
  try {
    const res = await callWorker("list-birthdays-today", {});
    return Array.isArray(res && res.namen) ? res.namen : [];
  } catch (e) {
    console.warn("Geburtstage nicht ladbar:", e);
    return [];
  }
}

// Lädt den Ampel-Status für die Trainerdaten-Kachel (my-trainerdaten-status,
// siehe admin-worker.js) — analog loadBirthdaysToday: Fehler werden geschluckt
// (Badge verschwindet dann einfach statt die Kachel zu blockieren). Kein Badge,
// solange kein Trainerdaten-Datensatz existiert (vorhanden:false) -- das ist
// kein Fehlerfall, sondern z.B. ein Nutzer ohne Trainerrolle.
async function loadTrainerdatenStatus() {
  _trainerdatenStatusLastFetch = Date.now();
  if (!currentUser || !isVisibleToUser("trainerdaten", currentUser)) {
    trainerdatenStatus = null;
    return;
  }
  try {
    const res = await callWorker("my-trainerdaten-status", {});
    trainerdatenStatus = (res && res.vorhanden) ? res : null;
  } catch (e) {
    console.warn("Trainerdaten-Status nicht ladbar:", e);
    trainerdatenStatus = null;
  }
  renderToolGrid();
}

// Badge "Gegner eintragen" auf der Testspielplaner-Kachel (my-testspielplaner-status,
// siehe admin-worker.js) — gleiches Muster wie loadTrainerdatenStatus: Fehler werden
// geschluckt (z.B. "Unbekannte Aktion" vor dem Worker-Redeploy -> einfach kein Badge).
async function loadTestspielplanerStatus() {
  _testspielplanerStatusLastFetch = Date.now();
  if (!currentUser || !isVisibleToUser("testspielplaner", currentUser)) {
    testspielplanerStatus = null;
    return;
  }
  try {
    const res = await callWorker("my-testspielplaner-status", {});
    testspielplanerStatus = (res && res.anstehendOhneGegner > 0) ? res : null;
  } catch (e) {
    console.warn("Testspielplaner-Status nicht ladbar:", e);
    testspielplanerStatus = null;
  }
  renderToolGrid();
}

async function loadSidebarWidget() {
  const widget = document.getElementById("calendar-widget");
  if (!widget) return;

  const showCalendar = !!currentUser && isVisibleToUser(CALENDAR_WIDGET_APP_ID, currentUser);
  const showAbsences = !!currentUser && isVisibleToUser(ABSENCE_WIDGET_APP_ID, currentUser);
  if (!showCalendar && !showAbsences) {
    widget.dataset.hasContent = "0";
    widget.style.display = "none";
    widget.innerHTML = "";
    return;
  }

  let oeffentlich = [], privat = [], kategorien = [], geburtstage = [];
  let absences = [], absenceKategorien = [];
  let calendarFailed = false, absenceFailed = false;

  const calendarPromise = showCalendar
    ? Promise.all([callWorker("dav-load", { app: CALENDAR_WIDGET_APP_ID }), loadBirthdaysToday()])
        .then(([res, namen]) => {
          const data = res && res.data && typeof res.data === "object" ? res.data : {};
          const termine = Array.isArray(data.termine) ? data.termine : [];
          kategorien = Array.isArray(data.kategorien) ? data.kategorien : [];
          const today = new Date().toISOString().slice(0, 10);
          const upcoming = termine
            .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.datum || "") && calendarTerminEndIso(t) >= today)
            .filter((t) => calendarTerminVisibleFor(t, currentUser))
            .sort((a, b) => calendarSortKey(a).localeCompare(calendarSortKey(b)));
          oeffentlich = upcoming.filter((t) => !t.privat).slice(0, CALENDAR_WIDGET_COUNT);
          privat = upcoming.filter((t) => t.privat).slice(0, CALENDAR_WIDGET_COUNT);
          geburtstage = namen;
        })
        .catch((e) => { console.warn("Vereinskalender-Widget nicht ladbar:", e); calendarFailed = true; })
    : Promise.resolve();

  const absencePromise = showAbsences
    ? callWorker("dav-load", { app: ABSENCE_WIDGET_APP_ID })
        .then((res) => {
          const data = res && res.data && typeof res.data === "object" ? res.data : {};
          const abwesenheiten = Array.isArray(data.abwesenheiten) ? data.abwesenheiten : [];
          absenceKategorien = Array.isArray(data.kategorien) ? data.kategorien : [];
          const today = new Date().toISOString().slice(0, 10);
          absences = abwesenheiten
            .filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.bis || "") && a.bis >= today)
            .sort((a, b) => absenceSortKey(a).localeCompare(absenceSortKey(b)))
            .slice(0, ABSENCE_WIDGET_COUNT);
        })
        .catch((e) => { console.warn("Abwesenheitskalender-Widget nicht ladbar:", e); absenceFailed = true; })
    : Promise.resolve();

  await Promise.all([calendarPromise, absencePromise]);

  const calendarOk = showCalendar && !calendarFailed;
  const absenceOk = showAbsences && !absenceFailed;
  if (!calendarOk && !absenceOk) {
    widget.dataset.hasContent = "0";
    widget.style.display = "none";
    widget.innerHTML = "";
    return;
  }

  renderSidebarWidget(widget, {
    showCalendar: calendarOk, oeffentlich, privat, kategorien, geburtstage,
    showAbsences: absenceOk, absences, absenceKategorien
  });
}

function renderSidebarWidget(widget, opts) {
  const { showCalendar, oeffentlich, privat, kategorien, geburtstage, showAbsences, absences, absenceKategorien } = opts;
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
  // Geburtstage (immer nur die von HEUTE, siehe list-birthdays-today) stehen
  // als eigene, nicht verlinkte Zeilen ganz oben -- kein Termin-Objekt aus dem
  // Vereinskalender, daher kein href dorthin.
  const birthdayRowHtml = (name) => `
        <div class="calendar-widget-item calendar-widget-birthday">
          <span class="cw-date">Heute</span>
          <span class="cw-emoji">🎂</span>
          <span class="cw-title">${escapeHtml(name)} hat Geburtstag</span>
        </div>
      `;

  let calendarHtml = "";
  if (showCalendar) {
    const rows = (geburtstage.length || oeffentlich.length)
      ? geburtstage.map(birthdayRowHtml).join("") + oeffentlich.map(rowHtml).join("")
      : '<p class="muted" style="padding:4px 0;">Keine anstehenden Termine.</p>';
    // Private Termine (nur für den eingeloggten Nutzer sichtbar, siehe
    // calendarTerminVisibleFor) stehen als eigener Abschnitt UNTER den normalen
    // Terminen — der Abschnitt fehlt ganz, wenn der Nutzer keine hat.
    const privateSection = privat.length ? `
      <h2 class="calendar-widget-sub-heading">🔒 Private Termine</h2>
      <div class="calendar-widget-list">${privat.map(rowHtml).join("")}</div>
    ` : "";
    calendarHtml = `
      <h2>📅 Nächste Termine</h2>
      <div class="calendar-widget-list">${rows}</div>
      ${privateSection}
    `;
  }

  // Abwesenheiten-Abschnitt: eigene App/Sichtbarkeit, daher unabhängig vom
  // Kalender-Teil gerendert (siehe loadSidebarWidget) — nutzt dasselbe
  // .calendar-widget-item/.cw-date/.cw-dot/.cw-title-Markup für optische
  // Konsistenz mit den Termin-Zeilen darüber.
  let absenceHtml = "";
  if (showAbsences) {
    const absTool = toolById(ABSENCE_WIDGET_APP_ID);
    const absUrl = absTool ? absTool.url : "#";
    const absKatFarbe = (id) => {
      const k = absenceKategorien.find((k2) => k2.id === id);
      return k ? k.farbe : "#6b7280";
    };
    const absKatName = (id) => {
      const k = absenceKategorien.find((k2) => k2.id === id);
      return k ? k.name : "Sonstiges";
    };
    const absRowHtml = (a) => `
      <a class="calendar-widget-item" href="${escapeHtml(absUrl)}">
        <span class="cw-date">${escapeHtml(formatAbsenceRange(a.von, a.bis))}</span>
        <span class="cw-dot" style="background:${escapeHtml(absKatFarbe(a.kategorie))}"></span>
        <span class="cw-title">${escapeHtml(absencePersonName(a))} (${escapeHtml(absKatName(a.kategorie))})</span>
      </a>
    `;
    const absRows = absences.length
      ? absences.map(absRowHtml).join("")
      : '<p class="muted" style="padding:4px 0;">Keine anstehenden Abwesenheiten.</p>';
    absenceHtml = `
      <h2 class="calendar-widget-sub-heading">🧳 Nächste Abwesenheiten</h2>
      <div class="calendar-widget-list">${absRows}</div>
    `;
  }

  widget.innerHTML = `<div class="card">${calendarHtml}${absenceHtml}</div>`;
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

// ---- Feedback & Hilfe ----

// Bewusst kein "Once"-Cache wie bei newsToolOptionsOnce: welche Tools zur Auswahl
// stehen, hängt von isVisibleToUser() (Login-Status + Gruppen des AKTUELLEN Nutzers)
// ab, nicht von einer festen Liste — muss bei jedem Tab-/Login-Wechsel neu gebaut
// werden, sonst zeigt das Dropdown nach einem Nutzerwechsel noch die Tools des
// vorherigen Nutzers.
function renderFeedbackToolOptions() {
  const sel = document.getElementById("feedback-tool");
  if (!sel) return;
  sel.innerHTML = "";
  const allgemein = document.createElement("option");
  allgemein.value = "";
  allgemein.textContent = "— Allgemein —";
  sel.appendChild(allgemein);
  TOOLS.filter((t) => isVisibleToUser(t.id, currentUser)).forEach((t) => {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = t.name;
    sel.appendChild(o);
  });
}

// Feedback-Tab ist komplett login-gated (wie das Dashboard bis zum ersten sichtbaren
// Tool) — einfaches an/aus je nach currentUser, kein Feingranulares wie renderToolGrid.
function renderFeedbackTab() {
  const emptyEl = document.getElementById("feedback-empty");
  const contentEl = document.getElementById("feedback-content");
  if (!emptyEl || !contentEl) return;
  if (!currentUser) {
    emptyEl.style.display = "block";
    contentEl.style.display = "none";
    return;
  }
  emptyEl.style.display = "none";
  contentEl.style.display = "block";
  renderFeedbackToolOptions();
  const wikiCard = document.getElementById("wiki-ask-card");
  if (wikiCard) wikiCard.style.display = isVisibleToUser("vereinswiki", currentUser) ? "block" : "none";
}

// Fragen ans Toolbox Wiki, direkt hier ganz oben im Tab eingebettet (statt einer
// eigenen Kachel) — wer Hilfe braucht, soll sich erst selbst helfen lassen können,
// bevor Feedback/Hilfe angefragt wird. Ruft den separaten wiki-worker (Gemini)
// direkt mit dem hier schon vorhandenen currentToken auf (gleiches Login-Token,
// gleiche Origin) — kein eigener Login-Umweg nötig. Sichtbarkeit folgt derselben
// isVisibleToUser()-Regel wie die Tool-Kachel (siehe renderFeedbackTab), da der
// wiki-worker serverseitig denselben Zugriffscheck macht.
async function askWiki(question) {
  let resp;
  try {
    resp = await fetch(WIKI_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + currentToken },
      body: JSON.stringify({ question })
    });
  } catch (e) {
    throw new Error("Wissens-Assistent nicht erreichbar.");
  }
  let data = null;
  try { data = await resp.json(); } catch (_) { /* kein JSON-Body */ }
  if (!resp.ok) {
    throw new Error((data && data.error) || ("Assistent-Fehler (HTTP " + resp.status + ")"));
  }
  return data;
}

function setupWikiFrage() {
  const btn = document.getElementById("btn-wiki-frage");
  if (!btn) return;
  btn.addEventListener("click", handleWikiFrage);
  document.getElementById("wiki-frage-input").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); handleWikiFrage(); }
  });
}

async function handleWikiFrage() {
  const input = document.getElementById("wiki-frage-input");
  const q = input.value.trim();
  if (!q) { input.focus(); return; }
  const btn = document.getElementById("btn-wiki-frage");
  btn.disabled = true;
  showWikiAntwortLoading(q);
  try {
    const res = await askWiki(q);
    const anzahl = typeof res.dokumentAnzahl === "number" ? res.dokumentAnzahl : null;
    const meta = "KI-generiert" + (anzahl != null ? ` auf Basis von ${anzahl} Dokument${anzahl === 1 ? "" : "en"}` : "") + ", bitte im Zweifel im Originaldokument prüfen.";
    showWikiAntwort(q, res.answer || "(keine Antwort erhalten)", meta);
  } catch (e) {
    showWikiAntwort(q, "Es ist ein Fehler aufgetreten: " + e.message, "");
  } finally {
    btn.disabled = false;
  }
}

function showWikiAntwortLoading(frage) {
  const card = document.getElementById("wiki-antwort-card");
  card.style.display = "block";
  document.getElementById("wiki-antwort-frage").textContent = frage;
  document.getElementById("wiki-antwort-text").innerHTML = '<span class="muted">Der Assistent liest die Dokumente und formuliert eine Antwort …</span>';
  document.getElementById("wiki-antwort-meta").textContent = "";
}

function showWikiAntwort(frage, text, meta) {
  const card = document.getElementById("wiki-antwort-card");
  card.style.display = "block";
  document.getElementById("wiki-antwort-frage").textContent = frage;
  document.getElementById("wiki-antwort-text").innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
  document.getElementById("wiki-antwort-meta").textContent = meta || "";
}

function setupWhatsappLink() {
  const link = document.getElementById("feedback-whatsapp-link");
  if (!link) return;
  const text = "Hallo Michel, ich habe eine Frage/ein Feedback zu einem Tool:";
  link.href = "https://wa.me/" + WHATSAPP_CONTACT + "?text=" + encodeURIComponent(text);
}

// Lazy geladen (nur beim Kachel-Klick, siehe buildAdminDashboardCard und
// btn-admin-dashboard-refresh) statt in init()/afterAuthChange() wie die
// immer sichtbaren Einstellungen-Panels — spart den Worker-Call für Admins,
// die die Ansicht nie öffnen.
let adminStatsState = null; // letzte get-admin-stats-Antwort, für den Dropdown-Wechsel ohne Refetch

async function loadAndRenderAdminStats() {
  const errorEl = document.getElementById("admin-dashboard-error");
  const contentEl = document.getElementById("admin-dashboard-content");
  errorEl.style.display = "none";
  contentEl.style.display = "none";
  try {
    const data = await callWorker("get-admin-stats", {});
    adminStatsState = data;
    renderAdminStats(data);
    contentEl.style.display = "block";
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  }
}

function renderAdminStats(data) {
  document.getElementById("stat-users").textContent = `${data.users.passwordSet} von ${data.users.total}`;

  const trainerNote = document.getElementById("admin-dashboard-trainer-note");
  if (!data.trainerGroup.exists) {
    trainerNote.style.display = "block";
    document.getElementById("stat-trainervertrag").textContent = "–";
    document.getElementById("stat-trainervertrag-sub").textContent = "erstellt";
    document.getElementById("stat-trainerkodex").textContent = "–";
    document.getElementById("stat-jugendschutz").textContent = "–";
  } else {
    trainerNote.style.display = "none";
    const tv = data.trainervertrag;
    document.getElementById("stat-trainervertrag").textContent = `${tv.generiert} von ${tv.total}`;
    document.getElementById("stat-trainervertrag-sub").textContent =
      `erstellt · ${tv.ausstehend} ausstehend · ${tv.unvollstaendig} unvollständig`;
    document.getElementById("stat-trainerkodex").textContent = `${data.trainerkodex.confirmed} von ${data.trainerkodex.total}`;
    // Fallback "–", solange der Worker das Feld noch nicht liefert (alter Deploy).
    document.getElementById("stat-jugendschutz").textContent = data.jugendschutz ? `${data.jugendschutz.confirmed} von ${data.jugendschutz.total}` : "–";
  }

  document.getElementById("stat-feedback").textContent = String(data.feedbackOpen);
  document.getElementById("stat-materialbedarf").textContent = String(data.materialbedarfOpen);
  document.getElementById("stat-busplan").textContent = String(data.busplanOpen);
  // Fallback "–", solange der Worker das Feld noch nicht liefert (alter Deploy).
  document.getElementById("stat-testspielplaner").textContent = data.testspielplanerAngefragt == null ? "–" : String(data.testspielplanerAngefragt);

  renderRecentActivity();
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderRecentActivity() {
  const list = document.getElementById("admin-dashboard-recent-list");
  if (!list) return;
  const select = document.getElementById("admin-dashboard-recent-select");
  const kind = select ? select.value : "logins";
  const key = kind === "trainervertrag" ? "recentTrainervertrag" : kind === "trainerkodex" ? "recentTrainerkodex" : kind === "jugendschutz" ? "recentJugendschutz" : "recentLogins";
  const entries = (adminStatsState && Array.isArray(adminStatsState[key])) ? adminStatsState[key] : [];
  if (entries.length === 0) {
    list.innerHTML = '<li class="muted">Keine Daten vorhanden.</li>';
    return;
  }
  list.innerHTML = entries.map((e) => {
    const name = (e.vorname && e.nachname) ? `${e.vorname} ${e.nachname}` : e.username;
    return `<li><span>${escapeHtml(name)}</span><span class="recent-activity-when">${escapeHtml(fmtDateTime(e.at))}</span></li>`;
  }).join("");
}

// ---------- Export-Sammlung (Admin-Dashboard) ----------
// Sammelt die Export-Funktionen mehrerer Gateway-Apps an einem Ort, damit der
// Admin nicht für jeden Export einzeln in die jeweilige App wechseln muss. Holt
// die App-Daten über das bestehende dav-load-Gateway (Admin hat dort per
// userMayAccessTool()-Bypass ohnehin uneingeschränkten Lesezugriff, siehe
// admin-worker.js) und baut denselben Export dann hier nach — kein
// Worker-Redeploy nötig, da nur bereits existierende DAV_APPS-Einträge gelesen
// werden (materialliste, personalkosten, busplan, kleiderbestellung,
// materialbedarf, spielertool-test). Bewusst NICHT die Original-Exportfunktion
// der Ziel-App direkt aufrufen (die läuft im dortigen app.js, nicht hier) --
// kleine Formeln/Layouts werden repliziert, gleiches Muster wie an anderen
// Cross-App-Stellen dieses Workers (z.B. buildTrainerRecord).

async function exportHubLoadAppData(appId) {
  const res = await callWorker("dav-load", { app: appId });
  return res.data;
}

function downloadFile(filename, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Lokales Datum (nicht toISOString, das liefert UTC), siehe gleichnamige
// Helfer in Materialliste/Personalkosten -- gleicher Grund (Mitternachts-Bug).
function exportHubLocalDateIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function printExportHubContent() {
  document.body.classList.add("printing-report");
  const cleanup = () => { document.body.classList.remove("printing-report"); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  setTimeout(() => window.print(), 150);
}

// -- Materialliste / spielertool-test: reiner appData-JSON-Dump, 1:1 wie dort --

async function exportMateriallisteJson() {
  const data = await exportHubLoadAppData("materialliste");
  downloadFile("materialdaten-backup-" + exportHubLocalDateIso() + ".json", "application/json", JSON.stringify(data, null, 2));
}

async function exportSpielertoolJson() {
  const data = await exportHubLoadAppData("spielertool-test");
  downloadFile("spielerdaten-backup-" + exportHubLocalDateIso() + ".json", "application/json", JSON.stringify(data, null, 2));
}

// -- Personalkosten: Text/PDF, alle Bereiche+Felder (kein Auswahl-Modal wie im
// Original -- der Admin will hier den Gesamtexport, nicht eine Teilauswahl) --

const EXPORT_HUB_PK_FIELDS = [
  { key: "bereich", label: "Bereich" },
  { key: "name", label: "Name" },
  { key: "mannschaft", label: "Mannschaft" },
  { key: "position", label: "Position" },
  { key: "jahrgangsleiter", label: "Jahrgangsleiter" },
  { key: "lizenz", label: "Lizenz" },
  { key: "landesebene", label: "Landesebene" },
  { key: "stelle", label: "Stelle", num: true, fmt: (v) => (v == null ? "—" : exportHubFmtPct(v)) },
  { key: "ae100", label: "AE 100%", num: true, fmt: (v) => (v == null ? "—" : exportHubFmtEuro(v)) },
  { key: "aeMonat", label: "AE / Monat", num: true, fmt: (v) => exportHubFmtEuro(v) },
  { key: "besonderheit", label: "Besonderheit" }
];
function exportHubNumFmt(n, maxDec) {
  n = Number(n) || 0;
  return n.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: maxDec == null ? 2 : maxDec });
}
function exportHubFmtEuro(n) { return exportHubNumFmt(n, 2) + " €"; }
function exportHubFmtPct(factor) { return exportHubNumFmt((Number(factor) || 0) * 100, 1) + " %"; }
function exportHubBetragOf(list, label) {
  if (!label) return 0;
  const hit = (list || []).find((x) => x.label === label);
  return hit ? (Number(hit.betrag) || 0) : 0;
}
function exportHubTrainerAe100(t, parameter) {
  return exportHubBetragOf(parameter.positionen, t.position)
    + exportHubBetragOf(parameter.lizenzen, t.lizenz)
    + exportHubBetragOf(parameter.landesebene, t.landesebene)
    + exportHubBetragOf(parameter.jahrgangsleiter, t.jahrgangsleiter);
}
function exportHubTrainerAeIst(t, parameter) {
  if (t.manuellAE != null && t.manuellAE !== "") return Number(t.manuellAE) || 0;
  return exportHubTrainerAe100(t, parameter) * (Number(t.stelle) || 0);
}
function exportHubEntryAe(x) { return Number(x.ae) || 0; }

function exportHubPersonalRows(data) {
  const season = data.seasons[data.meta.currentSeason];
  const rows = [];
  (season.trainer || []).forEach((t) => rows.push({
    bereich: "Trainer", name: t.name || "", mannschaft: t.mannschaft || "", position: t.position || "",
    jahrgangsleiter: t.jahrgangsleiter || "", lizenz: t.lizenz || "", landesebene: t.landesebene || "",
    stelle: Number(t.stelle) || 0, ae100: exportHubTrainerAe100(t, data.parameter), aeMonat: exportHubTrainerAeIst(t, data.parameter),
    besonderheit: t.besonderheit || ""
  }));
  (season.schwerpunkt || []).forEach((x) => rows.push({
    bereich: "Schwerpunkttrainer", name: x.name || "", mannschaft: x.mannschaft || "", position: x.position || "",
    jahrgangsleiter: "", lizenz: "", landesebene: "", stelle: null, ae100: null,
    aeMonat: exportHubEntryAe(x), besonderheit: x.besonderheit || ""
  }));
  (season.foerderung || []).forEach((x) => rows.push({
    bereich: "Förderung", name: x.name || "", mannschaft: x.mannschaft || "", position: x.position || "",
    jahrgangsleiter: "", lizenz: "", landesebene: "", stelle: null, ae100: null,
    aeMonat: exportHubEntryAe(x), besonderheit: x.besonderheit || ""
  }));
  rows.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return rows;
}

async function exportPersonalkostenReport(format) {
  const data = await exportHubLoadAppData("personalkosten");
  const rows = exportHubPersonalRows(data);
  const seasonKey = data.meta.currentSeason;
  const fields = EXPORT_HUB_PK_FIELDS;
  const cell = (f, r) => (f.fmt ? f.fmt(r[f.key]) : (r[f.key] ?? ""));
  if (format === "pdf") {
    const theadHtml = `<tr>${fields.map((f) => `<th${f.num ? ' class="num"' : ""}>${escapeHtml(f.label)}</th>`).join("")}</tr>`;
    const rowsHtml = rows.map((r) => `<tr>${fields.map((f) => `<td${f.num ? ' class="num"' : ""}>${escapeHtml(String(cell(f, r)))}</td>`).join("")}</tr>`).join("");
    const total = rows.reduce((a, r) => a + (Number(r.aeMonat) || 0), 0);
    const totalRow = `<tr class="total-row">${fields.map((f, i) => {
      if (f.key === "aeMonat") return `<td class="num">${escapeHtml(exportHubFmtEuro(total))}</td>`;
      return i === 0 ? `<td>Summe (${rows.length} Personen)</td>` : "<td></td>";
    }).join("")}</tr>`;
    document.getElementById("print-content").innerHTML = `
      <h1>💶 Personalübersicht</h1>
      <p class="print-meta">Trainer, Schwerpunkttrainer, Förderung — Saison ${escapeHtml(seasonKey)} — erstellt am ${new Date().toLocaleString("de-DE")}</p>
      <table class="print-table"><thead>${theadHtml}</thead><tbody>${rowsHtml}${totalRow}</tbody></table>`;
    printExportHubContent();
    return;
  }
  const widths = fields.map((f) => Math.max(f.label.length, ...rows.map((r) => String(cell(f, r)).length)));
  const line = (cells) => cells.map((c, i) => {
    const s = String(c);
    return fields[i].num ? s.padStart(widths[i]) : s.padEnd(widths[i]);
  }).join("  ");
  const sepLine = widths.map((w) => "-".repeat(w)).join("  ");
  let out = `Personalübersicht (Trainer, Schwerpunkttrainer, Förderung) — Saison ${seasonKey}\n`;
  out += `Erstellt am ${new Date().toLocaleString("de-DE")}\n\n`;
  out += line(fields.map((f) => f.label)) + "\n" + sepLine + "\n";
  out += rows.map((r) => line(fields.map((f) => cell(f, r)))).join("\n") + "\n";
  const total = rows.reduce((a, r) => a + (Number(r.aeMonat) || 0), 0);
  out += sepLine + "\n" + `${rows.length} Personen — Summe AE / Monat: ${exportHubFmtEuro(total)}\n`;
  downloadFile(`personalkosten_${seasonKey.replace("/", "-")}_${exportHubLocalDateIso()}.txt`, "text/plain", "﻿" + out);
}

// -- Kleiderbestellung: Text/PDF. Beim Nachbauen fiel ein Bug im Original auf:
// exportZeilen() dort baut den Map-Key als `p.artikelId + "" + p.groesse` und
// liest artikelId/groesse per key.split("") wieder aus -- das splittet aber in
// EINZELNE ZEICHEN, nicht die zwei Original-Felder (".split("")" ist kein
// Trenner-Split). Die Summierung selbst bleibt richtig (gleicher Key wird
// konsistent verwendet), aber Artikelname/Größe in der Ausgabe sind kaputt,
// sobald artikelId/groesse mehr als ein Zeichen haben. Hier daher NICHT über
// einen zusammengesetzten Key re-parsen, sondern beide Felder direkt im
// Map-Value mitführen. (Fund gilt nur für diesen Nachbau -- das Original in
// E:\kleiderbestellung\app.js hat den Bug weiterhin.)

function exportHubGroessenIndex(artikelById, artikelId, groesse) {
  const artikel = artikelById[artikelId];
  if (!artikel) return 999;
  const idx = artikel.groessen.indexOf(groesse);
  return idx === -1 ? 999 : idx;
}

function exportHubKleiderZeilen(data) {
  const map = new Map();
  for (const b of Object.values(data.bestellungen || {})) {
    for (const p of (b.positionen || [])) {
      if (!p.menge) continue;
      const key = p.artikelId + "" + p.groesse;
      const entry = map.get(key) || { artikelId: p.artikelId, groesse: p.groesse, summe: 0 };
      entry.summe += Number(p.menge);
      map.set(key, entry);
    }
  }
  const artikelById = Object.fromEntries((data.katalog.artikel || []).map((a) => [a.id, a]));
  return [...map.values()]
    .map((z) => ({ ...z, artikelName: artikelById[z.artikelId] ? artikelById[z.artikelId].name : `(gelöscht: ${z.artikelId})` }))
    .sort((a, b) => a.artikelName.localeCompare(b.artikelName, "de") ||
      exportHubGroessenIndex(artikelById, a.artikelId, a.groesse) - exportHubGroessenIndex(artikelById, b.artikelId, b.groesse));
}

async function exportKleiderbestellungReport(format) {
  const data = await exportHubLoadAppData("kleiderbestellung");
  const zeilen = exportHubKleiderZeilen(data);
  if (!zeilen.length) throw new Error("Es liegen noch keine Bestellungen vor.");
  if (format === "pdf") {
    const theadHtml = `<tr><th>Artikel</th><th>Größe</th><th class="num">Menge</th></tr>`;
    const rowsHtml = zeilen.map((z) => `<tr><td>${escapeHtml(z.artikelName)}</td><td>${escapeHtml(z.groesse)}</td><td class="num">${escapeHtml(String(z.summe))}</td></tr>`).join("");
    const gesamt = zeilen.reduce((a, z) => a + z.summe, 0);
    const totalRow = `<tr class="total-row"><td>Gesamt</td><td></td><td class="num">${escapeHtml(String(gesamt))}</td></tr>`;
    document.getElementById("print-content").innerHTML = `
      <h1>👕 Kleiderbestellung</h1>
      <p class="print-meta">Zusammenfassung nach Artikel und Größe — erstellt am ${new Date().toLocaleString("de-DE")}</p>
      <table class="print-table"><thead>${theadHtml}</thead><tbody>${rowsHtml}${totalRow}</tbody></table>`;
    printExportHubContent();
    return;
  }
  const fields = [
    { label: "Artikel", key: "artikelName", num: false },
    { label: "Größe", key: "groesse", num: false },
    { label: "Menge", key: "summe", num: true }
  ];
  const widths = fields.map((f) => Math.max(f.label.length, ...zeilen.map((z) => String(z[f.key]).length)));
  const line = (cells) => cells.map((c, i) => {
    const s = String(c);
    return fields[i].num ? s.padStart(widths[i]) : s.padEnd(widths[i]);
  }).join("  ");
  const sepLine = widths.map((w) => "-".repeat(w)).join("  ");
  let out = `Kleiderbestellung — Zusammenfassung\n`;
  out += `Erstellt am ${new Date().toLocaleString("de-DE")}\n\n`;
  out += line(fields.map((f) => f.label)) + "\n" + sepLine + "\n";
  out += zeilen.map((z) => line(fields.map((f) => z[f.key]))).join("\n") + "\n";
  const gesamt = zeilen.reduce((a, z) => a + z.summe, 0);
  out += sepLine + "\n" + `Gesamt: ${gesamt} Stück\n`;
  downloadFile(`kleiderbestellung_${exportHubLocalDateIso()}.txt`, "text/plain", "﻿" + out);
}

// -- Materialbedarf: Text/PDF, IMMER alle Meldungen (Dashboard hat keinen
// Status-Filter wie die App selbst -- Admin will hier den Gesamtüberblick) --

const EXPORT_HUB_MELDUNG_STATUS = [
  { id: "offen", label: "Offen" },
  { id: "angenommen", label: "Angenommen" },
  { id: "abgelehnt", label: "Abgelehnt" },
  { id: "gekauft", label: "Gekauft/Erledigt" }
];
function exportHubStatusLabel(status) {
  const s = EXPORT_HUB_MELDUNG_STATUS.find((x) => x.id === status);
  return s ? s.label : status;
}
function exportHubFmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("de-DE") + ", " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
}
function exportHubPositionenText(positionen) {
  return (positionen || []).map((p) => `${p.material} ×${p.menge}`).join(", ");
}
function exportHubMeldungTrainerName(m) {
  return (m.vorname || m.nachname) ? `${m.vorname || ""} ${m.nachname || ""}`.trim() : m.erstelltVon;
}

async function exportMaterialbedarfReport(format) {
  const data = await exportHubLoadAppData("materialbedarf");
  const meldungen = data.meldungen || [];
  if (!meldungen.length) throw new Error("Keine Meldungen vorhanden.");
  const rows = meldungen.map((m) => ({
    datum: exportHubFmtDate(m.erstelltAm),
    trainer: exportHubMeldungTrainerName(m),
    mannschaft: m.mannschaft || "",
    material: exportHubPositionenText(m.positionen),
    grund: m.grund || "",
    dringlichkeit: m.dringlichkeit === "dringend" ? "dringend" : "normal",
    status: exportHubStatusLabel(m.status),
    kommentar: m.adminKommentar || ""
  }));
  if (format === "pdf") {
    const theadHtml = `<tr><th>Datum</th><th>Trainer</th><th>Mannschaft</th><th>Material</th><th>Grund</th><th>Dringlichkeit</th><th>Status</th><th>Kommentar</th></tr>`;
    const rowsHtml = rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.datum)}</td><td>${escapeHtml(r.trainer)}</td><td>${escapeHtml(r.mannschaft)}</td>
        <td>${escapeHtml(r.material)}</td><td>${escapeHtml(r.grund)}</td><td>${escapeHtml(r.dringlichkeit)}</td>
        <td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.kommentar)}</td>
      </tr>`).join("");
    document.getElementById("print-content").innerHTML = `
      <h1>🛒 Materialbedarf</h1>
      <p class="print-meta">Alle Meldungen — erstellt am ${new Date().toLocaleString("de-DE")}</p>
      <table class="print-table"><thead>${theadHtml}</thead><tbody>${rowsHtml}</tbody></table>`;
    printExportHubContent();
    return;
  }
  const fields = [
    { label: "Datum", key: "datum" }, { label: "Trainer", key: "trainer" }, { label: "Mannschaft", key: "mannschaft" },
    { label: "Material", key: "material" }, { label: "Grund", key: "grund" }, { label: "Dringlichkeit", key: "dringlichkeit" },
    { label: "Status", key: "status" }, { label: "Kommentar", key: "kommentar" }
  ];
  const widths = fields.map((f) => Math.max(f.label.length, ...rows.map((r) => String(r[f.key]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  const sepLine = widths.map((w) => "-".repeat(w)).join("  ");
  let out = `Materialbedarf — alle Meldungen\n`;
  out += `Erstellt am ${new Date().toLocaleString("de-DE")}\n\n`;
  out += line(fields.map((f) => f.label)) + "\n" + sepLine + "\n";
  out += rows.map((r) => line(fields.map((f) => r[f.key]))).join("\n") + "\n";
  downloadFile(`materialbedarf_${exportHubLocalDateIso()}.txt`, "text/plain", "﻿" + out);
}

// -- Busplan: nur PDF (Original hat auch nur den Druck-Export) --

const EXPORT_HUB_BUSPLAN_STATUS_WERTE = [
  { id: "", label: "—", farbe: "#c7ccd6" },
  { id: "zusage", label: "Zusage", farbe: "#2d8c4e" },
  { id: "absage", label: "Absage", farbe: "#c0392b" },
  { id: "offen", label: "offen", farbe: "#c9941f" },
  { id: "klaerung", label: "in Klärung", farbe: "#d2691e" },
  { id: "vorbereitung", label: "Unter Vorbereitung", farbe: "#6b7280" }
];
const EXPORT_HUB_BUSPLAN_CONFLICT_STATUS_IDS = EXPORT_HUB_BUSPLAN_STATUS_WERTE.filter((s) => s.id && s.id !== "absage").map((s) => s.id);
const EXPORT_HUB_WOCHENTAGE_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function exportHubFmtDatum(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  const wd = EXPORT_HUB_WOCHENTAGE_KURZ[d.getDay()];
  return `${wd}, ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function exportHubBusplanStatusCounts(season) {
  const counts = {};
  EXPORT_HUB_BUSPLAN_STATUS_WERTE.forEach((s) => { counts[s.id] = 0; });
  season.teams.forEach((t) => t.spiele.forEach((sp) => t.busOptionIds.forEach((oid) => {
    const wert = sp.status[oid] ? sp.status[oid].wert : "";
    counts[wert] = (counts[wert] || 0) + 1;
  })));
  return counts;
}
function exportHubBusplanConflictGroups(season) {
  const groups = {};
  season.teams.forEach((t) => t.spiele.forEach((sp) => {
    if (!sp.datum) return;
    t.busOptionIds.forEach((oid) => {
      const st = sp.status[oid];
      if (!st || !EXPORT_HUB_BUSPLAN_CONFLICT_STATUS_IDS.includes(st.wert)) return;
      const key = sp.datum + "|" + oid;
      if (!groups[key]) groups[key] = { datum: sp.datum, optionId: oid, entries: [] };
      groups[key].entries.push({ teamId: t.id, teamName: t.name, spielId: sp.id, ort: sp.ort, wert: st.wert });
    });
  }));
  return Object.values(groups).filter((g) => g.entries.length >= 2);
}
function exportHubBusplanConflictMap(groups) {
  const map = {};
  groups.forEach((g) => {
    g.entries.forEach((e) => { map[`${e.teamId}|${e.spielId}|${g.optionId}`] = g.entries.filter((o) => o !== e); });
  });
  return map;
}

async function exportBusplanHubPdf() {
  const data = await exportHubLoadAppData("busplan");
  const seasonKey = data.meta.currentSeason;
  const season = data.seasons[seasonKey];
  const counts = exportHubBusplanStatusCounts(season);
  const totalSpiele = season.teams.reduce((a, t) => a + t.spiele.length, 0);
  const kennzahlen = [
    { label: "Mannschaften", value: season.teams.length },
    { label: "Spiele gesamt", value: totalSpiele },
    { label: "Zusagen", value: counts.zusage || 0 },
    { label: "Offen / in Klärung", value: (counts.offen || 0) + (counts.klaerung || 0) },
    { label: "Absagen", value: counts.absage || 0 }
  ];
  const kennzahlenHtml = kennzahlen.map((k) => `
    <div class="print-kennzahl"><div class="pk-label">${escapeHtml(k.label)}</div><div class="pk-value">${escapeHtml(String(k.value))}</div></div>`).join("");

  const conflictGroups = exportHubBusplanConflictGroups(season).sort((a, b) => a.datum.localeCompare(b.datum));
  const conflictMap = exportHubBusplanConflictMap(conflictGroups);
  const conflictHtml = conflictGroups.length ? `
    <div class="print-konflikte">
      <h2>⚠️ Konflikte</h2>
      ${conflictGroups.map((g) => {
        const option = season.busOptions.find((o) => o.id === g.optionId);
        const teamsText = g.entries.map((e) => `${escapeHtml(e.teamName)} (${escapeHtml(e.ort || "Ort offen")})`).join(" + ");
        return `<div class="print-konflikt-row"><strong>${escapeHtml(exportHubFmtDatum(g.datum))}</strong> — ${escapeHtml(option ? option.name : g.optionId)}: ${teamsText}</div>`;
      }).join("")}
    </div>` : "";

  const teamBlocksHtml = season.teams.map((t) => {
    const options = t.busOptionIds.map((id) => season.busOptions.find((o) => o.id === id)).filter(Boolean);
    const spiele = t.spiele.slice().sort((a, b) => (a.datum || "").localeCompare(b.datum || ""));
    const heading = `<h2>${escapeHtml(t.name)}${t.liga ? " — " + escapeHtml(t.liga) : ""}</h2>`;
    if (!spiele.length) return `<div class="print-team-block">${heading}<p class="print-meta">Keine Spiele erfasst.</p></div>`;
    const theadHtml = `<tr><th>Datum</th><th>Ort</th>${options.map((o) => `<th>${escapeHtml(o.name)}</th>`).join("")}<th>Notiz</th></tr>`;
    const rowsHtml = spiele.map((sp) => {
      const cells = options.map((o) => {
        const st = sp.status[o.id] || { wert: "", notiz: "" };
        const def = EXPORT_HUB_BUSPLAN_STATUS_WERTE.find((s) => s.id === st.wert) || EXPORT_HUB_BUSPLAN_STATUS_WERTE[0];
        const partners = conflictMap[`${t.id}|${sp.id}|${o.id}`];
        let text = def.label;
        if (st.notiz) text += " – " + st.notiz;
        if (partners) text += " ⚠️";
        return `<td class="print-status-cell" style="background:${def.farbe}">${escapeHtml(text)}</td>`;
      }).join("");
      return `<tr><td class="strong">${escapeHtml(exportHubFmtDatum(sp.datum))}</td><td>${escapeHtml(sp.ort)}</td>${cells}<td>${escapeHtml(sp.notiz || "")}</td></tr>`;
    }).join("");
    return `<div class="print-team-block">${heading}<table class="print-table"><thead>${theadHtml}</thead><tbody>${rowsHtml}</tbody></table></div>`;
  }).join("");

  document.getElementById("print-content").innerHTML = `
    <h1>🚌 Busplan — Gesamtübersicht</h1>
    <p class="print-meta">Saison ${escapeHtml(seasonKey)} — erstellt am ${new Date().toLocaleString("de-DE")}</p>
    <div class="print-kennzahlen">${kennzahlenHtml}</div>
    ${conflictHtml}
    ${teamBlocksHtml || `<p class="print-meta">Für diese Saison sind noch keine Mannschaften erfasst.</p>`}`;
  printExportHubContent();
}

// -- Dispatch + Klick-Wiring (data-export-Attribute, siehe index.html) --

const EXPORT_HUB_HANDLERS = {
  "materialliste-json": exportMateriallisteJson,
  "spielertool-test-json": exportSpielertoolJson,
  "personalkosten-text": () => exportPersonalkostenReport("text"),
  "personalkosten-pdf": () => exportPersonalkostenReport("pdf"),
  "busplan-pdf": exportBusplanHubPdf,
  "kleiderbestellung-text": () => exportKleiderbestellungReport("text"),
  "kleiderbestellung-pdf": () => exportKleiderbestellungReport("pdf"),
  "materialbedarf-text": () => exportMaterialbedarfReport("text"),
  "materialbedarf-pdf": () => exportMaterialbedarfReport("pdf")
};

async function runExportHubAction(key, btn) {
  const errorEl = document.getElementById("export-hub-error");
  if (errorEl) errorEl.style.display = "none";
  const handler = EXPORT_HUB_HANDLERS[key];
  if (!handler) return;
  const prevLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Lädt …";
  try {
    await handler();
  } catch (e) {
    if (errorEl) {
      errorEl.textContent = e.message || "Export fehlgeschlagen.";
      errorEl.style.display = "block";
    }
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel;
  }
}

async function loadAndRenderFeedback() {
  const errorEl = document.getElementById("feedback-admin-error");
  errorEl.style.display = "none";
  try {
    const data = await callWorker("list-feedback", {});
    feedbackState = Array.isArray(data.entries) ? data.entries : [];
    renderFeedbackAdmin();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  }
}

function renderFeedbackAdmin() {
  const list = document.getElementById("feedback-admin-list");
  if (!list) return;
  // Unerledigt zuerst, sonst neueste zuerst — Admin sieht offene Einträge oben.
  const sorted = feedbackState.slice().sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
  if (sorted.length === 0) {
    list.innerHTML = '<p class="muted">Noch kein Feedback vorhanden.</p>';
    return;
  }
  list.innerHTML = sorted.map((f) => {
    const tool = f.toolId ? toolById(f.toolId) : null;
    const type = f.type === "wunsch" ? "wunsch" : "feedback";
    const name = (f.vorname && f.nachname) ? `${f.vorname} ${f.nachname}` : (f.username || "?");
    return `
      <div class="feedback-admin-row" data-id="${escapeHtml(f.id || "")}">
        <div class="feedback-admin-main">
          <div class="feedback-item-head">
            <span class="feedback-badge feedback-badge-${type}">${type === "wunsch" ? "Wunsch" : "Feedback"}</span>
            <span class="muted">${escapeHtml(name)}</span>
          </div>
          <div class="muted" style="font-size:12px; margin-top:2px;">${tool ? `→ ${escapeHtml(tool.name)}` : "— Allgemein —"}</div>
          <div class="feedback-item-text">${escapeHtml(f.text || "")}</div>
        </div>
        <div class="feedback-admin-actions">
          <label class="checkbox-label"><input type="checkbox" class="feedback-done-checkbox" ${f.done ? "checked" : ""} /> Erledigt</label>
          <button type="button" class="btn danger small feedback-del-btn">Löschen</button>
        </div>
      </div>`;
  }).join("");
  list.querySelectorAll(".feedback-admin-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".feedback-done-checkbox").addEventListener("change", (e) => toggleFeedbackDone(id, e.target.checked));
    row.querySelector(".feedback-del-btn").addEventListener("click", () => deleteFeedbackEntry(id));
  });
}

async function toggleFeedbackDone(id, done) {
  const prev = feedbackState.slice();
  feedbackState = feedbackState.map((f) => (f.id === id ? { ...f, done } : f));
  await persistFeedback(prev);
}

async function deleteFeedbackEntry(id) {
  if (!confirm("Diesen Eintrag wirklich löschen?")) return;
  const prev = feedbackState.slice();
  feedbackState = feedbackState.filter((f) => f.id !== id);
  await persistFeedback(prev);
}

// Speichert feedbackState serverseitig; bei Fehler Rollback auf den vorherigen Stand
// (identisches Muster zu persistNews).
async function persistFeedback(prevOnError) {
  const errorEl = document.getElementById("feedback-admin-error");
  const successEl = document.getElementById("feedback-admin-success");
  errorEl.style.display = "none";
  successEl.style.display = "none";
  try {
    const res = await callWorker("save-feedback", { entries: feedbackState });
    if (res && Array.isArray(res.entries)) feedbackState = res.entries;
    renderFeedbackAdmin();
    successEl.style.display = "block";
  } catch (err) {
    if (prevOnError) feedbackState = prevOnError;
    renderFeedbackAdmin();
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
}

function activateTab(name) {
  document.querySelectorAll("nav button[data-tab]").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-section").forEach((s) => s.classList.remove("active"));
  const btn = document.querySelector('nav button[data-tab="' + name + '"]');
  if (btn) btn.classList.add("active");
  const section = document.getElementById("tab-" + name);
  if (section) section.classList.add("active");
  // Kalender-Widget hängt außerhalb von #tab-uebersicht (siehe loadSidebarWidget) —
  // beim Tab-Wechsel Sichtbarkeit anhand des geladenen Inhalts neu bewerten.
  const widget = document.getElementById("calendar-widget");
  if (widget) widget.style.display = (name === "uebersicht" && widget.dataset.hasContent === "1") ? "block" : "none";
}

function setupTabs() {
  document.querySelectorAll("nav button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  const versionBadgeHeader = document.getElementById("version-badge");
  const openVersionHistory = () => {
    activateTab("admin");
    const panel = document.getElementById("changelog-panel");
    if (panel) { panel.open = true; panel.scrollIntoView({ behavior: "smooth", block: "start" }); }
  };
  versionBadgeHeader.addEventListener("click", openVersionHistory);
  versionBadgeHeader.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openVersionHistory(); }
  });

  document.getElementById("btn-empty-login").addEventListener("click", () => activateTab("admin"));
  document.getElementById("btn-feedback-empty-login").addEventListener("click", () => activateTab("admin"));
  document.getElementById("btn-admin-dashboard-back").addEventListener("click", () => activateTab("uebersicht"));
  document.getElementById("btn-admin-dashboard-refresh").addEventListener("click", () => loadAndRenderAdminStats());
  document.getElementById("btn-admin-dashboard-open").addEventListener("click", () => {
    activateTab("admin-dashboard");
    loadAndRenderAdminStats();
  });

  const jumpToAdminPanel = (panelId) => {
    activateTab("admin");
    const panel = document.getElementById(panelId);
    if (panel) { panel.open = true; panel.scrollIntoView({ behavior: "smooth", block: "start" }); }
  };
  const openTool = (toolId) => {
    const tool = toolById(toolId);
    if (tool) window.open(tool.url, "_blank", "noopener");
  };
  const statTileActions = {
    "stat-tile-users": () => jumpToAdminPanel("admin-users-panel"),
    "stat-tile-feedback": () => jumpToAdminPanel("admin-feedback-panel"),
    "stat-tile-trainervertrag": () => openTool("trainerdaten"),
    "stat-tile-trainerkodex": () => openTool("trainerdaten"),
    "stat-tile-jugendschutz": () => openTool("trainerdaten"),
    "stat-tile-materialbedarf": () => openTool("materialbedarf"),
    "stat-tile-busplan": () => openTool("busplan"),
    "stat-tile-testspielplaner": () => openTool("testspielplaner")
  };
  Object.keys(statTileActions).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", statTileActions[id]);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); statTileActions[id](); }
    });
  });

  const recentSelect = document.getElementById("admin-dashboard-recent-select");
  if (recentSelect) recentSelect.addEventListener("change", renderRecentActivity);

  document.querySelectorAll("[data-export]").forEach((btn) => {
    btn.addEventListener("click", () => runExportHubAction(btn.dataset.export, btn));
  });
  document.querySelectorAll("[data-open-tool]").forEach((btn) => {
    btn.addEventListener("click", () => openTool(btn.dataset.openTool));
  });
  document.querySelectorAll("[data-open-url]").forEach((btn) => {
    btn.addEventListener("click", () => window.open(btn.dataset.openUrl, "_blank", "noopener"));
  });
}

function renderHeaderUser() {
  const el = document.getElementById("header-user");
  if (!currentUser) {
    el.style.display = "none";
    el.innerHTML = "";
    renderViewAsControl();
    return;
  }
  const adminBadge = currentUser.isAdmin ? '<span class="version-badge">Admin</span>' : "";
  const viewAsBadge = currentUser.viewAsGroupId ? '<span class="version-badge badge-view-as">🎭 Testansicht</span>' : "";
  el.innerHTML = `👤 ${escapeHtml(currentUser.username)}${adminBadge}${viewAsBadge}`;
  el.style.display = "flex";
  renderViewAsControl();
}

// Testansicht-Umschalter im Header: nur für echte Admins sichtbar (auch
// während eine Testansicht bereits aktiv ist, siehe realIsAdmin), lädt die
// Gruppenliste per list-directory nach (kein Admin-Gate im Worker, bleibt
// also auch während der Testansicht selbst abrufbar).
async function loadDirectoryGroupsIfNeeded() {
  if (!currentUser || !currentUser.realIsAdmin) return;
  try {
    const data = await callWorker("list-directory", {});
    directoryGroupsState = (data && data.groups) || [];
  } catch (e) {
    directoryGroupsState = [];
  }
  renderViewAsControl();
}

function renderViewAsControl() {
  const select = document.getElementById("view-as-select");
  if (!select) return;
  if (!currentUser || !currentUser.realIsAdmin) {
    select.style.display = "none";
    return;
  }
  select.innerHTML = '<option value="">👑 Admin (echt)</option>' +
    directoryGroupsState.map((g) => `<option value="${escapeHtml(g.id)}">🎭 Ansicht: ${escapeHtml(g.name)}</option>`).join("");
  select.value = currentUser.viewAsGroupId || "";
  select.style.display = "inline-block";
}

function setupViewAsControl() {
  const select = document.getElementById("view-as-select");
  if (!select) return;
  select.addEventListener("change", async () => {
    const groupId = select.value || null;
    try {
      const data = await callWorker("set-view-as", { groupId });
      currentUser = buildCurrentUser({ ...currentUser, ...data });
      await afterAuthChange();
    } catch (e) {
      alert("Testansicht konnte nicht umgeschaltet werden: " + e.message);
      renderViewAsControl();
    }
  });
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
  document.getElementById("admin-access-panel").style.display = "none";
  document.getElementById("admin-visibility-panel").style.display = "none";
  document.getElementById("admin-news-panel").style.display = "none";
  document.getElementById("admin-feedback-panel").style.display = "none";
  document.getElementById("btn-admin-dashboard-open").style.display = "none";

  if (currentUser) {
    document.getElementById("logged-in-username").textContent = currentUser.username;
    document.getElementById("admin-logged-in-panel").style.display = "block";
    if (currentUser.isAdmin) {
      document.getElementById("admin-users-panel").style.display = "block";
      document.getElementById("admin-groups-panel").style.display = "block";
      document.getElementById("admin-access-panel").style.display = "block";
      document.getElementById("admin-visibility-panel").style.display = "block";
      document.getElementById("admin-news-panel").style.display = "block";
      document.getElementById("admin-feedback-panel").style.display = "block";
      document.getElementById("btn-admin-dashboard-open").style.display = "inline-flex";
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
  renderFeedbackTab();
  await Promise.all([loadSidebarWidget(), loadTrainerdatenStatus(), loadTestspielplanerStatus()]);
  if (currentUser && currentUser.isAdmin) {
    await loadAndRenderGroups();
    await loadAndRenderUsers();
    renderVisibilityList();
    renderAccessOverview();
    renderNewsAdmin();
    await loadAndRenderFeedback();
  }
  await loadDirectoryGroupsIfNeeded();
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
      if (err.archived) {
        errorEl.textContent = err.message;
        errorEl.style.display = "block";
        return;
      }
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
    const vertragBenoetigt = document.getElementById("new-user-vertrag-benoetigt").checked;
    const groupIds = getCheckedValues(document.getElementById("new-user-groups"));
    const errorEl = document.getElementById("users-error");
    const successEl = document.getElementById("users-success");
    errorEl.style.display = "none";
    successEl.style.display = "none";
    try {
      const data = await callWorker("create-user", { vorname, nachname, isAdmin, lizenz, mannschaften, vertragBenoetigt, groupIds });
      document.getElementById("new-user-vorname").value = "";
      document.getElementById("new-user-nachname").value = "";
      document.getElementById("new-user-lizenz").value = "";
      document.getElementById("new-user-mannschaften").value = "";
      document.getElementById("new-user-is-admin").checked = false;
      document.getElementById("new-user-vertrag-benoetigt").checked = false;
      const prov = summarizeProvisionReport(data.provisioned);
      successEl.textContent = `Angelegt: ${data.username}` + (prov ? ` · Auto-Einträge → ${prov}` : "");
      successEl.style.display = "block";
      await loadAndRenderGroups();
      await loadAndRenderUsers();
      renderAccessOverview();
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
      renderAccessOverview();
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
      // provisionGroupIds wird nur im Gruppen-Tab gepflegt, hier unverändert übernehmen —
      // sonst würde jedes Speichern in diesem Panel die Auto-Provisionierung für ALLE
      // Tools löschen (save-visibility ersetzt config.tools auf dem Worker komplett).
      const provisionGroupIds = (visibilityState[id] && visibilityState[id].provisionGroupIds) || [];
      tools[id] = { visible, loginRequired, groupIds, editGroupIds, provisionGroupIds };
    });
    const errorEl = document.getElementById("admin-save-error");
    const successEl = document.getElementById("admin-save-success");
    errorEl.style.display = "none";
    successEl.style.display = "none";
    try {
      await callWorker("save-visibility", { tools });
      visibilityState = tools;
      renderToolGrid();
      renderFeedbackTab();
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

  const feedbackForm = document.getElementById("feedback-form");
  if (feedbackForm) {
    feedbackForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = document.getElementById("feedback-text").value.trim();
      const errorEl = document.getElementById("feedback-error");
      const successEl = document.getElementById("feedback-success");
      errorEl.style.display = "none";
      successEl.style.display = "none";
      if (!text) {
        errorEl.textContent = "Text ist ein Pflichtfeld.";
        errorEl.style.display = "block";
        return;
      }
      try {
        await callWorker("submit-feedback", {
          type: document.getElementById("feedback-type").value,
          toolId: document.getElementById("feedback-tool").value,
          text
        });
        document.getElementById("feedback-text").value = "";
        successEl.style.display = "block";
        // Admin sieht die eigene Einreichung sofort in admin-feedback-panel, ohne neu zu laden.
        if (currentUser && currentUser.isAdmin) await loadAndRenderFeedback();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = "block";
      }
    });
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
  renderChangelog();
  renderNews();
  setupTabs();
  setupAuthForms();
  setupWhatsappLink();
  setupWikiFrage();
  setupViewAsControl();

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
  renderFeedbackTab();
  await Promise.all([loadSidebarWidget(), loadTrainerdatenStatus(), loadTestspielplanerStatus()]);
  if (currentUser && currentUser.isAdmin) {
    // Seriell statt Promise.all: renderUsersList gruppiert die Nutzerliste
    // anhand von groupsState, das also schon geladen sein muss, bevor
    // loadAndRenderUsers() rendert (sonst Race, je nachdem welcher der beiden
    // Worker-Aufrufe zuerst zurückkommt).
    await loadAndRenderGroups();
    await loadAndRenderUsers();
    renderVisibilityList();
    renderAccessOverview();
    renderNewsAdmin();
    await loadAndRenderFeedback();
  }
  await loadDirectoryGroupsIfNeeded();

  // Beim allerersten Besuch (noch kein Nutzerkonto vorhanden) direkt in den
  // Admin-Tab springen, wo das "Admin-Konto einrichten"-Formular wartet.
  if (bootstrapAvailable && !currentUser) {
    activateTab("admin");
  }
}

init();

// Mehrfach live beobachtet (siehe project-toolsuebersicht-Memory): loadTrainerdatenStatus()
// wurde bisher nur einmal beim Seitenladen/Login geholt. Kehrt ein Nutzer aus einer
// verlinkten App zurück, nachdem er dort gerade eine fehlende Bestätigung nachgeholt
// hat, blieb die Kachel bis zum manuellen Reload auf dem alten (roten) Stand hängen,
// obwohl der Server längst "vollständig" berechnet. Fix: bei Rückkehr in den
// sichtbaren Tab erneut abfragen -- mit Mindestabstand, damit schnelles Tab-Switching
// den Worker nicht flutet (Timestamp wird auch vom Erstladen selbst gesetzt, siehe
// loadTrainerdatenStatus()).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (Date.now() - _trainerdatenStatusLastFetch >= 10000) loadTrainerdatenStatus();
  // Gleiches Muster für die Testspielplaner-Kachel: wer aus der App zurückkehrt und
  // dort gerade den Gegner eingetragen/den Platz freigegeben hat, soll das Badge
  // ohne manuellen Reload verschwinden sehen.
  if (Date.now() - _testspielplanerStatusLastFetch >= 10000) loadTestspielplanerStatus();
});
