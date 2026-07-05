// Cloudflare Worker: Login/Session, Nutzergruppen + Sichtbarkeits-Konfiguration
// der Tools-Übersicht, alles gegen Nextcloud gespiegelt. Nicht Teil des
// Pages-Deployments — separat bei Cloudflare deployen.
// Deployment: dash.cloudflare.com -> Workers & Pages -> Worker "landingpage"
// -> diesen Code einfügen -> Deploy (URL bleibt https://landingpage.<subdomain>.workers.dev,
// bereits als WORKER_URL in app.js eingetragen).
//
// NACH dem Deploy folgende Worker-Secrets setzen
// (Workers -> landingpage -> Settings -> Variables -> Add secret):
//   NEXTCLOUD_URL         = https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/ToolsUebersicht/sichtbarkeit.json
//   NEXTCLOUD_NUTZER_URL  = https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/ToolsUebersicht/nutzer.json
//   NEXTCLOUD_USERNAME    = admin
//   NEXTCLOUD_PASSWORD    = <App-Passwort aus Nextcloud>
//   SESSION_SECRET         = <zufällige lange Zeichenkette, einmalig generiert>
//
// Optionale Secrets für die zentrale Aktions-Passwortprüfung (verify-action-password).
// Fehlt eines, meldet nur die jeweilige Aktion einen Konfigurationsfehler — der Rest
// des Workers läuft normal. Werte frei wählbar (die alten Client-Passwörter stehen
// in der öffentlichen Git-Historie, daher am besten NEUE Passwörter vergeben):
//   PW_CHECKLISTE_SPERRE    = TrainerCheckliste: Checkliste entsperren / Eintrag mit gesperrter Checkliste löschen
//   PW_ANMELDUNG_TEILNEHMER = Trainerversammlung-Anmeldung: Teilnehmer-Tab in verwaltung.html öffnen
//   PW_BUDGET_LEEREN        = Vereinsbudget: "Saison leeren"
//   PW_TRAINERKODEX_LOESCHEN = Trainerkodex: Bestätigungen löschen (einzeln/alle)
//   PW_BUDGET_EINGANG_ZUGANG = sc-heiligenstadt-beleg-upload-Worker (eigenes Cloudflare-Deploy!): Zugriffscode in beleg-eingang.html
//
// Die letzte wird nicht vom Browser-Client, sondern vom EIGENEN Cloudflare Worker
// serverseitig abgefragt (Worker-zu-Worker-Fetch) - dieser Worker braucht dafür
// kein eigenes Passwort-Secret mehr.
// (beleg-scanner nutzte diesen Weg vorübergehend ebenfalls, seit 2026-07-05 wieder
// eigenständig mit lokalen Secrets SEARCH_PASSWORD/UPLOAD_PASSWORD - siehe dort.)
//
// BOOTSTRAP (einmalig, direkt nach dem Deploy, bevor die URL geteilt wird):
// Solange in nutzer.json noch kein Nutzer existiert, zeigt die Seite im
// Admin-Tab automatisch ein "Admin-Konto einrichten"-Formular. Dort einmal
// Nutzername + Passwort wählen — danach ist dieser Weg dauerhaft gesperrt
// (die Aktion "bootstrap-admin" antwortet ab dann mit 403).
//
// Passwörter werden mit PBKDF2-HMAC-SHA256 gehasht (Web-Crypto, keine
// Abhängigkeiten), Sessions sind zustandslose HMAC-signierte Bearer-Token
// (30 Tage gültig) — kein KV/D1 nötig. Nutzergruppen werden zusammen mit den
// Nutzerkonten in derselben nutzer.json gespeichert (Top-Level-Key "groups"),
// kein zusätzliches Worker-Secret nötig.
//
// API (POST-Body: { action, ... } außer beim einfachen GET):
//   GET                                                        -> { tools, bootstrapAvailable } ohne Auth
//   POST { action: "bootstrap-admin", username, password }     -> nur wenn noch keine Nutzer existieren
//   POST { action: "login", username, password }               -> { token, username, isAdmin, groupIds } | { needsPasswordSetup: true } | 401
//   POST { action: "set-password", username, password }        -> nur falls mustSetPassword=true beim Nutzer
//   POST { action: "me", app? } + Authorization: Bearer <token> -> { username, isAdmin, groupIds } (+ canEdit, wenn app übergeben und bekannt)
//   POST { action: "create-user", vorname, nachname, isAdmin, groupIds } (admin) -> generiert Nutzername, legt Nutzer mit mustSetPassword=true an
//   POST { action: "list-users" } (admin)                       -> Liste inkl. vorname/nachname/displayName/groupIds, ohne Passwort-Hashes
//   POST { action: "reset-password", username } (admin)         -> löscht Hash, mustSetPassword=true
//   POST { action: "update-user", username, vorname, nachname, isAdmin } (admin) -> ändert Vor-/Nachname und Admin-Status (letztem Admin kann Admin-Status nicht entzogen werden)
//   POST { action: "delete-user", username } (admin)             -> löscht Nutzer, entfernt ihn aus allen Gruppen (letzter Admin kann nicht gelöscht werden)
//   POST { action: "create-group", name } (admin)                -> legt Gruppe an (id per Slugify aus name)
//   POST { action: "list-groups" } (admin)                       -> alle Gruppen inkl. memberUsernames
//   POST { action: "update-group-members", groupId, memberUsernames } (admin) -> ersetzt Mitgliederliste komplett
//   POST { action: "delete-group", groupId } (admin)             -> löscht Gruppe, räumt groupIds in sichtbarkeit.json auf
//   POST { action: "save-visibility", tools } (admin)            -> aktualisiert tools in sichtbarkeit.json (erhält news), tools[id] = {visible, loginRequired, groupIds, editGroupIds}
//     (groupIds steuert die Sichtbarkeit im Modus "Nur bestimmte Gruppen"; editGroupIds ist unabhängig davon
//     und vergibt zusätzlich Bearbeiten-Rechte, unabhängig vom Sichtbarkeits-Modus des Tools.)
//   POST { action: "save-news", news } (admin)                   -> speichert die Neuigkeiten (Array, serverseitig validiert) im news-Key von sichtbarkeit.json (erhält tools); GET liefert news an alle Besucher
//   POST { action: "dav-load", app } + Authorization: Bearer       -> { data, rev } (Inhalt der App-Datendatei aus Nextcloud, data:null wenn noch nicht vorhanden; rev = ETag)
//   POST { action: "dav-save", app, data, rev? } + Authorization: Bearer -> { ok:true, rev } (schreibt die App-Datendatei; mit rev nur, wenn die Datei
//     serverseitig unverändert ist — sonst 409 mit { conflict:true }. Ohne rev unconditional wie früher, alte Clients bleiben kompatibel.)
//     WebDAV-Gateway: Zugriff nur, wenn der Nutzer das Tool sehen darf (Gruppen-Sichtbarkeit). App-id -> Nextcloud-Pfad in DAV_APPS.
//   POST { action: "dav-file-put", app, id, name, contentType, dataBase64 } + Authorization: Bearer -> { ok:true }
//     (lädt eine Binärdatei in den Unterordner dateien/ der App; id = UUID, Größe <= 10 MB; Sichtbarkeits-Check wie dav-load)
//   POST { action: "dav-file-get", app, id } + Authorization: Bearer    -> rohe Datei-Bytes (Content-Type von Nextcloud) | 404
//   POST { action: "dav-file-delete", app, id } + Authorization: Bearer -> { ok:true } (204/404 = Erfolg beim Aufräumen)
//   POST { action: "verify-action-password", scope, password }    -> { ok:true } | 403 — ohne Login; prüft die früher im
//     Client hartkodierten Aktions-Passwörter gegen Worker-Secrets (Scope-Liste: ACTION_PASSWORD_SECRETS).

