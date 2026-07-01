// Cloudflare Worker: liefert/speichert die Sichtbarkeits-Konfiguration der
// Tools-Übersicht in Nextcloud. Nicht Teil des Pages-Deployments — separat
// bei Cloudflare deployen.
// Deployment: dash.cloudflare.com -> Workers & Pages -> Create Worker ->
// diesen Code einfügen -> Deploy.
// Worker-Name z.B. "toolsuebersicht" (URL: toolsuebersicht.<subdomain>.workers.dev)
// -> die tatsächliche URL danach in app.js als WORKER_URL eintragen.
//
// NACH dem Deploy folgende Worker-Secrets setzen
// (Workers -> toolsuebersicht -> Settings -> Variables -> Add secret):
//   NEXTCLOUD_URL       = https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/ToolsUebersicht/sichtbarkeit.json
//   NEXTCLOUD_USERNAME  = admin
//   NEXTCLOUD_PASSWORD  = <App-Passwort aus Nextcloud>
//   ADMIN_PIN           = <frei wählbare PIN für den Admin-Tab>
//
// Der Worker schreibt keine Zugangsdaten/PIN in den Code — alles kommt
// ausschließlich aus den Worker-Secrets (verschlüsselt, nicht im Repo sichtbar).
//
// API:
//   GET               -> { tools: {...} } ohne Auth (unkritische Daten, nur welche
//                         Links sichtbar sind). Fehlt die Datei noch, wird sie mit
//                         "alle sichtbar" initialisiert.
//   POST { pin }              -> prüft nur die PIN, gibt bei Erfolg { tools } zurück
//   POST { pin, tools }       -> prüft die PIN, schreibt tools nach Nextcloud,
//                                 gibt bei Erfolg { tools } zurück, sonst 401

const ALLOWED_ORIGINS = [
  "http://localhost:8770",
  "https://tecko1985.github.io"
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_PASSWORD || !env.ADMIN_PIN) {
      return json({ error: "Worker-Secrets nicht konfiguriert" }, 500, corsHeaders);
    }

    const authHeader = "Basic " + btoa(env.NEXTCLOUD_USERNAME + ":" + env.NEXTCLOUD_PASSWORD);

    if (request.method === "GET") {
      const data = await readConfig(env.NEXTCLOUD_URL, authHeader);
      return json({ tools: data.tools }, 200, corsHeaders);
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

    if (body.pin !== env.ADMIN_PIN) {
      return json({ error: "Falsche PIN" }, 401, corsHeaders);
    }

    // Nur PIN-Verifikation, kein Schreiben
    if (!body.tools || typeof body.tools !== "object") {
      const data = await readConfig(env.NEXTCLOUD_URL, authHeader);
      return json({ tools: data.tools }, 200, corsHeaders);
    }

    const newConfig = { version: 1, tools: body.tools };
    try {
      const putResp = await fetch(env.NEXTCLOUD_URL, {
        method: "PUT",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(newConfig, null, 2)
      });
      if (!putResp.ok) throw new Error(`Nextcloud PUT ${putResp.status}`);
    } catch (e) {
      return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
    }

    return json({ tools: newConfig.tools }, 200, corsHeaders);
  }
};

async function readConfig(nextcloudUrl, authHeader) {
  try {
    const resp = await fetch(nextcloudUrl, { method: "GET", headers: { Authorization: authHeader } });
    if (resp.ok) {
      const text = await resp.text();
      if (text.trim()) {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.tools === "object") return parsed;
      }
    }
  } catch (_) { /* Datei existiert noch nicht */ }
  return { version: 1, tools: {} };
}

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
