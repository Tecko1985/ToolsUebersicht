# Tools-Übersicht (v1.0)

Zentrale Landingpage mit Links zu allen Vereins- und privaten Tools (Vanilla JS, kein Build-Step). Live unter https://tecko1985.github.io/ToolsUebersicht/, deployed via GitHub Pages.

Jede Tool-Karte zeigt Version und geeignetes Endgerät (📱/💻) des verlinkten Tools; die Karten lassen sich per Greifpunkt frei anordnen (Reihenfolge wird im Browser gemerkt).

- `config.js` — Stammdaten aller Tool-Links (`TOOLS`-Array: Name, Beschreibung, URL, Kategorie, Version). Neue Tools werden hier per Code-Änderung ergänzt.
- `app.js` — rendert die Kartenübersicht, das Login und den Admin-Tab.
- `admin-worker.js` — Cloudflare Worker: Login/Sessions, Sichtbarkeits-Konfiguration und das WebDAV-Login-Gateway für andere Apps (siehe unten), beides in Nextcloud gespeichert. Wird **nicht** über GitHub Pages ausgeliefert, sondern separat bei Cloudflare deployed (Anleitung im Datei-Kopf).

## Login & Nutzerverwaltung

Echte Nutzerkonten statt eines geteilten PIN:

- Nicht eingeloggte Besucher sehen weiterhin alle öffentlich markierten Tools. Ist dadurch aktuell kein Tool sichtbar, erscheint ein Hinweis mit "Jetzt anmelden"-Button statt einer reinen Leermeldung.
- Ein Login schaltet zusätzlich Tools frei, die im Admin-Tab auf "nur eingeloggt" oder auf bestimmte Gruppen gestellt wurden.
- Admin-Konten können im Admin-Tab (Bereich "Nutzer") weitere Nutzer anlegen — dabei wird nur Vorname/Nachname angegeben, kein Passwort. Der Nutzername (z.B. `max.muster`) wird automatisch generiert, bei Namensgleichheit mit angehängter Zahl.
- Die Anmeldung läuft zweistufig: zuerst nur den Nutzernamen eingeben ("Weiter"). Je nach Ergebnis erscheint entweder das Passwortfeld für einen bestehenden Account, oder — beim allerersten Login des Nutzers — das Formular "Konto einrichten", in dem er sein eigenes Passwort festlegt und damit sein Konto verknüpft. Beide Zwischenschritte haben einen "Zurück"-Button zur Nutzernamen-Eingabe.
- Neue Passwörter müssen mindestens 12 Zeichen lang sein und Groß- sowie Kleinbuchstaben sowie eine Zahl oder ein Sonderzeichen enthalten (gilt für Admin-Anlage und Erstlogin).
- Ein Admin kann jederzeit das Passwort eines Nutzers zurücksetzen (z.B. wenn jemand ausgesperrt ist) — der Nutzer durchläuft danach erneut den Erstlogin-Flow. Vorname/Nachname/Admin-Status lassen sich nachträglich bearbeiten, Nutzer lassen sich löschen (inkl. Sicherheitsabfrage). Dem letzten Admin-Konto kann der Admin-Status nicht entzogen werden, es kann auch nicht gelöscht werden.
- Für größere Listen gibt es einen Text-Massenimport (Admin-Tab → "Nutzer-Massenimport"): ein Name pro Zeile im Format `Vorname Nachname`.
- Passwörter werden mit PBKDF2 (Web Crypto, 100.000 Iterationen, Salt pro Nutzer) gehasht, niemals im Klartext gespeichert. Sessions sind signierte Bearer-Token (30 Tage gültig), im Browser in `localStorage` unter dem Schlüssel `tu_session_token` gespeichert.

**Bekannter Tradeoff:** Wer einen frisch angelegten Nutzernamen kennt, bevor die echte Person sich zuerst einloggt, könnte ihn theoretisch übernehmen. Für dieses interne Vereins-Tool bewusst akzeptiert — im Zweifel per "Passwort zurücksetzen" korrigierbar.

**Erstbesuch:** Solange in der Nutzerdatei noch kein Konto existiert, öffnet sich im Admin-Tab automatisch das Formular zum Anlegen des ersten Admin-Kontos. Dieser Weg ist danach dauerhaft gesperrt — er hängt daran, ob global schon irgendein Nutzer existiert, nicht an Browser oder Gerät.