const ALLOWED_ORIGINS = [
  "http://localhost:8767", // Materialliste (Dev-Server)
  "http://localhost:8768", // TrainerCheckliste (Dev-Server)
  "http://localhost:8769", // TrainerVertrag (Dev-Server)
  "http://localhost:8770", // ToolsUebersicht (Dev-Server)
  "http://localhost:8771", // Spielertool (Dev-Server)
  "http://localhost:8772", // Vereinsbudget (Dev-Server)
  "http://localhost:8774", // Trainerversammlung-Anmeldung (Dev-Server)
  "http://localhost:8775", // Trainerkodex (Dev-Server)
  "http://localhost:8779", // Spielersichtung (Dev-Server)
  "http://localhost:8777", // Vereinskalender (Dev-Server)
  "http://localhost:8792", // Busplan (Dev-Server)
  "http://localhost:8780", // Spielerplus-Klon (Dev-Server)
  "https://tecko1985.github.io"
];

// Apps, die ihre Daten über das Gateway (Action dav-load/dav-save) in Nextcloud
// speichern. Key = Tool-id (wie in config.js/sichtbarkeit.json), Wert = volle
// WebDAV-URL der Datendatei. Pfade sind nicht geheim (stehen bereits in den
// öffentlichen App-Repos); geheim sind nur Konto + Passwort (Worker-Secrets).
const DAV_APPS = {
  "materialliste":     "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/06_Zeugwart/Materiallisten/materialdaten.json",
  "trainercheckliste": "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/TrainerCheckin/trainercheckin.json",
  "spielertool-test":  "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Spieler_Bewertung/spielerdaten.json",
  "trainerkodex":      "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Trainerkodex/trainerkodex.json",
  "spielersichtung":   "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Spielersichtung/spielersichtung.json",
  "platzbelegung":     "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Platzbelegung/platzbelegung.json",
  "personalkosten":    "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Personalkosten/personalkosten.json",
  "vereinskalender":   "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Vereinskalender/vereinskalender.json",
  "busplan":           "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Busplan/busplan.json",
  "spielerplus-klon":  "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Spielerplus/spielerplus.json"
};

const PBKDF2_ITERATIONS = 100000; // siehe README: bewusst unter OWASP-210k, um im Cloudflare-Free-CPU-Limit zu bleiben
const SALT_BYTES = 16;
const HASH_BITS = 256;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 Tage
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const requiredSecrets = ["NEXTCLOUD_URL", "NEXTCLOUD_USERNAME", "NEXTCLOUD_PASSWORD", "NEXTCLOUD_NUTZER_URL", "SESSION_SECRET"];
    const missingSecrets = requiredSecrets.filter((name) => !env[name]);
    if (missingSecrets.length > 0) {
      return json({ error: "Worker-Secrets nicht konfiguriert: " + missingSecrets.join(", ") }, 500, corsHeaders);
    }

    const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

    // Alle Aktionen lesen zuerst aus Nextcloud. Schlägt so ein Read fehl, wirft
    // readJson (statt still einen leeren Fallback zu liefern) und der Client
    // bekommt 502 — sonst würde der nächste read-modify-write-Schreibzugriff
    // den kompletten Bestand (nutzer.json bzw. App-Daten) mit dem Fallback überschreiben.
    try {

    if (request.method === "GET") {
      const [config, usersDoc] = await Promise.all([
        readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} }),
        readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc())
      ]);
      return json({ tools: config.tools, news: Array.isArray(config.news) ? config.news : null, bootstrapAvailable: Object.keys(usersDoc.users).length === 0 }, 200, corsHeaders);
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Ungültiges JSON" }, 400, corsHeaders);
    }

    switch (body.action) {
      case "bootstrap-admin":
        return handleBootstrapAdmin(body, env, authHeader, corsHeaders);
      case "login":
        return handleLogin(body, env, authHeader, corsHeaders);
      case "set-password":
        return handleSetPassword(body, env, authHeader, corsHeaders);
      case "me":
        return handleMe(request, body, env, authHeader, corsHeaders);
      case "create-user":
        return handleCreateUser(request, body, env, authHeader, corsHeaders);
      case "list-users":
        return handleListUsers(request, env, authHeader, corsHeaders);
      case "reset-password":
        return handleResetPassword(request, body, env, authHeader, corsHeaders);
      case "update-user":
        return handleUpdateUser(request, body, env, authHeader, corsHeaders);
      case "delete-user":
        return handleDeleteUser(request, body, env, authHeader, corsHeaders);
      case "create-group":
        return handleCreateGroup(request, body, env, authHeader, corsHeaders);
      case "list-groups":
        return handleListGroups(request, env, authHeader, corsHeaders);
      case "update-group-members":
        return handleUpdateGroupMembers(request, body, env, authHeader, corsHeaders);
      case "delete-group":
        return handleDeleteGroup(request, body, env, authHeader, corsHeaders);
      case "save-visibility":
        return handleSaveVisibility(request, body, env, authHeader, corsHeaders);
      case "save-news":
        return handleSaveNews(request, body, env, authHeader, corsHeaders);
      case "verify-action-password":
        return handleVerifyActionPassword(body, env, corsHeaders);
      case "dav-load":
        return handleDavLoad(request, body, env, authHeader, corsHeaders);
      case "dav-save":
        return handleDavSave(request, body, env, authHeader, corsHeaders);
      case "dav-file-put":
        return handleDavFilePut(request, body, env, authHeader, corsHeaders);
      case "dav-file-get":
        return handleDavFileGet(request, body, env, authHeader, corsHeaders);
      case "dav-file-delete":
        return handleDavFileDelete(request, body, env, authHeader, corsHeaders);
      default:
        return json({ error: "Unbekannte Aktion" }, 400, corsHeaders);
    }

    } catch (e) {
      if (e instanceof NextcloudError) {
        return json({ error: e.message }, 502, corsHeaders);
      }
      return json({ error: "Interner Fehler: " + e.message }, 500, corsHeaders);
    }
  }
};

