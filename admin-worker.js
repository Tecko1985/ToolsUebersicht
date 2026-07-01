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
//   POST { action: "me" } + Authorization: Bearer <token>       -> { username, isAdmin, groupIds }
//   POST { action: "create-user", vorname, nachname, isAdmin, groupIds } (admin) -> generiert Nutzername, legt Nutzer mit mustSetPassword=true an
//   POST { action: "bulk-create-users", entries: [{vorname,nachname}], isAdmin, groupIds } (admin) -> { created, skipped }
//   POST { action: "list-users" } (admin)                       -> Liste inkl. vorname/nachname/displayName/groupIds, ohne Passwort-Hashes
//   POST { action: "reset-password", username } (admin)         -> löscht Hash, mustSetPassword=true
//   POST { action: "create-group", name } (admin)                -> legt Gruppe an (id per Slugify aus name)
//   POST { action: "list-groups" } (admin)                       -> alle Gruppen inkl. memberUsernames
//   POST { action: "update-group-members", groupId, memberUsernames } (admin) -> ersetzt Mitgliederliste komplett
//   POST { action: "delete-group", groupId } (admin)             -> löscht Gruppe, räumt groupIds in sichtbarkeit.json auf
//   POST { action: "save-visibility", tools } (admin)            -> ersetzt sichtbarkeit.json, tools[id] = {visible, loginRequired, groupIds}

const ALLOWED_ORIGINS = [
  "http://localhost:8770",
  "https://tecko1985.github.io"
];

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

    if (request.method === "GET") {
      const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
      const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
      return json({ tools: config.tools, bootstrapAvailable: Object.keys(usersDoc.users).length === 0 }, 200, corsHeaders);
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
        return handleMe(request, env, authHeader, corsHeaders);
      case "create-user":
        return handleCreateUser(request, body, env, authHeader, corsHeaders);
      case "bulk-create-users":
        return handleBulkCreateUsers(request, body, env, authHeader, corsHeaders);
      case "list-users":
        return handleListUsers(request, env, authHeader, corsHeaders);
      case "reset-password":
        return handleResetPassword(request, body, env, authHeader, corsHeaders);
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
      default:
        return json({ error: "Unbekannte Aktion" }, 400, corsHeaders);
    }
  }
};

// ---------- Aktionen: Auth ----------

async function handleBootstrapAdmin(body, env, authHeader, corsHeaders) {
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  if (!USERNAME_RE.test(username)) return json({ error: "Ungültiger Nutzername (3-32 Zeichen, a-z 0-9 . _ -)" }, 400, corsHeaders);
  if (password.length < 8) return json({ error: "Passwort muss mindestens 8 Zeichen haben" }, 400, corsHeaders);

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
  const user = usersDoc.users[username];

  if (!user) return json({ error: "Ungültige Anmeldedaten" }, 401, corsHeaders);
  if (user.mustSetPassword || !user.passwordHash) {
    return json({ needsPasswordSetup: true }, 200, corsHeaders);
  }

  const ok = await verifyPassword(password, user.salt, user.iterations, user.passwordHash);
  if (!ok) return json({ error: "Ungültige Anmeldedaten" }, 401, corsHeaders);

  const token = await signToken(makeSessionPayload(user.username, !!user.isAdmin), env.SESSION_SECRET);
  return json({ token, username: user.username, isAdmin: !!user.isAdmin, groupIds: getUserGroupIds(usersDoc, user.username) }, 200, corsHeaders);
}

async function handleSetPassword(body, env, authHeader, corsHeaders) {
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  if (password.length < 8) return json({ error: "Passwort muss mindestens 8 Zeichen haben" }, 400, corsHeaders);

  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  const user = usersDoc.users[username];
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

async function handleMe(request, env, authHeader, corsHeaders) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  let groupIds = [];
  if (!session.isAdmin) {
    const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
    groupIds = getUserGroupIds(usersDoc, session.username);
  }
  return json({ username: session.username, isAdmin: !!session.isAdmin, groupIds }, 200, corsHeaders);
}

// ---------- Aktionen: Nutzerverwaltung ----------

async function handleCreateUser(request, body, env, authHeader, corsHeaders) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const vorname = String(body.vorname || "").trim();
  const nachname = String(body.nachname || "").trim();
  if (!vorname || !nachname) return json({ error: "Vorname und Nachname erforderlich" }, 400, corsHeaders);

  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
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

