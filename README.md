# Tools-Übersicht

Zentrale Landingpage mit Links zu allen Tools (Vanilla JS, kein Build-Step). Live unter https://tecko1985.github.io/ToolsUebersicht/, deployed via GitHub Pages.

- `config.js` — Stammdaten aller Tool-Links (`TOOLS`-Array: Name, Beschreibung, URL, Kategorie). Neue Tools werden hier per Code-Änderung ergänzt.
- `app.js` — rendert die Kartenübersicht, das Login und den Admin-Tab.
- `admin-worker.js` — Cloudflare Worker: Login/Sessions und die Sichtbarkeits-Konfiguration (welche Links aktuell eingeblendet sind), beide in Nextcloud gespeichert. Wird **nicht** über GitHub Pages ausgeliefert, sondern separat bei Cloudflare deployed (Anleitung im Datei-Kopf).

## Login & Nutzerverwaltung

Seit v2.0 gibt es echte Nutzerkonten statt eines geteilten PIN:

- Nicht eingeloggte Besucher sehen weiterhin alle öffentlich markierten Tools.
- Ein Login schaltet zusätzlich Tools frei, die im Admin-Tab auf "nur eingeloggt" gestellt wurden.
- Admin-Konten können im Admin-Tab (Bereich "Nutzer") weitere Nutzer anlegen — dabei wird nur ein Nutzername vergeben, kein Passwort. Der jeweilige Nutzer wählt sein Passwort selbst beim allerersten Login ("Passwort festlegen"-Formular erscheint automatisch).
- Ein Admin kann jederzeit das Passwort eines Nutzers zurücksetzen (z.B. wenn jemand ausgesperrt ist) — der Nutzer durchläuft danach erneut den Erstlogin-Flow.
- Passwörter werden mit PBKDF2 (Web Crypto, 100.000 Iterationen, Salt pro Nutzer) gehasht, niemals im Klartext gespeichert. Sessions sind signierte Bearer-Token (30 Tage gültig), im Browser in `localStorage` gespeichert.

**Bekannter Tradeoff:** Wer einen frisch angelegten Nutzernamen kennt, bevor die echte Person sich zuerst einloggt, könnte ihn theoretisch übernehmen. Für dieses interne Vereins-Tool bewusst akzeptiert — im Zweifel per "Passwort zurücksetzen" korrigierbar.

Solange `admin-worker.js` noch nicht mit den unten genannten Secrets deployed ist, läuft die Seite im Fallback-Modus: alle Tools aus `config.js` gelten als öffentlich sichtbar, der Admin-Tab meldet einen Verbindungsfehler.

## Nutzergruppen (seit v2.1)

- Im Admin-Tab unter "Gruppen" können Gruppen angelegt werden (z.B. "Vorstand", "Trainer U15"). Mitglieder werden über eine Checkbox-Liste je Gruppe zugeordnet.
- Bei der Sichtbarkeits-Einstellung eines Tools kann zusätzlich zu "nur eingeloggt" eine oder mehrere Gruppen ausgewählt werden — dann sehen nur Mitglieder dieser Gruppen (plus Admins, die immer alles sehen) das Tool. Leer gelassen gilt weiterhin "jeder eingeloggte Nutzer".
- Eine gelöschte Gruppe wird automatisch aus allen Tool-Zuordnungen entfernt, damit kein Tool versehentlich für alle unsichtbar bleibt.
- Nutzer anlegen erfolgt jetzt über Vorname/Nachname — der Nutzername (z.B. `max.muster`) wird automatisch generiert, bei Namensgleichheit mit angehängter Zahl (`max.muster2`).
- Für größere Listen gibt es einen Text-Massenimport (Admin-Tab → "Nutzer-Massenimport"): ein Name pro Zeile im Format `Vorname Nachname`, alle Personen werden mit `mustSetPassword` angelegt und durchlaufen beim ersten Login den normalen Erstlogin-Flow.
- Kein zusätzliches Worker-Secret nötig: Gruppen werden zusammen mit den Nutzerkonten in derselben `nutzer.json` gespeichert.

## Setup nach dem ersten Deploy

1. `admin-worker.js` bei Cloudflare deployen (siehe Kommentar im Datei-Kopf).
2. Worker-Secrets setzen: `NEXTCLOUD_URL`, `NEXTCLOUD_NUTZER_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_PASSWORD`, `SESSION_SECRET`. Das alte Secret `ADMIN_PIN` wird nicht mehr gebraucht und kann gelöscht werden.
3. **Direkt danach, bevor die URL geteilt wird**: im Admin-Tab der Seite läuft automatisch das "Admin-Konto einrichten"-Formular (solange `nutzer.json` noch leer ist) — dort das erste Admin-Konto anlegen. Dieser Weg ist danach dauerhaft gesperrt.
4. Weitere Nutzer im Admin-Tab unter "Nutzer" anlegen.

## Geplante Erweiterung

Aktuell ist die Sichtbarkeit pro Tool nur binär (öffentlich vs. "nur eingeloggt"). Eine feinere, nutzerspezifische Freigabe pro Tool (z.B. "nur Person A und B sehen Tool X") ist im Datenmodell nicht ausgeschlossen, aber noch nicht implementiert.