// ---------- Aktionen: Auth ----------

async function handleBootstrapAdmin(body, env, authHeader, corsHeaders) {
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  // "__proto__" besteht den Regex-Test, würde als Objekt-Key aber das Prototyp-
  // Objekt statt eines eigenen Eintrags setzen — explizit ablehnen.
  if (!USERNAME_RE.test(username) || username === "__proto__") return json({ error: "Ungültiger Nutzername (3-32 Zeichen, a-z 0-9 . _ -)" }, 400, corsHeaders);
  const pwError = validatePasswordStrength(password);
  if (pwError) return json({ error: pwError }, 400, corsHeaders);

  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  if (Object.keys(usersDoc.users).length > 0) {
    return json({ error: "Bootstrap bereits abgeschlossen" }, 403, corsHeaders);
  }

  const { hash, salt, iterations } = await hashNewPassword(password);
  const now = new Date().toISOString();
  usersDoc.users[username] = {
    username, passwordHash: hash, salt, iterations,
    isAdmin: true, mustSetPassword: false,
    createdAt: now, passwordSetAt: now
  };

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  const token = await signToken(makeSessionPayload(username, true), env.SESSION_SECRET);
  return json({ token, username, isAdmin: true, groupIds: [] }, 200, corsHeaders);
}

async function handleLogin(body, env, authHeader, corsHeaders) {
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  const user = getOwn(usersDoc.users, username);

  if (!user) return json({ error: "Ungültige Anmeldedaten" }, 401, corsHeaders);
  if (user.mustSetPassword || !user.passwordHash) {
    return json({ needsPasswordSetup: true }, 200, corsHeaders);
  }

  const ok = await verifyPassword(password, user.salt, user.iterations, user.passwordHash);
  if (!ok) {
    // Bremse gegen Durchprobieren (wie bei verify-action-password). Trifft im
    // zweistufigen Login-Flow auch den Nutzername-Schritt (login mit leerem
    // Passwort bei bestehendem Konto) — 0,8s einmal pro Anmeldung ist bewusst
    // in Kauf genommen.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return json({ error: "Ungültige Anmeldedaten" }, 401, corsHeaders);
  }

  const token = await signToken(makeSessionPayload(user.username, !!user.isAdmin), env.SESSION_SECRET);
  return json({ token, username: user.username, isAdmin: !!user.isAdmin, groupIds: getUserGroupIds(usersDoc, user.username) }, 200, corsHeaders);
}

async function handleSetPassword(body, env, authHeader, corsHeaders) {
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const pwError = validatePasswordStrength(password);
  if (pwError) return json({ error: pwError }, 400, corsHeaders);

  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  const user = getOwn(usersDoc.users, username);
  if (!user) return json({ error: "Unbekannter Nutzer" }, 404, corsHeaders);
  if (!user.mustSetPassword) return json({ error: "Passwort wurde bereits gesetzt" }, 409, corsHeaders);

  const { hash, salt, iterations } = await hashNewPassword(password);
  user.passwordHash = hash;
  user.salt = salt;
  user.iterations = iterations;
  user.mustSetPassword = false;
  user.passwordSetAt = new Date().toISOString();

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  const token = await signToken(makeSessionPayload(user.username, !!user.isAdmin), env.SESSION_SECRET);
  return json({ token, username: user.username, isAdmin: !!user.isAdmin, groupIds: getUserGroupIds(usersDoc, user.username) }, 200, corsHeaders);
}

async function handleMe(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  const usersDoc = session.usersDoc;
  const groupIds = session.isAdmin ? [] : getUserGroupIds(usersDoc, session.username);
  const user = getOwn(usersDoc.users, session.username);
  const result = {
    username: session.username,
    isAdmin: !!session.isAdmin,
    groupIds,
    vorname: (user && user.vorname) || null,
    nachname: (user && user.nachname) || null
  };
  if (body && body.app) {
    result.canEdit = await resolveEditPermission(String(body.app), session, env, authHeader);
  }
  return json(result, 200, corsHeaders);
}

// ---------- Aktionen: Nutzerverwaltung ----------

async function handleCreateUser(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const vorname = String(body.vorname || "").trim();
  const nachname = String(body.nachname || "").trim();
  if (!vorname || !nachname) return json({ error: "Vorname und Nachname erforderlich" }, 400, corsHeaders);

  const usersDoc = session.usersDoc;
  if (!usersDoc.groups) usersDoc.groups = {};

  const username = generateUsername(vorname, nachname, new Set(Object.keys(usersDoc.users)));
  usersDoc.users[username] = {
    username, vorname, nachname, passwordHash: null, salt: null, iterations: null,
    isAdmin: !!body.isAdmin, mustSetPassword: true,
    createdAt: new Date().toISOString(), passwordSetAt: null
  };

  addUserToGroups(usersDoc, username, body.groupIds);

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ username, vorname, nachname, mustSetPassword: true }, 201, corsHeaders);
}

async function handleListUsers(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const usersDoc = session.usersDoc;
  const users = Object.values(usersDoc.users).map((u) => ({
    username: u.username,
    vorname: u.vorname || null,
    nachname: u.nachname || null,
    displayName: (u.vorname && u.nachname) ? `${u.vorname} ${u.nachname}` : u.username,
    isAdmin: !!u.isAdmin,
    mustSetPassword: !!u.mustSetPassword,
    createdAt: u.createdAt,
    groupIds: getUserGroupIds(usersDoc, u.username)
  }));
  return json({ users }, 200, corsHeaders);
}

