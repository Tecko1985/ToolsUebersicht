# Tools-Übersicht

Zentrale Landingpage mit Links zu allen Tools (Vanilla JS, kein Build-Step). Live unter https://tecko1985.github.io/ToolsUebersicht/, deployed via GitHub Pages.

- `config.js` — Stammdaten aller Tool-Links (`TOOLS`-Array: Name, Beschreibung, URL, Kategorie). Neue Tools werden hier per Code-Änderung ergänzt.
- `app.js` — rendert die Kartenübersicht und den Admin-Tab.
- `admin-worker.js` — Cloudflare Worker, der die Sichtbarkeits-Konfiguration (welche Links aktuell eingeblendet sind) in Nextcloud liest/schreibt. Wird **nicht** über GitHub Pages ausgeliefert, sondern separat bei Cloudflare deployed (Anleitung im Datei-Kopf).

## Admin-Tab

Im Tab "Admin" kann per PIN festgelegt werden, welche Tool-Karten auf der Übersicht sichtbar sind. Die PIN wird serverseitig im Worker geprüft (Worker-Secret `ADMIN_PIN`), die Sichtbarkeits-Konfiguration liegt zentral in Nextcloud und gilt sofort für alle Besucher — ohne Redeploy.

Solange `admin-worker.js` noch nicht deployed ist, läuft die Seite im Fallback-Modus: alle Tools aus `config.js` gelten als sichtbar, der Admin-Tab meldet einen Verbindungsfehler.

## Setup nach dem ersten Deploy

1. `admin-worker.js` bei Cloudflare deployen (siehe Kommentar im Datei-Kopf).
2. Worker-Secrets setzen: `NEXTCLOUD_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_PASSWORD`, `ADMIN_PIN`.
3. Die resultierende `*.workers.dev`-URL in `app.js` als `WORKER_URL` eintragen und committen.

## Geplante Erweiterung

Perspektivisch soll die Sichtbarkeit einzelner Links auch auf bestimmte Personen eingeschränkt werden können. Das Datenschema (`tools[id]`-Objekt statt reinem Boolean) ist dafür bereits vorbereitet, aber noch nicht implementiert.