Solange `admin-worker.js` noch nicht mit den unten genannten Secrets deployed ist, läuft die Seite im Fallback-Modus: alle Tools aus `config.js` gelten als öffentlich sichtbar, der Admin-Tab meldet einen Verbindungsfehler.

## Nutzergruppen & Sichtbarkeit

- Im Admin-Tab unter "Gruppen" können Gruppen angelegt werden (z.B. "Vorstand", "Trainer U15"). Mitglieder werden über eine Checkbox-Liste je Gruppe zugeordnet ("Mitglieder"-Button) — alternativ direkt in der Nutzerliste über den "Gruppen"-Button je Nutzer.
- Pro Tool ist die Sichtbarkeit vierstufig einstellbar: versteckt, öffentlich, für jeden eingeloggten Nutzer, oder nur für bestimmte Gruppen (plus Admins, die immer alles sehen). Alternativ direkt über den "Apps"-Button je Gruppe: dort legt man fest, welche Tools diese Gruppe nutzen darf (setzt automatisch "nur eingeloggt").
- Entfernt man einer Gruppe die letzte Tool-Zuordnung, wird das Tool wieder versteckt statt für alle eingeloggten Nutzer sichtbar zu werden.
- Eine gelöschte Gruppe wird automatisch aus allen Tool-Zuordnungen entfernt, damit kein Tool versehentlich für alle unsichtbar bleibt.
- Kein zusätzliches Worker-Secret nötig: Gruppen werden zusammen mit den Nutzerkonten in derselben `nutzer.json` gespeichert.

## WebDAV-Login-Gateway für andere Apps

Mehrere Vereins-Tools (Materialliste, TrainerCheckliste, Spielertool, Trainerkodex, Platzbelegung, Spielersichtung, Personalkosten) speichern ihre eigenen Daten per WebDAV in derselben Nextcloud. Statt dort ein eigenes Formular mit WebDAV-Adresse, Benutzername und App-Passwort zu verlangen, nutzen sie dieselbe Anmeldung wie diese Übersicht:

- Die Apps lesen das Login-Token aus `localStorage["tu_session_token"]` (funktioniert, weil alle Apps auf derselben Origin `tecko1985.github.io` liegen) und rufen den Worker mit `{ action: "dav-load" | "dav-save", app: "<tool-id>" }` auf.
- Der Worker prüft das Token **und** die Gruppen-Sichtbarkeit des jeweiligen Tools (identische Regeln wie oben), bevor er serverseitig mit den eigenen Nextcloud-Zugangsdaten auf die passende Datei zugreift. Der Client bekommt nie ein Passwort zu Gesicht.
- Die Zuordnung App-id → Nextcloud-Datei-Pfad liegt fest in `DAV_APPS` in `admin-worker.js`. Eine weitere App anzubinden heißt: Eintrag in `DAV_APPS` ergänzen, in der App den gleichen Gateway-Code (Token lesen, `dav-load`/`dav-save` aufrufen) einbauen und das alte WebDAV-Formular entfernen.

## Setup nach dem ersten Deploy

1. `admin-worker.js` bei Cloudflare deployen (siehe Kommentar im Datei-Kopf).
2. Worker-Secrets setzen: `NEXTCLOUD_URL`, `NEXTCLOUD_NUTZER_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_PASSWORD`, `SESSION_SECRET`.
3. **Direkt danach, bevor die URL geteilt wird**: im Admin-Tab der Seite läuft automatisch das "Admin-Konto einrichten"-Formular (solange `nutzer.json` noch leer ist) — dort das erste Admin-Konto anlegen. Dieser Weg ist danach dauerhaft gesperrt.
4. Weitere Nutzer im Admin-Tab unter "Nutzer" anlegen.

## Geplante Erweiterung

Aktuell ist die Sichtbarkeit pro Tool nur bis auf Gruppenebene einstellbar. Eine noch feinere, nutzerspezifische Freigabe pro Tool (z.B. "nur Person A und B sehen Tool X") ist im Datenmodell nicht ausgeschlossen, aber noch nicht implementiert.