async function handleResetPassword(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const username = normalizeUsername(body.username);
  const usersDoc = session.usersDoc;
  const user = getOwn(usersDoc.users, username);
  if (!user) return json({ error: "Unbekannter Nutzer" }, 404, corsHeaders);

  user.passwordHash = null;
  user.salt = null;
  user.iterations = null;
  user.mustSetPassword = true;
  user.passwordSetAt = null;

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ username, mustSetPassword: true }, 200, corsHeaders);
}

async function handleUpdateUser(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const username = normalizeUsername(body.username);
  const usersDoc = session.usersDoc;
  const user = getOwn(usersDoc.users, username);
  if (!user) return json({ error: "Unbekannter Nutzer" }, 404, corsHeaders);

  const vorname = String(body.vorname || "").trim();
  const nachname = String(body.nachname || "").trim();
  if (!vorname || !nachname) return json({ error: "Vorname und Nachname erforderlich" }, 400, corsHeaders);

  const isAdmin = !!body.isAdmin;
  if (user.isAdmin && !isAdmin) {
    const adminCount = Object.values(usersDoc.users).filter((u) => u.isAdmin).length;
    if (adminCount <= 1) return json({ error: "Letztem Admin kann der Admin-Status nicht entzogen werden" }, 400, corsHeaders);
  }

  user.vorname = vorname;
  user.nachname = nachname;
  user.isAdmin = isAdmin;

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ username, vorname, nachname, isAdmin }, 200, corsHeaders);
}

async function handleDeleteUser(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const username = normalizeUsername(body.username);
  const usersDoc = session.usersDoc;
  const user = getOwn(usersDoc.users, username);
  if (!user) return json({ error: "Unbekannter Nutzer" }, 404, corsHeaders);

  if (user.isAdmin) {
    const adminCount = Object.values(usersDoc.users).filter((u) => u.isAdmin).length;
    if (adminCount <= 1) return json({ error: "Letzter Admin kann nicht gelöscht werden" }, 400, corsHeaders);
  }

  delete usersDoc.users[username];
  Object.values(usersDoc.groups || {}).forEach((g) => {
    g.memberUsernames = (g.memberUsernames || []).filter((m) => m !== username);
  });

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ deleted: username }, 200, corsHeaders);
}

// ---------- Aktionen: Gruppen ----------

async function handleCreateGroup(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const name = String(body.name || "").trim();
  if (!name) return json({ error: "Gruppenname erforderlich" }, 400, corsHeaders);

  const usersDoc = session.usersDoc;
  if (!usersDoc.groups) usersDoc.groups = {};

  const baseId = slugifyGroupName(name);
  const id = uniqueGroupId(baseId, new Set(Object.keys(usersDoc.groups)));
  usersDoc.groups[id] = { id, name, memberUsernames: [], createdAt: new Date().toISOString() };

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ group: usersDoc.groups[id] }, 201, corsHeaders);
}

async function handleListGroups(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const usersDoc = session.usersDoc;
  return json({ groups: Object.values(usersDoc.groups || {}) }, 200, corsHeaders);
}

async function handleUpdateGroupMembers(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const groupId = String(body.groupId || "");
  const usersDoc = session.usersDoc;
  const group = getOwn(usersDoc.groups || {}, groupId);
  if (!group) return json({ error: "Unbekannte Gruppe" }, 404, corsHeaders);

  const requested = Array.isArray(body.memberUsernames) ? body.memberUsernames.map(normalizeUsername) : [];
  group.memberUsernames = requested.filter((u) => getOwn(usersDoc.users, u));

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ group }, 200, corsHeaders);
}

async function handleDeleteGroup(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const groupId = String(body.groupId || "");
  const usersDoc = session.usersDoc;
  if (!getOwn(usersDoc.groups || {}, groupId)) return json({ error: "Unbekannte Gruppe" }, 404, corsHeaders);
  delete usersDoc.groups[groupId];

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  // Verwaiste Gruppenreferenz aus sichtbarkeit.json entfernen (best effort,
  // die Gruppe selbst ist zu diesem Zeitpunkt bereits gelöscht)
  try {
    const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
    let changed = false;
    Object.values(config.tools || {}).forEach((entry) => {
      if (Array.isArray(entry.groupIds) && entry.groupIds.includes(groupId)) {
        entry.groupIds = entry.groupIds.filter((id) => id !== groupId);
        changed = true;
      }
      if (Array.isArray(entry.editGroupIds) && entry.editGroupIds.includes(groupId)) {
        entry.editGroupIds = entry.editGroupIds.filter((id) => id !== groupId);
        changed = true;
      }
    });
    if (changed) await writeJson(env.NEXTCLOUD_URL, authHeader, config);
  } catch (_) { /* Aufräumen ist best-effort */ }

  return json({ deleted: groupId }, 200, corsHeaders);
}

// ---------- Aktionen: Sichtbarkeit ----------

async function handleSaveVisibility(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  if (!body.tools || typeof body.tools !== "object") {
    return json({ error: "Ungültige Daten" }, 400, corsHeaders);
  }

  // Read-modify-write: bestehende Config lesen und nur tools ersetzen, damit
  // andere Schlüssel (z.B. news) durch ein Sichtbarkeits-Speichern nicht verloren gehen.
  const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
  config.version = 1;
  config.tools = body.tools;
  try {
    await writeJson(env.NEXTCLOUD_URL, authHeader, config);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ tools: config.tools }, 200, corsHeaders);
}

const NEWS_VALID_TYPES = ["neu", "update", "fix", "hinweis"];