async function handleBulkCreateUsers(request, body, env, authHeader, corsHeaders) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const entries = Array.isArray(body.entries) ? body.entries : [];
  const isAdmin = !!body.isAdmin;

  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  if (!usersDoc.groups) usersDoc.groups = {};

  const existingUsernames = new Set(Object.keys(usersDoc.users));
  const created = [];
  const skipped = [];

  for (const entry of entries) {
    const vorname = String((entry && entry.vorname) || "").trim();
    const nachname = String((entry && entry.nachname) || "").trim();
    if (!vorname || !nachname) {
      skipped.push({ vorname, nachname, reason: "Vorname oder Nachname fehlt" });
      continue;
    }
    const username = generateUsername(vorname, nachname, existingUsernames);
    existingUsernames.add(username);
    usersDoc.users[username] = {
      username, vorname, nachname, passwordHash: null, salt: null, iterations: null,
      isAdmin, mustSetPassword: true,
      createdAt: new Date().toISOString(), passwordSetAt: null
    };
    addUserToGroups(usersDoc, username, body.groupIds);
    created.push({ username, vorname, nachname });
  }

  if (created.length > 0) {
    try {
      await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
    } catch (e) {
      return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
    }
  }

  return json({ created, skipped }, 200, corsHeaders);
}

async function handleListUsers(request, env, authHeader, corsHeaders) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
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
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const username = normalizeUsername(body.username);
  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  const user = usersDoc.users[username];
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

// ---------- Aktionen: Gruppen ----------

async function handleCreateGroup(request, body, env, authHeader, corsHeaders) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const name = String(body.name || "").trim();
  if (!name) return json({ error: "Gruppenname erforderlich" }, 400, corsHeaders);

  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
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
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  return json({ groups: Object.values(usersDoc.groups || {}) }, 200, corsHeaders);
}

async function handleUpdateGroupMembers(request, body, env, authHeader, corsHeaders) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const groupId = String(body.groupId || "");
  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  const group = usersDoc.groups && usersDoc.groups[groupId];
  if (!group) return json({ error: "Unbekannte Gruppe" }, 404, corsHeaders);

  const requested = Array.isArray(body.memberUsernames) ? body.memberUsernames.map(normalizeUsername) : [];
  group.memberUsernames = requested.filter((u) => usersDoc.users[u]);

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ group }, 200, corsHeaders);
}

async function handleDeleteGroup(request, body, env, authHeader, corsHeaders) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const groupId = String(body.groupId || "");
  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  if (!usersDoc.groups || !usersDoc.groups[groupId]) return json({ error: "Unbekannte Gruppe" }, 404, corsHeaders);
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
    });
    if (changed) await writeJson(env.NEXTCLOUD_URL, authHeader, config);
  } catch (_) { /* Aufräumen ist best-effort */ }

  return json({ deleted: groupId }, 200, corsHeaders);
}

// ---------- Aktionen: Sichtbarkeit ----------

async function handleSaveVisibility(request, body, env, authHeader, corsHeaders) {
  const session = await getSession(request, env);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  if (!body.tools || typeof body.tools !== "object") {
    return json({ error: "Ungültige Daten" }, 400, corsHeaders);
  }

  const newConfig = { version: 1, tools: body.tools };
  try {
    await writeJson(env.NEXTCLOUD_URL, authHeader, newConfig);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ tools: newConfig.tools }, 200, corsHeaders);
}

// ---------- Nextcloud-JSON-Helfer ----------

function emptyUsersDoc() {
  return { version: 1, users: {}, groups: {} };
}

async function readJson(url, authHeader, fallback) {
  try {
    const resp = await fetch(url, { method: "GET", headers: { Authorization: authHeader } });
    if (resp.ok) {
      const text = await resp.text();
      if (text.trim()) {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") return parsed;
      }
    }
  } catch (_) { /* Datei existiert noch nicht */ }
  return fallback;
}

async function writeJson(url, authHeader, data) {
  const resp = await fetch(url, {
    method: "PUT",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(data, null, 2)
  });
  if (!resp.ok) throw new Error(`Nextcloud PUT ${resp.status}`);
}

// ---------- Gruppen-Helfer ----------

function addUserToGroups(usersDoc, username, groupIds) {
  if (!Array.isArray(groupIds)) return;
  groupIds.forEach((gid) => {
    const group = usersDoc.groups[gid];
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

// ---------- sonstige Helfer ----------

function normalizeUsername(raw) {
  return String(raw || "").trim().toLowerCase();
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