// Speichert die Neuigkeiten (Array) im news-Key von sichtbarkeit.json. Admin-only,
// read-modify-write (erhält tools). Jede Meldung wird serverseitig validiert/normiert:
// Titel Pflicht, Typ auf erlaubte Werte, Datum auf YYYY-MM-DD (sonst heute), Längen
// gekappt, id vergeben falls fehlend. So kann ein manipulierter Client keine kaputten
// Daten ablegen. Der öffentliche GET liest news 1:1 wieder aus (alle Besucher).
async function handleSaveNews(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  if (!Array.isArray(body.news)) {
    return json({ error: "Ungültige Daten" }, 400, corsHeaders);
  }

  const today = new Date().toISOString().slice(0, 10);
  const clean = [];
  for (const n of body.news.slice(0, 100)) {
    if (!n || typeof n !== "object") continue;
    const title = String(n.title || "").trim().slice(0, 200);
    if (!title) continue; // Titel ist Pflicht
    const item = {
      id: /^[a-z0-9-]{1,40}$/i.test(String(n.id || "")) ? String(n.id) : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(n.date || "")) ? String(n.date) : today,
      type: NEWS_VALID_TYPES.includes(String(n.type)) ? String(n.type) : "hinweis",
      title,
      text: String(n.text || "").trim().slice(0, 1000)
    };
    const toolId = String(n.toolId || "").trim().slice(0, 60);
    if (toolId) item.toolId = toolId;
    clean.push(item);
  }

  const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
  config.version = config.version || 1;
  config.news = clean;
  try {
    await writeJson(env.NEXTCLOUD_URL, authHeader, config);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ news: config.news }, 200, corsHeaders);
}

// ---------- Aktionen: Aktions-Passwörter der Tool-Apps ----------

// Serverseitige Prüfung der früher im Client hartkodierten Aktions-Passwörter
// (dort konnte sie jeder im Quellcode nachlesen). Scope -> Worker-Secret mit dem
// Klartext-Passwort. Bewusst ohne Login nutzbar: verwaltung.html (Anmeldung) und
// das Vereinsbudget haben kein Gateway-Login.
// Scopes ab hier werden nicht vom Client, sondern SERVERSEITIG von anderen
// Cloudflare Workern aufgerufen (Worker-zu-Worker-Fetch, kein Origin-Header) -
// ersetzt dort ein bisher lokal im jeweiligen Worker geprüftes Secret 1:1.
const ACTION_PASSWORD_SECRETS = {
  "checkliste-sperre": "PW_CHECKLISTE_SPERRE",       // TrainerCheckliste: Entsperren/Löschen gesperrter Checklisten
  "anmeldung-teilnehmer": "PW_ANMELDUNG_TEILNEHMER", // Trainerversammlung-Anmeldung: Teilnehmer-Tab
  "budget-saison-leeren": "PW_BUDGET_LEEREN",        // Vereinsbudget: "Saison leeren"
  "trainerkodex-loeschen": "PW_TRAINERKODEX_LOESCHEN", // Trainerkodex: Bestätigungen löschen (einzeln/alle)
  "budget-beleg-eingang": "PW_BUDGET_EINGANG_ZUGANG" // sc-heiligenstadt-beleg-upload-Worker: Zugriffscode für beleg-eingang.html (serverseitig delegiert)
};

async function handleVerifyActionPassword(body, env, corsHeaders) {
  const scope = String(body.scope || "");
  const secretName = getOwn(ACTION_PASSWORD_SECRETS, scope);
  if (!secretName) return json({ error: "Unbekannter Passwort-Scope" }, 400, corsHeaders);
  if (!env[secretName]) {
    return json({ error: "Worker-Secret " + secretName + " ist nicht konfiguriert" }, 500, corsHeaders);
  }
  const ok = await staticPasswordEquals(String(body.password || ""), env[secretName]);
  if (!ok) {
    // Bremse gegen Durchprobieren — die Aktion ist ohne Login erreichbar.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return json({ error: "Falsches Passwort" }, 403, corsHeaders);
  }
  return json({ ok: true }, 200, corsHeaders);
}

// Vergleich über SHA-256-Digests: konstante Länge, damit timingSafeEqual nicht
// über seinen Längen-Check die Passwortlänge verrät.
async function staticPasswordEquals(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected))
  ]);
  return timingSafeEqual(bytesToBase64(new Uint8Array(a)), bytesToBase64(new Uint8Array(b)));
}

// ---------- Aktionen: WebDAV-Gateway für die Apps ----------

// Eine App darf ihre Daten lesen/schreiben, wenn der eingeloggte Nutzer das
// zugehörige Tool in der Übersicht sehen darf. Repliziert die Client-Logik
// isVisibleToUser (app.js) serverseitig — der Client ist umgehbar.
async function userMayAccessTool(app, session, env, authHeader) {
  if (session.isAdmin) return true; // Admin darf immer (spart Nextcloud-Reads)
  const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
  const entry = getOwn(config.tools || {}, app);
  if (!entry || entry.visible === false) return false; // versteckt/unkonfiguriert -> nur Admin
  if (!entry.loginRequired) return true;               // öffentliches Tool -> jeder Eingeloggte
  const gids = Array.isArray(entry.groupIds) ? entry.groupIds : [];
  if (gids.length === 0) return true;                  // "alle eingeloggten Nutzer"
  const userGroupIds = getUserGroupIds(session.usersDoc, session.username);
  return gids.some((g) => userGroupIds.includes(g));
}

// Bearbeiten-Recht für ein Tool: unabhängig von der Sichtbarkeits-Gruppierung
// (tools[id].groupIds), damit das Gewähren eines Bearbeiten-Rechts die
// Sichtbarkeit eines breiter freigegebenen Tools (z.B. "Alle eingeloggten
// Nutzer") nicht ungewollt auf bestimmte Gruppen verengt. Ersetzt die früher
// pro App hartkodierten EDITOR_GROUP_ID-Konstanten.
async function resolveEditPermission(app, session, env, authHeader) {
  if (session.isAdmin) return true;
  const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
  const entry = getOwn(config.tools || {}, app);
  if (!entry) return false;
  const editGroupIds = Array.isArray(entry.editGroupIds) ? entry.editGroupIds : [];
  if (editGroupIds.length === 0) return false;
  const userGroupIds = getUserGroupIds(session.usersDoc, session.username);
  return editGroupIds.some((g) => userGroupIds.includes(g));
}

async function handleDavLoad(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const app = String(body.app || "");
  const url = getOwn(DAV_APPS, app);
  if (!url) return json({ error: "Unbekannte App" }, 400, corsHeaders);

  if (!(await userMayAccessTool(app, session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }

  const { data, rev } = await readJsonWithRev(url, authHeader, null);
  return json({ data, rev }, 200, corsHeaders);
}

async function handleDavSave(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const app = String(body.app || "");
  const url = getOwn(DAV_APPS, app);
  if (!url) return json({ error: "Unbekannte App" }, 400, corsHeaders);

  if (body.data == null || typeof body.data !== "object") {
    return json({ error: "Ungültige Daten" }, 400, corsHeaders);
  }

  if (!(await userMayAccessTool(app, session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }

  // Optionaler Konfliktschutz: schickt der Client das rev (ETag) seines letzten
  // dav-load mit, wird nur geschrieben, wenn die Datei serverseitig unverändert
  // ist. Alte Clients ohne rev schreiben unconditional wie bisher. normalizeETag()
  // faengt Clients ab, die noch ein rev mit W/-Praefix im Speicher haben (z.B. aus
  // einer laenger offenen Seite von vor diesem Fix) — sonst waere der Konfliktschutz
  // erst nach einem Reload JEDER offenen Seite wieder benutzbar, nicht sofort nach
  // dem Worker-Deploy.
  const rev = normalizeETag(typeof body.rev === "string" && body.rev ? body.rev : null);
  let newRev;
  try {
    newRev = await writeJson(url, authHeader, body.data, rev);
  } catch (e) {
    if (e instanceof ConflictError) {
      return json({ error: "Konflikt: Die Daten wurden zwischenzeitlich von einem anderen Gerät geändert", conflict: true }, 409, corsHeaders);
    }
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }
  return json({ ok: true, rev: newRev }, 200, corsHeaders);
}

// ---------- Aktionen: Datei-Anhänge (Binär-Upload für Gateway-Apps) ----------

const FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB (muss zum Client-Cap in config.js passen)

// Verzeichnis-URL (ohne Slash am Ende) für die Datei-Anhänge einer App: der
// Unterordner "dateien" neben der JSON-Datendatei. Die einzelne Datei liegt unter
// <dir>/<id> — der Original-Dateiname fließt NIE in den Pfad ein (Path-Traversal-
// Schutz), er steht nur als Metadatum in der JSON der App.
function davFileDir(app) {
  const jsonUrl = getOwn(DAV_APPS, app);
  if (!jsonUrl) return null;
  return jsonUrl.slice(0, jsonUrl.lastIndexOf("/")) + "/dateien";
}

// Gemeinsame Vorprüfung aller Datei-Aktionen: Login, bekannte App, gültige
// Datei-Id (UUID) und Tool-Sichtbarkeit (wie dav-load/dav-save). Liefert
// { dir, fileUrl } oder { error: <fertige Response> }.
async function prepareFileAction(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return { error: json({ error: "Nicht angemeldet" }, 401, corsHeaders) };
  const app = String(body.app || "");
  const dir = davFileDir(app);
  if (!dir) return { error: json({ error: "Unbekannte App" }, 400, corsHeaders) };
  const id = String(body.id || "");
  if (!FILE_ID_RE.test(id)) return { error: json({ error: "Ungültige Datei-Id" }, 400, corsHeaders) };
  if (!(await userMayAccessTool(app, session, env, authHeader))) {
    return { error: json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders) };
  }
  return { dir, fileUrl: dir + "/" + id };
}

async function handleDavFilePut(request, body, env, authHeader, corsHeaders) {
  const p = await prepareFileAction(request, body, env, authHeader, corsHeaders);
  if (p.error) return p.error;

  let bytes;
  try {
    bytes = base64ToBytes(String(body.dataBase64 || ""));
  } catch (_) {
    return json({ error: "Datei-Inhalt ist kein gültiges base64" }, 400, corsHeaders);
  }
  if (bytes.length === 0) return json({ error: "Leere Datei" }, 400, corsHeaders);
  if (bytes.length > MAX_FILE_BYTES) return json({ error: "Datei zu groß" }, 413, corsHeaders);

  // Content-Type nur als schlichter ASCII-String übernehmen (kein CR/LF -> keine
  // Header-Injektion), sonst Fallback.
  let ctype = String(body.contentType || "").replace(/[^\x20-\x7e]/g, "");
  if (!ctype || ctype.length > 200) ctype = "application/octet-stream";

  const headers = { Authorization: authHeader, "Content-Type": ctype };
  let resp = await fetch(p.fileUrl, { method: "PUT", headers, body: bytes });
  // 409 beim PUT = der Unterordner "dateien" existiert noch nicht -> anlegen und
  // EINMAL wiederholen (MKCOL-Autofix, wie bei der ersten JSON-Speicherung).
  if (resp.status === 409) {
    await ensureCollection(p.dir, authHeader, 0);
    resp = await fetch(p.fileUrl, { method: "PUT", headers, body: bytes });
  }
  if (!resp.ok) return json({ error: `Nextcloud PUT ${resp.status}` }, 502, corsHeaders);
  return json({ ok: true }, 200, corsHeaders);
}

async function handleDavFileGet(request, body, env, authHeader, corsHeaders) {
  const p = await prepareFileAction(request, body, env, authHeader, corsHeaders);
  if (p.error) return p.error;

  let resp;
  try {
    resp = await fetch(p.fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = resp.headers.get("Content-Type") || "application/octet-stream";
  // Rohe Bytes als Stream durchreichen, mit CORS-Headern; der Client baut daraus
  // per Blob einen Download-/Vorschau-Link.
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

async function handleDavFileDelete(request, body, env, authHeader, corsHeaders) {
  const p = await prepareFileAction(request, body, env, authHeader, corsHeaders);
  if (p.error) return p.error;

  const resp = await fetch(p.fileUrl, { method: "DELETE", headers: { Authorization: authHeader } });
  // 204/200 = gelöscht, 404 = war schon weg — beides ist Erfolg fürs Aufräumen.
  if (resp.ok || resp.status === 404) return json({ ok: true }, 200, corsHeaders);
  return json({ error: `Nextcloud DELETE ${resp.status}` }, 502, corsHeaders);
}

// ---------- Nextcloud-JSON-Helfer ----------

function emptyUsersDoc() {
  return { version: 1, users: {}, groups: {} };
}

// NextcloudError -> 502 an den Client (zentral im fetch-Handler abgefangen),
// ConflictError -> 409 (nur dav-save mit rev/If-Match).
class NextcloudError extends Error {}
class ConflictError extends Error {}

// Liest eine JSON-Datei. NUR "Datei existiert nicht" (404) oder eine leere Datei
// ergeben den Fallback. Jeder andere Fehler (Netz, 5xx, kaputtes JSON) wirft —
// ein transienter Lesefehler darf nicht wie eine leere/neue Datei aussehen.
async function readJson(url, authHeader, fallback) {
  return (await readJsonWithRev(url, authHeader, fallback)).data;
}

// Kurzlebiger In-Memory-Cache für readJsonWithRev, ueberlebt auf einem warmen
// Worker-Isolate mehrere Requests. Grund: nutzer.json und sichtbarkeit.json
// werden bei JEDER einzelnen Aktion neu von Nextcloud gelesen (Session-Pruefung
// + Sichtbarkeits-Check), obwohl z.B. das Laden des Dashboards mehrere Aktionen
// (me, dav-load, list-users, list-groups) binnen Millisekunden ausloest — ohne
// Cache also bis zu 6-8 serielle Nextcloud-Roundtrips fuer eine einzige
// Seitenansicht. TTL kurz halten (statt unbegrenzt), damit eine Aenderung durch
// ein ANDERES Isolate nicht zu lang unbemerkt bleibt; writeJson invalidiert den
// eigenen Eintrag sofort, das deckt den Normalfall (Schreiben+Lesen im selben
// Request-Burst) verzoegerungsfrei ab.
const jsonCache = new Map(); // url -> { data, rev, expires }
const CACHE_TTL_MS = 5000;

// Nextcloud liefert ETags als "weak" (Praefix W/). HTTP verlangt fuer If-Match
// zwingend einen "strong comparison" und lehnt JEDEN weak-getaggten Wert schon
// dem Namen nach ab (RFC 7232 3.1) — ohne dieses Strippen bekommt jede
// If-Match-PUT ein 412, IMMER, unabhaengig davon ob die Datei sich wirklich
// geaendert hat (per Live-Test bestaetigt: identischer rev vor/nach Neuladen,
// trotzdem 412). Praefix vor jeder Weiterverwendung als If-Match entfernen.
function normalizeETag(etag) {
  return etag && etag.startsWith("W/") ? etag.slice(2) : etag;
}

async function readJsonWithRev(url, authHeader, fallback) {
  const cached = jsonCache.get(url);
  if (cached && cached.expires > Date.now()) return { data: cached.data, rev: cached.rev };

  let resp;
  try {
    resp = await fetch(url, { method: "GET", headers: { Authorization: authHeader } });
  } catch (e) {
    throw new NextcloudError("Nextcloud nicht erreichbar: " + e.message);
  }
  // 404/leer wird bewusst NICHT gecacht: seltener Pfad (i.d.R. nur vor der
  // allerersten Speicherung einer Datei), Cachen wuerde riskieren, eine
  // zwischenzeitliche Erst-Anlage durch ein anderes Isolate zu verdecken.
  if (resp.status === 404) return { data: fallback, rev: null };
  if (!resp.ok) throw new NextcloudError(`Nextcloud GET ${resp.status}`);
  const rev = normalizeETag(resp.headers.get("ETag"));
  const text = await resp.text();
  if (!text.trim()) return { data: fallback, rev };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    throw new NextcloudError("Nextcloud-Datei enthält kein gültiges JSON — Zugriff abgebrochen, Datei bitte prüfen");
  }
  if (parsed && typeof parsed === "object") {
    jsonCache.set(url, { data: parsed, rev, expires: Date.now() + CACHE_TTL_MS });
    return { data: parsed, rev };
  }
  throw new NextcloudError("Nextcloud-Datei hat ein unerwartetes Format — Zugriff abgebrochen");
}

// Schreibt eine JSON-Datei; mit ifMatch nur, wenn die Datei serverseitig noch dem
// bekannten Stand entspricht (412 -> ConflictError). Gibt das neue ETag zurück.
async function writeJson(url, authHeader, data, ifMatch) {
  const headers = { Authorization: authHeader, "Content-Type": "application/json" };
  if (ifMatch) headers["If-Match"] = ifMatch;
  const body = JSON.stringify(data, null, 2);
  let resp = await fetch(url, { method: "PUT", headers, body });
  // 409 beim PUT heißt in WebDAV: der Elternordner existiert noch nicht (passiert
  // bei der allerersten Speicherung einer neu angebundenen App). Ordner anlegen und
  // EINMAL wiederholen. Mit ifMatch kann ein 409 hier nicht aus einem fehlenden
  // Ordner stammen (die Datei — und damit ihr Ordner — existierte ja schon), daher
  // nur im unbedingten Fall automatisch anlegen.
  if (resp.status === 409 && !ifMatch) {
    await ensureParentCollection(url, authHeader);
    resp = await fetch(url, { method: "PUT", headers, body });
  }
  if (resp.status === 412) throw new ConflictError("Datei wurde zwischenzeitlich geändert");
  if (!resp.ok) throw new Error(`Nextcloud PUT ${resp.status}`);
  jsonCache.delete(url); // ab jetzt garantiert veraltet, naechster Read holt frisch
  return normalizeETag(resp.headers.get("OC-ETag") || resp.headers.get("ETag") || null);
}

// Legt den Elternordner der Datei-URL an — rekursiv, falls mehrere Ebenen fehlen.
// WebDAV MKCOL: 201 = angelegt, 405 = existiert bereits (Basisfall der Rekursion,
// bricht das Hochlaufen ab, sobald ein vorhandener Ordner erreicht ist),
// 409 = der eigene Elternordner fehlt ebenfalls -> erst den anlegen, dann erneut.
async function ensureParentCollection(fileUrl, authHeader) {
  await ensureCollection(fileUrl.slice(0, fileUrl.lastIndexOf("/")), authHeader, 0);
}

async function ensureCollection(collUrl, authHeader, depth) {
  if (depth > 15) throw new NextcloudError("Ordnerpfad zu tief zum automatischen Anlegen");
  let resp = await fetch(collUrl, { method: "MKCOL", headers: { Authorization: authHeader } });
  if (resp.status === 201 || resp.status === 405) return; // neu angelegt bzw. schon vorhanden
  if (resp.status === 409) {
    await ensureCollection(collUrl.slice(0, collUrl.lastIndexOf("/")), authHeader, depth + 1);
    resp = await fetch(collUrl, { method: "MKCOL", headers: { Authorization: authHeader } });
    if (resp.status === 201 || resp.status === 405) return;
  }
  throw new NextcloudError(`Ordner anlegen fehlgeschlagen (MKCOL ${resp.status})`);
}

// ---------- Gruppen-Helfer ----------

function addUserToGroups(usersDoc, username, groupIds) {
  if (!Array.isArray(groupIds)) return;
  groupIds.forEach((gid) => {
    const group = getOwn(usersDoc.groups, String(gid));
    if (group && !group.memberUsernames.includes(username)) group.memberUsernames.push(username);
  });
}

function getUserGroupIds(usersDoc, username) {
  const groups = usersDoc.groups || {};
  return Object.values(groups)
    .filter((g) => Array.isArray(g.memberUsernames) && g.memberUsernames.includes(username))
    .map((g) => g.id);
}

function transliterate(str) {
  return String(str)
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue");
}

function slugifyNamePart(str) {
  return transliterate(String(str || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function generateUsername(vorname, nachname, existingUsernames) {
  const vornamePart = slugifyNamePart(vorname);
  const nachnamePart = slugifyNamePart(nachname);
  let base = [vornamePart, nachnamePart].filter(Boolean).join(".");
  if (base.length < 3) base = (base + "nutzer").slice(0, 32);
  base = base.slice(0, 32);

  let candidate = base;
  let suffix = 1;
  while (existingUsernames.has(candidate) || !USERNAME_RE.test(candidate)) {
    suffix++;
    const suffixStr = String(suffix);
    candidate = base.slice(0, 32 - suffixStr.length) + suffixStr;
  }
  return candidate;
}

function slugifyGroupName(name) {
  const slug = transliterate(String(name || ""))
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "gruppe";
}

function uniqueGroupId(baseId, existingIds) {
  let candidate = baseId;
  let suffix = 1;
  while (existingIds.has(candidate)) {
    suffix++;
    candidate = `${baseId}-${suffix}`;
  }
  return candidate;
}

// ---------- Passwort-Regeln ----------

// Identisch im Frontend (app.js) dupliziert, da der Worker separat deployed wird.
// min. 12 Zeichen, Groß- und Kleinbuchstabe, dazu eine Zahl ODER ein Sonderzeichen.
function validatePasswordStrength(password) {
  const pw = String(password == null ? "" : password);
  if (pw.length < 12) return "Passwort muss mindestens 12 Zeichen lang sein.";
  if (!/[A-ZÄÖÜ]/.test(pw)) return "Passwort braucht mindestens einen Großbuchstaben.";
  if (!/[a-zäöüß]/.test(pw)) return "Passwort braucht mindestens einen Kleinbuchstaben.";
  if (!/[0-9]/.test(pw) && !/[^A-Za-z0-9ÄÖÜäöüß]/.test(pw)) return "Passwort braucht mindestens eine Zahl oder ein Sonderzeichen.";
  return null;
}

// ---------- Passwort-Hashing (PBKDF2, Web Crypto, keine Abhängigkeiten) ----------

async function deriveHashBits(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    keyMaterial,
    HASH_BITS
  );
  return new Uint8Array(bits);
}

async function hashNewPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hashBytes = await deriveHashBits(password, salt, PBKDF2_ITERATIONS);
  return { hash: bytesToBase64(hashBytes), salt: bytesToBase64(salt), iterations: PBKDF2_ITERATIONS };
}

async function verifyPassword(password, saltB64, iterations, expectedHashB64) {
  const salt = base64ToBytes(saltB64);
  const hashBytes = await deriveHashBits(password, salt, iterations);
  return timingSafeEqual(bytesToBase64(hashBytes), expectedHashB64);
}

function timingSafeEqual(aB64, bB64) {
  const a = base64ToBytes(aB64);
  const b = base64ToBytes(bB64);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- Session-Token (HMAC-signiert, zustandslos) ----------

function makeSessionPayload(username, isAdmin) {
  const iat = Math.floor(Date.now() / 1000);
  return { username, isAdmin: !!isAdmin, iat, exp: iat + SESSION_TTL_SECONDS };
}

async function signToken(payload, secret) {
  const enc = new TextEncoder();
  const payloadB64 = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  return payloadB64 + "." + bytesToBase64Url(new Uint8Array(sig));
}

async function verifyToken(token, secret) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let valid;
  try {
    valid = await crypto.subtle.verify("HMAC", key, base64UrlToBytes(sigB64), enc.encode(payloadB64));
  } catch (_) {
    return null;
  }
  if (!valid) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  } catch (_) {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

async function getSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return await verifyToken(match[1], env.SESSION_SECRET);
}

// Verifiziert das Token UND gleicht es mit dem aktuellen Nutzerbestand ab —
// zustandslose Tokens allein überleben sonst Nutzer-Löschung, Passwort-Reset
// und Admin-Entzug bis zu 30 Tage. Regeln: Nutzer muss noch existieren und ein
// gesetztes Passwort haben; Tokens von VOR dem letzten Passwort-Setzen sind
// ungültig (Reset durch Admin wirft damit alle alten Sitzungen raus); isAdmin
// kommt aus dem aktuellen Datensatz, nicht aus dem Token. Gibt zusätzlich das
// bereits gelesene usersDoc zurück, damit Handler es weiterverwenden können
// (kein zweiter Nextcloud-Read pro Request).
async function getVerifiedSession(request, env, authHeader) {
  const payload = await getSession(request, env);
  if (!payload) return null;
  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  const user = getOwn(usersDoc.users, String(payload.username || ""));
  if (!user || user.mustSetPassword || !user.passwordHash) return null;
  if (user.passwordSetAt) {
    const setAt = Math.floor(Date.parse(user.passwordSetAt) / 1000);
    if (Number.isFinite(setAt) && (Number(payload.iat) || 0) < setAt) return null;
  }
  return { username: user.username, isAdmin: !!user.isAdmin, usersDoc };
}

// ---------- sonstige Helfer ----------

function normalizeUsername(raw) {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, ".");
}

// Dynamische Objekt-Lookups mit von außen bestimmten Keys: nur echte eigene
// Properties zählen. Ohne diesen Check liefern geerbte Keys wie "__proto__"
// oder "constructor" ein truthy Ergebnis (Object.prototype bzw. die
// Konstruktor-Funktion) und fließen dann als vermeintlicher Treffer in die
// weitere Logik ein.
function getOwn(obj, key) {
  return obj && typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key)
    ? obj[key]
    : undefined;
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(b64url) {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return base64ToBytes(b64);
}

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
