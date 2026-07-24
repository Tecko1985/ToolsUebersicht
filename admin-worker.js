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
//   PW_BUDGET_EINGANG_ZUGANG = sc-heiligenstadt-beleg-upload-Worker (eigenes Cloudflare-Deploy!): Zugriffscode in beleg-eingang.html
//
// Die letzte wird nicht vom Browser-Client, sondern vom EIGENEN Cloudflare Worker
// serverseitig abgefragt (Worker-zu-Worker-Fetch) - dieser Worker braucht dafür
// kein eigenes Passwort-Secret mehr.
// (beleg-scanner nutzte diesen Weg vorübergehend ebenfalls, seit 2026-07-05 wieder
// eigenständig mit lokalen Secrets SEARCH_PASSWORD/UPLOAD_PASSWORD - siehe dort.)
//
// Optionales Secret für den E-Mail-Versand (Aktionen "notify-user" und
// "beleg-eingang-notify", siehe unten). Fehlt es, meldet nur die jeweilige Aktion
// einen Konfigurationsfehler, der Rest des Workers läuft normal (gleiches Prinzip
// wie bei den LIVEKIT_*-Secrets):
//   BREVO_API_KEY = API-Key aus dem Brevo-Konto (Einzel-Absender-Verifizierung
//     der unten als NOTIFY_FROM_EMAIL hinterlegten Adresse dort vorher nötig)
//
// Optionale Variable (kein Secret, darf im Dashboard als Klartext-Variable stehen)
// für die Beleg-Benachrichtigung:
//   NOTIFY_BELEG_EMAIL = Empfängeradresse für "beleg-eingang-notify". Absichtlich
//     hier statt als Konstante im Code: sc-heiligenstadt-budget ist ein öffentliches
//     Repo, und der Empfänger lässt sich so ohne Deploy wechseln. Fehlt sie, bleibt
//     der Mailversand ein stiller No-Op (Beleg-Einreichung funktioniert weiter).
//
// BOOTSTRAP (einmalig, direkt nach dem Deploy, bevor die URL geteilt wird):
// Solange in nutzer.json noch kein Nutzer existiert, zeigt die Seite im
// Admin-Tab automatisch ein "Admin-Konto einrichten"-Formular. Dort einmal
// Nutzername + Passwort wählen — danach ist dieser Weg dauerhaft gesperrt
// (die Aktion "bootstrap-admin" antwortet ab dann mit 403).
//
// Passwörter werden mit PBKDF2-HMAC-SHA256 gehasht (Web-Crypto, keine
// Abhängigkeiten), Sessions sind zustandslose HMAC-signierte Bearer-Token
// (7 Tage gültig) — kein KV/D1 nötig. Nutzergruppen werden zusammen mit den
// Nutzerkonten in derselben nutzer.json gespeichert (Top-Level-Key "groups"),
// kein zusätzliches Worker-Secret nötig.
//
// API (POST-Body: { action, ... } außer beim einfachen GET):
//   GET                                                        -> { tools, bootstrapAvailable } ohne Auth
//   POST { action: "bootstrap-admin", username, password }     -> nur wenn noch keine Nutzer existieren
//   POST { action: "login", username, password }               -> { token, username, isAdmin, groupIds } | { needsPasswordSetup: true } | 401
//   POST { action: "set-password", username, password }        -> nur falls mustSetPassword=true beim Nutzer
//   POST { action: "km-reg-oeffnen", teamId } + Bearer (Bearbeiten-Recht kadermanager) -> { token, teamName, expiresAt, ttlSeconds, freieSpieler }
//     Öffnet ein 15-Minuten-Registrierungsfenster für eine Mannschaft. Zustandslos: das Fenster IST das
//     signierte Token (typ "km-reg"), nichts wird gespeichert -- dafür nicht vorzeitig widerrufbar.
//   POST { action: "km-reg-info", token }        (OHNE Auth) -> { teamName, spieler:[{id,name}], expiresAt } | 401
//     Nur die noch freien Kaderplätze, nur id+name. Der Spieler hat noch kein Konto; das Token ist der Ausweis.
//   POST { action: "km-reg-abschliessen", token, spielerId, password } (Auth OPTIONAL) -> { token?, username, verknuepft, ... } | 401 | 403 | 409
//     OHNE Bearer: legt das Spielerkonto an (art:"spieler", Gruppe "Spieler", Passwort direkt gesetzt) und
//     verknüpft es per linkedUsername mit dem Kaderplatz. Antwort enthält dann `token` (neue Sitzung).
//     MIT gültigem Bearer: KEIN neues Konto, nur Verknüpfung des Kaderplatzes mit dem angemeldeten Konto
//     (kein `password` nötig, kein `token` in der Antwort) -- der Weg für Spieler, die schon in einer
//     Mannschaft stehen und sich zusätzlich für eine Gruppe (Torwart-/Athletikgruppe) eintragen. Ohne das
//     entstünde bei jedem weiteren Scan ein Doppelkonto. Zusätzlich gegated auf Tool-Sichtbarkeit.
//     verknuepft:false = Konto steht, Verknüpfung kollidierte -> "Das bin ich".
//     Die Gruppe "Spieler" muss in sichtbarkeit.json bei kadermanager.groupIds stehen, sonst bleibt die App leer.
//   POST { action: "km-self", art, teamId, ... } + Bearer (nur Tool-SICHTBARKEIT nötig, kein Bearbeiten-Recht)
//     Spieler-Selbstbedienung im Kadermanager ("Briefschlitz"): ändert serverseitig genau EINEN eigenen Eintrag.
//     art = "teilnahme" {terminId,status,grund?} | "umfrage" {umfrageId,optionIds[]} | "aufgabe" {terminId,aufgabeId,erledigt}
//         | "fahrt-angebot" {terminId,plaetze} | "fahrt-gesuch" {terminId,an} | "urlaub-add" {id?,von,bis,grund?,typ}
//         | "urlaub-del" {abwesenheitId} | "claim" {spielerId} | "unclaim"
//     Der eigene Kaderplatz kommt IMMER aus linkedUsername, nie aus dem Body -- ein manipulierter Request
//     trifft deshalb keinen fremden Eintrag. Ersetzt dav-save für Spieler: das würde die GANZE Datei
//     (alle Mannschaften, Kasse) schreiben und ist für sie per WRITE_REQUIRES_EDIT_PERMISSION gesperrt.
//   POST { action: "me", app? } + Authorization: Bearer <token> -> { username, isAdmin, groupIds, groupNames, realIsAdmin, viewAsGroupId, vertragspflichtig, passwordSetAt } (+ canEdit/canAdmin, wenn app übergeben und bekannt)
//     groupNames (seit 2026-07-21): die Namen zu groupIds, damit "Mein Konto" die Gruppen auch
//     Nicht-Admins zeigen kann (list-groups ist admin-only). Nur die EIGENEN Gruppen — kein Ersatz
//     für list-directory und kein Weg an dessen Spieler-Sperre vorbei. passwordSetAt (dito): Zeitpunkt
//     der letzten Passwortvergabe für die Anzeige, null bei Konten ohne das Feld.
//     isAdmin/groupIds sind die EFFEKTIVE Identität (siehe set-view-as); realIsAdmin ist immer der echte
//     Admin-Status aus nutzer.json, unabhängig von einer aktiven Testansicht — die Testansicht-Umschaltung
//     selbst muss also realIsAdmin prüfen, nicht isAdmin, sonst kann ein Admin sich nicht zurückschalten.
//     vertragspflichtig (bool, seit 2026-07-17): Gruppe "Trainer" ODER vertragBenoetigt-Flag, siehe
//     isVertragspflichtig. Trainerdaten gated daran Bankverbindung/Nebentätigkeit/Unterschrift/Dokumente —
//     wer keinen Vertrag braucht (z.B. Geschäftsführung), hinterlegt dort nur Kontaktdaten. Bewusst die
//     ECHTE Identität (session.username), NICHT die effektive: identisch zu handleMyTrainerdatenStatus,
//     damit Ampel-Badge und Formular nie auseinanderlaufen. Folge: eine aktive set-view-as-Testansicht
//     ändert vertragspflichtig NICHT — die reduzierte Ansicht lässt sich damit nicht durchspielen.
//   POST { action: "set-view-as", groupId } (nur wenn realIsAdmin) -> { ok:true, isAdmin, groupIds, realIsAdmin, viewAsGroupId }
//     Admin-Testansicht: ein echter Admin kann sich testweise als Mitglied einer Gruppe ausgeben (groupId:null
//     zum Zurückschalten). Wirkt zentral über getVerifiedSession() auf JEDE Aktion jeder Gateway-App (dav-load/
//     -save, canEdit, Personalakte-Sicht, ...), nicht nur auf die Landingpage selbst — kein Redeploy der
//     einzelnen Apps nötig, die lesen ohnehin nur isAdmin/groupIds aus der me()-Antwort. Persistiert je Nutzer
//     als viewAsGroupId in nutzer.json (überlebt also auch einen Reload/Gerätewechsel, bis explizit zurückgesetzt).
//   POST { action: "create-user", vorname, nachname, isAdmin, groupIds, art? } (admin) -> generiert Nutzername, legt Nutzer mit mustSetPassword=true an
//     art: "personal" (Vorgabe) | "spieler" -- trennt Vereinspersonal von Spielern/Eltern, siehe userArt()/istPersonal().
//     Spieler sind nie Admin (isAdmin wird ignoriert), erscheinen NICHT in personalakte-overview/list-directory/
//     list-trainer-profiles/get-admin-stats.users und kommen nur über explizit gesetzte groupIds an ein Tool
//     (der "keine Gruppe = alle eingeloggten"-Default gilt für sie nicht). Provisioning: nur kadermanager.
//   POST { action: "list-users" } (admin)                       -> Liste inkl. vorname/nachname/displayName/groupIds, ohne Passwort-Hashes
//   POST { action: "reset-password", username } (admin)         -> löscht Hash, mustSetPassword=true
//   POST { action: "change-password", oldPassword, newPassword } (eingeloggt) -> { token, username, ...identity }
//     Aendert das EIGENE Passwort; der Nutzer kommt aus dem Token, nie aus dem Body. Setzt passwordSetAt neu und
//     entwertet damit jede aeltere Session (siehe getVerifiedSession) — das zurueckgegebene Token muss der Client
//     speichern, sonst sperrt sich der Aendernde selbst aus.
//   POST { action: "update-user", username, vorname, nachname, isAdmin } (admin) -> ändert Vor-/Nachname und Admin-Status (letztem Admin kann Admin-Status nicht entzogen werden); zieht bei Namensänderung den Login-Nutzernamen automatisch mit um (Response-Feld usernameRename), außer die Zielkennung ist durch ein anderes Konto belegt
//   POST { action: "delete-user", username } (admin)             -> löscht Nutzer, entfernt ihn aus allen Gruppen (letzter Admin kann nicht gelöscht werden)
//   POST { action: "create-group", name } (admin)                -> legt Gruppe an (id per Slugify aus name)
//   POST { action: "list-groups" } (admin)                       -> alle Gruppen inkl. memberUsernames
//   POST { action: "trainerdaten-list-groups" } (admin ODER Trainerdaten-ADMINISTRIEREN-Stufe) -> alle Gruppen inkl. memberUsernames,
//     Mitglieder auf Personal gefiltert — schmale Variante von list-groups für die Gruppen-Auswahl/-Spalte im
//     Trainerdaten-CSV-Export (resolveAdminPermission("trainerdaten"): Administrieren-Gruppen aus dem Sichtbarkeits-Panel)
//   POST { action: "check-edit-permission", app } (jeder eingeloggte Nutzer) -> { canEdit, canAdmin } via
//     resolveEditPermission/resolveAdminPermission. Verrät nur das EIGENE Recht für EINE App (keine fremden Daten).
//     Konsumenten: der Trainerdaten-CORS-Proxy (Worker "trainerdaten", prüft darüber serverseitig die
//     ADMINISTRIEREN-Stufe, bevor er WebDAV-Zugriffe mit seinen eigenen Nextcloud-Secrets ausführt) und der
//     Trainerdaten-/Dokumentenvorlagen-Client für den Admin-Einstieg.
//     Bewusst 200 + false statt 403 bei fehlendem Recht — Aufrufer müssen "Session tot" (401) von
//     "kein Recht" unterscheiden können.
//   POST { action: "list-directory" } (jedes eingeloggte PERSONAL) -> { users:[{username,displayName}], groups:[{id,name}] } ohne
//     sensible Felder (kein isAdmin/mustSetPassword/memberUsernames) — für Teilen-mit-Picker in Gateway-Apps (z.B. Vereinskalender)
//     Liefert nur Personal; Spielerkonten bekommen 403 (kein Spieler-Tool hat einen Picker, und die vollständige
//     Namensliste des Vereins ist für ein Spielerkonto nichts zu holen).
//   POST { action: "list-tool-editors", app } + Authorization: Bearer -> { users:[{username,displayName}] }
//     Mitglieder der Bearbeiter-Gruppen (editGroupIds + adminGroupIds) EINER bestimmten App, z.B. für einen "Vertreter"-Picker
//     im Abwesenheitskalender-Formular — jeder mit Tool-Zugriff darf abrufen (gleiche Prüfung wie dav-load:
//     userMayAccessTool), kein Admin-Gate. Keine sensiblen Felder, gleiche Vertrauensstufe wie list-directory.
//   POST { action: "list-trainer-profiles" } (jeder eingeloggte Nutzer) -> { profiles:[{username,vorname,nachname,lizenz,mannschaften,vertragBenoetigt}] }
//     für alle Nutzer mit gesetztem Vor-/Nachnamen — zentrales Trainerprofil (Lizenz + betreute Mannschaft(en)),
//     damit Gateway-Apps (Personalkosten, Trainerdaten, Trainerkodex, Kadermanager, ...) NICHT nur das eigene
//     me()-Profil, sondern auch das anderer Nutzer nachschlagen können (Namensabgleich bzw. linkedUsername-Join).
//   POST { action: "list-birthdays-today" } (jeder eingeloggte Nutzer) -> { namen:["Vorname Nachname", ...] }
//     wer laut Trainerdaten (PROVISION_ONLY_PATHS, Tag+Monat, Europe/Berlin) heute Geburtstag hat — nur der
//     Name, nie das Geburtsjahr oder andere Trainerdaten-Felder (die bleiben exklusiv personalakte-overview
//     vorbehalten). Fürs "Nächste Termine"-Widget in app.js.
//   POST { action: "raumnutzung-kontakt-lookup", name } (Raumnutzung-Bearbeiter via resolveEditPermission)
//     -> { treffer: {strasse, plz, ort, telefon, email} | null } — Kontaktdaten GENAU EINER namentlich
//     benannten Person aus Trainerdaten (PROVISION_ONLY_PATHS), fürs Vorbefüllen von Veranstaltungsleitung/
//     Vertretung im Raumnutzungs-Antrag. Nur diese fünf Felder, nie IBAN/Geburtsdatum/Dokumente. Gate ist das
//     Bearbeiten-Recht der Raumnutzung-App: dieselben Personen tragen die Daten dort ohnehin von Hand ein und
//     sehen sie in jedem gespeicherten Antrag — die Aktion spart nur das Abtippen, weicht aber keine Grenze auf.
//   POST { action: "notify-user", username, subject, message } (jeder eingeloggte Nutzer) -> { ok:true, sent:bool }
//     E-Mail-Benachrichtigung an einen ANDEREN Nutzer, erster Verwendungszweck: Vereinskalender-Teilen-Hinweis
//     bei privaten Terminen (Vorbereitung fürs geplante Mail-Tool, siehe [[project-vereinskalender]]). Die
//     Zieladresse wird SERVERSEITIG über Trainerdaten aufgelöst (PROVISION_ONLY_PATHS, gleiches Prinzip wie
//     list-birthdays-today) — der Client nennt nur einen Nutzernamen, kann also nie eine beliebige Adresse
//     erzwingen. Hat die Zielperson keine E-Mail hinterlegt, stiller No-Op (sent:false), kein Fehler. Versand
//     über Brevo (Secret BREVO_API_KEY), Absender = NOTIFY_FROM_EMAIL/-NAME-Konstanten bei PROVISION_ONLY_PATHS.
//   POST { action: "vereinskalender-vote", terminId, candId, wert } (jeder mit Tool-Zugriff) -> { ok, rev, stimmen }
//     Eigene Stimme bei einem Umfrage-Termin des Vereinskalenders setzen ("ja"/"nein") oder zurückziehen ("").
//     Eigene Aktion, weil vereinskalender in WRITE_REQUIRES_EDIT_PERMISSION steht: Termine anlegen/ändern ist
//     Bearbeitern vorbehalten, ABSTIMMEN muss aber jeder dürfen, der den Termin sieht — sonst stimmt die
//     Geschäftsstelle mit sich selbst ab. Schreibt ausschließlich umfrage.stimmen[<Token-Nutzer>][candId] eines
//     einzelnen Termins und spiegelt dafür die Sichtbarkeitsregel für Privattermine serverseitig.
//   POST { action: "my-trainerdaten-status" } (jeder eingeloggte Nutzer) -> { vorhanden, trainerdatenGesamtOk, ...restliche
//     Trainerdaten-Statusfelder (gleiche Zusammenfassung wie personalakte-overview, aber NUR für den eigenen
//     Datensatz, kein Admin-Gate) } — für das grüne/rote Ampel-Badge auf der Trainerdaten-Kachel im Dashboard.
//     trainerdatenGesamtOk ist `null`, wenn WEDER ein Trainerdaten-Datensatz existiert NOCH die Person
//     vertragspflichtig ist (Gruppe "Trainer" oder vertragBenoetigt-Flag, siehe isVertragspflichtig) — dann
//     zeigt die Kachel bewusst kein Badge ("bin gar kein Trainer"). Ist die Person vertragspflichtig, ist es
//     ein serverseitig berechnetes bool, auch wenn noch gar kein Datensatz existiert (dann false = rotes
//     Kreuz "Daten unvollständig", seit 2026-07-14 — vorher fälschlich gar kein Badge in diesem Fall): Daten
//     eingereicht + Lizenz oder "keine Lizenz" + Lizenz nicht abgelaufen + Führerschein < 6 Monate alt +
//     Führungszeugnis eingereicht + Kodex < 6 Monate alt bestätigt, seit 1.6 — Trainerkodex ist Teil von
//     Trainerdaten geworden, siehe unten; + Jugendschutzkonzept < 6 Monate alt bestätigt, seit Trainerdaten
//     1.7, gleiche Ablauflogik wie Kodex.
//   POST { action: "my-trainercheckliste-status" } (jeder eingeloggte Nutzer) -> { vorhanden, zugang, abgang }
//     eigener TrainerCheckliste-Eintrag (Namensabgleich wie personalakte-overview), NUR der eigene Datensatz,
//     kein Admin-Gate (gleiche Vertrauensstufe wie my-trainerdaten-status) — für die read-only Anzeige "meine
//     Checkliste" in Trainerdatens Trainer-Selbstbedienung (rein informativ, fließt NICHT in trainerdatenGesamtOk
//     ein, siehe [[project-trainerdaten]]). zugang/abgang je { abgeschlossen, nichtAbgeschlossen,
//     nichtAbgeschlossenGrund, headerChecked, headerDatum, ort, datum, bemerkungen, items, itemTexts,
//     unterschriftTrainer, unterschriftFunktionaer } — volle eigene Personendaten inkl. Unterschriften sind hier
//     unbedenklich (es ist ausschließlich der eigene Eintrag, gleiche Vertrauensstufe wie die eigene
//     Trainerdaten-Einreichung), NICHT das ganze trainerEintraege-Array (Minimal-Disclosure, siehe CLAUDE.md).
//     Seit TrainerCheckliste 1.2 liegen Unterschriften als eigene Dateien (dateien/<fileId>) statt inline —
//     dieser Handler lädt sie für den eigenen Eintrag serverseitig nach (attachChecklistSignaturen).
//   POST { action: "update-group-members", groupId, memberUsernames } (admin) -> ersetzt Mitgliederliste komplett
//   POST { action: "provision-group", groupId } (admin)          -> legt für alle Mitglieder der Gruppe Einträge in den
//     dafür konfigurierten Tools an (Auto-Provisioning, idempotent) -> { provisioned:{[app]:{[username]:ergebnis}}, apps, memberCount }
//   POST { action: "delete-group", groupId } (admin)             -> löscht Gruppe, räumt groupIds in sichtbarkeit.json auf
//   POST { action: "save-visibility", tools } (admin)            -> aktualisiert tools in sichtbarkeit.json (erhält news), tools[id] = {visible, loginRequired, groupIds, editGroupIds, adminGroupIds, provisionGroupIds}
//     (groupIds steuert die Sichtbarkeit im Modus "Nur bestimmte Gruppen"; editGroupIds ist unabhängig davon
//     und vergibt zusätzlich Bearbeiten-Rechte, unabhängig vom Sichtbarkeits-Modus des Tools; adminGroupIds ist
//     die dritte Stufe "Administrieren" (App-interne Admin-Funktionen, schließt Bearbeiten ein — resolveEditPermission
//     wertet adminGroupIds mit); provisionGroupIds steuert das Auto-Provisioning: Mitglieder dieser Gruppen
//     bekommen automatisch einen Eintrag im Tool.)
//   POST { action: "save-news", news } (admin)                   -> speichert die Neuigkeiten (Array, serverseitig validiert) im news-Key von sichtbarkeit.json (erhält tools); GET liefert news an alle Besucher
//   POST { action: "submit-feedback", type, toolId?, text } (jeder eingeloggte Nutzer) -> { ok:true }
//     (legt EINEN Feedback-/Wunsch-Eintrag an; Name/Nutzername kommen serverseitig aus dem eigenen Konto,
//     der Client kann sie nicht fälschen oder für andere Nutzer einen Eintrag anlegen)
//   POST { action: "list-feedback" } (admin)                     -> { entries } (alle Feedback-/Wunsch-Einträge)
//   POST { action: "save-feedback", entries } (admin)            -> ersetzt alle Feedback-Einträge (Array, serverseitig
//     validiert) — für "erledigt"-Status togglen und Einträge löschen (kompletter Array-Ersatz wie save-news)
//   POST { action: "get-admin-stats" } (admin)                   -> { users, trainerGroup, trainervertrag, trainerkodex,
//     jugendschutz, feedbackOpen, materialbedarfOpen, busplanOpen } — Kennzahlen fürs Admin-Dashboard, aus bestehenden
//     Datenquellen berechnet (nutzer.json, feedback.json, trainerdaten/trainerkodex/materialbedarf/busplan via
//     DAV_APPS/PROVISION_ONLY_PATHS). Trainervertrag-/Trainerkodex-/Jugendschutzkonzept-Quote beziehen sich auf Mitglieder
//     der Gruppe TRAINER_GROUP_NAME ("Trainer") — existiert diese Gruppe noch nicht, liefert trainerGroup.exists:false.
//     Archivierte Trainer zählen NICHT zum Nenner dieser Quoten (siehe archiviert-Feld unten).
//   POST { action: "personalakte-overview" } (Personalakte-Sichtrecht, siehe mayViewPersonalakte) -> { trainerGroupExists, trainers:[...] }
//     Seit 1.3: ein Datensatz je Nutzerkonto in nutzer.json, NICHT mehr auf Mitglieder der Trainer-Gruppe
//     beschränkt (`trainerGroupExists` bleibt aus Client-Kompatibilität immer `true`, ist aber bedeutungslos
//     geworden). Zusammengeführt aus nutzer.json + trainerkodex/trainerdaten/trainercheckliste/personalkosten/
//     kadermanager — inkl. archivierter Nutzer (Gruppen werden beim Archivieren NICHT entzogen). Trainerdaten-
//     Anteil liefert ausschließlich Datum/Status-Felder, nie IBAN/Adresse — seit 1.1 zusätzlich Führerschein-/
//     Führungszeugnis-Status (migriert aus Fahrtenbuch, siehe [[project-trainerdaten]]).
//     Seit 1.2 zusätzlich `trainerId` (Trainerdaten-eigene id, nicht username) -- Personalakte ruft damit
//     direkt trainerdaten1.michel-brunner.workers.dev an, um die Dokumente selbst zu öffnen.
//   POST { action: "archive-trainer", username, grund? } (Personalakte-Sichtrecht) -> { ok:true, username, archiviertAm }
//     Schreibt zuerst einen Datenschnappschuss nach personalakte.json, sperrt danach Login+Sessions des Kontos
//     (Nutzerfelder archiviert/archiviertAm/archiviertGrund/archiviertVon in nutzer.json). Gruppenzugehörigkeit
//     bleibt unangetastet. Letzter Admin kann nicht archiviert werden.
//   POST { action: "reactivate-trainer", username } (Personalakte-Sichtrecht) -> { ok:true, username }
//     Hebt die Login-Sperre wieder auf, ergänzt den Snapshot in personalakte.json um reaktiviertAm/reaktiviertVon.
//   POST { action: "get-materialcontainer-code" } + Authorization: Bearer -> { code, hinweis, geaendertAm, geaendertVon }
//     Zahlencode des Schlosses am Materialcontainer. Eingeloggtes Personal; Spielerkonten bekommen 403.
//     Bewusst eine eigene schmale Aktion (nicht Teil von "me" und nicht im oeffentlichen GET) -- der Code oeffnet ein echtes Schloss.
//   POST { action: "set-materialcontainer-code", code, hinweis? } (Admin) -> { ok:true, code, hinweis, geaendertAm, geaendertVon }
//     Legt ihn in materialcontainer{} von sichtbarkeit.json ab (read-modify-write). Leerer code = "keiner hinterlegt".
//   POST { action: "dav-load", app } + Authorization: Bearer       -> { data, rev, me } (Inhalt der App-Datendatei aus Nextcloud, data:null wenn noch nicht vorhanden; rev = ETag)
//     me enthält dasselbe wie die Aktion "me" inkl. canEdit/canAdmin für diese App — der Client braucht dafür keinen zweiten Request.
//     Kostet den Worker keinen zusätzlichen Nextcloud-Read (nutzer.json + sichtbarkeit.json sind hier ohnehin gelesen).
//     Für Apps in AUTO_PRUNE_APPS (aktuell: fotoauftraege) werden dabei abgelaufene Listeneinträge entfernt und die Datei
//     zurückgeschrieben — ein dav-load kann also schreiben und ein neues rev liefern. Zugehörige Nextcloud-Dateien bleiben unberührt.
//   POST { action: "dav-save", app, data, rev? } + Authorization: Bearer -> { ok:true, rev } (schreibt die App-Datendatei; mit rev nur, wenn die Datei
//     serverseitig unverändert ist — sonst 409 mit { conflict:true }. Ohne rev unconditional wie früher, alte Clients bleiben kompatibel.)
//     WebDAV-Gateway: Zugriff nur, wenn der Nutzer das Tool sehen darf (Gruppen-Sichtbarkeit). App-id -> Nextcloud-Pfad in DAV_APPS.
//     Für Apps in WRITE_REQUIRES_EDIT_PERMISSION (aktuell: vereinswiki) zusätzlich ein Bearbeiten-Recht (editGroupIds/resolveEditPermission) -> sonst 403.
//   POST { action: "dav-file-put", app, id, name, contentType, dataBase64 } + Authorization: Bearer -> { ok:true }
//     (lädt eine Binärdatei in den Unterordner dateien/ der App; id = UUID, Größe <= 10 MB; Sichtbarkeits-Check wie dav-load,
//      plus Bearbeiten-Recht-Check wie dav-save für Apps in WRITE_REQUIRES_EDIT_PERMISSION)
//   POST { action: "dav-file-get", app, id } + Authorization: Bearer    -> rohe Datei-Bytes (Content-Type von Nextcloud) | 404
//   POST { action: "dav-file-delete", app, id } + Authorization: Bearer -> { ok:true } (204/404 = Erfolg beim Aufräumen; Bearbeiten-Recht-Check wie dav-file-put)
//   POST { action: "dav-restricted-put", app, contentType, dataBase64 } + Bearer -> { ok:true }
//     (abgeschotteter Datei-Upload: die Datei wird IMMER unter dem eigenen, aus dem Token stammenden
//      Nutzernamen abgelegt und ist NUR für Eigentümer/viewGroupId/Admin lesbar — für sensible
//      Dokumente wie Führerschein-Kopien, anders als dav-file-get, das jedem mit Tool-Zugriff jede Id liefert)
//   POST { action: "dav-restricted-get", app, owner } + Bearer    -> rohe Datei-Bytes | 403 | 404
//   POST { action: "dav-restricted-delete", app, owner } + Bearer -> { ok:true }
//     (dav-restricted-get/-delete nur, wenn owner==eigener Nutzer ODER Admin ODER Mitglied der viewGroupId;
//      abgeschotteter Bereich je App in RESTRICTED_FILE_APPS konfiguriert)
//   POST { action: "fahrtenbuch-extern-submit", code, fahrt:{...} } -> { ok:true, id } | 400 | 403
//     (ohne Login: externe Eltern-Fahrt. code = PW_FAHRTENBUCH_EXTERN, JEDER der drei
//      fahrtenbuch-extern-*-Aktionen prüft ihn unabhängig. fahrt entspricht dem Fahrtenbuch-Schema,
//      wird serverseitig validiert/gecappt; quelle wird IMMER hart auf "extern" gesetzt, status
//      IMMER "abgeschlossen". id vom Client vorab per crypto.randomUUID() erzeugt -> erneuter Submit
//      mit gleicher id UND quelle "extern" überschreibt denselben Eintrag (Idempotenz bei Netzwerk-
//      Retry) -- interne Einträge sind davon bewusst ausgenommen, sonst könnte ein Zugriffscode-
//      Inhaber eine bestehende interne Fahrt per erratener/bekannter Id überschreiben.)
//   POST { action: "fahrtenbuch-extern-file-put", code, id, name, contentType, dataBase64 } -> { ok:true }
//     (Mängelfoto ohne Login, offener dateien/-Ordner wie dav-file-put, id = client-UUID.)
//   POST { action: "fahrtenbuch-extern-fuehrerschein-put", code, owner?, contentType, dataBase64 } -> { ok:true, owner }
//     (Führerschein-Kopie ohne Login, abgeschotteter Bereich wie dav-restricted-put, aber owner wird
//      bei Erst-Upload VOM SERVER vergeben (kein owner aus dem Body vertraut) und in der Antwort
//      zurückgegeben; Re-Upload schickt ihn zurück. Einsehbar später nur über dav-restricted-get/
//      -delete mit Login, siehe oben.)
//   POST { action: "fahrtenbuch-belege-list", app:"fahrtenbuch", fahrtId } + Bearer
//     -> { belege:[{submittedAt,amount,desc,name,files:[{fileName,fileMime}]}] }
//     (Login + userMayAccessTool("fahrtenbuch") wie dav-load; KEIN Ownership-Check der konkreten
//      Fahrt, da fahrtId eine nicht erratbare UUID ist und nach dem Sichtbarkeits-Fix oben ein
//      Normalnutzer eine fremde fahrtId über die App ohnehin nicht mehr zu Gesicht bekommt. Listet
//      per WebDAV PROPFIND den Belegeingang-Ordner von sc-heiligenstadt-budget (anderes Nextcloud-
//      Verzeichnis, gleiches Konto) und liest nur die *.meta.json, deren Dateiname auf
//      "_fahrt-<fahrtId>.meta.json" endet — sc-heiligenstadt-budget/worker.js schreibt diesen
//      Suffix nur bei gültiger UUID. fahrtId wird hier zusätzlich serverseitig gegen FAHRT_ID_RE
//      geprüft, bevor sie in den Dateinamen-Vergleich einfließt.)
//   POST { action: "fahrtenbuch-beleg-file-get", app:"fahrtenbuch", fahrtId, fileName } + Bearer
//     -> Datei-Bytes (Content-Type wie Original) | 400/403/404
//     (liest eine einzelne, zu fahrtId gehörende Beleg-Datei aus demselben Ordner wie oben, für den
//      "Beleg anzeigen"-Knopf im Fahrtenbuch-Modal. fileName kommt vom Client — wird serverseitig
//      gegen ein Muster geprüft, das zwingend den "_fahrt-<fahrtId>"-Suffix enthalten muss, sonst
//      könnte ein Nutzer über einen erratenen/kopierten Dateinamen fremde Kassierer-Belege im
//      selben geteilten Ordner lesen.)
//   POST { action: "my-testspielplaner-status" } + Bearer -> { anstehendOhneGegner }
//     (Badge auf der Testspielplaner-Kachel: Anzahl EIGENER genehmigter Reservierungen ohne Gegner in den
//      nächsten 14 Tagen. Logik spiegelt anstehendeOhneGegner() in E:\testspielplaner\app.js.)
//   POST { action: "verify-action-password", scope, password }    -> { ok:true } | 403 — ohne Login; prüft die früher im
//     Client hartkodierten Aktions-Passwörter gegen Worker-Secrets (Scope-Liste: ACTION_PASSWORD_SECRETS).
//   POST { action: "beleg-eingang-notify", code, name, desc, amount, date, note, fileCount }
//     -> { ok:true, sent:true } | { ok:true, sent:false, reason } | 400 | 403 | 502
//     (ohne Login: Benachrichtigungsmail nach einer Beleg-Einreichung aus beleg-eingang.html.
//      Wird NICHT vom Browser aufgerufen, sondern serverseitig vom eigenen Beleg-Upload-Worker
//      (sc-heiligenstadt-budget/worker.js) über dessen Service Binding, NACHDEM der Beleg schon in
//      Nextcloud liegt. code = PW_BUDGET_EINGANG_ZUGANG, hier eigenständig geprüft — die URL dieses
//      Workers ist öffentlich, ohne eigene Prüfung wäre das ein offener Mail-Versender. Empfänger
//      kommt aus der Variable NOTIFY_BELEG_EMAIL, nie aus dem Body. Fehlt die Variable oder der
//      BREVO_API_KEY, ist die Aktion ein stiller No-Op (sent:false) statt eines Fehlers: der Beleg
//      ist zu diesem Zeitpunkt bereits gespeichert, eine ausbleibende Mail darf die Einreichung
//      nicht nachträglich als gescheitert erscheinen lassen.)
//   POST { action: "fotoauftrag-ordner-anlegen", id } + Bearer -> { ok:true, auftrag, rev } | 400 | 403 | 404 | 409 | 502
//     (Fotoaufträge: legt für einen offenen Auftrag serverseitig einen dedizierten Nextcloud-Ordner an UND
//      erzeugt darauf einen echten, eigenständigen öffentlichen Freigabelink über die Nextcloud OCS-Sharing-API
//      (shareType=3, permissions=15 = Ansehen+Hochladen) — pro Auftrag ein eigener, einzeln funktionierender
//      Link, kein gemeinsamer Link für alle Teams. Nur der zuständige Trainer (eigenes mannschaften-Profil
//      enthält den Team-Namen des Auftrags) oder ein Editor/Admin darf das auslösen. Zweiphasig: Status
//      offen->wird-angelegt zuerst als ETag-gesicherte Reservierung (verhindert doppelte Freigaben bei
//      gleichzeitigen Klicks auf denselben Auftrag), erst danach MKCOL+OCS-Aufruf, dann
//      wird-angelegt->ordner-angelegt. fotoauftraege steht zusätzlich in TEAM_FILTERED_APPS (siehe dort) —
//      dav-load liefert Nicht-Editoren nur Aufträge der eigenen Mannschaft(en), und in
//      WRITE_REQUIRES_EDIT_PERMISSION — generisches dav-save ist für Nicht-Editoren komplett gesperrt.)
//   POST { action: "fotoauftrag-spielbericht-hochladen", id, text, dataBase64 } + Bearer
//     -> { ok:true, auftrag, rev } | 400 | 403 | 404 | 409 | 413 | 502
//     (Fotoaufträge: lädt eine vom Client aus dem Spielbericht-Freitext erzeugte .docx
//      in denselben Ordner wie die Fotos — landet automatisch im selben Freigabelink.
//      Nur möglich, wenn der Auftrag schon einen ordnerPfad hat (Ordner muss existieren).
//      Gleiche Berechtigung wie fotoauftrag-ordner-anlegen: Editor oder eigenes
//      mannschaften-Profil enthält den Team-Namen. Fixer Dateiname Spielbericht.docx,
//      Re-Upload überschreibt bewusst. text wird zusätzlich roh im Auftrag gespeichert,
//      damit die App ihn ohne erneuten Datei-Download anzeigen kann.)
//   POST { action: "fotoauftrag-loeschen", id } + Bearer -> { ok:true, rev } | 400 | 403 | 404 | 409 | 502
//     (Fotoaufträge, Editor/Admin-only: löscht NUR den JSON-Eintrag. Der zugehörige
//      Nextcloud-Ordner samt Fotos und Spielbericht bleibt bewusst stehen — er ist das
//      Bildarchiv des Vereins und überlebt den Arbeitszettel. Ordner räumt man bei Bedarf
//      direkt in Nextcloud auf. Gleiches gilt für die automatische Bereinigung, siehe
//      AUTO_PRUNE_APPS.)

const ALLOWED_ORIGINS = [
  "http://localhost:8767", // Materialliste (Dev-Server)
  "http://localhost:8768", // TrainerCheckliste (Dev-Server)
  "http://localhost:8769", // Trainerdaten (Dev-Server)
  "http://localhost:8770", // ToolsUebersicht (Dev-Server)
  "http://localhost:8771", // Spielertool (Dev-Server)
  "http://localhost:8772", // Vereinsbudget (Dev-Server)
  "http://localhost:8774", // Trainerversammlung-Anmeldung (Dev-Server)
  "http://localhost:8779", // Spielersichtung (Dev-Server)
  "http://localhost:8777", // Vereinskalender (Dev-Server)
  "http://localhost:8792", // Busplan (Dev-Server)
  "http://localhost:8780", // Kadermanager (Dev-Server, bis 1.3 Spielerplus-Klon)
  "http://localhost:8794", // Digitaler Stempel (Dev-Server)
  "http://localhost:8795", // Kleiderbestellung (Dev-Server)
  "http://localhost:8796", // Fahrtenbuch (Dev-Server)
  "http://localhost:8782", // Spiele (Dev-Server)
  "http://localhost:8798", // Materialbedarf (Dev-Server)
  "http://localhost:8802", // Raumnutzung (Dev-Server)
  "http://localhost:8783", // Personalakte (Dev-Server)
  "http://localhost:8784", // Vereinswiki (Dev-Server)
  "http://localhost:8785", // Testspielplaner (Dev-Server)
  "http://localhost:8786", // Fotoaufträge (Dev-Server)
  "http://localhost:8787", // Abwesenheitskalender (Dev-Server)
  "http://localhost:8788", // Besprechung (Dev-Server)
  "http://localhost:8789", // Dokumentenvorlagen (Dev-Server)
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
  "spielersichtung":   "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Spielersichtung/spielersichtung.json",
  "platzbelegung":     "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Platzbelegung/platzbelegung.json",
  "personalkosten":    "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Personalkosten/personalkosten.json",
  "vereinskalender":   "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Vereinskalender/vereinskalender.json",
  "busplan":           "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Busplan/busplan.json",
  "kadermanager":      "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Spielerplus/spielerplus.json",
  "digitaler-stempel": "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/DigitalerStempel/digitaler-stempel.json",
  "kleiderbestellung": "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Kleiderbestellung/kleiderbestellung.json",
  "fahrtenbuch":       "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Fahrtenbuch/fahrtenbuch.json",
  "materialbedarf":    "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Materialbedarf/materialbedarf.json",
  "raumnutzung":       "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Raumnutzung/raumnutzung.json",
  "personalakte":      "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Personalakte/personalakte.json",
  "vereinswiki":       "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Vereinswiki/vereinswiki.json",
  "testspielplaner":   "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Testspielplaner/testspielplaner.json",
  "fotoauftraege":     "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Fotoauftraege/fotoauftraege.json",
  "abwesenheitskalender": "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Abwesenheitskalender/abwesenheitskalender.json",
  "dokumentenvorlagen": "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Dokumentenvorlagen/dokumentenvorlagen.json"
};

// Basis-Ordner für die von Fotoaufträge erzeugten Foto-Upload-Ordner (getrennt
// von DAV_APPS, da dort nur die JSON-Datendatei der App steht, nicht der
// Foto-Baum). "06_Social Media" ist ein eigenständiger Ordner auf oberster
// Ebene (Geschwister von 05_Nachwuchsbereich/02_Geschäftsstelle/etc.), NICHT
// unter 05_Nachwuchsbereich verschachtelt -- mit Michel am 2026-07-13
// bestätigt. Muss nicht vorher manuell angelegt werden: ensureCollection()
// legt fehlende Ebenen (auch diesen Ordner selbst) beim ersten Ordner-Anlegen
// automatisch an, wie überall sonst in dieser Datei.
const FOTOAUFTRAEGE_ORDNER_BASIS = "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/06_Social Media";

// Belegeingang-Ordner von sc-heiligenstadt-budget (eigenes Repo/eigener Worker,
// aber dasselbe Nextcloud-Konto -- volle Admin-WebDAV-Credentials reichen, kein
// Service Binding nötig). Anderer Zweig als alles in DAV_APPS (Geschäftsstelle
// statt Nachwuchsbereich), deshalb eigene Konstante statt Ableitung aus DAV_APPS.
// Nur für handleFahrtenbuchBelegeList (read-only) verwendet.
const BELEGE_EINGANG_DIR =
  "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/02_Geschäftsstelle/Belege_aus_Belegtool";

// Apps, bei denen Schreiben (dav-save/dav-file-put/dav-file-delete) zusätzlich zur
// reinen Tool-Sichtbarkeit ein explizites Bearbeiten-Recht voraussetzt (editGroupIds,
// serverseitig über resolveEditPermission geprüft) — nicht nur ein UI-Hinweis wie
// bisher bei den anderen Apps mit canEdit(). Wer sehen, aber nicht bearbeiten darf,
// bekommt hier ein hartes 403 statt zu schreiben. Für Apps mit echtem Selbstbedienungs-
// Muster (jeder legt/verwaltet nur eigene Einträge, z.B. Fahrtenbuch, Materialbedarf,
// Testspielplaner) ist das NICHT die richtige Schublade — die stehen stattdessen in
// OWNER_FILTERED_APPS weiter unten (Nicht-Editoren schreiben weiterhin, aber nur ihre
// eigenen Einträge). Apps, die in KEINEM der beiden Sets stehen (z.B. kleiderbestellung,
// digitaler-stempel), behalten das alte Verhalten: wer das Tool sehen darf, darf auch
// das ganze Dokument schreiben — dort ist Bearbeiten-Recht bisher nur eine UI-Blende.
const WRITE_REQUIRES_EDIT_PERMISSION = new Set([
  "vereinswiki",
  "materialliste", "trainercheckliste", "spielertool-test", "spielersichtung",
  "personalkosten", "busplan", "vereinskalender", "kadermanager", "platzbelegung",
  "fotoauftraege", "raumnutzung"
]);
// fotoauftraege zusätzlich hier (nicht nur in TEAM_FILTERED_APPS weiter unten):
// normale Trainer dürfen generisches dav-save für diese App NIE aufrufen (auch
// nicht für eigene Aufträge) — ihr einziger Schreibzugriff ist die dedizierte,
// eigens validierte Aktion fotoauftrag-ordner-anlegen. Anlegen/Löschen von
// Aufträgen und "erledigt"-Markierung bleiben Editoren (Social-Media-Gruppe)
// vorbehalten.
// materialbedarf, testspielplaner: NICHT hier -- Selbstbedienungs-Muster wie
// fahrtenbuch (jeder meldet/bucht eigene Einträge), siehe OWNER_FILTERED_APPS
// unten statt hartem Block. digitaler-stempel: ebenfalls Selbstbedienung
// (stempelt eigene Dokumente), aber stampedBy ist ein verschachteltes Objekt
// {username,...} statt eines flachen ownerField-Strings -- passt nicht ins
// bestehende OWNER_FILTERED_APPS-Schema ohne Erweiterung, bleibt vorerst nur
// client-seitig gegated (wie kleiderbestellung).

// Datendateien, in die das Auto-Provisioning (provisionUser) schreiben darf, die aber
// bewusst NICHT über DAV_APPS für dav-load/dav-save geöffnet sind: Trainerdaten
// enthält IBAN-Daten und läuft sonst über den eigenen submit-worker — die Datei hier
// nur intern (server-seitig) beschreiben, nie für eingeloggte Nutzer lesbar machen.
const PROVISION_ONLY_PATHS = {
  "trainerdaten": "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/Trainerdaten/trainerdaten.json"
};

// Absender für handleNotifyUser (E-Mail-Adresse selbst ist nicht geheim, deshalb
// Konstante statt Secret). TODO Michel: echte Nachwuchs-Adresse eintragen UND bei
// Brevo als Einzel-Absender verifizieren (Bestätigungslink an genau diese Adresse),
// sonst lehnt Brevo den Versand ab.
const NOTIFY_FROM_EMAIL = "nachwuchs@sc1911-heiligenstadt.de";
const NOTIFY_FROM_NAME = "SC 1911 Heiligenstadt";

// Feedback & Wünsche aus dem Feedback-Tab (seit 1.10) — eigene Datei, damit ein
// einfacher eingeloggter Nutzer per submit-feedback schreiben darf (Einzeleintrag,
// serverseitig zusammengebaut) ohne Zugriff auf sichtbarkeit.json/nutzer.json zu
// bekommen. Nicht in DAV_APPS: kein generisches dav-load/dav-save, sondern eigene
// Aktionen mit eigener Validierung (siehe handleSubmitFeedback/handleListFeedback/
// handleSaveFeedback).
const FEEDBACK_URL = "https://nx88695.your-storageshare.de/remote.php/dav/files/admin/05_Nachwuchsbereich/02_Förderung/Tools/ToolsUebersicht/feedback.json";

// Apps mit serverseitig abgeschottetem Datei-Bereich: Dateien in diesem Unterordner
// (statt "dateien") liefert/löscht das Gateway NUR für den Eigentümer, Admins und
// Mitglieder der viewGroupId — unabhängig davon, wer sonst Zugriff auf das Tool hat.
// Anders als dav-file-get (das jedem mit Tool-Zugriff jede Datei-Id ausliefert) ist das
// die echte serverseitige Abschottung für sensible Dokumente (z. B. Führerschein-Kopien).
// Die Datei liegt unter <app-ordner>/<subdir>/<eigentuemer-username>, der Nutzername ist
// zugleich der Zugriffsschlüssel (genau ein Dokument je Nutzer, Re-Upload überschreibt).
// fahrtenbuch (seit 1.1-extern): externe Eltern haben keinen Login-Nutzernamen als
// natürlichen Schlüssel -- hier wird stattdessen ein serverseitig vergebener 32-Zeichen-
// Hex-Schlüssel verwendet, siehe handleFahrtenbuchExternFuehrerscheinPut. Eigener
// Unterordner-Name "fuehrerscheine-extern", damit er nicht mit Trainerdatens eigenem,
// andersartigem Führerschein-Pfad kollidiert (Trainerdaten enthält IBAN-Daten und ist
// bewusst nicht generisch über dieses Gateway erreichbar, siehe PROVISION_ONLY_PATHS).
const RESTRICTED_FILE_APPS = {
  fahrtenbuch: { subdir: "fuehrerscheine-extern", viewGroupId: "fuehrerschein-einsicht" }
};

// Apps, bei denen dav-load/dav-save NICHT das ganze Dokument an jeden Tool-Nutzer
// durchreichen, sondern für Nutzer ohne Bearbeiten-Recht (resolveEditPermission)
// auf listField ein Eigentümer-Filter greift (ownerField === eigener Username).
// Grund: die bisherige rein clientseitige Filterung (z.B. Fahrtenbuchs
// visibleFahrten()) verhindert nur die Anzeige, nicht aber, dass das komplette
// Array (fremde Fahrten inkl. Mängel-Fotos/Adressen) über dav-load im Klartext
// beim Client ankommt (DevTools-Network-Tab oder Konsolen-fetch reichen). Editoren/
// Admin (resolveEditPermission) bekommen weiterhin das volle Dokument, unveraendert.
// Siehe handleDavLoad/handleOwnerFilteredSave für die Umsetzung.
const OWNER_FILTERED_APPS = {
  fahrtenbuch: { listField: "fahrten", ownerField: "erstelltVon" },
  materialbedarf: { listField: "meldungen", ownerField: "erstelltVon" },
  testspielplaner: { listField: "reservierungen", ownerField: "erstelltVon" }
};

// Wie OWNER_FILTERED_APPS, aber NUR fürs Schreiben: das Sichtbarkeitsmodell dieser
// App ist "voller Lesezugriff für jeden mit Tool-Sichtbarkeit" (jede:r soll alle
// Abwesenheiten sehen, damit eine interne Vertretungsregelung greift), kombiniert mit
// "Nicht-Bearbeiter dürfen nur eigene Einträge anlegen/ändern/löschen". Bewusst NICHT
// in OWNER_FILTERED_APPS aufgenommen: das würde in handleDavLoad auch das Lesen auf
// eigene Einträge einschränken, was hier falsch wäre. handleDavLoad wertet diese Map
// NICHT aus (kein Read-Filter); nur handleDavSave prüft sie zusätzlich und routet bei
// Treffer zur selben handleOwnerFilteredSave() (die kennt ohnehin keine
// Read-Filterung, kümmert sich rein ums Schreiben). Der Client bekommt beim Laden
// IMMER den vollen Array; ein Nicht-Bearbeiter muss vor dav-save selbst auf eigene
// Einträge filtern, sonst 400 "fremde oder ungültige Einträge".
const OWNER_WRITE_APPS = {
  abwesenheitskalender: { listField: "abwesenheiten", ownerField: "erstelltVon" }
};

// Wie OWNER_FILTERED_APPS, aber das Sichtbarkeitskriterium ist "eigene
// mannschaften (nutzer.json) enthält item[teamField]" statt "item[ownerField]
// === eigener Username" -- passend für Apps, bei denen Ersteller (Editor-
// Rolle, hier: Social-Media-Team) und Betroffener (eine Mannschaft/deren
// Trainer) zwei verschiedene Rollen sind. Bei fotoauftraege legt das
// Social-Media-Team den Auftrag an, aber der zuständige Trainer (nicht der
// Ersteller) muss ihn sehen/erfüllen dürfen -- OWNER_FILTERED_APPS würde ihm
// per erstelltVon-Filter nichts anzeigen. Editoren (resolveEditPermission)
// bekommen wie bei OWNER_FILTERED_APPS immer das volle Dokument. Wichtig auch
// aus Sicherheitssicht: fotoauftraege.freigabeLink ist ein echter, funktions-
// fähiger Bearer-Link -- ihn per dav-load an alle auszuliefern würde den
// ganzen Sinn hinter "isolierte Links pro Team" unterlaufen (gleiche Logik
// wie der Kommentar zu OWNER_FILTERED_APPS oben). Siehe handleDavLoad.
const TEAM_FILTERED_APPS = {
  fotoauftraege: { listField: "auftraege", teamField: "mannschaft" }
};

// Selbstaufraeumende Listen: Eintraege, deren Zeitstempel laenger als maxTageAlt
// zurueckliegt, werden bei jedem dav-load entfernt (siehe handleDavLoad).
// Bewusst KEIN Cloudflare-Cron-Trigger: die Bereinigung braucht keine Pünktlichkeit
// (sie soll nur verhindern, dass die Liste zulaeuft), und ein Cron-Trigger waere
// zusaetzliche Konfiguration ausserhalb des Repos, die deploy-worker.ps1 nicht
// mitdeployt. Der Stichtag wird bewusst SERVERSEITIG berechnet -- eine
// clientseitige Bereinigung wuerde der Uhr des Browsers vertrauen, und eine falsch
// gestellte Uhr wuerde dort fremde Datensaetze loeschen.
// Wichtig: das Aufraeumen entfernt nur den Listeneintrag, nie zugehoerige
// Nextcloud-Dateien (bei fotoauftraege sind das die Fotos = das Vereinsarchiv).
const AUTO_PRUNE_APPS = {
  fotoauftraege: { listField: "auftraege", dateField: "erstelltAm", maxTageAlt: 5 }
};

const PBKDF2_ITERATIONS = 100000; // siehe README: bewusst unter OWASP-210k, um im Cloudflare-Free-CPU-Limit zu bleiben
const SALT_BYTES = 16;
const HASH_BITS = 256;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 Tage
// Stichtag: jede Session, die VOR diesem Zeitpunkt ausgestellt wurde, gilt als
// beendet (Prüfung in getVerifiedSession). Nötig, weil die Laufzeit im Token
// steckt: das Senken von SESSION_TTL_SECONDS auf 7 Tage wirkt nur auf NEU
// ausgestellte Token, die alten 30-Tage-Token wären sonst noch bis zu vier
// Wochen weitergelaufen. Bewusst eine Konstante im Code statt eines Feldes in
// nutzer.json -- ein Stichtag ist ein einmaliges Ereignis, kein laufender
// Zustand, und so kostet die Prüfung keinen zusätzlichen Nextcloud-Lesezugriff.
// Für einen erneuten Rauswurf aller Nutzer (z.B. nach einem Vorfall) hier den
// Wert auf "jetzt" setzen und neu deployen. WICHTIG: nie einen Zeitpunkt in der
// ZUKUNFT eintragen -- dann wäre auch jedes frisch ausgestellte Login-Token
// sofort ungültig und niemand käme mehr herein.
const SESSIONS_INVALID_BEFORE = 1784700000; // 2026-07-22T06:00:00Z
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

// Zentrales Trainerprofil (seit 1.10): Lizenzstufe + betreute Mannschaft(en) je
// Nutzer, einmalig hier gepflegt statt in Personalkosten/Trainerdaten/etc.
// dupliziert. Werte übernommen aus Personalkosten config.js DEFAULT_PARAMETER.lizenzen.
const LIZENZ_OPTIONEN = ["", "ohne Lizenz", "Basis", "C", "B", "B Elite", "A"];

// Name der Gruppe, deren Mitglieder für Trainervertrag-/Trainerkodex-Quote im
// Admin-Dashboard zählen. Lookup nach Namen (nicht Id), da die Id nur beim
// Anlegen aus dem Namen slugifiziert wird und bei Umbenennung nicht
// automatisch nachzieht — der Name ist die stabile, für den Admin sichtbare
// Referenz. Muss einmalig manuell über das Gruppen-Panel (Einstellungen)
// angelegt werden.
const TRAINER_GROUP_NAME = "Trainer";

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
      // Spieler-Registrierung: -info/-abschliessen bewusst OHNE Auth (der Spieler
      // hat noch kein Konto), das Registrierungs-Token ist der Ausweis.
      case "km-reg-oeffnen":
        return handleKmRegOeffnen(request, body, env, authHeader, corsHeaders);
      case "km-reg-info":
        return handleKmRegInfo(body, env, authHeader, corsHeaders);
      case "km-reg-abschliessen":
        return handleKmRegAbschliessen(request, body, env, authHeader, corsHeaders);
      // Spieler-Selbstbedienung: schreibt NUR den eigenen Eintrag, deshalb bewusst
      // ohne Bearbeiten-Recht nutzbar (siehe Kommentar bei handleKmSelf).
      case "km-self":
        return handleKmSelf(request, body, env, authHeader, corsHeaders);
      case "me":
        return handleMe(request, body, env, authHeader, corsHeaders);
      case "set-view-as":
        return handleSetViewAs(request, body, env, authHeader, corsHeaders);
      case "create-user":
        return handleCreateUser(request, body, env, authHeader, corsHeaders);
      case "list-users":
        return handleListUsers(request, env, authHeader, corsHeaders);
      case "reset-password":
        return handleResetPassword(request, body, env, authHeader, corsHeaders);
      case "change-password":
        return handleChangePassword(request, body, env, authHeader, corsHeaders);
      case "update-user":
        return handleUpdateUser(request, body, env, authHeader, corsHeaders);
      case "delete-user":
        return handleDeleteUser(request, body, env, authHeader, corsHeaders);
      case "create-group":
        return handleCreateGroup(request, body, env, authHeader, corsHeaders);
      case "list-groups":
        return handleListGroups(request, env, authHeader, corsHeaders);
      case "trainerdaten-list-groups":
        return handleTrainerdatenListGroups(request, env, authHeader, corsHeaders);
      case "check-edit-permission":
        return handleCheckEditPermission(request, body, env, authHeader, corsHeaders);
      case "list-directory":
        return handleListDirectory(request, env, authHeader, corsHeaders);
      case "list-tool-editors":
        return handleListToolEditors(request, body, env, authHeader, corsHeaders);
      case "list-trainer-profiles":
        return handleListTrainerProfiles(request, env, authHeader, corsHeaders);
      case "list-birthdays-today":
        return handleListBirthdaysToday(request, env, authHeader, corsHeaders);
      case "my-trainerdaten-status":
        return handleMyTrainerdatenStatus(request, env, authHeader, corsHeaders);
      case "raumnutzung-kontakt-lookup":
        return handleRaumnutzungKontaktLookup(request, body, env, authHeader, corsHeaders);
      case "notify-user":
        return handleNotifyUser(request, body, env, authHeader, corsHeaders);
      case "my-trainercheckliste-status":
        return handleMyTrainerchecklisteStatus(request, env, authHeader, corsHeaders);
      case "my-testspielplaner-status":
        return handleMyTestspielplanerStatus(request, env, authHeader, corsHeaders);
      case "update-group-members":
        return handleUpdateGroupMembers(request, body, env, authHeader, corsHeaders);
      case "provision-group":
        return handleProvisionGroup(request, body, env, authHeader, corsHeaders);
      case "delete-group":
        return handleDeleteGroup(request, body, env, authHeader, corsHeaders);
      case "save-visibility":
        return handleSaveVisibility(request, body, env, authHeader, corsHeaders);
      case "save-news":
        return handleSaveNews(request, body, env, authHeader, corsHeaders);
      case "get-materialcontainer-code":
        return handleGetMaterialcontainerCode(request, env, authHeader, corsHeaders);
      case "set-materialcontainer-code":
        return handleSetMaterialcontainerCode(request, body, env, authHeader, corsHeaders);
      case "submit-feedback":
        return handleSubmitFeedback(request, body, env, authHeader, corsHeaders);
      case "list-feedback":
        return handleListFeedback(request, env, authHeader, corsHeaders);
      case "save-feedback":
        return handleSaveFeedback(request, body, env, authHeader, corsHeaders);
      case "get-admin-stats":
        return handleGetAdminStats(request, env, authHeader, corsHeaders);
      case "personalakte-overview":
        return handlePersonalakteOverview(request, env, authHeader, corsHeaders);
      case "archive-trainer":
        return handleArchiveTrainer(request, body, env, authHeader, corsHeaders);
      case "reactivate-trainer":
        return handleReactivateTrainer(request, body, env, authHeader, corsHeaders);
      case "verify-action-password":
        return handleVerifyActionPassword(body, env, corsHeaders);
      case "beleg-eingang-notify":
        return handleBelegEingangNotify(body, env, corsHeaders);
      case "dav-load":
        return handleDavLoad(request, body, env, authHeader, corsHeaders);
      case "dav-save":
        return handleDavSave(request, body, env, authHeader, corsHeaders);
      case "vereinskalender-vote":
        return handleVereinskalenderVote(request, body, env, authHeader, corsHeaders);
      case "fotoauftrag-ordner-anlegen":
        return handleFotoauftragOrdnerAnlegen(request, body, env, authHeader, corsHeaders);
      case "fotoauftrag-spielbericht-hochladen":
        return handleFotoauftragSpielberichtHochladen(request, body, env, authHeader, corsHeaders);
      case "fotoauftrag-loeschen":
        return handleFotoauftragLoeschen(request, body, env, authHeader, corsHeaders);
      case "dav-file-put":
        return handleDavFilePut(request, body, env, authHeader, corsHeaders);
      case "dav-file-get":
        return handleDavFileGet(request, body, env, authHeader, corsHeaders);
      case "dav-file-delete":
        return handleDavFileDelete(request, body, env, authHeader, corsHeaders);
      case "dav-restricted-put":
        return handleDavRestrictedPut(request, body, env, authHeader, corsHeaders);
      case "dav-restricted-get":
        return handleDavRestrictedGet(request, body, env, authHeader, corsHeaders);
      case "dav-restricted-delete":
        return handleDavRestrictedDelete(request, body, env, authHeader, corsHeaders);
      case "fahrtenbuch-extern-submit":
        return handleFahrtenbuchExternSubmit(body, env, authHeader, corsHeaders);
      case "fahrtenbuch-extern-file-put":
        return handleFahrtenbuchExternFilePut(body, env, authHeader, corsHeaders);
      case "fahrtenbuch-extern-fuehrerschein-put":
        return handleFahrtenbuchExternFuehrerscheinPut(body, env, authHeader, corsHeaders);
      case "fahrtenbuch-belege-list":
        return handleFahrtenbuchBelegeList(request, body, env, authHeader, corsHeaders);
      case "fahrtenbuch-beleg-file-get":
        return handleFahrtenbuchBelegFileGet(request, body, env, authHeader, corsHeaders);
      case "livekit-token":
        return handleLivekitToken(request, body, env, authHeader, corsHeaders);
      case "livekit-kick":
        return handleLivekitKick(request, body, env, authHeader, corsHeaders);
      case "livekit-mute":
        return handleLivekitMute(request, body, env, authHeader, corsHeaders);
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
  return json({ token, username, isAdmin: true, groupIds: [], realIsAdmin: true, viewAsGroupId: null }, 200, corsHeaders);
}

async function handleLogin(body, env, authHeader, corsHeaders) {
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  const user = getOwn(usersDoc.users, username);

  if (!user) return json({ error: "Ungültige Anmeldedaten" }, 401, corsHeaders);
  // Archivierte Konten (Personalakte) werden VOR der Passwortprüfung abgefangen:
  // der zweistufige Login-Flow ruft login(username, "") zuerst mit leerem
  // Passwort auf, um zu entscheiden, welcher Screen als nächstes kommt — läge
  // dieser Check dahinter, würde dieser erste Aufruf in den generischen
  // 401-Zweig fallen und faelschlich das Passwort-Feld zeigen statt sofort
  // "archiviert" zu melden.
  if (user.archiviert) {
    return json({ error: "Dieses Konto wurde archiviert.", archived: true }, 403, corsHeaders);
  }
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

  // Für die "Zuletzt angemeldet"-Liste im Admin-Dashboard, best-effort — ein
  // Speicherfehler hier darf den eigentlichen Login nicht verhindern.
  user.lastLoginAt = new Date().toISOString();
  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) { /* siehe Kommentar oben */ }

  const token = await signToken(makeSessionPayload(user.username, !!user.isAdmin), env.SESSION_SECRET);
  const identity = deriveIdentity(user, usersDoc);
  return json({ token, username: user.username, ...identity }, 200, corsHeaders);
}

async function handleSetPassword(body, env, authHeader, corsHeaders) {
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const pwError = validatePasswordStrength(password);
  if (pwError) return json({ error: pwError }, 400, corsHeaders);

  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  const user = getOwn(usersDoc.users, username);
  if (!user) return json({ error: "Unbekannter Nutzer" }, 404, corsHeaders);
  // Archivierte Konten wie in handleLogin abfangen. Diese Aktion ist bewusst OHNE
  // Login nutzbar (Erstvergabe des eigenen Passworts) und nur durch
  // mustSetPassword geschuetzt -- ein Konto, das archiviert wurde, BEVOR sich die
  // Person je angemeldet hat, behaelt mustSetPassword:true (archive-trainer fasst
  // das Feld nicht an). Ohne diesen Check koennte ein Fremder ihm bei erratenem
  // Nutzernamen ein Passwort setzen: der Login bliebe zwar gesperrt, aber nach
  // einer spaeteren reactivate-trainer waere das Konto mit FREMDEM Passwort
  // aktiv und die eigentliche Person zugleich ausgesperrt (mustSetPassword ist
  // dann false, der "Konto einrichten"-Weg also verbraucht).
  if (user.archiviert) {
    return json({ error: "Dieses Konto wurde archiviert.", archived: true }, 403, corsHeaders);
  }
  if (!user.mustSetPassword) return json({ error: "Passwort wurde bereits gesetzt" }, 409, corsHeaders);

  const { hash, salt, iterations } = await hashNewPassword(password);
  user.passwordHash = hash;
  user.salt = salt;
  user.iterations = iterations;
  user.mustSetPassword = false;
  user.passwordSetAt = new Date().toISOString();
  user.lastLoginAt = user.passwordSetAt;

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  const token = await signToken(makeSessionPayload(user.username, !!user.isAdmin), env.SESSION_SECRET);
  const identity = deriveIdentity(user, usersDoc);
  return json({ token, username: user.username, ...identity }, 200, corsHeaders);
}

// Eigenes Passwort aendern. Dritter Passwort-Weg neben set-password (Erstvergabe,
// bewusst ohne Login) und reset-password (Admin, ohne Kenntnis des alten) -- dieser
// hier braucht Token UND das bisherige Passwort.
//
// Der zu aendernde Nutzer kommt IMMER aus dem Token, nie aus dem Body: sonst koennte
// jeder Eingeloggte mit einem fremden Nutzernamen im Body ein anderes Konto
// uebernehmen.
//
// Nebenwirkung, die der Client kennen muss: das neue passwordSetAt entwertet in
// getVerifiedSession jedes Token mit aelterem iat -- also alle Sessions auf allen
// Geraeten, auch die gerade benutzte. Deshalb wird hier ein frisches Token
// ausgestellt (nach dem Schreiben, damit sein iat nicht vor passwordSetAt liegt).
async function handleChangePassword(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const oldPassword = String((body && body.oldPassword) || "");
  const newPassword = String((body && body.newPassword) || "");

  const usersDoc = session.usersDoc;
  const user = getOwn(usersDoc.users, session.username);
  if (!user) return json({ error: "Unbekannter Nutzer" }, 404, corsHeaders);

  // Altes Passwort VOR jeder Pruefung des neuen: wer nur das Token hat (fremdes
  // Geraet, geklauter localStorage), soll gar kein Feedback bekommen -- und die
  // Bremse gegen Durchprobieren greift so immer.
  const ok = await verifyPassword(oldPassword, user.salt, user.iterations, user.passwordHash);
  if (!ok) {
    await new Promise((resolve) => setTimeout(resolve, 800)); // Bremse wie in handleLogin
    return json({ error: "Das bisherige Passwort stimmt nicht." }, 403, corsHeaders);
  }

  const pwError = validatePasswordStrength(newPassword);
  if (pwError) return json({ error: pwError }, 400, corsHeaders);
  if (oldPassword === newPassword) {
    return json({ error: "Das neue Passwort muss sich vom bisherigen unterscheiden." }, 400, corsHeaders);
  }

  const { hash, salt, iterations } = await hashNewPassword(newPassword);
  user.passwordHash = hash;
  user.salt = salt;
  user.iterations = iterations;
  user.passwordSetAt = new Date().toISOString();

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  const token = await signToken(makeSessionPayload(user.username, !!user.isAdmin), env.SESSION_SECRET);
  const identity = deriveIdentity(user, usersDoc);
  return json({ token, username: user.username, ...identity }, 200, corsHeaders);
}

async function handleMe(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  const app = (body && body.app) ? String(body.app) : null;
  return json(await buildMeResult(session, env, authHeader, app), 200, corsHeaders);
}

// Baut die Antwort der Aktion "me". Ausgelagert, weil handleDavLoad dieselben
// Angaben mitliefert: dort sind nutzer.json (steckt als usersDoc schon in der
// Session) und sichtbarkeit.json für die Rechteprüfung ohnehin gelesen, die
// Felder kosten also KEINEN zusätzlichen Nextcloud-Read -- der Client spart
// dafür einen kompletten HTTP-Roundtrip beim Öffnen der App.
// app (optional): nur damit ist canEdit im Ergebnis; ohne App-Bezug gibt es
// kein Bearbeiten-Recht zu beantworten.
async function buildMeResult(session, env, authHeader, app, cfgPrefetch) {
  const usersDoc = session.usersDoc;
  const user = getOwn(usersDoc.users, session.username);
  const result = {
    username: session.username,
    isAdmin: !!session.isAdmin,
    groupIds: session.groupIds,
    realIsAdmin: !!session.realIsAdmin,
    viewAsGroupId: session.viewAsGroupId || null,
    vorname: (user && user.vorname) || null,
    nachname: (user && user.nachname) || null,
    lizenz: (user && user.lizenz) || "",
    mannschaften: (user && Array.isArray(user.mannschaften)) ? user.mannschaften : [],
    // Namen der EIGENEN Gruppen. Der Client hat in groupIds nur IDs und list-groups
    // ist admin-only -- deshalb konnte die Karte "Mein Konto" die Gruppen-Zeile
    // bisher ausschliesslich Admins zeigen. Bewusst hier aufgeloest statt der Client
    // per list-directory: das liefert die komplette Namensliste des Vereins und ist
    // fuer Spielerkonten per 403 gesperrt. Hier erfaehrt jeder nur seine eigenen
    // Gruppen -- nichts ueber fremde Konten oder die Gruppenstruktur des Vereins.
    // Folgt session.groupIds und damit auch einer aktiven Admin-Testansicht.
    groupNames: (session.groupIds || [])
      .map((id) => (getOwn(usersDoc.groups || {}, id) || {}).name)
      .filter(Boolean),
    // Fuer "Passwort zuletzt geaendert am". Fehlt bei Konten, die seit Einfuehrung
    // des Feldes kein Passwort gesetzt haben -- der Client laesst die Zeile dann weg.
    passwordSetAt: (user && user.passwordSetAt) || null,
    // Braucht diese Person einen Trainervertrag? Der Client kann das NICHT selbst
    // ableiten: er sieht in groupIds nur IDs, nicht den Gruppennamen "Trainer", und
    // list-groups ist Admin-only. Trainerdaten blendet daran Bankverbindung/
    // Nebentätigkeit/Unterschrift/Dokumente aus (Geschäftsführung o.ä. hinterlegt dort
    // nur Kontaktdaten). Ein bool über die EIGENE Person -- keine fremden Daten.
    vertragspflichtig: isVertragspflichtig(usersDoc, session.username),
    // Eigene Konto-Art. Additiv; der Client blendet daran Dinge aus, die für
    // Spielerkonten nicht gelten (z.B. den Materialcontainer-Code im Header).
    // Kommt aus dem echten Datensatz, folgt also NICHT einer Admin-Testansicht.
    art: session.art
  };
  if (app) {
    // Beide Stufen aus DERSELBEN Config-Promise beantworten -- ohne den lokalen
    // Prefetch würde jeder Resolver bei fehlendem cfgPrefetch einzeln lesen.
    const cfg = cfgPrefetch || prefetchJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
    result.canEdit = await resolveEditPermission(app, session, env, authHeader, cfg);
    // Administrieren (dritte Stufe, additiv): App-interne Admin-Funktionen --
    // Apps, die das Feld nicht kennen, ignorieren es einfach.
    result.canAdmin = await resolveAdminPermission(app, session, env, authHeader, cfg);
  }
  return result;
}

// Admin-Testansicht umschalten/zurücksetzen — siehe API-Dokumentation oben.
// Gate bewusst auf session.realIsAdmin (NICHT session.isAdmin), sonst kann
// sich ein Admin waehrend einer aktiven Testansicht nicht mehr zurueckschalten.
async function handleSetViewAs(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.realIsAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const usersDoc = session.usersDoc;
  const user = getOwn(usersDoc.users, session.username);
  const groupId = (body && body.groupId) ? String(body.groupId) : null;
  if (groupId && !getOwn(usersDoc.groups || {}, groupId)) {
    return json({ error: "Unbekannte Gruppe" }, 400, corsHeaders);
  }

  if (groupId) user.viewAsGroupId = groupId;
  else delete user.viewAsGroupId;

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  const identity = deriveIdentity(user, usersDoc);
  return json({ ok: true, ...identity }, 200, corsHeaders);
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

  // Namenskollision gegen den GESAMTEN Bestand prüfen, nicht nur gegen die
  // eigene Art -- Spieler und Personal teilen sich einen Namensraum (Login).
  const username = generateUsername(vorname, nachname, new Set(Object.keys(usersDoc.users)));
  const art = normalizeArt(body.art);
  usersDoc.users[username] = {
    username, vorname, nachname, passwordHash: null, salt: null, iterations: null,
    art,
    // Ein Spieler ist nie Admin -- ein durchgereichtes isAdmin:true würde die
    // Art-Trennung sofort aushebeln (Admin umgeht jeden Sichtbarkeits-Check).
    isAdmin: art === USER_ART_SPIELER ? false : !!body.isAdmin,
    mustSetPassword: true,
    lizenz: normalizeLizenz(body.lizenz), mannschaften: normalizeMannschaften(body.mannschaften),
    vertragBenoetigt: !!body.vertragBenoetigt,
    createdAt: new Date().toISOString(), passwordSetAt: null
  };

  addUserToGroups(usersDoc, username, body.groupIds);

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  // Auto-Provisioning: je nach Gruppen des Nutzers Einträge in den passenden Tools
  // anlegen (best effort — der Nutzer ist bereits angelegt, ein Fehler hier darf die
  // Antwort nicht kippen).
  let provisioned = {};
  try {
    const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
    const apps = provisionAppsForGroups(config, getUserGroupIds(usersDoc, username))
      .filter((app) => provisionErlaubtFuerArt(app, art));
    if (apps.length) provisioned = await provisionUsers([usersDoc.users[username]], apps, env, authHeader);
  } catch (_) { /* Provisioning ist best effort */ }

  return json({ username, vorname, nachname, art, mustSetPassword: true, provisioned }, 201, corsHeaders);
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
    art: userArt(u),
    isAdmin: !!u.isAdmin,
    mustSetPassword: !!u.mustSetPassword,
    createdAt: u.createdAt,
    groupIds: getUserGroupIds(usersDoc, u.username),
    lizenz: u.lizenz || "",
    mannschaften: Array.isArray(u.mannschaften) ? u.mannschaften : [],
    vertragBenoetigt: !!u.vertragBenoetigt
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

  // art ist OPTIONAL: fehlt es im Body (älterer Client), bleibt die bisherige Art
  // stehen. Ein normalizeArt(undefined) würde "personal" liefern und damit jeden
  // Spieler beim ersten Bearbeiten stillschweigend zum Personal befördern -- inkl.
  // Wiederauftauchen in Personalakte und Teilen-Pickern.
  const art = body.art === undefined ? userArt(user) : normalizeArt(body.art);
  // Ein Spieler ist nie Admin (gleiche Invariante wie in handleCreateUser). Beim
  // Umstufen Personal -> Spieler wird ein bestehender Admin-Status entzogen.
  const isAdmin = art === USER_ART_SPIELER ? false : !!body.isAdmin;
  if (user.isAdmin && !isAdmin) {
    const adminCount = Object.values(usersDoc.users).filter((u) => u.isAdmin).length;
    if (adminCount <= 1) return json({ error: "Letztem Admin kann der Admin-Status nicht entzogen werden" }, 400, corsHeaders);
  }

  user.vorname = vorname;
  user.nachname = nachname;
  user.art = art;
  user.isAdmin = isAdmin;
  user.lizenz = normalizeLizenz(body.lizenz);
  user.mannschaften = normalizeMannschaften(body.mannschaften);
  user.vertragBenoetigt = !!body.vertragBenoetigt;

  // Der Login-Nutzername wird beim Anlegen einmalig aus Vorname/Nachname generiert
  // (generateUsername) und danach nie mehr angefasst. Ohne diesen Abgleich bleibt
  // eine spätere Namenskorrektur (z. B. Tippfehler im Vornamen) rein kosmetisch: die
  // Liste zeigt den neuen Namen, aber das Konto ist weiterhin nur unter dem alten
  // Nutzernamen erreichbar, und der Nutzer kann sich mit seinem (jetzt korrekten)
  // Namen nicht mehr anmelden. Nur bei freier Ziel-Kennung umbenennen; kollidiert sie
  // mit einem ANDEREN Konto, lieber gar nicht anfassen und den Konflikt zurückmelden,
  // statt eine "-2"-Variante zu erzeugen, die der Nutzer beim Anmelden nie eingeben würde.
  const desiredUsername = baseUsernameFor(vorname, nachname);
  let usernameRename = null;
  if (desiredUsername !== username) {
    if (getOwn(usersDoc.users, desiredUsername)) {
      usernameRename = { from: username, to: desiredUsername, applied: false };
    } else {
      delete usersDoc.users[username];
      user.username = desiredUsername;
      usersDoc.users[desiredUsername] = user;
      Object.values(usersDoc.groups || {}).forEach((g) => {
        if (!Array.isArray(g.memberUsernames)) return;
        const idx = g.memberUsernames.indexOf(username);
        if (idx !== -1) g.memberUsernames[idx] = desiredUsername;
      });
      usernameRename = { from: username, to: desiredUsername, applied: true };
    }
  }
  const finalUsername = (usernameRename && usernameRename.applied) ? desiredUsername : username;

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({
    username: finalUsername, vorname, nachname, isAdmin,
    lizenz: user.lizenz, mannschaften: user.mannschaften, usernameRename
  }, 200, corsHeaders);
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

// Schmale Variante von list-groups für die Gruppen-Auswahl und die CSV-Spalte
// "Gruppen" im Trainerdaten-Admin: list-groups bleibt admin-only, hier darf
// zusätzlich die Population "darf Trainerdaten administrieren" lesen
// (resolveAdminPermission — Administrieren-Gruppen aus dem Sichtbarkeits-Panel,
// Admin-Kurzschluss inklusive; seit der dritten Rechte-Stufe hängt der ganze
// Trainerdaten-Admin-Modus an dieser Stufe, nicht mehr am Bearbeiten-Häkchen).
// Diese Personen sehen im Trainerdaten-Admin ohnehin alle Stammdaten inkl.
// IBAN; die Gruppenzugehörigkeit des Personals ist demgegenüber mild.
// Mitgliederlisten werden auf Personal gefiltert: Spielerkonten tauchen in den
// Trainerdaten nie auf und gehen einen Trainerdaten-Admin nichts an.
async function handleTrainerdatenListGroups(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  if (!(await resolveAdminPermission("trainerdaten", session, env, authHeader))) {
    return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  }

  const usersDoc = session.usersDoc;
  const istPersonalUsername = (username) => {
    const u = getOwn(usersDoc.users || {}, username);
    return !!u && istPersonal(u);
  };
  const groups = Object.values(usersDoc.groups || {}).map((g) => ({
    id: g.id,
    name: g.name,
    memberUsernames: (Array.isArray(g.memberUsernames) ? g.memberUsernames : []).filter(istPersonalUsername)
  }));
  return json({ groups }, 200, corsHeaders);
}

// Die eigenen Rechte-Stufen für EINE App — dieselben Resolver wie alle
// serverseitigen Gates (Admin-Kurzschluss inklusive). Primärer Konsument ist
// der Trainerdaten-CORS-Proxy (Worker "trainerdaten"): der prüft hierüber per
// Service Binding canAdmin (Administrieren-Stufe = Vollzugriff inkl. IBAN),
// bevor er WebDAV-Zugriffe mit seinen eigenen Nextcloud-Secrets ausführt.
// Bewusst 200 + false statt 403 bei fehlendem Recht, damit Aufrufer
// "Session ungültig" (401) von "eingeloggt, aber kein Recht" trennen können.
async function handleCheckEditPermission(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  const app = String(body.app || "");
  if (!app) return json({ error: "app fehlt" }, 400, corsHeaders);
  const cfg = prefetchJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
  const canEdit = await resolveEditPermission(app, session, env, authHeader, cfg);
  const canAdmin = await resolveAdminPermission(app, session, env, authHeader, cfg);
  return json({ canEdit: !!canEdit, canAdmin: !!canAdmin }, 200, corsHeaders);
}

// Schlanke, nicht-Admin-Variante von list-users/list-groups für "Teilen mit"-Picker
// in Gateway-Apps: nur Name+Nutzername bzw. Id+Name, keine Passwort-/Admin-/
// Mitgliederdaten. Jeder eingeloggte Nutzer darf das abrufen (kein isAdmin-Gate).
async function handleListDirectory(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  // Spieler bekommen das Verzeichnis gar nicht: es gibt kein Spieler-Tool mit
  // Teilen-Picker, und die vollständige Namensliste des Vereins ist nichts, was
  // ein Spielerkonto abrufen können muss. Braucht ein Spieler-Feature später
  // Namen, bekommt es eine eigene, schmale Aktion (Minimal-Disclosure) statt
  // einer Aufweichung hier.
  if (session.art === USER_ART_SPIELER) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const usersDoc = session.usersDoc;
  // Nur Personal: der Picker (z.B. Vereinskalender "Teilen mit") soll nicht durch
  // 200 Spielernamen unbenutzbar werden -- und Spieler sind dort nie das Ziel.
  const users = Object.values(usersDoc.users).filter(istPersonal).map((u) => ({
    username: u.username,
    displayName: (u.vorname && u.nachname) ? `${u.vorname} ${u.nachname}` : u.username
  }));
  const groups = Object.values(usersDoc.groups || {}).map((g) => ({ id: g.id, name: g.name }));
  return json({ users, groups }, 200, corsHeaders);
}

// Mitglieder der Bearbeiter-Gruppen (editGroupIds) einer bestimmten App -- z.B.
// für einen "Vertreter"-Picker im Abwesenheitskalender-Formular. Wie
// list-directory nur username+displayName, keine sensiblen Felder. Anders als
// list-directory an eine konkrete App gebunden (userMayAccessTool-Check wie
// dav-load), damit die Bearbeiter-Struktur einer App nicht an Nutzer ohne
// jeglichen Zugriff auf diese App durchsickert.
async function handleListToolEditors(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  const app = String(body.app || "");
  if (!getOwn(DAV_APPS, app)) return json({ error: "Unbekannte App" }, 400, corsHeaders);
  if (!(await userMayAccessTool(app, session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }
  const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
  const entry = getOwn(config.tools || {}, app);
  // Administrieren-Gruppen zählen mit -- deren Mitglieder SIND Bearbeiter
  // (resolveEditPermission wertet adminGroupIds genauso), also gehören sie
  // auch in jeden "Bearbeiter"-Picker.
  const editGroupIds = (entry && Array.isArray(entry.editGroupIds)) ? entry.editGroupIds : [];
  const adminGroupIds = (entry && Array.isArray(entry.adminGroupIds)) ? entry.adminGroupIds : [];
  const usersDoc = session.usersDoc;
  const usernames = new Set();
  editGroupIds.concat(adminGroupIds).forEach((gid) => {
    const group = getOwn(usersDoc.groups || {}, gid);
    if (group && Array.isArray(group.memberUsernames)) group.memberUsernames.forEach((u) => usernames.add(u));
  });
  const users = Array.from(usernames).map((username) => {
    const u = getOwn(usersDoc.users, username);
    return { username, displayName: (u && u.vorname && u.nachname) ? `${u.vorname} ${u.nachname}` : username };
  });
  return json({ users }, 200, corsHeaders);
}

// Zentrales Trainerprofil (Lizenz + Mannschaften) für ALLE Nutzer, nicht nur den
// eigenen Account (me() liefert nur das eigene Profil). Gleiche Vertrauensstufe
// wie list-directory/dav-load: jeder eingeloggte Nutzer darf lesen, keine
// sensiblen Felder (kein isAdmin/mustSetPassword/Passwort-Hash).
async function handleListTrainerProfiles(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const usersDoc = session.usersDoc;
  // Nur Personal. Zwei Gründe: ein Spieler HAT kein Trainerprofil (Lizenz/
  // Mannschaften sind Personal-Felder), und der Kadermanager joint diese Liste
  // per linkedUsername an seine Kadereinträge -- stünden Spieler drin, bekäme
  // jeder Spieler-Kaderplatz ein sinnloses Lizenz-Badge.
  // Bewusst KEIN 403 für Spieler (anders als list-directory): der Kadermanager
  // ruft diese Aktion beim Laden für die Trainer-Badges auf, und db.js wirft bei
  // 403 -- ein Spieler bekäme sonst eine kaputte App statt einer Kaderliste.
  const profiles = Object.values(usersDoc.users)
    .filter(istPersonal)
    .filter((u) => u.vorname && u.nachname)
    .map((u) => ({
      username: u.username,
      vorname: u.vorname,
      nachname: u.nachname,
      lizenz: u.lizenz || "",
      mannschaften: Array.isArray(u.mannschaften) ? u.mannschaften : [],
      vertragBenoetigt: !!u.vertragBenoetigt
    }));
  return json({ profiles }, 200, corsHeaders);
}

// ---------- Aktionen: Spieler-Registrierung (Kadermanager) ----------
//
// Onboarding für ~200 Spielerkonten, ohne dass jemand 200 Zugänge einzeln
// verteilen und nachhalten muss. Der Auth-Faktor ist die physische Anwesenheit
// im Training: der Trainer öffnet ein kurzes Zeitfenster, zeigt den Link (QR
// oder Mannschafts-Chat), die Spieler tragen sich selbst ein.
//
// Bewusst ZUSTANDSLOS: das Fenster ist allein das signierte Token, es wird
// nirgends gespeichert. Damit gibt es keinen Registrierungs-State in
// spielerplus.json, der mit dem normalen Speichern der App um dieselbe Datei
// konkurriert (LWW), und ein Fenster kann nicht "hängenbleiben" -- es läuft
// durch exp von selbst ab. Preis: ein einmal ausgegebenes Fenster lässt sich
// nicht vorzeitig widerrufen (KM_REG_TTL_SECONDS deshalb kurz halten).
//
// Restrisiko, bewusst getragen: wer den Link innerhalb des Fensters hat, kann
// sich als JEDER noch freie Spieler dieser Mannschaft eintragen. Genau dagegen
// ist das Fenster kurz und der Trainer sieht die Neuzugänge live in seiner
// Kaderliste -- trägt sich jemand als "Leon" ein, während Leon danebensteht,
// fliegt das sofort auf. Diese soziale Kontrolle ersetzt hier eine
// E-Mail-Verifikation, die es bei Kindern schlicht nicht gibt.
const KM_REG_TOKEN_TYP = "km-reg";
const KM_REG_TTL_SECONDS = 15 * 60;
const SPIELER_GROUP_NAME = "Spieler";

// Prüft ein Registrierungs-Token. Der typ-Check ist nicht optional: verifyToken
// validiert nur Signatur+exp, und beide Token-Sorten sind mit demselben
// SESSION_SECRET signiert. Ohne ihn wäre jedes gültige Session-Token als
// Registrierungs-Token einsetzbar (und umgekehrt).
async function verifyKmRegToken(token, env) {
  const payload = await verifyToken(String(token || ""), env.SESSION_SECRET);
  if (!payload || payload.typ !== KM_REG_TOKEN_TYP || !payload.teamId) return null;
  return payload;
}

// Kadereintrag -> Vor-/Nachname. Der Kader führt EINEN Namensstring; erster Teil
// ist der Vorname, der Rest der Nachname ("Max von Mustermann" -> "Max" / "von
// Mustermann"). Ein einzelnes Wort ergibt einen leeren Nachnamen -- bewusst
// toleriert statt abgelehnt: ein unvollständig gepflegter Kadername darf die
// Registrierung im Training nicht blockieren (baseUsernameFor kommt damit klar).
function splitKaderName(name) {
  const teile = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return null;
  return { vorname: teile[0], nachname: teile.slice(1).join(" ") };
}

// Öffnet das Registrierungsfenster für eine Mannschaft. Verlangt Bearbeiten-Recht
// am Kadermanager -- wer den Kader nicht pflegen darf, darf auch keine Konten
// dafür entstehen lassen.
async function handleKmRegOeffnen(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  if (!(await userMayAccessTool("kadermanager", session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }
  if (!(await resolveEditPermission("kadermanager", session, env, authHeader))) {
    return json({ error: "Kein Bearbeiten-Recht für dieses Tool" }, 403, corsHeaders);
  }

  const teamId = String(body.teamId || "");
  const doc = await readJson(DAV_APPS["kadermanager"], authHeader, { meta: {}, teams: [] });
  const team = (doc.teams || []).find((t) => t && t.id === teamId);
  if (!team) return json({ error: "Mannschaft nicht gefunden" }, 404, corsHeaders);

  const now = Math.floor(Date.now() / 1000);
  const exp = now + KM_REG_TTL_SECONDS;
  const token = await signToken(
    { typ: KM_REG_TOKEN_TYP, teamId, iat: now, exp, von: session.username },
    env.SESSION_SECRET
  );
  const freie = (team.kader || []).filter((s) => s && !s.linkedUsername).length;
  return json({ token, teamName: team.name || "", expiresAt: exp * 1000, ttlSeconds: KM_REG_TTL_SECONDS, freieSpieler: freie }, 200, corsHeaders);
}

// Was der Spieler nach dem Scannen sieht. OHNE Auth -- er hat ja noch kein Konto;
// das Token IST der Ausweis. Liefert bewusst nur id+name der noch freien
// Kaderplätze: keine Rollen, keine Fotos, keine Termine, und nichts über die
// bereits registrierten Mitspieler.
async function handleKmRegInfo(body, env, authHeader, corsHeaders) {
  const payload = await verifyKmRegToken(body.token, env);
  if (!payload) return json({ error: "Dieser Anmelde-Link ist abgelaufen oder ungültig. Bitte den Trainer um einen neuen." }, 401, corsHeaders);

  const doc = await readJson(DAV_APPS["kadermanager"], authHeader, { meta: {}, teams: [] });
  const team = (doc.teams || []).find((t) => t && t.id === payload.teamId);
  if (!team) return json({ error: "Mannschaft nicht gefunden" }, 404, corsHeaders);

  const spieler = (team.kader || [])
    .filter((s) => s && !s.linkedUsername && String(s.name || "").trim())
    .map((s) => ({ id: s.id, name: s.name }));
  return json({ teamName: team.name || "", spieler, expiresAt: (payload.exp || 0) * 1000 }, 200, corsHeaders);
}

// Legt das Spielerkonto an und verknüpft es mit dem Kaderplatz. OHNE Auth, das
// Token trägt die Berechtigung.
//
// Reihenfolge (nutzer.json ZUERST, dann spielerplus.json) ist bewusst gewählt --
// die beiden Schreibvorgänge sind nicht atomar, und einer der Fehlerfälle ist
// deutlich milder als der andere:
//   Konto ohne Kaderplatz  -> Spieler ist eingeloggt und hakt sich per "Das bin
//                             ich" selbst ein. Heilt sich selbst.
//   Kaderplatz ohne Konto  -> Platz ist dauerhaft blockiert, niemand kann sich
//                             mehr darauf registrieren, und nur der Trainer
//                             könnte es (wenn er es merkt) wieder lösen.
// Deshalb: erst das Konto. Schlägt danach die Verknüpfung fehl, kommt der
// Spieler trotzdem mit gültiger Sitzung raus, nur mit verknuepft:false.
async function handleKmRegAbschliessen(request, body, env, authHeader, corsHeaders) {
  const payload = await verifyKmRegToken(body.token, env);
  if (!payload) return json({ error: "Dieser Anmelde-Link ist abgelaufen oder ungültig. Bitte den Trainer um einen neuen." }, 401, corsHeaders);

  const spielerId = String(body.spielerId || "");

  // Zweiter Weg: der Scanner ist bereits angemeldet (typisch der Torhüter, der schon
  // in seiner Mannschaft steht und sich zusätzlich für die Torwartgruppe einträgt).
  // Dann kein zweites Konto anlegen -- das erzeugte bisher stillschweigend einen
  // Doppelaccount ("leon.mueller2") --, sondern nur den Kaderplatz verknüpfen.
  // getVerifiedSession liefert bei fehlendem/abgelaufenem Token sauber null, ohne zu
  // werfen; die Erstanmeldung echter Neulinge läuft also unverändert weiter unten.
  const session = await getVerifiedSession(request, env, authHeader);
  if (session) {
    // Gleiche Schranke wie handleKmSelf: das Reg-Token berechtigt zum Kader, aber
    // wer das Tool gar nicht sehen darf, soll sich auch nicht hineinverknüpfen.
    if (!(await userMayAccessTool("kadermanager", session, env, authHeader))) {
      return json({ error: "Dein Konto hat keinen Zugriff auf den Kadermanager. Bitte wende dich an deinen Trainer." }, 403, corsHeaders);
    }
    return kmRegVerknuepfeBestehendes(payload, spielerId, session.username, authHeader, corsHeaders);
  }

  const pwError = validatePasswordStrength(body.password);
  if (pwError) return json({ error: pwError }, 400, corsHeaders);

  const { data: kmDoc, rev } = await readJsonWithRev(DAV_APPS["kadermanager"], authHeader, { meta: {}, teams: [] });
  const team = (kmDoc.teams || []).find((t) => t && t.id === payload.teamId);
  if (!team) return json({ error: "Mannschaft nicht gefunden" }, 404, corsHeaders);
  const spieler = (team.kader || []).find((s) => s && s.id === spielerId);
  if (!spieler) return json({ error: "Dieser Eintrag steht nicht mehr im Kader." }, 404, corsHeaders);
  // Doppelregistrierung: Erstprüfung gegen den gelesenen Stand. Die eigentliche
  // Absicherung gegen zwei gleichzeitige Anmeldungen auf denselben Platz ist das
  // If-Match beim Schreiben weiter unten -- diese Prüfung hier erspart nur den
  // sinnlosen Kontoanlage-Versuch im Normalfall.
  if (spieler.linkedUsername) return json({ error: "Für diesen Spieler gibt es schon ein Konto." }, 409, corsHeaders);

  const namen = splitKaderName(spieler.name);
  if (!namen) return json({ error: "Dieser Kadereintrag hat keinen Namen. Bitte den Trainer, ihn zu ergänzen." }, 400, corsHeaders);

  // --- Schritt 1: Konto anlegen ---
  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  if (!usersDoc.groups) usersDoc.groups = {};
  const username = generateUsername(namen.vorname, namen.nachname, new Set(Object.keys(usersDoc.users)));
  const { hash, salt, iterations } = await hashNewPassword(String(body.password || ""));
  const nowIso = new Date().toISOString();
  usersDoc.users[username] = {
    username, vorname: namen.vorname, nachname: namen.nachname,
    passwordHash: hash, salt, iterations,
    art: USER_ART_SPIELER,
    isAdmin: false,
    // Das Passwort wird hier direkt gesetzt (nicht mustSetPassword:true wie bei
    // create-user): der Spieler steht gerade davor und vergibt es selbst -- ein
    // zweiter "jetzt Passwort setzen"-Schritt ohne Auth wäre genau die Lücke,
    // die dieser ganze Ablauf ersetzt.
    mustSetPassword: false,
    lizenz: "", mannschaften: [], vertragBenoetigt: false,
    createdAt: nowIso, passwordSetAt: nowIso, lastLoginAt: nowIso
  };
  // Ohne Gruppe sähe der Spieler nach dem Login kein einziges Tool -- der
  // "keine Gruppe = alle eingeloggten"-Default gilt für Spieler nicht
  // (userMayAccessTool). Die Gruppe wird bei Bedarf angelegt; sie muss in
  // sichtbarkeit.json bei kadermanager.groupIds stehen, sonst bleibt die App leer.
  const spielerGruppe = ensureSpielerGruppe(usersDoc);
  addUserToGroups(usersDoc, username, [spielerGruppe.id]);

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Konto konnte nicht angelegt werden: " + e.message }, 502, corsHeaders);
  }

  const sessionToken = await signToken(makeSessionPayload(username, false), env.SESSION_SECRET);

  // --- Schritt 2: Kaderplatz verknüpfen ---
  // If-Match: hat in der Zwischenzeit jemand anders gespeichert (anderer Spieler,
  // Trainer im selben Moment), schlägt das fehl statt dessen Änderung zu
  // überschreiben. Das Konto steht dann schon -- deshalb verknuepft:false statt
  // eines Fehlers, der den Spieler ratlos zurückließe.
  spieler.linkedUsername = username;
  try {
    await writeJson(DAV_APPS["kadermanager"], authHeader, kmDoc, rev);
  } catch (e) {
    return json({
      token: sessionToken, username, verknuepft: false,
      hinweis: "Dein Konto ist angelegt und du bist angemeldet. Bitte wähle im Kader noch selbst deinen Namen aus („Das bin ich“)."
    }, 200, corsHeaders);
  }

  return json({ token: sessionToken, username, verknuepft: true, teamName: team.name || "", spielerName: spieler.name || "" }, 200, corsHeaders);
}

// Bereits angemeldeter Scanner: nur verknüpfen, kein Konto anlegen. Die Mannschaft
// kommt aus dem verifizierten Reg-Token, NIE aus dem Request-Body -- km-reg-info gibt
// bewusst keine teamId heraus, und ein manipulierter Body darf keinen fremden Kader
// treffen. Antwortform identisch zum Kontoanlage-Pfad, damit der Client beide Fälle
// gleich behandelt (nur ohne `token`: die Sitzung besteht ja schon).
async function kmRegVerknuepfeBestehendes(payload, spielerId, username, authHeader, corsHeaders) {
  const url = DAV_APPS["kadermanager"];
  // Retry wie in handleKmSelf: read-modify-write auf einer Datei, die Trainer und
  // andere Spieler gleichzeitig schreiben. Ein 412 ist hier heilbar, weil die
  // Verknüpfung idempotent auf dem frischen Stand neu versucht werden kann.
  for (let versuch = 0; versuch < 3; versuch++) {
    jsonCache.delete(url);
    const { data: doc, rev } = await readJsonWithRev(url, authHeader, { meta: {}, teams: [] });
    jsonCache.delete(url);

    const team = (doc.teams || []).find((t) => t && t.id === payload.teamId);
    if (!team) return json({ error: "Mannschaft nicht gefunden" }, 404, corsHeaders);

    const res = kmVerknuepfeKaderplatz(team, spielerId, username);
    if (res.error) return json({ error: res.error }, res.status || 400, corsHeaders);

    try {
      await writeJson(url, authHeader, doc, rev);
    } catch (e) {
      // Nur Konflikte sind erneut versuchbar; ein Netz-/Serverfehler wird als solcher
      // gemeldet, statt ihn als "jemand anders war schneller" zu verkleiden.
      if (e instanceof ConflictError && versuch < 2) continue;
      if (e instanceof ConflictError) {
        return json({
          username, verknuepft: false,
          hinweis: "Gerade haben zu viele gleichzeitig gespeichert. Öffne den Kadermanager und wähle dort deinen Namen aus („Das bin ich“)."
        }, 200, corsHeaders);
      }
      return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
    }
    return json({ username, verknuepft: true, teamName: team.name || "", spielerName: res.spieler.name || "" }, 200, corsHeaders);
  }
}

// Reduzierte Kadermanager-Sicht für Spielerkonten.
//
// Die App selbst kennt bewusst keine abgestufte Sichtbarkeit ("nur das Bearbeiten
// ist granular, nicht das Sehen") -- bei ~20 Trainern war das richtig, bei ~200
// Spielern nicht: sonst sieht jeder Jugendliche die Mannschaftskasse aller
// (wer wie viel Strafe schuldet), wer wann krank war, und die Kader sämtlicher
// anderer Mannschaften.
//
// Serverseitig statt im Client, weil der Client umgehbar ist -- gefiltert wird, was
// gar nicht erst ausgeliefert wird. Das ist hier gefahrlos möglich, weil ein Spieler
// dav-save NIE aufrufen darf (kadermanager steht in WRITE_REQUIRES_EDIT_PERMISSION,
// Spieler haben kein Bearbeiten-Recht): die gekürzte Kopie kann also nicht
// zurückgeschrieben werden und dabei fremde Daten löschen. Der einzige Schreibweg
// für Spieler ist km-self, und das arbeitet serverseitig immer auf dem VOLLEN Doc.
function kmSpielerSicht(doc, username) {
  const teams = Array.isArray(doc.teams) ? doc.teams : [];
  const gehoertMir = (t) => (Array.isArray(t && t.kader) ? t.kader : [])
    .some((s) => s && s.linkedUsername && sameText(s.linkedUsername, username));
  const meine = teams.filter(gehoertMir);

  // Noch keinem Kaderplatz zugeordnet -- seltener Fall, tritt nur auf, wenn die
  // Verknüpfung bei der Registrierung kollidierte (verknuepft:false). Dann genau so
  // viel ausliefern, dass "Das bin ich" möglich ist: Mannschafts- und Kadernamen,
  // sonst nichts. Ohne das säße der Spieler in einer leeren App fest.
  if (meine.length === 0) {
    return {
      meta: {},
      teams: teams.map((t) => ({
        id: t.id, name: t.name, farbe: t.farbe,
        kader: (Array.isArray(t.kader) ? t.kader : [])
          .map((s) => ({ id: s.id, name: s.name, linkedUsername: s.linkedUsername || "" })),
        termine: [], umfragen: [], abwesenheiten: [],
        kasse: { strafenkatalog: [], buchungen: [] }
      }))
    };
  }

  return {
    // meta mitnehmen: meta.rollenRechte steuert hasRecht() im Client.
    meta: (doc.meta && typeof doc.meta === "object") ? doc.meta : {},
    teams: meine.map((t) => {
      const ich = (t.kader || []).find((s) => s && s.linkedUsername && sameText(s.linkedUsername, username));
      const meineId = ich ? ich.id : null;
      const kasse = (t.kasse && typeof t.kasse === "object") ? t.kasse : {};
      return Object.assign({}, t, {
        // Urlaub/Krank ist gesundheitsnah -- nur der eigene Eintrag.
        abwesenheiten: (Array.isArray(t.abwesenheiten) ? t.abwesenheiten : [])
          .filter((a) => a && a.spielerId === meineId),
        kasse: {
          // Der Strafenkatalog ist nur die Preisliste ("Zu spät: 2 €") -- die darf
          // und soll jeder sehen, sie enthält keine Personendaten.
          strafenkatalog: Array.isArray(kasse.strafenkatalog) ? kasse.strafenkatalog : [],
          // Buchungen nur die eigenen: was ein Mitspieler schuldet, geht niemanden an.
          buchungen: (Array.isArray(kasse.buchungen) ? kasse.buchungen : [])
            .filter((b) => b && b.spielerId === meineId)
        }
      });
    })
  };
}

// ---------- Aktion: Spieler-Selbstbedienung im Kadermanager ("Briefschlitz") ----------
//
// Ein Spieler darf genau seine EIGENEN Einträge ändern: zusagen/absagen, abstimmen,
// eine ihm zugewiesene Aufgabe abhaken, Mitfahrt anbieten/suchen, Urlaub/Krank
// melden -- alles OHNE Bearbeiten-Recht am Tool.
//
// Warum eine eigene Aktion statt einfach Bearbeiten-Recht: das generische dav-save
// schreibt IMMER die komplette Datei zurück (alle Mannschaften, alle Kader, die
// Kasse). Bearbeiten-Recht für ~200 Spielerkonten hieße, dass jedes davon den
// gesamten Bestand überschreiben oder löschen kann -- per Browser-Konsole trivial.
// Diese Aktion nimmt stattdessen eine winzige, getypte Nachricht entgegen und
// ändert serverseitig genau ein Feld.
//
// Sicherheitskern: der eigene Kaderplatz wird IMMER aus linkedUsername abgeleitet
// (kmSelfEigenerSpieler), NIE aus dem Request-Body. Ein manipulierter Request kann
// damit keinen fremden Eintrag treffen. Einzige Ausnahme ist "claim" -- das
// übernimmt per Definition einen Platz und prüft deshalb, dass er noch frei ist.
//
// Nebeneffekt gegen Schreibkonflikte: 25 Zusagen am Mittwochabend schicken je ein
// paar Byte statt der ganzen Datei; der Server serialisiert sie per If-Match und
// wiederholt bei Kollision selbst, statt dass Clients sich gegenseitig überschreiben.
const KM_SELF_STATUS = new Set(["zu", "unsicher", "ab"]);

async function handleKmSelf(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  // Bewusst NUR Sichtbarkeit, nicht resolveEditPermission -- genau das ist der Zweck
  // dieser Aktion. Wer das Tool nicht sehen darf, kommt aber auch hier nicht durch.
  if (!(await userMayAccessTool("kadermanager", session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }

  const url = DAV_APPS["kadermanager"];
  const art = String(body.art || "");
  const teamId = String(body.teamId || "");

  for (let versuch = 0; versuch < 3; versuch++) {
    // Frisch lesen erzwingen: der 5s-Cache könnte einen veralteten Stand liefern,
    // und ein read-modify-write braucht zwingend das ETag zum GELESENEN Inhalt.
    jsonCache.delete(url);
    const { data: doc, rev } = await readJsonWithRev(url, authHeader, { meta: {}, teams: [] });
    // Sofort wieder aus dem Cache nehmen -- readJsonWithRev legt das geparste Objekt
    // dort ab und gibt DIESE Referenz zurück. Ohne das Entfernen würde die Mutation
    // unten den Cache für parallele Requests im selben Isolate verfälschen (gleiche
    // Falle wie im Kommentar bei handleDavLoad).
    jsonCache.delete(url);

    const team = (doc.teams || []).find((t) => t && t.id === teamId);
    if (!team) return json({ error: "Mannschaft nicht gefunden" }, 404, corsHeaders);

    const res = kmSelfAnwenden(art, body, team, session.username);
    if (res.error) return json({ error: res.error }, res.status || 400, corsHeaders);

    try {
      await writeJson(url, authHeader, doc, rev);
      return json({ ok: true, ...(res.antwort || {}) }, 200, corsHeaders);
    } catch (e) {
      // Jemand anders hat zwischendurch gespeichert: frisch lesen und die eigene
      // Änderung erneut anwenden, statt fremde Änderungen zu überschreiben.
      if (e instanceof ConflictError && versuch < 2) continue;
      if (e instanceof ConflictError) {
        return json({ error: "Gerade speichern zu viele gleichzeitig. Bitte nochmal tippen." }, 409, corsHeaders);
      }
      return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
    }
  }
}

// Eigener Kaderplatz -- ausschließlich über die Verknüpfung, nie über den Body.
function kmSelfEigenerSpieler(team, username) {
  return (team.kader || []).find((s) => s && s.linkedUsername && sameText(s.linkedUsername, username)) || null;
}

// Spiegelt terminIstKommend() im Client (datum >= heute). Ein Tag Toleranz, weil der
// Worker in UTC rechnet und der Client in lokaler Zeit -- ohne die Toleranz wäre ein
// Termin "heute" je nach Uhrzeit serverseitig schon Vergangenheit. Für den Zweck der
// Regel (keine nachträgliche Änderung der Statistik-Historie) ist das unerheblich.
function kmTerminIstKommend(termin) {
  const gestern = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return String(termin.datum || "") >= gestern;
}

function kmFahrgemeinschaft(termin) {
  if (!termin.fahrgemeinschaft || typeof termin.fahrgemeinschaft !== "object") termin.fahrgemeinschaft = {};
  if (!Array.isArray(termin.fahrgemeinschaft.angebote)) termin.fahrgemeinschaft.angebote = [];
  if (!Array.isArray(termin.fahrgemeinschaft.gesuche)) termin.fahrgemeinschaft.gesuche = [];
  return termin.fahrgemeinschaft;
}

// Verknüpft einen Kaderplatz mit einem Konto. Einzige Stelle für diese Regel --
// beide Wege dorthin (km-self "claim" aus der App, km-reg-abschliessen mit
// bestehender Sitzung) rufen sie auf, damit die Bedingungen nicht auseinanderlaufen.
// Mutiert `team` in-place; der Aufrufer schreibt danach.
function kmVerknuepfeKaderplatz(team, spielerId, username) {
  const ziel = (team.kader || []).find((s) => s && s.id === String(spielerId || ""));
  if (!ziel) return { error: "Spieler nicht gefunden", status: 404 };
  if (ziel.linkedUsername) return { error: "Dieser Spieler ist bereits mit einem Konto verknüpft.", status: 409 };
  // Pro Team nur ein eigener Platz -- alten lösen (gleiche Regel wie claimSpieler).
  // Bewusst nur innerhalb DIESES Teams: eine Verknüpfung in einer anderen Mannschaft
  // oder Gruppe bleibt bestehen, das ist der Kern der Mehrfachzugehörigkeit.
  (team.kader || []).forEach((s) => { if (s.linkedUsername && sameText(s.linkedUsername, username)) s.linkedUsername = ""; });
  ziel.linkedUsername = username;
  return { spieler: ziel };
}

// Wendet GENAU EINE Selbstbedienungs-Änderung an. Gibt {error,status} oder {antwort}.
// Die Regeln spiegeln bewusst 1:1 die Client-Gates (canSetStatusFor, vote,
// toggleAufgabe, fgEntferne*, removeAbwesenheit) -- der Server darf nicht mehr
// erlauben als die Oberfläche anbietet, sonst ist der Client die einzige Schranke.
function kmSelfAnwenden(art, body, team, username) {
  const jetzt = new Date().toISOString();

  // claim läuft VOR der Eigener-Spieler-Ermittlung: dort gibt es noch keinen.
  if (art === "claim") {
    const res = kmVerknuepfeKaderplatz(team, body.spielerId, username);
    if (res.error) return { error: res.error, status: res.status };
    return { antwort: { spielerId: res.spieler.id } };
  }

  const ich = kmSelfEigenerSpieler(team, username);
  if (!ich) return { error: "Du bist in dieser Mannschaft keinem Kaderplatz zugeordnet.", status: 403 };

  const terminHolen = () => (team.termine || []).find((t) => t && t.id === String(body.terminId || ""));

  switch (art) {
    case "teilnahme": {
      const termin = terminHolen();
      if (!termin) return { error: "Termin nicht gefunden", status: 404 };
      if (!kmTerminIstKommend(termin)) return { error: "Vergangene Termine kann nur der Trainer ändern.", status: 403 };
      if (!termin.teilnahme || typeof termin.teilnahme !== "object") termin.teilnahme = {};
      if (body.status == null || body.status === "") { delete termin.teilnahme[ich.id]; return {}; }
      const status = String(body.status);
      if (!KM_SELF_STATUS.has(status)) return { error: "Unbekannter Status" };
      termin.teilnahme[ich.id] = { status, grund: String(body.grund || "").slice(0, 500), am: jetzt };
      return {};
    }

    case "umfrage": {
      const u = (team.umfragen || []).find((x) => x && x.id === String(body.umfrageId || ""));
      if (!u) return { error: "Umfrage nicht gefunden", status: 404 };
      if (!u.offen) return { error: "Diese Umfrage ist geschlossen.", status: 403 };
      const gueltig = new Set((u.optionen || []).map((o) => o && o.id));
      const gewaehlt = Array.isArray(body.optionIds)
        ? body.optionIds.map(String).filter((id) => gueltig.has(id))
        : [];
      if (!u.mehrfach && gewaehlt.length > 1) return { error: "Hier ist nur eine Antwort erlaubt." };
      if (!u.stimmen || typeof u.stimmen !== "object") u.stimmen = {};
      if (gewaehlt.length) u.stimmen[ich.id] = gewaehlt; else delete u.stimmen[ich.id];
      return {};
    }

    case "aufgabe": {
      const termin = terminHolen();
      if (!termin) return { error: "Termin nicht gefunden", status: 404 };
      const a = (termin.aufgaben || []).find((x) => x && x.id === String(body.aufgabeId || ""));
      if (!a) return { error: "Aufgabe nicht gefunden", status: 404 };
      if (!Array.isArray(a.spielerIds) || !a.spielerIds.includes(ich.id)) {
        return { error: "Diese Aufgabe ist dir nicht zugewiesen.", status: 403 };
      }
      if (!a.erledigt || typeof a.erledigt !== "object") a.erledigt = {};
      if (body.erledigt) a.erledigt[ich.id] = true; else delete a.erledigt[ich.id];
      return {};
    }

    case "fahrt-angebot": {
      const termin = terminHolen();
      if (!termin) return { error: "Termin nicht gefunden", status: 404 };
      const fg = kmFahrgemeinschaft(termin);
      fg.angebote = fg.angebote.filter((a) => a && a.spielerId !== ich.id);
      const plaetze = Number(body.plaetze);
      if (Number.isFinite(plaetze) && plaetze > 0) {
        fg.angebote.push({ spielerId: ich.id, plaetze: Math.min(Math.floor(plaetze), 20) });
      }
      return {};
    }

    case "fahrt-gesuch": {
      const termin = terminHolen();
      if (!termin) return { error: "Termin nicht gefunden", status: 404 };
      const fg = kmFahrgemeinschaft(termin);
      fg.gesuche = fg.gesuche.filter((id) => id !== ich.id);
      if (body.an) fg.gesuche.push(ich.id);
      return {};
    }

    case "unclaim": {
      // Löst ausschließlich die EIGENE Verknüpfung (ich stammt aus linkedUsername) --
      // eine spielerId aus dem Body wird bewusst ignoriert.
      ich.linkedUsername = "";
      return {};
    }

    case "urlaub-add": {
      if (!Array.isArray(team.abwesenheiten)) team.abwesenheiten = [];
      const von = String(body.von || "");
      const bis = String(body.bis || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) {
        return { error: "Ungültiger Zeitraum" };
      }
      if (bis < von) return { error: "Das Ende liegt vor dem Beginn." };
      // Id vom Client übernehmen, wenn brauchbar und frei: der Client hat den Eintrag
      // lokal schon mit dieser Id angelegt (sofortige Anzeige). Eine serverseitig neu
      // erzeugte Id würde auseinanderlaufen -- ein direkt folgendes Löschen schickt
      // dann eine Id, die es serverseitig nie gab (404).
      const wunschId = String(body.id || "");
      const idFrei = wunschId.length >= 8 && wunschId.length <= 64 &&
                     !team.abwesenheiten.some((x) => x && x.id === wunschId);
      const eintrag = {
        id: idFrei ? wunschId : crypto.randomUUID(),
        spielerId: ich.id, von, bis,
        grund: String(body.grund || "").slice(0, 300),
        typ: body.typ === "krank" ? "krank" : "urlaub"
      };
      team.abwesenheiten.push(eintrag);
      return { antwort: { id: eintrag.id } };
    }

    case "urlaub-del": {
      if (!Array.isArray(team.abwesenheiten)) team.abwesenheiten = [];
      const a = team.abwesenheiten.find((x) => x && x.id === String(body.abwesenheitId || ""));
      if (!a) return { error: "Eintrag nicht gefunden", status: 404 };
      if (a.spielerId !== ich.id) return { error: "Das ist nicht dein Eintrag.", status: 403 };
      team.abwesenheiten = team.abwesenheiten.filter((x) => x !== a);
      return {};
    }

    default:
      return { error: "Unbekannte Selbstbedienungs-Aktion" };
  }
}

// Legt die Spieler-Gruppe an, falls es sie noch nicht gibt. Gleiche Idee wie
// TRAINER_GROUP_NAME: über den Namen auffindbar, damit der Ablauf nicht an einer
// hartkodierten Id hängt, die in nutzer.json vielleicht nie angelegt wurde.
function ensureSpielerGruppe(usersDoc) {
  if (!usersDoc.groups) usersDoc.groups = {};
  const vorhanden = Object.values(usersDoc.groups).find((g) => g && g.name === SPIELER_GROUP_NAME);
  if (vorhanden) return vorhanden;
  const id = uniqueGroupId(slugifyGroupName(SPIELER_GROUP_NAME), new Set(Object.keys(usersDoc.groups)));
  usersDoc.groups[id] = { id, name: SPIELER_GROUP_NAME, memberUsernames: [] };
  return usersDoc.groups[id];
}

// Stellt ein kurzlebiges LiveKit-Zugangstoken für die Besprechung aus (Sprach-/
// Screenshare-Treffpunkt, siehe E:\besprechung). Die Besprechung speichert
// selbst NICHTS in Nextcloud -- diese Aktion ist ihre einzige Server-Berührung.
// LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET sind bewusst NICHT Teil von
// requiredSecrets oben (das würde bei fehlendem Secret die GESAMTE Gateway für
// alle Apps mit 500 blockieren) -- die Prüfung ist hier lokal auf diese eine
// Aktion beschränkt, ein fehlendes Secret bricht nur "livekit-token".
async function handleLivekitToken(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  if (!(await userMayAccessTool("besprechung", session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf die Besprechung" }, 403, corsHeaders);
  }
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    return json({ error: "LiveKit ist serverseitig noch nicht konfiguriert." }, 500, corsHeaders);
  }
  const room = String(body.room || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(room)) {
    return json({ error: "Ungültiger Raumname" }, 400, corsHeaders);
  }
  const user = getOwn(session.usersDoc.users, session.username);
  const name = (user && user.vorname && user.nachname) ? `${user.vorname} ${user.nachname}` : session.username;
  const token = await buildLivekitToken({
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    identity: session.username,
    name,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
    ttlSeconds: 6 * 60 * 60 // 6h -- deckt eine lange Versammlung ohne Token-Refresh-Logik ab
  });
  return json({ token, url: env.LIVEKIT_URL, identity: session.username, name }, 200, corsHeaders);
}

// Gate für die Moderations-Aktionen der Besprechung (kicken/stummschalten):
// eingeloggt + Bearbeiter-Recht (resolveEditPermission = "bestimmte Gruppen",
// dieselbe editGroupIds-Logik wie bei den anderen Apps) + LiveKit serverseitig
// konfiguriert. Liefert { session } oder { error: <Response> }.
async function requireBesprechungModerator(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return { error: json({ error: "Nicht angemeldet" }, 401, corsHeaders) };
  if (!(await resolveEditPermission("besprechung", session, env, authHeader))) {
    return { error: json({ error: "Keine Moderationsrechte für die Besprechung" }, 403, corsHeaders) };
  }
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    return { error: json({ error: "LiveKit ist serverseitig noch nicht konfiguriert." }, 500, corsHeaders) };
  }
  return { session };
}

function validateBesprechungRoom(room) {
  const r = String(room || "").trim();
  return /^[a-zA-Z0-9_-]{1,100}$/.test(r) ? r : null;
}

// Entfernt einen Teilnehmer aus dem Besprechungsraum (LiveKit RemoveParticipant).
async function handleLivekitKick(request, body, env, authHeader, corsHeaders) {
  const gate = await requireBesprechungModerator(request, env, authHeader, corsHeaders);
  if (gate.error) return gate.error;
  const room = validateBesprechungRoom(body.room);
  const identity = String(body.identity || "").trim();
  if (!room) return json({ error: "Ungültiger Raumname" }, 400, corsHeaders);
  if (!identity) return json({ error: "Kein Teilnehmer angegeben" }, 400, corsHeaders);
  try {
    await livekitRoomService(env, "RemoveParticipant", { room, identity });
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }
  return json({ ok: true }, 200, corsHeaders);
}

// Schaltet einen einzelnen publizierten Track eines Teilnehmers stumm
// (LiveKit MutePublishedTrack). track_sid kommt vom moderierenden Client.
async function handleLivekitMute(request, body, env, authHeader, corsHeaders) {
  const gate = await requireBesprechungModerator(request, env, authHeader, corsHeaders);
  if (gate.error) return gate.error;
  const room = validateBesprechungRoom(body.room);
  const identity = String(body.identity || "").trim();
  const trackSid = String(body.trackSid || "").trim();
  if (!room) return json({ error: "Ungültiger Raumname" }, 400, corsHeaders);
  if (!identity || !trackSid) return json({ error: "Teilnehmer oder Track fehlt" }, 400, corsHeaders);
  try {
    await livekitRoomService(env, "MutePublishedTrack", { room, identity, track_sid: trackSid, muted: true });
  } catch (e) {
    return json({ error: e.message }, 502, corsHeaders);
  }
  return json({ ok: true }, 200, corsHeaders);
}

// Wer heute (Tag+Monat) laut Trainerdaten Geburtstag hat -- nur Vor-/Nachname,
// nie das Geburtsjahr oder andere Trainerdaten-Felder. Anders als
// personalakte-overview (siehe mayViewPersonalakte) bewusst für JEDEN
// eingeloggten Nutzer offen: dass heute jemandes Geburtstag ist, ist ein
// öffentlicher Anlass fürs Dashboard, das Geburtsjahr bleibt trotzdem exklusiv
// der Personalakte vorbehalten. Trainerdaten selbst bleibt PROVISION_ONLY
// (IBAN etc.) -- hier wird nur serverseitig gelesen und stark gefiltert.
async function handleListBirthdaysToday(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const trainerdatenDoc = await readJson(PROVISION_ONLY_PATHS.trainerdaten, authHeader, { version: 1, trainer: [] });
  // "Heute" serverseitig ist ohne Zeitzonen-Bezug reines UTC -- Europe/Berlin
  // wird deshalb erzwungen, sonst wäre der Treffer in den ersten Stunden nach
  // Mitternacht MESZ/MEZ (UTC-Tageswechsel liegt davor) um bis zu zwei Stunden
  // verschoben.
  const heuteMD = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }).slice(5, 10);
  const namen = (trainerdatenDoc.trainer || [])
    .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.geburtsdatum || "") && t.geburtsdatum.slice(5, 10) === heuteMD)
    .map((t) => `${t.vorname || ""} ${t.nachname || ""}`.trim())
    .filter(Boolean);
  return json({ namen }, 200, corsHeaders);
}

// Kontaktdaten-Prefill für den Raumnutzungs-Antrag (Veranstaltungsleitung/
// Vertretung): der Client schickt den frei getippten Namen, hier wird er gegen
// Trainerdaten (PROVISION_ONLY_PATHS) aufgelöst und NUR Straße/PLZ/Ort/Telefon/
// E-Mail zurückgegeben — nie IBAN, Geburtsdatum oder Dokumente (Minimal-
// Disclosure wie list-birthdays-today). Gate ist das Bearbeiten-Recht der
// Raumnutzung-App (resolveEditPermission, dieselbe Schranke wie dav-save dort):
// diese Personen tragen die Kontaktdaten sonst von Hand in den Antrag ein und
// sehen sie in jedem gespeicherten Antrag — die Aktion spart das Abtippen,
// öffnet aber keinem zusätzlichen Personenkreis Daten.
// Namensabgleich reihenfolge-tolerant über sameNamePair (das Formularfeld heißt
// "Name, Vorname", eingegeben wird erfahrungsgemäß beides — siehe
// [[feedback-name-matching-order-tolerance]]). Ein Komma-Paar ("Eschborn,
// Alexander") wird zuerst probiert, danach IMMER zusätzlich die Wort-Splits an
// der ersten und letzten Lücke (Kommas dabei wie Leerzeichen behandelt), damit
// auch Doppelnamen eine Chance haben ("Karl Heinz Müller" = Vorname "Karl
// Heinz" ODER Nachname "Heinz Müller"). Das Komma darf nie exklusiv gewinnen:
// eine Eingabe MIT Komma muss mindestens alles treffen, was dieselbe Eingabe
// ohne Komma träfe (Michel-Bugreport 2026-07-24: Komma-Eingaben liefen leer,
// während beide Leerzeichen-Reihenfolgen funktionierten). Treffer ohne jedes
// Kontaktfeld (reine Import-Stubs) werden übersprungen, sonst blockiert ein
// namensgleicher Stub den echten Datensatz.
async function handleRaumnutzungKontaktLookup(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  if (!(await resolveEditPermission("raumnutzung", session, env, authHeader))) {
    return json({ error: "Kein Bearbeiten-Recht für dieses Tool" }, 403, corsHeaders);
  }

  const name = String(body.name || "").trim().slice(0, 200);
  const paare = [];
  const kommaIdx = name.indexOf(",");
  if (kommaIdx >= 0) {
    const vorKomma = name.slice(0, kommaIdx).trim();
    const nachKomma = name.slice(kommaIdx + 1).trim();
    if (vorKomma && nachKomma) paare.push([vorKomma, nachKomma]);
  }
  const worte = name.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (worte.length >= 2) {
    paare.push([worte[0], worte.slice(1).join(" ")]);
    if (worte.length > 2) paare.push([worte.slice(0, -1).join(" "), worte[worte.length - 1]]);
  }
  if (!paare.length) return json({ treffer: null }, 200, corsHeaders);

  const trainerdatenDoc = await readJson(PROVISION_ONLY_PATHS.trainerdaten, authHeader, { version: 1, trainer: [] });
  const liste = trainerdatenDoc.trainer || [];
  let td = null;
  for (const [a, b] of paare) {
    td = liste.find((t) => sameNamePair(t.vorname, t.nachname, a, b) &&
      (t.strasse || t.plz || t.ort || t.telefon || t.email)) || null;
    if (td) break;
  }
  if (!td) return json({ treffer: null }, 200, corsHeaders);

  return json({
    treffer: {
      strasse: td.strasse || "",
      plz: td.plz || "",
      ort: td.ort || "",
      telefon: td.telefon || "",
      email: td.email || ""
    }
  }, 200, corsHeaders);
}

// Ist dieser Nutzer "vertragspflichtig" (braucht einen Trainervertrag/Trainerdaten)?
// Gruppe "Trainer" ODER individuelles vertragBenoetigt-Flag (z.B. Helfer/Betreuer ohne
// Trainer-Rolle) -- gleiche Definition wie vertragspflichtigeUsernames weiter unten in
// handleGetAdminStats, hier als gemeinsamer Helfer für EINEN einzelnen Nutzer (siehe
// handleMyTrainerdatenStatus). Bewusst OHNE archiviert-Filter (anders als dort): ein
// archiviertes/gesperrtes Konto kommt über getVerifiedSession ohnehin nicht mehr hierher.
function isVertragspflichtig(usersDoc, username) {
  const trainerGroup = Object.values((usersDoc && usersDoc.groups) || {}).find((g) => g.name === TRAINER_GROUP_NAME) || null;
  const inTrainerGroup = !!(trainerGroup && (trainerGroup.memberUsernames || []).includes(username));
  const user = getOwn(usersDoc && usersDoc.users, username);
  return inTrainerGroup || !!(user && user.vertragBenoetigt);
}

// Status-Badge auf der Trainerdaten-Kachel (Dashboard) -- bewusst wie
// list-birthdays-today/list-trainer-profiles für JEDEN eingeloggten Nutzer
// offen (nur der eigene Datensatz, kein Admin-Gate wie mayViewPersonalakte).
// trainerdatenGesamtOk ist die einzige Ampel-Bedingung, serverseitig berechnet,
// damit die Logik nicht im Client dupliziert wird. null (nicht false), wenn WEDER
// ein Trainerdaten-Datensatz existiert NOCH die Person vertragspflichtig ist -- die
// Kachel zeigt dann bewusst KEIN rotes Kreuz ("bin gar kein Trainer"), sondern gar
// kein Badge. Ist die Person vertragspflichtig, aber es existiert (noch) gar kein
// Datensatz, zeigt die Kachel trotzdem ein rotes Kreuz ("Daten unvollständig") statt
// gar nichts -- Michel-Feedback 2026-07-14: "nicht vollständig sollte auch angezeigt
// werden", nicht nur stillschweigend fehlen.
// Seit 2026-07-17 zweistufig: für NICHT-Vertragspflichtige (die in Trainerdaten nur
// noch Kontaktdaten sehen) ist die Ampel allein "E-Mail hinterlegt". Das mitgelieferte
// vertragspflichtig-Flag sagt dem Dashboard, welche der beiden Ampeln es anzeigt.
async function handleMyTrainerdatenStatus(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  const user = getOwn(session.usersDoc.users, session.username);
  const trainerdatenDoc = await readJson(PROVISION_ONLY_PATHS.trainerdaten, authHeader, { version: 1, trainer: [] });
  const td = findTrainerdatenRecord(trainerdatenDoc, user);
  const summary = buildTrainerdatenSummary(td);

  // trainerlizenzGueltigBis ist ein reines "yyyy-mm-dd"-Datum (Kalendertag), kein
  // Zeitpunkt -- ein new Date(...)-Momentvergleich würde es ab Mitternacht UTC als
  // abgelaufen werten, obwohl die App selbst (_dateOnlyIsPast, String-Vergleich)
  // "gültig bis heute" noch den ganzen Tag über als gültig zeigt (Bug live erlebt:
  // Michel setzte testweise "gültig bis heute", App zeigte grün, Badge trotzdem rot).
  // String-Vergleich gegen "heute" in Europe/Berlin, gleiche Technik wie
  // handleListBirthdaysToday, hält Client und Server konsistent.
  const heuteBerlin = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const lizenzOk = summary.trainerlizenzNichtVorhanden === true || !!(
    summary.trainerlizenzHochgeladenAm &&
    (!summary.trainerlizenzGueltigBis || summary.trainerlizenzGueltigBis >= heuteBerlin)
  );
  const vertragspflichtig = isVertragspflichtig(session.usersDoc, session.username);
  const zeigeBadge = summary.vorhanden || vertragspflichtig;

  // Zwei Ampeln, weil es zwei Populationen gibt (seit 2026-07-17): Wer keinen
  // Trainervertrag braucht (Geschäftsführung o.ä.), sieht in Trainerdaten gar keine
  // Bankverbindung/Unterschrift/Dokumente mehr und kann die volle Bedingung deshalb
  // NIE erfüllen -- er bekäme dauerhaft ein rotes Kreuz für etwas, das er weder sieht
  // noch soll. Für ihn zählt allein die E-Mail: der einzige Grund, warum er das
  // Formular überhaupt ausfüllt (Kontaktaufnahme), und clientseitig sein einziges
  // zusätzliches Pflichtfeld -- Anzeige und Ampel bleiben so deckungsgleich, siehe
  // [[feedback-status-fallback-parity]].
  let trainerdatenGesamtOk;
  if (!zeigeBadge) {
    trainerdatenGesamtOk = null;
  } else if (!vertragspflichtig) {
    trainerdatenGesamtOk = !!summary.email;
  } else {
    trainerdatenGesamtOk = !!(
      summary.unterschriftAm &&
      lizenzOk &&
      summary.fuehrerscheinGueltig === true &&
      summary.fuehrungszeugnisEingereichtAm &&
      summary.kodexGueltig === true &&
      summary.jugendschutzGueltig === true
    );
  }

  return json({ ...summary, trainerdatenGesamtOk, vertragspflichtig }, 200, corsHeaders);
}

// E-Mail-Benachrichtigung an einen anderen Nutzer, siehe Doku-Kommentar bei
// "notify-user" oben. Adresse wird HIER serverseitig aufgelöst (nie vom Client
// entgegengenommen) -- PROVISION_ONLY_PATHS.trainerdaten darf laut Kommentar dort
// nie direkt an eingeloggte Nutzer durchgereicht werden, deshalb wird aus dem
// vollen buildTrainerdatenSummary()-Ergebnis ausschließlich das email-Feld
// verwendet und auch in der Antwort nie zurückgegeben.
async function handleNotifyUser(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const username = normalizeUsername(String(body.username || ""));
  const subject = String(body.subject || "").trim().slice(0, 200);
  const message = String(body.message || "").trim().slice(0, 4000);
  if (!username || !subject || !message) {
    return json({ error: "Ungültige Daten" }, 400, corsHeaders);
  }

  const targetUser = getOwn(session.usersDoc.users, username);
  if (!targetUser) return json({ ok: true, sent: false }, 200, corsHeaders);

  const trainerdatenDoc = await readJson(PROVISION_ONLY_PATHS.trainerdaten, authHeader, { version: 1, trainer: [] });
  const td = findTrainerdatenRecord(trainerdatenDoc, targetUser);
  const email = buildTrainerdatenSummary(td).email;
  if (!email) return json({ ok: true, sent: false }, 200, corsHeaders);

  if (!env.BREVO_API_KEY) {
    return json({ error: "E-Mail-Versand ist serverseitig noch nicht konfiguriert." }, 500, corsHeaders);
  }

  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": env.BREVO_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        sender: { email: NOTIFY_FROM_EMAIL, name: NOTIFY_FROM_NAME },
        to: [{ email }],
        subject,
        textContent: message
      })
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error("Brevo-Versand fehlgeschlagen", resp.status, errText);
      return json({ error: "Mail-Versand fehlgeschlagen (HTTP " + resp.status + ")" }, 502, corsHeaders);
    }
  } catch (e) {
    return json({ error: "Mail-Versand fehlgeschlagen: " + e.message }, 502, corsHeaders);
  }

  return json({ ok: true, sent: true }, 200, corsHeaders);
}

// Lädt eine ausgelagerte TrainerCheckliste-Unterschrift (dateien/<fileId> der App,
// seit TrainerCheckliste 1.2 eigene PNG-Dateien statt inline-DataURL in der JSON)
// und liefert sie als PNG-DataURL — "" bei fehlender Datei/Fehler.
const CHECKLIST_SIG_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function loadChecklistSignaturDataUrl(fileId, authHeader) {
  if (typeof fileId !== "string" || !CHECKLIST_SIG_FILE_RE.test(fileId)) return "";
  const jsonUrl = DAV_APPS.trainercheckliste;
  const fileUrl = jsonUrl.slice(0, jsonUrl.lastIndexOf("/")) + "/dateien/" + fileId;
  try {
    const resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
    if (!resp.ok) return "";
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (!buf.length) return "";
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return "data:image/png;base64," + btoa(bin);
  } catch (_) { return ""; }
}

// Hängt die (ausgelagerten) Unterschriften einer Checklisten-Sektion wieder inline an
// die Antwort — nur für den EIGENEN Eintrag (kein Größenproblem), gleiche Idee wie
// handleMySubmission in Trainerdatens submit-worker. Alt-Einträge mit noch inline
// gespeicherter Unterschrift bleiben unberührt (out-Feld ist dann schon belegt).
async function attachChecklistSignaturen(out, rohSection, authHeader) {
  const s = rohSection || {};
  if (!out.unterschriftTrainer && s.unterschriftTrainerFileId) {
    out.unterschriftTrainer = await loadChecklistSignaturDataUrl(s.unterschriftTrainerFileId, authHeader);
  }
  if (!out.unterschriftFunktionaer && s.unterschriftFunktionaerFileId) {
    out.unterschriftFunktionaer = await loadChecklistSignaturDataUrl(s.unterschriftFunktionaerFileId, authHeader);
  }
}

// Trainer-Selbstbedienungs-Pendant zum Admin-only "TrainerCheckliste-Status"-Feld
// in Trainerdaten (dort per Admin-WebDAV gelesen, siehe TRAINERCHECKLISTE_WEBDAV_URL
// in Trainerdatens config.js) — dieselbe Quelle (DAV_APPS.trainercheckliste), aber
// serverseitig auf den EIGENEN Eintrag verengt, da der Trainer keinen WebDAV-Zugriff
// hat und das volle trainerEintraege-Array Namen/Adressen/Unterschriften ALLER
// anderen Trainer enthält (Minimal-Disclosure, wie list-birthdays-today).
async function handleMyTrainerchecklisteStatus(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  const user = getOwn(session.usersDoc.users, session.username);
  const checklisteDoc = await readJson(DAV_APPS.trainercheckliste, authHeader, { trainerEintraege: [] });
  // Gleiche Match-Konvention wie handlePersonalakteOverview: linkedUsername (falls
  // je gesetzt) vor Namensfallback; TrainerCheckliste kennt aktuell kein
  // linkedUsername-Feld, der Zweig ist also Zukunftsvorsorge, kein toter Code-Pfad.
  const eintrag = (checklisteDoc.trainerEintraege || []).find((e) =>
    (e.linkedUsername && sameText(e.linkedUsername, session.username)) ||
    sameNamePair(e.vorname, e.name, user.vorname, user.nachname));
  if (!eintrag) return json({ vorhanden: false }, 200, corsHeaders);

  const sectionOut = (s) => {
    s = s || {};
    return {
      abgeschlossen: !!s.abgeschlossen,
      nichtAbgeschlossen: !!s.nichtAbgeschlossen,
      nichtAbgeschlossenGrund: s.nichtAbgeschlossenGrund || "",
      headerChecked: !!s.headerChecked,
      headerDatum: s.headerDatum || null,
      ort: s.ort || "",
      datum: s.datum || null,
      bemerkungen: s.bemerkungen || "",
      items: (s.items && typeof s.items === "object") ? s.items : {},
      itemTexts: (s.itemTexts && typeof s.itemTexts === "object") ? s.itemTexts : {},
      unterschriftTrainer: s.unterschriftTrainer || "",
      unterschriftFunktionaer: s.unterschriftFunktionaer || ""
    };
  };

  const zugang = sectionOut(eintrag.zugang);
  const abgang = sectionOut(eintrag.abgang);
  // Ausgelagerte Unterschriften (FileId statt inline) für die Anzeige in
  // Trainerdatens "Meine Checkliste" wieder inline anhängen.
  await attachChecklistSignaturen(zugang, eintrag.zugang, authHeader);
  await attachChecklistSignaturen(abgang, eintrag.abgang, authHeader);

  return json({ vorhanden: true, zugang, abgang }, 200, corsHeaders);
}

// Badge auf der Testspielplaner-Kachel (Dashboard): Anzahl EIGENER genehmigter
// Reservierungen ohne Gegner in den nächsten 14 Tagen ("Gegner eintragen oder
// Platz freigeben"). Logik muss anstehendeOhneGegner() in
// E:\testspielplaner\app.js spiegeln (ISO-Stringvergleich, Europe/Berlin wie
// handleListBirthdaysToday), sonst widersprechen sich Badge und In-App-Banner.
async function handleMyTestspielplanerStatus(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  const doc = await readJson(DAV_APPS.testspielplaner, authHeader, { reservierungen: [] });
  const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const grenze = new Date(Date.now() + 14 * 86400000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const anstehendOhneGegner = (Array.isArray(doc.reservierungen) ? doc.reservierungen : []).filter((r) =>
    r.erstelltVon === session.username && r.status === "genehmigt" &&
    !((r.gegner || "").trim()) && (r.datum || "") >= heute && (r.datum || "") <= grenze
  ).length;
  return json({ anstehendOhneGegner }, 200, corsHeaders);
}

async function handleUpdateGroupMembers(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const groupId = String(body.groupId || "");
  const usersDoc = session.usersDoc;
  const group = getOwn(usersDoc.groups || {}, groupId);
  if (!group) return json({ error: "Unbekannte Gruppe" }, 404, corsHeaders);

  const previous = Array.isArray(group.memberUsernames) ? group.memberUsernames.slice() : [];
  const requested = Array.isArray(body.memberUsernames) ? body.memberUsernames.map(normalizeUsername) : [];
  group.memberUsernames = requested.filter((u) => getOwn(usersDoc.users, u));

  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  // Auto-Provisioning für NEU hinzugekommene Mitglieder (best effort).
  let provisioned = {};
  try {
    const added = group.memberUsernames.filter((u) => !previous.includes(u));
    if (added.length) {
      const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
      const apps = provisionAppsForGroups(config, [groupId]);
      const members = added.map((u) => getOwn(usersDoc.users, u)).filter(Boolean);
      if (apps.length && members.length) provisioned = await provisionUsers(members, apps, env, authHeader);
    }
  } catch (_) { /* Provisioning ist best effort */ }

  return json({ group, provisioned }, 200, corsHeaders);
}

// Provisioniert nachträglich ALLE aktuellen Mitglieder einer Gruppe in die für diese
// Gruppe konfigurierten Tools (Button "Bestehende Mitglieder jetzt eintragen").
// Batch pro App (1 Read + 1 Write), idempotent — bereits vorhandene Einträge bleiben.
async function handleProvisionGroup(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const groupId = String(body.groupId || "");
  const usersDoc = session.usersDoc;
  const group = getOwn(usersDoc.groups || {}, groupId);
  if (!group) return json({ error: "Unbekannte Gruppe" }, 404, corsHeaders);

  const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
  const apps = provisionAppsForGroups(config, [groupId]);
  const members = (group.memberUsernames || [])
    .map((u) => getOwn(usersDoc.users, u))
    .filter(Boolean);

  let provisioned = {};
  if (apps.length && members.length) {
    provisioned = await provisionUsers(members, apps, env, authHeader);
  }
  return json({ provisioned, apps, memberCount: members.length }, 200, corsHeaders);
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
      if (Array.isArray(entry.adminGroupIds) && entry.adminGroupIds.includes(groupId)) {
        entry.adminGroupIds = entry.adminGroupIds.filter((id) => id !== groupId);
        changed = true;
      }
      if (Array.isArray(entry.provisionGroupIds) && entry.provisionGroupIds.includes(groupId)) {
        entry.provisionGroupIds = entry.provisionGroupIds.filter((id) => id !== groupId);
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

// ---------- Aktionen: Materialcontainer-Code ----------

// Der Zahlencode des Schlosses am Materialcontainer. Bewusst eine EIGENE, schmale
// Aktion statt eines Feldes in "me" oder im öffentlichen Config-GET: der Code
// öffnet ein echtes Schloss vor Ort, er soll nur dort über die Leitung gehen, wo
// ihn jemand ausdrücklich sehen will (siehe auch die Trennung bei
// dav-restricted-*). Aus demselben Grund steht er NICHT im GET, den jeder
// unangemeldete Besucher der Landingpage abruft.
//
// Sichtbar für eingeloggtes Personal, NICHT für Spielerkonten: "keine Gruppe =
// alle eingeloggten" gilt für Spieler nirgends in diesem Worker, und bei ~200
// Spielerkonten wäre ein Containercode für alle das Gegenteil eines Schlosses.
async function handleGetMaterialcontainerCode(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  if (session.art === USER_ART_SPIELER) {
    return json({ error: "Kein Zugriff auf den Materialcontainer-Code" }, 403, corsHeaders);
  }
  const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
  const mc = (config.materialcontainer && typeof config.materialcontainer === "object")
    ? config.materialcontainer : {};
  return json({
    code: typeof mc.code === "string" ? mc.code : "",
    hinweis: typeof mc.hinweis === "string" ? mc.hinweis : "",
    geaendertAm: mc.geaendertAm || null,
    geaendertVon: mc.geaendertVon || null
  }, 200, corsHeaders);
}

// Admin setzt den Code (einmal im Monat von Hand). Read-modify-write wie
// handleSaveVisibility, damit tools/news nicht verloren gehen. Ein leerer Code
// ist erlaubt und heißt "noch keiner hinterlegt" -- so lässt sich der Eintrag
// auch wieder leeren, ohne dass ein alter Code stehen bleibt.
async function handleSetMaterialcontainerCode(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const code = String(body.code == null ? "" : body.code).trim().slice(0, 60);
  const hinweis = String(body.hinweis == null ? "" : body.hinweis).trim().slice(0, 200);

  const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
  config.version = config.version || 1;
  config.materialcontainer = {
    code,
    hinweis,
    geaendertAm: new Date().toISOString(),
    geaendertVon: session.username
  };
  try {
    await writeJson(env.NEXTCLOUD_URL, authHeader, config);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }
  return json({ ok: true, ...config.materialcontainer }, 200, corsHeaders);
}

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

// ---------- Aktionen: Feedback & Hilfe ----------

const FEEDBACK_VALID_TYPES = ["feedback", "wunsch"];

// Jeder eingeloggte Nutzer darf EINEN Eintrag anlegen (kein Admin-Gate) — anders als
// save-feedback nimmt diese Aktion nie ein ganzes Array vom Client entgegen, sondern
// baut genau einen Eintrag serverseitig zusammen. So kann ein Nutzer weder fremde
// Einträge überschreiben/löschen noch unter fremdem Namen einreichen.
async function handleSubmitFeedback(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const text = String(body.text || "").trim().slice(0, 2000);
  if (!text) return json({ error: "Text darf nicht leer sein" }, 400, corsHeaders);
  const type = FEEDBACK_VALID_TYPES.includes(String(body.type)) ? String(body.type) : "feedback";
  const toolId = String(body.toolId || "").trim().slice(0, 60);

  const user = getOwn(session.usersDoc.users, session.username) || {};
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    type,
    text,
    username: session.username,
    vorname: user.vorname || null,
    nachname: user.nachname || null,
    createdAt: new Date().toISOString(),
    done: false
  };
  if (toolId) entry.toolId = toolId;

  const doc = await readJson(FEEDBACK_URL, authHeader, { version: 1, entries: [] });
  doc.version = doc.version || 1;
  doc.entries = Array.isArray(doc.entries) ? doc.entries : [];
  doc.entries.push(entry);
  if (doc.entries.length > 500) doc.entries = doc.entries.slice(doc.entries.length - 500);

  try {
    await writeJson(FEEDBACK_URL, authHeader, doc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ ok: true }, 200, corsHeaders);
}

async function handleListFeedback(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const doc = await readJson(FEEDBACK_URL, authHeader, { version: 1, entries: [] });
  return json({ entries: Array.isArray(doc.entries) ? doc.entries : [] }, 200, corsHeaders);
}

// Admin-only, kompletter Array-Ersatz (wie save-news) — Client schickt den lokal
// mutierten Stand (done getoggelt bzw. Eintrag entfernt) komplett zurück. Jeder
// Eintrag wird serverseitig neu zusammengebaut/validiert, kein Feld ungeprüft
// übernommen.
async function handleSaveFeedback(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  if (!Array.isArray(body.entries)) {
    return json({ error: "Ungültige Daten" }, 400, corsHeaders);
  }

  const clean = [];
  for (const f of body.entries.slice(0, 500)) {
    if (!f || typeof f !== "object") continue;
    const text = String(f.text || "").trim().slice(0, 2000);
    if (!text) continue; // Text ist Pflicht
    const item = {
      id: /^[a-z0-9-]{1,40}$/i.test(String(f.id || "")) ? String(f.id) : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
      type: FEEDBACK_VALID_TYPES.includes(String(f.type)) ? String(f.type) : "feedback",
      text,
      username: String(f.username || "").trim().slice(0, 32) || null,
      vorname: f.vorname ? String(f.vorname).trim().slice(0, 100) : null,
      nachname: f.nachname ? String(f.nachname).trim().slice(0, 100) : null,
      createdAt: /^\d{4}-\d{2}-\d{2}T/.test(String(f.createdAt || "")) ? String(f.createdAt) : new Date().toISOString(),
      done: !!f.done
    };
    const toolId = String(f.toolId || "").trim().slice(0, 60);
    if (toolId) item.toolId = toolId;
    clean.push(item);
  }

  const doc = { version: 1, entries: clean };
  try {
    await writeJson(FEEDBACK_URL, authHeader, doc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  return json({ entries: doc.entries }, 200, corsHeaders);
}

// ---------- Aktionen: Admin-Dashboard-Statistik ----------

// Liefert sechs Kennzahlen für die Admin-Dashboard-Kachel, alle serverseitig
// aus bereits bestehenden Datenquellen berechnet (kein neues Speicherformat).
// Trainervertrag-/Trainerkodex-Quote beziehen sich auf die Mitglieder der
// Gruppe TRAINER_GROUP_NAME — existiert die Gruppe noch nicht, liefert diese
// Aktion trainerGroup.exists:false statt einer irreführenden 0-von-0-Quote.
async function handleGetAdminStats(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session || !session.isAdmin) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const usersDoc = session.usersDoc;
  // Alle Quoten dieser Statistik (Vertrag, Kodex, Jugendschutz, Passwort gesetzt)
  // meinen Personal -- ein Spieler zieht sie sonst dauerhaft nach unten, ohne dass
  // es je etwas zu erfüllen gäbe. Spieler bekommen ihre eigene, schlichte Zahl.
  const alleUsers = Object.values(usersDoc.users);
  const users = alleUsers.filter(istPersonal);
  const usersTotal = users.length;
  const usersPasswordSet = users.filter((u) => u.mustSetPassword === false).length;
  const spielerAlle = alleUsers.filter((u) => !istPersonal(u));
  const spielerTotal = spielerAlle.length;
  const spielerPasswordSet = spielerAlle.filter((u) => u.mustSetPassword === false).length;

  const trainerGroup = Object.values(usersDoc.groups || {}).find((g) => g.name === TRAINER_GROUP_NAME) || null;
  // Archivierte Trainer (Personalakte) werden hier ausgeklammert: sie reichen
  // per Definition nie wieder Trainerdaten ein/bestätigen nie wieder den Kodex
  // und würden die beiden Quoten sonst dauerhaft künstlich nach unten ziehen.
  const trainerUsernames = trainerGroup
    ? (trainerGroup.memberUsernames || []).filter((uname) => {
        const u = getOwn(usersDoc.users, uname);
        return !(u && u.archiviert);
      })
    : [];

  // Trainervertrag ist NICHT auf Mitglieder der Gruppe "Trainer" beschränkt --
  // manche Nutzer (z.B. Helfer/Betreuer) sind keine Trainer im engeren Sinn,
  // brauchen aber trotzdem einen Vertrag (User-Entscheidung 2026-07-12, siehe
  // vertragBenoetigt-Feld/Checkbox in der Nutzerverwaltung). Trainerkodex
  // bleibt bewusst auf trainerUsernames/Gruppe Trainer beschränkt.
  const vertragspflichtigeUsernames = Array.from(new Set([
    ...trainerUsernames,
    ...users.filter((u) => u.vertragBenoetigt && !u.archiviert).map((u) => u.username)
  ]));

  // trainerkodexDoc/DAV_APPS.trainerkodex seit 1.6 nicht mehr nötig -- Trainerkodex
  // ist Teil von Trainerdaten geworden (siehe [[project-trainerkodex]]), die Quote
  // unten liest jetzt aus trainerdatenByUsername statt einem eigenen Lookup.
  const [feedbackDoc, trainerdatenDoc, materialbedarfDoc, busplanDoc, testspielplanerDoc] = await Promise.all([
    readJson(FEEDBACK_URL, authHeader, { version: 1, entries: [] }),
    readJson(PROVISION_ONLY_PATHS.trainerdaten, authHeader, { version: 1, trainer: [] }),
    readJson(DAV_APPS.materialbedarf, authHeader, { meldungen: [] }),
    readJson(DAV_APPS.busplan, authHeader, { meta: {}, seasons: {} }),
    readJson(DAV_APPS.testspielplaner, authHeader, { reservierungen: [] })
  ]);

  const trainerdatenByUsername = new Map();
  (Array.isArray(trainerdatenDoc.trainer) ? trainerdatenDoc.trainer : []).forEach((t) => {
    if (t.username) trainerdatenByUsername.set(t.username, t);
  });

  // Trainervertrag-Status je Gruppenmitglied: seit dem admin-getriebenen
  // "generate-pdfs.ps1 -Zuweisen"-Stapel-Workflow kann ein Vertrag erstellt sein,
  // OHNE dass der Trainer sich je selbst eingeloggt/eingereicht hat — solche
  // Datensätze haben kein username-Feld und wurden von der reinen
  // trainerdatenByUsername-Map (unten nur noch für Trainerkodex gebraucht) nie
  // gefunden. Deshalb hier dieselbe namens-tolerante Match-Kaskade wie
  // buildTrainerRecord/Personalakte (findTrainerdatenRecord) plus dieselbe
  // Status-Ableitung wie Trainerdatens eigene _trainerStatus()/statusLabel
  // (buildTrainerdatenSummary liefert exakt "unvollstaendig"|"ausstehend"|"generiert").
  const trainervertragStatusCounts = { unvollstaendig: 0, ausstehend: 0, generiert: 0 };
  vertragspflichtigeUsernames.forEach((uname) => {
    const user = getOwn(usersDoc.users, uname);
    const record = findTrainerdatenRecord(trainerdatenDoc, user);
    const status = buildTrainerdatenSummary(record).status;
    trainervertragStatusCounts[status] = (trainervertragStatusCounts[status] || 0) + 1;
  });

  // Trainerkodex + Jugendschutzkonzept: bestätigt sich der Trainer ausschließlich
  // selbst im eigenen Login-Bereich (kein Admin-Batch-Äquivalent wie beim Vertrag
  // oben) — ein Datensatz ohne username kann daher nie kodex-/jugendschutzBestaetigtAm
  // tragen, die einfachere username-Map genügt hier weiterhin. Beide Quoten zählen
  // (wie schon der Kodex) reines "jemals bestätigt", nicht die 6-Monats-Gültigkeit.
  const trainerkodexBestaetigt = trainerUsernames.filter((uname) => {
    const t = trainerdatenByUsername.get(uname);
    return !!(t && t.kodexBestaetigtAm);
  }).length;
  const jugendschutzBestaetigt = trainerUsernames.filter((uname) => {
    const t = trainerdatenByUsername.get(uname);
    return !!(t && t.jugendschutzBestaetigtAm);
  }).length;

  const meldungen = Array.isArray(materialbedarfDoc.meldungen) ? materialbedarfDoc.meldungen : [];
  const materialbedarfOffen = meldungen.filter((m) => m.status === "offen").length;

  // Testspielplaner: Anfragen, die auf eine Admin-Entscheidung warten.
  const tspReservierungen = Array.isArray(testspielplanerDoc.reservierungen) ? testspielplanerDoc.reservierungen : [];
  const testspielplanerAngefragt = tspReservierungen.filter((r) => r.status === "angefragt").length;

  // "Zuletzt aktiv"-Listen für das Dropdown im Admin-Dashboard — dieselben
  // bereits geladenen Datenquellen, nur nach Datum sortiert statt gezählt.
  // trainervertragEingereichtAm() spiegelt E:\Trainerdaten\app.js::_eingereichtAm
  // (unterschriftAm seit 1.5, davor nur erstelltAm als Näherung). signaturVorhanden ist
  // das Flag seit dem Auslagern der Unterschriften aus der JSON; signatureDataUrl bleibt
  // als Fallback für noch nicht migrierte Alt-Einträge (deploy-reihenfolge-unabhängig).
  const trainervertragEingereichtAm = (t) => t.unterschriftAm || ((t.signaturVorhanden || t.signatureDataUrl) ? t.erstelltAm : null);
  const topRecent = (entries, limit) => entries
    .filter((e) => e.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, limit)
    .map((e) => {
      const u = getOwn(usersDoc.users, e.username);
      return { username: e.username, vorname: (u && u.vorname) || "", nachname: (u && u.nachname) || "", at: e.at };
    });

  const recentLogins = topRecent(users.map((u) => ({ username: u.username, at: u.lastLoginAt })), 5);
  const recentTrainervertrag = topRecent(vertragspflichtigeUsernames.map((uname) => ({
    username: uname, at: trainerdatenByUsername.has(uname) ? trainervertragEingereichtAm(trainerdatenByUsername.get(uname)) : null
  })), 5);
  const recentTrainerkodex = topRecent(trainerUsernames.map((uname) => ({
    username: uname, at: trainerdatenByUsername.has(uname) ? trainerdatenByUsername.get(uname).kodexBestaetigtAm : null
  })), 5);
  const recentJugendschutz = topRecent(trainerUsernames.map((uname) => ({
    username: uname, at: trainerdatenByUsername.has(uname) ? trainerdatenByUsername.get(uname).jugendschutzBestaetigtAm : null
  })), 5);

  const feedbackEntries = Array.isArray(feedbackDoc.entries) ? feedbackDoc.entries : [];
  const feedbackOffen = feedbackEntries.filter((f) => !f.done).length;

  // Busplan: nur aktuelle Saison zählen (wie E:\Busplan\app.js, Anzeige der
  // Übersicht) — offene/klärungsbedürftige Zusagen über alle Mannschaften,
  // Spiele und deren Bus-Optionen.
  const currentSeasonKey = busplanDoc.meta && busplanDoc.meta.currentSeason;
  const season = currentSeasonKey ? (busplanDoc.seasons || {})[currentSeasonKey] : null;
  let busplanOffen = 0;
  if (season && Array.isArray(season.teams)) {
    season.teams.forEach((t) => {
      const busOptionIds = Array.isArray(t.busOptionIds) ? t.busOptionIds : [];
      (t.spiele || []).forEach((sp) => {
        busOptionIds.forEach((oid) => {
          const wert = (sp.status && sp.status[oid]) ? sp.status[oid].wert : "";
          if (wert === "offen" || wert === "klaerung") busplanOffen++;
        });
      });
    });
  }

  return json({
    // users zählt ab sofort nur noch Personal. Solange keine Spielerkonten
    // existieren (spieler.total === 0), sind das exakt dieselben Zahlen wie vorher --
    // die Kachel im Admin-UI ändert sich also erst, wenn es wirklich Spieler gibt.
    users: { total: usersTotal, passwordSet: usersPasswordSet },
    spieler: { total: spielerTotal, passwordSet: spielerPasswordSet },
    trainerGroup: { exists: !!trainerGroup, memberCount: trainerUsernames.length },
    trainervertrag: {
      total: vertragspflichtigeUsernames.length,
      generiert: trainervertragStatusCounts.generiert,
      ausstehend: trainervertragStatusCounts.ausstehend,
      unvollstaendig: trainervertragStatusCounts.unvollstaendig
    },
    trainerkodex: { confirmed: trainerkodexBestaetigt, total: trainerUsernames.length },
    jugendschutz: { confirmed: jugendschutzBestaetigt, total: trainerUsernames.length },
    feedbackOpen: feedbackOffen,
    materialbedarfOpen: materialbedarfOffen,
    busplanOpen: busplanOffen,
    testspielplanerAngefragt,
    recentLogins,
    recentTrainervertrag,
    recentTrainerkodex,
    recentJugendschutz
  }, 200, corsHeaders);
}

// ---------- Aktionen: Personalakte ----------

// Baut EINEN zusammengeführten Trainer-Datensatz aus nutzer.json + sechs parallel
// gelesenen App-Dateien. Wird sowohl für die Übersicht (einmal je Mitglied der
// Trainer-Gruppe) als auch für archive-trainer (einmal, frisch, für genau eine
// Person) verwendet -- ein Join, zwei Aufrufer.
// Trainerdaten: gemeinsame Match-Kaskade, auch von handleMyTrainerdatenStatus
// (Status-Badge auf der Trainerdaten-Kachel) genutzt -- ein Ort für den Join.
// Match-Reihenfolge: echter username (reale Einreichung) > linkedUsername
// (Provisioning-Stub vor Erstlogin, siehe provisionTrainerdaten) > Namensfallback
// (sameNamePair reihenfolge-tolerant, gleicher Grund wie TrainerCheckliste).
function findTrainerdatenRecord(trainerdatenDoc, user) {
  if (!user) return null;
  const list = trainerdatenDoc.trainer || [];
  // Username-Treffer haben Vorrang ueber das GANZE Array, erst dann linkedUsername,
  // erst dann Namensabgleich -- exakt dieselbe Rangfolge wie die Schreibpfade
  // (submit-worker.js handleSubmit/resolveOwnTrainerRecord). Die fruehere einzelne
  // .find()-ODER-Kette nahm stattdessen den ERSTEN Record, der irgendein Kriterium
  // erfuellte: stand ein namensgleicher Import-Stub (ohne Dokumente/Unterschrift)
  // vor dem echten Datensatz, las die Ampel den Stub und blieb rot, obwohl der
  // Trainer auf seinem echten Datensatz alles erfuellt hatte.
  return list.find((t) => t.username && t.username === user.username) ||
         list.find((t) => t.linkedUsername && sameText(t.linkedUsername, user.username)) ||
         list.find((t) => sameNamePair(t.vorname, t.nachname, user.vorname, user.nachname)) ||
         null;
}

// Status/Verlaufsfelder plus seit 2026-07-08 zusaetzlich Geburtsdatum/Adresse/
// Telefon/E-Mail (expliziter User-Wunsch, damit die Personalakte diese
// Basisdaten zeigen kann) -- IBAN/Bankverbindung bleiben weiterhin
// ausgeschlossen, dafuer gibt es PROVISION_ONLY_PATHS ueberhaupt.
// trainerlizenzHochgeladenAm: reiner Status wie fuehrungszeugnisEingereichtAm.
// trainerlizenzNichtVorhanden/Art/GueltigBis: seit 2026-07-09, vorher fehlten
// diese drei hier (Lücke, u.a. Personalaktes Lizenzanzeige betreffend).
// Führerschein-Gültigkeit seit 1.1 hier statt in Fahrtenbuch berechnet (Feature
// dorthin migriert, siehe [[project-trainerdaten]]) -- gleiche Formel wie vorher
// (hochgeladenAm + 6 Monate). Führungszeugnis hat bewusst keine Ablauflogik (v1).
// kodexBestaetigtAm/kodexSignatureDataUrl/kodexVersion (seit 1.6): Trainerkodex ist
// in Trainerdaten aufgegangen (siehe [[project-trainerkodex]]), gleiche 6-Monats-
// Ablauflogik wie beim Führerschein, aber unabhängig davon berechnet.
// jugendschutzBestaetigtAm/jugendschutzSignatureDataUrl/jugendschutzVersion (seit
// Trainerdaten 1.7): Kinder- und Jugendschutzkonzept, eigenständiges Dokument neben
// dem Kodex, gleiche 6-Monats-Ablauflogik, unabhängig davon berechnet.
function buildTrainerdatenSummary(td) {
  let fuehrerscheinGueltigBis = null, fuehrerscheinGueltig = null;
  if (td && td.fuehrerscheinHochgeladenAm) {
    const faellig = new Date(td.fuehrerscheinHochgeladenAm);
    faellig.setMonth(faellig.getMonth() + 6);
    fuehrerscheinGueltigBis = faellig.toISOString();
    fuehrerscheinGueltig = faellig.getTime() > Date.now();
  }
  let kodexGueltigBis = null, kodexGueltig = null;
  if (td && td.kodexBestaetigtAm) {
    const faellig = new Date(td.kodexBestaetigtAm);
    faellig.setMonth(faellig.getMonth() + 6);
    kodexGueltigBis = faellig.toISOString();
    kodexGueltig = faellig.getTime() > Date.now();
  }
  let jugendschutzGueltigBis = null, jugendschutzGueltig = null;
  if (td && td.jugendschutzBestaetigtAm) {
    const faellig = new Date(td.jugendschutzBestaetigtAm);
    faellig.setMonth(faellig.getMonth() + 6);
    jugendschutzGueltigBis = faellig.toISOString();
    jugendschutzGueltig = faellig.getTime() > Date.now();
  }
  return td ? {
    vorhanden: true,
    trainerId: td.id || null,
    // Fallback wie _eingereichtAm() in Trainerdatens app.js: Einreichungen von vor
    // submit-worker 1.5 (2026-07-07) haben eine echte Signatur, aber noch kein
    // unterschriftAm-Feld -- ohne den Fallback blieb die Ampel fuer solche Trainer
    // dauerhaft rot, obwohl Admin-Liste/Detail (mit Fallback) "eingereicht" zeigen.
    unterschriftAm: td.unterschriftAm || ((td.signaturVorhanden || td.signatureDataUrl) ? td.erstelltAm : null) || null,
    erstelltAm: td.erstelltAm || null,
    vertragsGeneriert: !!td.vertragsGeneriert,
    // vertragPdfBereitgestelltAm/vertragUnterschriebenAm (seit Trainerdaten 1.10):
    // der digitale Signier-Workflow -- eigene Felder, getrennt vom alten Word-
    // Batch-Flag vertragsGeneriert. Ohne diese beiden hier zeigte Personalakte
    // "Vertrag ausstehend" auch fuer laengst digital unterschriebene Vertraege.
    vertragPdfBereitgestelltAm: td.vertragPdfBereitgestelltAm || null,
    vertragUnterschriebenAm: td.vertragUnterschriebenAm || null,
    // vertragUnterschriebenAm zaehlt hier wie vertragsGeneriert als "generiert" --
    // zwei gleichwertige Wege zum selben Ziel (unterschriebener Vertrag).
    status: td.status || ((td.vertragsGeneriert || td.vertragUnterschriebenAm) ? "generiert" : (td.username ? "ausstehend" : "unvollstaendig")),
    fuehrerscheinHochgeladenAm: td.fuehrerscheinHochgeladenAm || null,
    fuehrerscheinGueltigBis, fuehrerscheinGueltig,
    fuehrungszeugnisEingereichtAm: td.fuehrungszeugnisEingereichtAm || null,
    trainerlizenzHochgeladenAm: td.trainerlizenzHochgeladenAm || null,
    trainerlizenzNichtVorhanden: !!td.trainerlizenzNichtVorhanden,
    trainerlizenzArt: td.trainerlizenzArt || null,
    trainerlizenzGueltigBis: td.trainerlizenzGueltigBis || null,
    kodexBestaetigtAm: td.kodexBestaetigtAm || null,
    kodexSignatureDataUrl: td.kodexSignatureDataUrl || null,
    kodexVersion: td.kodexVersion || null,
    kodexGueltigBis, kodexGueltig,
    jugendschutzBestaetigtAm: td.jugendschutzBestaetigtAm || null,
    jugendschutzSignatureDataUrl: td.jugendschutzSignatureDataUrl || null,
    jugendschutzVersion: td.jugendschutzVersion || null,
    jugendschutzGueltigBis, jugendschutzGueltig,
    geburtsdatum: td.geburtsdatum || null,
    strasse: td.strasse || null,
    plz: td.plz || null,
    ort: td.ort || null,
    telefon: td.telefon || null,
    email: td.email || null
  } : {
    vorhanden: false, trainerId: null, unterschriftAm: null, erstelltAm: null, vertragsGeneriert: false,
    vertragPdfBereitgestelltAm: null, vertragUnterschriebenAm: null, status: "unvollstaendig",
    fuehrerscheinHochgeladenAm: null, fuehrerscheinGueltigBis: null, fuehrerscheinGueltig: null, fuehrungszeugnisEingereichtAm: null,
    trainerlizenzHochgeladenAm: null, trainerlizenzNichtVorhanden: false, trainerlizenzArt: null, trainerlizenzGueltigBis: null,
    kodexBestaetigtAm: null, kodexSignatureDataUrl: null, kodexVersion: null, kodexGueltigBis: null, kodexGueltig: null,
    jugendschutzBestaetigtAm: null, jugendschutzSignatureDataUrl: null, jugendschutzVersion: null, jugendschutzGueltigBis: null, jugendschutzGueltig: null,
    geburtsdatum: null, strasse: null, plz: null, ort: null, telefon: null, email: null
  };
}

function buildTrainerRecord(user, usersDoc, sources) {
  const { trainerdatenDoc, checklisteDoc, personalkostenDoc, kadermanagerDoc } = sources;
  const fullName = `${user.vorname || ""} ${user.nachname || ""}`.trim();
  const fullNameReversed = `${user.nachname || ""} ${user.vorname || ""}`.trim();

  const td = findTrainerdatenRecord(trainerdatenDoc, user);
  const trainerdaten = buildTrainerdatenSummary(td);

  // Trainerkodex: seit 1.6 Teil von Trainerdaten (siehe [[project-trainerkodex]]),
  // kein separates trainerkodexDoc/DAV_APPS.trainerkodex-Lookup mehr -- dieselbe
  // Ausgabeform wie vorher (bestaetigt/datum/kodexVersion), Personalakte braucht
  // dafür keine Client-Änderung.
  const trainerkodex = {
    bestaetigt: !!trainerdaten.kodexBestaetigtAm,
    datum: trainerdaten.kodexBestaetigtAm,
    kodexVersion: trainerdaten.kodexVersion
  };

  // TrainerCheckliste: exakt dieselbe Match-Konvention wie provisionTrainercheckliste
  // ("name" ist in dieser App das Nachname-Feld, nicht der volle Name). Namens-
  // Reihenfolge via sameNamePair toleriert (manuell angelegte Eintraege ohne
  // linkedUsername vertauschen Vorname/Nachname in der Praxis gelegentlich).
  const eintrag = (checklisteDoc.trainerEintraege || []).find((e) =>
    (e.linkedUsername && sameText(e.linkedUsername, user.username)) ||
    sameNamePair(e.vorname, e.name, user.vorname, user.nachname));
  const sectionSummary = (s) => s
    ? { abgeschlossen: !!s.abgeschlossen, datum: s.datum || s.headerDatum || null }
    : { abgeschlossen: false, datum: null };
  const trainercheckliste = {
    zugang: sectionSummary(eintrag && eintrag.zugang),
    abgang: sectionSummary(eintrag && eintrag.abgang)
  };

  // Personalkosten: aktuelle Saison, "name" ist dort der VOLLE Name (siehe
  // provisionPersonalkosten) -- Rohfelder, keine AE-Euro-Formel neu berechnen
  // (drittes Duplikat dieser Formel wäre ein Drift-Risiko, siehe Trainerdaten-
  // CLAUDE.md-Warnung zur selben Formel). fullNameReversed faengt vertauschte
  // Vorname/Nachname-Eingabe ab (gleicher Grund wie sameNamePair oben).
  let personalkosten = null;
  const pkSeasonKey = personalkostenDoc.meta && personalkostenDoc.meta.currentSeason;
  const pkSeason = pkSeasonKey ? (personalkostenDoc.seasons || {})[pkSeasonKey] : null;
  if (pkSeason && Array.isArray(pkSeason.trainer)) {
    const t = pkSeason.trainer.find((x) =>
      (x.linkedUsername && sameText(x.linkedUsername, user.username)) ||
      sameText(x.name, fullName) || sameText(x.name, fullNameReversed));
    if (t) {
      personalkosten = {
        mannschaft: t.mannschaft || "", position: t.position || "",
        stelle: t.stelle ?? null, manuellAE: t.manuellAE ?? null, besonderheit: t.besonderheit || ""
      };
    }
  }

  // Kadermanager: NUR linkedUsername (kein Namensfallback -- kein Praezedenzfall
  // in dieser App). Eine Person kann in mehreren Teams stehen.
  const kadermanager = [];
  (kadermanagerDoc.teams || []).forEach((team) => {
    (team.kader || []).forEach((s) => {
      if (s.linkedUsername && sameText(s.linkedUsername, user.username)) {
        kadermanager.push({
          team: team.name || "", position: s.position || "", nummer: s.nummer || "",
          rollen: Array.isArray(s.rollen) ? s.rollen : [],
          inaktiv: Array.isArray(s.rollen) && s.rollen.includes("inaktiv")
        });
      }
    });
  });

  return {
    username: user.username, vorname: user.vorname || "", nachname: user.nachname || "",
    lizenz: user.lizenz || "", mannschaften: Array.isArray(user.mannschaften) ? user.mannschaften : [],
    groupIds: getUserGroupIds(usersDoc, user.username),
    mustSetPassword: !!user.mustSetPassword, lastLoginAt: user.lastLoginAt || null,
    archiviert: !!user.archiviert, archiviertAm: user.archiviertAm || null,
    archiviertGrund: user.archiviertGrund || null, archiviertVon: user.archiviertVon || null,
    trainerkodex, trainerdaten, trainercheckliste, personalkosten, kadermanager
  };
}

async function loadPersonalakteSources(env, authHeader) {
  // trainerkodexDoc seit 1.6 nicht mehr nötig -- Trainerkodex ist Teil von
  // Trainerdaten geworden (siehe buildTrainerRecord), ein Lookup weniger.
  const [trainerdatenDoc, checklisteDoc, personalkostenDoc, kadermanagerDoc] = await Promise.all([
    readJson(PROVISION_ONLY_PATHS.trainerdaten, authHeader, { version: 1, trainer: [] }),
    readJson(DAV_APPS.trainercheckliste, authHeader, { trainerEintraege: [] }),
    readJson(DAV_APPS.personalkosten, authHeader, { meta: {}, seasons: {} }),
    readJson(DAV_APPS.kadermanager, authHeader, { meta: {}, teams: [] })
  ]);
  return { trainerdatenDoc, checklisteDoc, personalkostenDoc, kadermanagerDoc };
}

async function handlePersonalakteOverview(request, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  if (!(await mayViewPersonalakte(session, env, authHeader))) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);

  const usersDoc = session.usersDoc;
  const sources = await loadPersonalakteSources(env, authHeader);
  // Seit 1.3: alle Nutzerkonten, nicht mehr nur Mitglieder der Gruppe TRAINER_GROUP_NAME
  // (Wunsch: Personalakte soll wirklich jeden zeigen, nicht nur wer in der Trainer-Gruppe steckt).
  // "Jeden" meinte dabei jeden MITARBEITER -- damals war jeder Login Personal. Mit
  // Spielerkonten bekäme die Personalakte sonst 200 Karteileichen, jede dauerhaft rot
  // (kein Vertrag/Führungszeugnis/Kodex -- und bei Kindern auch nie).
  const trainers = Object.values(usersDoc.users || {})
    .filter(istPersonal)
    .map((user) => buildTrainerRecord(user, usersDoc, sources));

  return json({ trainerGroupExists: true, trainers }, 200, corsHeaders);
}

async function handleArchiveTrainer(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  if (!(await mayViewPersonalakte(session, env, authHeader))) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  if (!(await resolveEditPermission("personalakte", session, env, authHeader))) return json({ error: "Kein Bearbeiten-Recht für dieses Tool" }, 403, corsHeaders);

  const username = normalizeUsername(body.username);
  const usersDoc = session.usersDoc;
  const user = getOwn(usersDoc.users, username);
  if (!user) return json({ error: "Unbekannter Nutzer" }, 404, corsHeaders);
  if (user.archiviert) return json({ error: "Nutzer ist bereits archiviert" }, 409, corsHeaders);
  if (user.isAdmin) {
    const adminCount = Object.values(usersDoc.users).filter((u) => u.isAdmin).length;
    if (adminCount <= 1) return json({ error: "Letzter Admin kann nicht archiviert werden" }, 400, corsHeaders);
  }

  const sources = await loadPersonalakteSources(env, authHeader);
  const record = buildTrainerRecord(user, usersDoc, sources);
  const now = new Date().toISOString();
  const grund = String(body.grund || "").trim().slice(0, 500) || null;

  // Reihenfolge bewusst: Snapshot ZUERST schreiben. Schlaegt Schritt 2 fehl, ist
  // der Trainer noch nicht gesperrt (sicherer Fehlschlag), nicht gesperrt-ohne-
  // Datensatz.
  const { data: paDocRaw, rev } = await readJsonWithRev(DAV_APPS.personalakte, authHeader, { version: 1, archiv: [] });
  const paDoc = (paDocRaw && typeof paDocRaw === "object") ? paDocRaw : { version: 1, archiv: [] };
  if (!Array.isArray(paDoc.archiv)) paDoc.archiv = [];
  const idx = paDoc.archiv.findIndex((e) => e.username === username);
  const snapshotEntry = { username, archiviertAm: now, archiviertGrund: grund, archiviertVon: session.username, snapshot: record };
  if (idx === -1) paDoc.archiv.push(snapshotEntry); else paDoc.archiv[idx] = snapshotEntry;

  try {
    await writeJson(DAV_APPS.personalakte, authHeader, paDoc, rev || undefined);
  } catch (e) {
    return json({ error: "Snapshot konnte nicht gespeichert werden: " + e.message }, 502, corsHeaders);
  }

  user.archiviert = true;
  user.archiviertAm = now;
  user.archiviertGrund = grund;
  user.archiviertVon = session.username;
  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    // Snapshot ist bereits gespeichert (idempotent per username) -- ein Retry
    // von archive-trainer ist sicher, er ueberschreibt nur denselben Snapshot.
    return json({ error: "Snapshot gespeichert, aber Login-Sperre fehlgeschlagen: " + e.message }, 502, corsHeaders);
  }

  return json({ ok: true, username, archiviertAm: now }, 200, corsHeaders);
}

async function handleReactivateTrainer(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  if (!(await mayViewPersonalakte(session, env, authHeader))) return json({ error: "Nicht berechtigt" }, 403, corsHeaders);
  if (!(await resolveEditPermission("personalakte", session, env, authHeader))) return json({ error: "Kein Bearbeiten-Recht für dieses Tool" }, 403, corsHeaders);

  const username = normalizeUsername(body.username);
  const usersDoc = session.usersDoc;
  const user = getOwn(usersDoc.users, username);
  if (!user) return json({ error: "Unbekannter Nutzer" }, 404, corsHeaders);
  if (!user.archiviert) return json({ error: "Nutzer ist nicht archiviert" }, 409, corsHeaders);

  // Reihenfolge umgekehrt zu archive-trainer: hier zaehlt zuerst die
  // Login-Freigabe, die Snapshot-Annotation ist reine Historie/best effort.
  user.archiviert = false;
  user.archiviertAm = null;
  user.archiviertGrund = null;
  user.archiviertVon = null;
  try {
    await writeJson(env.NEXTCLOUD_NUTZER_URL, authHeader, usersDoc);
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  try {
    const { data: paDoc, rev } = await readJsonWithRev(DAV_APPS.personalakte, authHeader, { version: 1, archiv: [] });
    const entry = (paDoc && Array.isArray(paDoc.archiv)) ? paDoc.archiv.find((e) => e.username === username) : null;
    if (entry) {
      entry.reaktiviertAm = new Date().toISOString();
      entry.reaktiviertVon = session.username;
      await writeJson(DAV_APPS.personalakte, authHeader, paDoc, rev || undefined);
    }
  } catch (_e) {
    // best effort -- Login funktioniert bereits wieder, Historie ist nur Komfort
  }

  return json({ ok: true, username }, 200, corsHeaders);
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
  "budget-beleg-eingang": "PW_BUDGET_EINGANG_ZUGANG", // sc-heiligenstadt-beleg-upload-Worker: Zugriffscode für beleg-eingang.html (serverseitig delegiert)
  "fahrtenbuch-extern": "PW_FAHRTENBUCH_EXTERN" // extern.html: Vorab-Check am Code-Gate (die drei fahrtenbuch-extern-*-Aktionen prüfen zusätzlich selbst)
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

// ---------- Aktion: Benachrichtigung bei neuer Beleg-Einreichung ----------

// Ohne Intl gebaut: die Locale-Daten der Workers-Runtime sind nicht garantiert,
// und für "1234.5 -> 1.234,50 €" lohnt die Abhängigkeit ohnehin nicht.
function formatEuroBetrag(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(",", "."));
  if (!isFinite(n)) return "unbekannt";
  return n.toFixed(2).replace(".", ",") + " €";
}

function formatDatumDeutsch(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? m[3] + "." + m[2] + "." + m[1] : (iso || "unbekannt");
}

// Benachrichtigungsmail nach einer Beleg-Einreichung, siehe Doku-Kommentar bei
// "beleg-eingang-notify" oben. Aufruf kommt serverseitig vom Beleg-Upload-Worker,
// nicht aus dem Browser. Der Empfänger stammt IMMER aus NOTIFY_BELEG_EMAIL, nie
// aus dem Body — sonst wäre das ein offenes Mail-Relay für jeden, der den
// Zugriffscode kennt, und den kennen alle Helfer.
async function handleBelegEingangNotify(body, env, corsHeaders) {
  if (!env.PW_BUDGET_EINGANG_ZUGANG) {
    return json({ error: "Zugriffscode ist serverseitig nicht konfiguriert" }, 500, corsHeaders);
  }
  const codeOk = await staticPasswordEquals(String(body.code || ""), env.PW_BUDGET_EINGANG_ZUGANG);
  if (!codeOk) {
    // Bremse gegen Durchprobieren — die Aktion ist ohne Login erreichbar.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return json({ error: "Falscher Zugriffscode" }, 403, corsHeaders);
  }

  // Zeilenumbrüche raus: beide kommen aus einzeiligen Feldern, über den offenen
  // POST-Endpunkt ließen sich aber welche einschleusen und würden die Mail zerreißen.
  // note ist bewusst ausgenommen — das ist ein Textarea, dort sind Umbrüche gewollt.
  const einzeilig = (v, max) => capStr(v, max).replace(/[\r\n]+/g, " ");
  const name = einzeilig(body.name, 120);
  const desc = einzeilig(body.desc, 200);
  if (!name || !desc) return json({ error: "Name oder Beschreibung fehlt" }, 400, corsHeaders);
  const note = capStr(body.note, 1000);
  const betrag = formatEuroBetrag(body.amount);
  const datum = formatDatumDeutsch(capStr(body.date, 40));
  const fileCount = Math.min(99, Math.max(0, parseInt(body.fileCount, 10) || 0));

  // Fehlende Konfiguration hier bewusst als Erfolg mit sent:false melden statt als
  // Fehler: wenn diese Aktion läuft, liegt der Beleg bereits in Nextcloud. Eine
  // ausbleibende Mail darf die Einreichung nicht nachträglich kippen.
  const empfaenger = capStr(env.NOTIFY_BELEG_EMAIL, 200);
  if (!empfaenger) {
    console.warn("beleg-eingang-notify: NOTIFY_BELEG_EMAIL ist nicht gesetzt — keine Mail verschickt");
    return json({ ok: true, sent: false, reason: "NOTIFY_BELEG_EMAIL fehlt" }, 200, corsHeaders);
  }
  if (!env.BREVO_API_KEY) {
    console.warn("beleg-eingang-notify: BREVO_API_KEY ist nicht gesetzt — keine Mail verschickt");
    return json({ ok: true, sent: false, reason: "BREVO_API_KEY fehlt" }, 200, corsHeaders);
  }

  // Zeilenumbrüche aus dem Betreff werfen: desc ist Helfer-Freitext.
  const subject = ("Neuer Beleg: " + betrag + " — " + desc).replace(/[\r\n]+/g, " ").slice(0, 200);
  const zeilen = [
    "Es wurde ein neuer Beleg eingereicht.",
    "",
    "Eingereicht von: " + name,
    "Grund: " + desc,
    "Betrag: " + betrag,
    "Beleg-Datum: " + datum,
    "Dateien: " + fileCount
  ];
  if (note) zeilen.push("Notiz: " + note);
  zeilen.push(
    "",
    "Der Beleg liegt im Eingangs-Ordner der Geschäftsstelle und kann im",
    "Vereinsbudget-Tool übernommen werden."
  );

  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": env.BREVO_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        sender: { email: NOTIFY_FROM_EMAIL, name: NOTIFY_FROM_NAME },
        to: [{ email: empfaenger }],
        subject,
        textContent: zeilen.join("\n")
      })
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error("Brevo-Versand fehlgeschlagen", resp.status, errText);
      return json({ error: "Mail-Versand fehlgeschlagen (HTTP " + resp.status + ")" }, 502, corsHeaders);
    }
  } catch (e) {
    return json({ error: "Mail-Versand fehlgeschlagen: " + e.message }, 502, corsHeaders);
  }

  return json({ ok: true, sent: true }, 200, corsHeaders);
}

// ---------- Aktionen: WebDAV-Gateway für die Apps ----------

// Eine App darf ihre Daten lesen/schreiben, wenn der eingeloggte Nutzer das
// zugehörige Tool in der Übersicht sehen darf. Repliziert die Client-Logik
// isVisibleToUser (app.js) serverseitig — der Client ist umgehbar.
// cfgPrefetch (optional): eine bereits laufende Leseanfrage auf sichtbarkeit.json,
// die der Aufrufer parallel zum nutzer.json-Read gestartet hat (siehe
// prefetchJson / getVerifiedSession). Fehlt sie, wird wie bisher hier gelesen —
// dann meist aus dem jsonCache, weil derselbe Request die Datei schon brauchte.
async function userMayAccessTool(app, session, env, authHeader, cfgPrefetch) {
  if (session.isAdmin) return true; // Admin darf immer (spart Nextcloud-Reads)
  const config = await (cfgPrefetch || readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} }));
  const entry = getOwn(config.tools || {}, app);
  if (!entry || entry.visible === false) return false; // versteckt/unkonfiguriert -> nur Admin
  if (!entry.loginRequired) return true;               // öffentliches Tool -> jeder Eingeloggte
  const gids = Array.isArray(entry.groupIds) ? entry.groupIds : [];
  if (gids.length === 0) {
    // "Alle eingeloggten Nutzer" -- gemeint war immer "das ganze Personal", denn
    // bisher WAR jeder Login Personal. Für Spieler gilt dieser Komfort-Default
    // deshalb nicht: sie kommen ausschließlich über eine explizit gesetzte Gruppe
    // an ein Tool. Sonst würde jedes Tool, bei dem die Gruppe mal vergessen wird,
    // sofort für alle Spieler offenstehen -- und zwar unbemerkt, weil ein zu weit
    // sichtbares Tool niemandem auffällt. So fällt der Fehler in die sichere
    // Richtung: das Tool bleibt für Spieler leer, statt zu viel zu zeigen.
    return session.art !== USER_ART_SPIELER;
  }
  return gids.some((g) => session.groupIds.includes(g));
}

// Bearbeiten-Recht für ein Tool: unabhängig von der Sichtbarkeits-Gruppierung
// (tools[id].groupIds), damit das Gewähren eines Bearbeiten-Rechts die
// Sichtbarkeit eines breiter freigegebenen Tools (z.B. "Alle eingeloggten
// Nutzer") nicht ungewollt auf bestimmte Gruppen verengt. Ersetzt die früher
// pro App hartkodierten EDITOR_GROUP_ID-Konstanten.
// adminGroupIds zählen mit: "Administrieren" schließt "Bearbeiten" ein --
// serverseitig hier verankert, damit ein Administrieren-Häkchen ohne zweites
// Bearbeiten-Häkchen nie ins Leere läuft (das Panel koppelt die Häkchen nur
// zur Anzeige, maßgeblich ist diese Zeile).
async function resolveEditPermission(app, session, env, authHeader, cfgPrefetch) {
  if (session.isAdmin) return true;
  const config = await (cfgPrefetch || readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} }));
  const entry = getOwn(config.tools || {}, app);
  if (!entry) return false;
  const editGroupIds = Array.isArray(entry.editGroupIds) ? entry.editGroupIds : [];
  const adminGroupIds = Array.isArray(entry.adminGroupIds) ? entry.adminGroupIds : [];
  return editGroupIds.concat(adminGroupIds).some((g) => session.groupIds.includes(g));
}

// Administrieren-Recht für ein Tool -- dritte Stufe über "Bearbeiten": App-interne
// Admin-Funktionen (z.B. Trainerdaten-Vollzugriff inkl. IBAN, Kadermanager-
// Rechte-Matrix) delegierbar machen, ohne globale Admin-Rechte (Nutzerverwaltung,
// Passwort-Resets) zu vergeben. Gleiche Konventionen wie resolveEditPermission:
// leeres adminGroupIds = niemand, globaler Admin immer, unabhängig von der
// Sichtbarkeit. Konsumenten: canAdmin in me/dav-load, check-edit-permission
// (darüber der Trainerdaten-CORS-Proxy) und trainerdaten-list-groups.
async function resolveAdminPermission(app, session, env, authHeader, cfgPrefetch) {
  if (session.isAdmin) return true;
  const config = await (cfgPrefetch || readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} }));
  const entry = getOwn(config.tools || {}, app);
  if (!entry) return false;
  const adminGroupIds = Array.isArray(entry.adminGroupIds) ? entry.adminGroupIds : [];
  if (adminGroupIds.length === 0) return false;
  return adminGroupIds.some((g) => session.groupIds.includes(g));
}

// Sichtrecht fuer die GESAMTE Personalakte-App (Uebersicht + Archiv +
// Archivieren/Reaktivieren) -- bewusst wie resolveEditPermission (leeres
// groupIds = NIEMAND), nicht wie userMayAccessTool (leeres groupIds = jeder
// Eingeloggte). Liest dasselbe Feld, das auch die Kachel-Sichtbarkeit steuert
// (config.tools.personalakte.groupIds in sichtbarkeit.json) -- kein neuer
// Config-Schluessel noetig, der Admin nutzt das bestehende Sichtbarkeits-Panel.
async function mayViewPersonalakte(session, env, authHeader) {
  if (session.isAdmin) return true;
  const config = await readJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
  const entry = getOwn(config.tools || {}, "personalakte");
  if (!entry) return false;
  const groupIds = Array.isArray(entry.groupIds) ? entry.groupIds : [];
  if (groupIds.length === 0) return false;
  return groupIds.some((g) => session.groupIds.includes(g));
}

async function handleDavLoad(request, body, env, authHeader, corsHeaders) {
  // sichtbarkeit.json (Tool-Rechte) hängt nicht an nutzer.json (Session) — beide
  // Reads parallel starten, statt den zweiten hinter dem ersten herlaufen zu
  // lassen. Spart bei kaltem jsonCache einen kompletten Nextcloud-Roundtrip.
  let cfgPrefetch = null;
  const session = await getVerifiedSession(request, env, authHeader, (payload) => {
    // Admins überspringen die Rechteprüfung per Kurzschluss — für sie wäre der
    // Prefetch ein Read, den niemand liest. Bei aktiver Testansicht steht im
    // Token weiterhin isAdmin; dann entfällt hier nur die Beschleunigung und
    // userMayAccessTool liest die Datei wie bisher selbst.
    if (!payload.isAdmin) {
      cfgPrefetch = prefetchJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
    }
  });
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const app = String(body.app || "");
  const url = getOwn(DAV_APPS, app);
  if (!url) return json({ error: "Unbekannte App" }, 400, corsHeaders);

  if (!(await userMayAccessTool(app, session, env, authHeader, cfgPrefetch))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }

  let { data, rev } = await readJsonWithRev(url, authHeader, null);

  // Abgelaufene Eintraege entfernen, BEVOR gefiltert wird -- die Filterbloecke
  // unten liefern nur eine Teilsicht, geschrieben werden muss aber die komplette
  // Liste. Laeuft absichtlich fuer JEDEN Leser (auch Nicht-Editoren): welche
  // Eintraege fallen, entscheidet allein diese Regel, nicht der Aufrufer -- der
  // Request-Body hat darauf keinerlei Einfluss.
  const pruneCfg = getOwn(AUTO_PRUNE_APPS, app);
  if (pruneCfg && data && Array.isArray(data[pruneCfg.listField])) {
    const grenze = Date.now() - pruneCfg.maxTageAlt * 24 * 60 * 60 * 1000;
    const behalten = data[pruneCfg.listField].filter((item) => {
      if (!item || typeof item !== "object") return true;
      const ts = Date.parse(item[pruneCfg.dateField]);
      // Ohne verwertbaren Zeitstempel wird NIE geloescht: ein fehlendes oder
      // kaputtes Datum darf nicht als "unendlich alt" durchgehen.
      return !Number.isFinite(ts) || ts > grenze;
    });
    if (behalten.length !== data[pruneCfg.listField].length) {
      // Neues Objekt statt In-Place-Mutation -- gleicher jsonCache-Grund wie in
      // den Filterbloecken unten. rev kann aus dem Cache stammen; passt es nicht
      // mehr, scheitert der If-Match-PUT sauber und wir liefern einfach den
      // ungekuerzten Stand aus (der naechste Load raeumt auf).
      const bereinigt = { ...data, [pruneCfg.listField]: behalten };
      try {
        rev = await writeJson(url, authHeader, bereinigt, rev);
        data = bereinigt;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
  }

  const ownerCfg = getOwn(OWNER_FILTERED_APPS, app);
  if (ownerCfg && data && Array.isArray(data[ownerCfg.listField]) &&
      !(await resolveEditPermission(app, session, env, authHeader, cfgPrefetch))) {
    // Neues Objekt bauen statt data[listField] in-place zu setzen: readJsonWithRev
    // liefert bei Cache-Hit (jsonCache, 5s TTL) eine Referenz auf das gecachte
    // Objekt zurück — eine In-Place-Mutation würde den Cache für alle anderen
    // Requests im selben Fenster (auch Editoren!) auf diese gefilterte Sicht verengen.
    data = { ...data, [ownerCfg.listField]: data[ownerCfg.listField].filter(
      (item) => item && item[ownerCfg.ownerField] === session.username) };
  }
  const teamCfg = getOwn(TEAM_FILTERED_APPS, app);
  if (teamCfg && data && Array.isArray(data[teamCfg.listField]) &&
      !(await resolveEditPermission(app, session, env, authHeader, cfgPrefetch))) {
    const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
    const user = getOwn(usersDoc.users, session.username);
    const meineMannschaften = new Set(normalizeMannschaften(user && user.mannschaften));
    // Neues Objekt bauen statt in-place zu mutieren -- gleicher Cache-Grund wie beim ownerCfg-Block oben.
    data = { ...data, [teamCfg.listField]: data[teamCfg.listField].filter(
      (item) => item && meineMannschaften.has(item[teamCfg.teamField])) };
  }
  // Kadermanager für Spielerkonten: nur die eigene Mannschaft, eigene Kassen-
  // buchungen, eigene Urlaub/Krank-Einträge (siehe kmSpielerSicht). Baut wie die
  // Blöcke oben ein NEUES Objekt -- der jsonCache hält sonst die gekürzte Sicht
  // und liefert sie im selben 5-Sekunden-Fenster auch Trainern aus.
  if (app === "kadermanager" && session.art === USER_ART_SPIELER && data && typeof data === "object") {
    data = kmSpielerSicht(data, session.username);
  }
  // me additiv mitliefern: kostet hier keinen einzigen zusätzlichen
  // Nextcloud-Read (usersDoc steckt in der Session, sichtbarkeit.json wurde für
  // die Rechteprüfung oben schon gelesen), erspart dem Client aber den separaten
  // "me"-Request beim Start. Clients, die das Feld nicht kennen, ignorieren es.
  const me = await buildMeResult(session, env, authHeader, app, cfgPrefetch);
  return json({ data, rev, me }, 200, corsHeaders);
}

async function handleDavSave(request, body, env, authHeader, corsHeaders) {
  // Wie in handleDavLoad: die Rechte-Datei parallel zum Session-Read holen.
  // Beim Speichern zählt das doppelt -- der PUT kann erst starten, wenn beide
  // Prüfungen durch sind, jeder eingesparte serielle Read verkürzt also direkt
  // die Zeit bis "Gespeichert ✓".
  let cfgPrefetch = null;
  const session = await getVerifiedSession(request, env, authHeader, (payload) => {
    if (!payload.isAdmin) {
      cfgPrefetch = prefetchJson(env.NEXTCLOUD_URL, authHeader, { version: 1, tools: {} });
    }
  });
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const app = String(body.app || "");
  const url = getOwn(DAV_APPS, app);
  if (!url) return json({ error: "Unbekannte App" }, 400, corsHeaders);

  if (body.data == null || typeof body.data !== "object") {
    return json({ error: "Ungültige Daten" }, 400, corsHeaders);
  }

  if (!(await userMayAccessTool(app, session, env, authHeader, cfgPrefetch))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }
  if (WRITE_REQUIRES_EDIT_PERMISSION.has(app) && !(await resolveEditPermission(app, session, env, authHeader, cfgPrefetch))) {
    return json({ error: "Kein Bearbeiten-Recht für dieses Tool" }, 403, corsHeaders);
  }

  const ownerCfg = getOwn(OWNER_FILTERED_APPS, app) || getOwn(OWNER_WRITE_APPS, app);
  if (ownerCfg && !(await resolveEditPermission(app, session, env, authHeader, cfgPrefetch))) {
    // Nutzer ohne Bearbeiten-Recht: bei OWNER_FILTERED_APPS hat handleDavLoad bereits
    // nur die eigenen Einträge geliefert (body.data[listField] enthält bestenfalls nur
    // eigene). Bei OWNER_WRITE_APPS (z.B. abwesenheitskalender, siehe Kommentar dort)
    // sieht der Client beim Laden dagegen ALLE Einträge -- body.data[listField] kann
    // hier fremde Einträge enthalten und wird von handleOwnerFilteredSave direkt
    // darunter geprüft (400 bei jedem fremden Eintrag; der Client muss selbst
    // vorfiltern). In beiden Fällen NICHT wie unten das ganze Dokument wholesale
    // schreiben (würde fremde Einträge löschen bzw. überschreiben, die dieser Client
    // nie oder nur veraltet im Speicher hatte).
    return handleOwnerFilteredSave(url, ownerCfg, session, authHeader, body.data[ownerCfg.listField], corsHeaders);
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

// Speicherpfad für OWNER_FILTERED_APPS-Nutzer ohne Bearbeiten-Recht: statt das vom
// Client geschickte Dokument wholesale zu übernehmen (der Client kennt ja nur die
// eigenen Einträge), wird serverseitig frisch gelesen, NUR listField gemergt (fremde
// Einträge unangetastet aus dem frischen Stand übernommen, eigene komplett durch die
// Client-Version ersetzt — deckt Anlegen/Ändern/Löschen der eigenen Einträge ab) und
// bei einem Schreibkonflikt (zwei Nutzer speichern gleichzeitig) automatisch mit dem
// neuen Stand erneut gemergt. Kein rev/If-Match vom Client nötig: da nie etwas
// wholesale übernommen wird, sondern jedes Mal frisch gegen den aktuellen Stand
// gemergt wird, können sich zwei verschiedene Nutzer nie gegenseitig überschreiben.
async function handleOwnerFilteredSave(url, cfg, session, authHeader, submitted, corsHeaders) {
  if (!Array.isArray(submitted) ||
      submitted.some((it) => !it || typeof it !== "object" || it[cfg.ownerField] !== session.username)) {
    return json({ error: "Ungültige Daten: fremde oder ungültige Einträge" }, 400, corsHeaders);
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data: rawDoc, rev } = await readJsonWithRev(url, authHeader, { meta: {}, [cfg.listField]: [] });
    const doc = rawDoc && typeof rawDoc === "object" ? rawDoc : { meta: {}, [cfg.listField]: [] };
    const others = (Array.isArray(doc[cfg.listField]) ? doc[cfg.listField] : [])
      .filter((it) => !it || it[cfg.ownerField] !== session.username);
    const merged = { ...doc, [cfg.listField]: others.concat(submitted) };
    merged.meta = { ...(doc.meta || {}), stand: new Date().toISOString() };
    try {
      const newRev = await writeJson(url, authHeader, merged, rev);
      return json({ ok: true, rev: newRev }, 200, corsHeaders);
    } catch (e) {
      if (e instanceof ConflictError && attempt < 3) continue; // jemand anders hat zwischenzeitlich geschrieben -> frisch neu lesen+mergen
      if (e instanceof ConflictError) {
        return json({ error: "Konflikt: bitte erneut versuchen", conflict: true }, 409, corsHeaders);
      }
      return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
    }
  }
}

// ---------- Aktion: Abstimmen bei einer Vereinskalender-Umfrage ----------
// vereinskalender steht in WRITE_REQUIRES_EDIT_PERMISSION -- Termine anlegen und
// aendern darf nur, wer in editGroupIds steht. Das ABSTIMMEN bei einem
// Umfrage-Termin ist aber ausdruecklich fuer alle gedacht, die den Termin sehen
// duerfen (sonst stimmt die Geschaeftsstelle mit sich selbst ab, waehrend die
// eingeladenen Trainer nur zusehen). Statt dafuer die Schreib-Restriktion
// aufzuweichen -- dann duerfte jeder Trainer auch fremde Termine aendern und
// loeschen -- schreibt diese schmale Aktion ausschliesslich
// umfrage.stimmen[<Nutzername aus dem Token>][<candId>] EINES Termins.
//
// Sichtbarkeitsregel: Spiegel von terminVisibleFor() in vereinskalender/app.js.
// Ohne sie koennte jemand mit Tool-Zugriff bei einem fremden Privattermin
// mitstimmen und ueber die zurueckgelieferten Stimmen dessen Teilnehmerkreis
// auslesen. Wer die Regel dort aendert, muss sie hier mitziehen.
function vereinskalenderTerminSichtbar(t, session) {
  if (!t.privat) return true;
  if (session.isAdmin) return true;
  if (t.ersteller && t.ersteller === session.username) return true;
  if (Array.isArray(t.geteiltUsers) && t.geteiltUsers.includes(session.username)) return true;
  const gids = Array.isArray(session.groupIds) ? session.groupIds : [];
  if (Array.isArray(t.geteiltGruppen) && t.geteiltGruppen.some((g) => gids.includes(g))) return true;
  return false;
}

async function handleVereinskalenderVote(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  // Bewusst NUR userMayAccessTool, nicht resolveEditPermission -- genau das ist
  // der Zweck dieser Aktion. Wer das Tool nicht sehen darf, kommt trotzdem nicht durch.
  if (!(await userMayAccessTool("vereinskalender", session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }

  const terminId = String(body.terminId || "");
  const candId = String(body.candId || "");
  const wert = String(body.wert || "");
  if (!terminId || !candId) return json({ error: "Fehlende Termin- oder Vorschlags-Id" }, 400, corsHeaders);
  if (wert !== "ja" && wert !== "nein" && wert !== "") {
    return json({ error: "Ungültige Stimme" }, 400, corsHeaders);
  }

  const url = DAV_APPS["vereinskalender"];
  // Read-modify-write wie handleOwnerFilteredSave: kein rev vom Client, sondern
  // jedes Mal frisch lesen und nur das eigene Feld setzen. Zwei gleichzeitig
  // abstimmende Nutzer koennen sich dadurch nie gegenseitig ueberschreiben.
  for (let attempt = 1; attempt <= 3; attempt++) {
    // Gleiches Muster wie handleKmSelf: VOR dem Lesen aus dem Cache nehmen (der
    // 5s-Cache könnte einen veralteten Stand samt altem ETag liefern — der
    // If-Match-PUT unten scheiterte dann grundlos), und direkt NACH dem Lesen
    // noch einmal, weil readJsonWithRev die gecachte Referenz zurückgibt und die
    // Mutation unten sonst parallele Requests im selben Isolate verfälscht.
    jsonCache.delete(url);
    const { data: raw, rev } = await readJsonWithRev(url, authHeader, null);
    jsonCache.delete(url);
    const doc = (raw && typeof raw === "object") ? raw : null;
    const termine = (doc && Array.isArray(doc.termine)) ? doc.termine : [];
    const t = termine.find((x) => x && x.id === terminId);
    if (!t) return json({ error: "Termin nicht gefunden" }, 404, corsHeaders);
    if (!vereinskalenderTerminSichtbar(t, session)) {
      return json({ error: "Kein Zugriff auf diesen Termin" }, 403, corsHeaders);
    }
    const umfrage = t.umfrage;
    const kandidaten = (umfrage && umfrage.aktiv && Array.isArray(umfrage.termine)) ? umfrage.termine : [];
    if (kandidaten.length === 0) return json({ error: "Zu diesem Termin läuft keine Umfrage" }, 400, corsHeaders);
    // candId landet gleich als Objekt-Schluessel -- nur eine Id, die wirklich in
    // der Vorschlagsliste steht, darf durch.
    if (!kandidaten.some((c) => c && c.id === candId)) {
      return json({ error: "Terminvorschlag nicht gefunden" }, 404, corsHeaders);
    }

    const stimmen = (umfrage.stimmen && typeof umfrage.stimmen === "object") ? umfrage.stimmen : {};
    const alteEigene = stimmen[session.username];
    const meine = (alteEigene && typeof alteEigene === "object") ? { ...alteEigene } : {};
    if (wert) meine[candId] = wert; else delete meine[candId];
    const neueStimmen = { ...stimmen };
    if (Object.keys(meine).length > 0) neueStimmen[session.username] = meine;
    else delete neueStimmen[session.username]; // letzte eigene Stimme zurueckgezogen -> keinen leeren Eintrag zuruecklassen
    umfrage.stimmen = neueStimmen;
    doc.meta = { ...(doc.meta || {}), stand: new Date().toISOString() };

    try {
      const newRev = await writeJson(url, authHeader, doc, rev);
      return json({ ok: true, rev: newRev, stimmen: neueStimmen }, 200, corsHeaders);
    } catch (e) {
      if (e instanceof ConflictError && attempt < 3) continue; // jemand anders hat gleichzeitig gespeichert -> frisch lesen
      if (e instanceof ConflictError) {
        return json({ error: "Konflikt: bitte erneut versuchen", conflict: true }, 409, corsHeaders);
      }
      return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
    }
  }
}

// ---------- Aktion: Fotoauftrag-Ordner anlegen (dedizierter Ordner + echter
// Nextcloud-Freigabelink pro Auftrag, via OCS-Sharing-API) ----------

function normalizeFotoauftraegeDoc(raw) {
  const doc = raw && typeof raw === "object" ? raw : {};
  return {
    meta: doc.meta && typeof doc.meta === "object" ? doc.meta : {},
    auftraege: Array.isArray(doc.auftraege) ? doc.auftraege : []
  };
}

// mannschaft ist Freitext (kein Enum) -- transliterate() (ä/ö/ü/ß, siehe unten
// bei den Gruppen-Helfern) plus Einkürzen auf [A-Za-z0-9-] neutralisiert dabei
// automatisch jeden Path-Traversal-Versuch im Feld, ohne den String separat
// gegen ein Blacklist-Muster prüfen zu müssen.
function slugifyMannschaftForPath(str) {
  const ascii = transliterate(String(str || "")).trim();
  const cleaned = ascii.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "Team").slice(0, 60);
}

function buildFotoauftragBasisPfad(mannschaft, datumIso, gegner) {
  const mannschaftSlug = slugifyMannschaftForPath(mannschaft);
  const gegnerSlug = gegner ? slugifyMannschaftForPath(gegner) : "";
  const teil = gegnerSlug ? `${mannschaftSlug}_${gegnerSlug}` : mannschaftSlug;
  return `${datumIso}_${teil}`;
}

// Legt den Ziel-Ordner an. Anders als ensureCollection() wird ein bereits
// existierender Name NICHT still wiederverwendet (405 heißt hier "Name schon
// vergeben", nicht "passt schon") -- sonst könnten zwei verschiedene Aufträge
// versehentlich denselben Nextcloud-Ordner (und dieselbe Freigabe) teilen.
// Kollisionsprüfung läuft bewusst gegen das echte Nextcloud-Dateisystem, nicht
// nur gegen JSON-Einträge (die könnten z.B. nach einem gelöschten Auftrag
// fehlen, obwohl der Ordner noch existiert).
async function ensureUniqueFotoauftragOrdner(basisFullUrl, authHeader) {
  const parentUrl = basisFullUrl.slice(0, basisFullUrl.lastIndexOf("/"));
  await ensureCollection(parentUrl, authHeader, 0); // gemeinsamer Basis-Ordner (06_Social Media) -- Wiederverwendung hier korrekt

  let suffix = 1;
  let candidateUrl = basisFullUrl;
  for (;;) {
    let resp = await fetch(candidateUrl, { method: "MKCOL", headers: { Authorization: authHeader } });
    if (resp.status === 201) return candidateUrl;
    if (resp.status === 409) {
      await ensureCollection(candidateUrl.slice(0, candidateUrl.lastIndexOf("/")), authHeader, 0);
      resp = await fetch(candidateUrl, { method: "MKCOL", headers: { Authorization: authHeader } });
      if (resp.status === 201) return candidateUrl;
    }
    if (resp.status === 405) {
      suffix += 1;
      if (suffix > 50) throw new NextcloudError("Konnte keinen freien Ordnernamen finden");
      candidateUrl = `${basisFullUrl}_${suffix}`;
      continue;
    }
    throw new NextcloudError(`Ordner anlegen fehlgeschlagen (MKCOL ${resp.status})`);
  }
}

function nextcloudOrigin(url) {
  return new URL(url).origin;
}

// Pfad relativ zum Nextcloud-Nutzer-Root, wie ihn die OCS-Share-API im
// "path"-Parameter erwartet -- aus einer vollen WebDAV-URL
// (.../remote.php/dav/files/<user>/<pfad>) extrahiert.
function nextcloudRelativePath(url) {
  const marker = "/remote.php/dav/files/";
  const pathname = new URL(url).pathname;
  const idx = pathname.indexOf(marker);
  if (idx === -1) throw new NextcloudError("Unerwartetes Nextcloud-URL-Format");
  const afterUser = pathname.slice(idx + marker.length);
  const slash = afterUser.indexOf("/");
  return decodeURIComponent(slash === -1 ? "" : afterUser.slice(slash));
}

// OCS-Sharing-API: erzeugt einen echten, eigenständigen Nextcloud-Freigabelink
// für GENAU diesen einen Ordner (shareType=3 = öffentlicher Link). Komplett
// NEU in dieser Flotte -- bisher nutzt jede App nur rohes WebDAV. Vor dem
// produktiven Verlassen auf diese Funktion unbedingt per Live-Probe gegen
// einen Wegwerf-Ordner verifizieren (siehe CLAUDE.md dieser App): die genauen
// Feldnamen der Antwort, ob permissions=15 wirklich "Ansehen + Hochladen"
// ergibt (nicht Drop-Box-Modus), und ob öffentliche Links auf diesem
// Tarif/dieser Instanz überhaupt aktiviert sind.
async function createPublicShare(folderWebdavUrl, authHeader) {
  const ocsUrl = nextcloudOrigin(folderWebdavUrl) + "/ocs/v2.php/apps/files_sharing/api/v1/shares";
  const form = new URLSearchParams();
  form.set("path", nextcloudRelativePath(folderWebdavUrl));
  form.set("shareType", "3");
  form.set("permissions", "15"); // read+update+create+delete ("Hochladen und Bearbeiten erlauben"), NICHT 4 (Datei-Ablage)
  let resp;
  try {
    resp = await fetch(ocsUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "OCS-APIRequest": "true",
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });
  } catch (e) {
    throw new NextcloudError("Nextcloud-Freigabe nicht erreichbar: " + e.message);
  }
  if (!resp.ok) throw new NextcloudError(`Nextcloud-Freigabe fehlgeschlagen (OCS ${resp.status})`);
  let parsed;
  try {
    parsed = await resp.json();
  } catch (_) {
    throw new NextcloudError("Unerwartete OCS-Antwort (kein JSON)");
  }
  const data = parsed && parsed.ocs && parsed.ocs.data;
  if (!data || typeof data.url !== "string" || typeof data.token !== "string") {
    throw new NextcloudError("OCS-Antwort enthält keine url/token — Response-Form gegen Live-Probe prüfen");
  }
  return { url: data.url, token: data.token };
}

async function rollbackFotoauftragToOffen(url, authHeader, id) {
  try {
    const { data, rev } = await readJsonWithRev(url, authHeader, { meta: {}, auftraege: [] });
    const doc = normalizeFotoauftraegeDoc(data);
    const a = doc.auftraege.find((x) => x && x.id === id);
    if (!a || a.status !== "wird-angelegt") return; // schon anderweitig verändert -- nicht anfassen
    a.status = "offen";
    a.ordnerWirdAngelegtVon = null;
    a.ordnerWirdAngelegtAm = null;
    await writeJson(url, authHeader, doc, rev);
  } catch (_) {
    // best-effort -- ein fehlgeschlagener Rollback darf den ursprünglichen Fehler nicht verdecken
  }
}

async function handleFotoauftragOrdnerAnlegen(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const url = getOwn(DAV_APPS, "fotoauftraege");
  if (!url) return json({ error: "Unbekannte App" }, 400, corsHeaders);
  if (!(await userMayAccessTool("fotoauftraege", session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }

  const id = String(body.id || "");
  if (!id) return json({ error: "Fehlende id" }, 400, corsHeaders);

  // Phase A: reservieren (offen -> wird-angelegt). Der ETag-If-Match-Write
  // wirkt hier als Mutex -- wer den konditionalen Write verliert, bekommt 409,
  // BEVOR irgendein MKCOL/OCS-Aufruf passiert (siehe CLAUDE.md für die
  // Begründung, warum das bei dieser App nötig ist, anders als der sonst in
  // dieser Flotte akzeptierte Doppelbuchungs-Race).
  let { data, rev } = await readJsonWithRev(url, authHeader, { meta: {}, auftraege: [] });
  let doc = normalizeFotoauftraegeDoc(data);
  let auftrag = doc.auftraege.find((a) => a && a.id === id);
  if (!auftrag) return json({ error: "Auftrag nicht gefunden" }, 404, corsHeaders);
  if (auftrag.status !== "offen") {
    return json({ error: "Auftrag ist nicht mehr offen", conflict: true }, 409, corsHeaders);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(auftrag.datum || ""))) {
    return json({ error: "Auftrag hat ein ungültiges Datum" }, 400, corsHeaders);
  }
  if (!String(auftrag.mannschaft || "").trim()) {
    return json({ error: "Auftrag hat keine Mannschaft" }, 400, corsHeaders);
  }

  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  const user = getOwn(usersDoc.users, session.username);
  const isEditor = await resolveEditPermission("fotoauftraege", session, env, authHeader);
  if (!isEditor && !mayActOnFotoauftragTeam(auftrag.mannschaft, user)) {
    return json({ error: "Keine Berechtigung, für dieses Team einen Ordner anzulegen" }, 403, corsHeaders);
  }

  auftrag.status = "wird-angelegt";
  auftrag.ordnerWirdAngelegtVon = session.username;
  auftrag.ordnerWirdAngelegtAm = new Date().toISOString();
  try {
    rev = await writeJson(url, authHeader, doc, rev);
  } catch (e) {
    if (e instanceof ConflictError) {
      return json({ error: "Auftrag wird bereits von jemand anderem bearbeitet", conflict: true }, 409, corsHeaders);
    }
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }

  // Phase B: eigentliche Arbeit, genau einmal.
  const basisPfad = buildFotoauftragBasisPfad(auftrag.mannschaft, auftrag.datum, auftrag.gegner);
  let fullUrl, share;
  try {
    fullUrl = await ensureUniqueFotoauftragOrdner(FOTOAUFTRAEGE_ORDNER_BASIS + "/" + basisPfad, authHeader);
    share = await createPublicShare(fullUrl, authHeader);
  } catch (e) {
    await rollbackFotoauftragToOffen(url, authHeader, id);
    return json({ error: "Ordner/Freigabe konnte nicht angelegt werden: " + e.message }, 502, corsHeaders);
  }
  const relPath = fullUrl.slice(FOTOAUFTRAEGE_ORDNER_BASIS.length + 1);

  const applyFinal = (a) => {
    a.status = "ordner-angelegt";
    a.ordnerPfad = relPath;
    a.freigabeLink = share.url;
    a.freigabeToken = share.token;
    a.ordnerErstelltVon = session.username;
    a.ordnerErstelltVonVorname = (user && user.vorname) || null;
    a.ordnerErstelltVonNachname = (user && user.nachname) || null;
    a.ordnerErstelltAm = new Date().toISOString();
  };
  applyFinal(auftrag);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const newRev = await writeJson(url, authHeader, doc, rev);
      return json({ ok: true, auftrag, rev: newRev }, 200, corsHeaders);
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt === 3) {
        return json({
          error: "Ordner/Freigabe angelegt, aber Speichern fehlgeschlagen: " + e.message,
          ordnerPfad: relPath, freigabeLink: share.url
        }, 502, corsHeaders);
      }
      const fresh = await readJsonWithRev(url, authHeader, { meta: {}, auftraege: [] });
      doc = normalizeFotoauftraegeDoc(fresh.data);
      rev = fresh.rev;
      const freshAuftrag = doc.auftraege.find((a) => a && a.id === id);
      if (!freshAuftrag || freshAuftrag.status !== "wird-angelegt" || freshAuftrag.ordnerWirdAngelegtVon !== session.username) {
        return json({
          error: "Auftrag wurde zwischenzeitlich verändert", conflict: true,
          ordnerPfad: relPath, freigabeLink: share.url
        }, 409, corsHeaders);
      }
      auftrag = freshAuftrag;
      applyFinal(auftrag);
    }
  }
}

// Gemeinsamer Team-Zugehörigkeits-Check für fotoauftrag-ordner-anlegen UND
// fotoauftrag-spielbericht-hochladen (beide: Editor darf immer, sonst nur bei
// Team-Übereinstimmung mit dem eigenen mannschaften-Profil).
function mayActOnFotoauftragTeam(mannschaft, user) {
  const meineMannschaften = new Set(normalizeMannschaften(user && user.mannschaften));
  return meineMannschaften.has(mannschaft);
}

// Escaping für Freitext in word/document.xml-Textknoten -- & < > sind dort
// die einzigen zwingend zu escapenden Zeichen (anders als in HTML/escapeHtml
// braucht es kein &quot;/&#39;, da hier keine Attributwerte befüllt werden).
function escapeXmlText(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Lädt eine vom Client aus Freitext erzeugte .docx-Datei (siehe buildSpielberichtDocxBlob
// in app.js) in denselben Nextcloud-Ordner, der auch die Fotos enthält -- landet damit
// automatisch im selben Freigabelink, ohne eigene neue Freigabe. Fixer Dateiname
// (Re-Upload überschreibt bewusst, ein Spielbericht pro Auftrag).
async function handleFotoauftragSpielberichtHochladen(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const url = getOwn(DAV_APPS, "fotoauftraege");
  if (!url) return json({ error: "Unbekannte App" }, 400, corsHeaders);
  if (!(await userMayAccessTool("fotoauftraege", session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }

  const id = String(body.id || "");
  if (!id) return json({ error: "Fehlende id" }, 400, corsHeaders);
  const text = String(body.text || "").slice(0, 20000);
  if (!text.trim()) return json({ error: "Spielbericht ist leer" }, 400, corsHeaders);

  let bytes;
  try {
    bytes = base64ToBytes(String(body.dataBase64 || ""));
  } catch (_) {
    return json({ error: "Ungültige Datei-Daten" }, 400, corsHeaders);
  }
  if (bytes.length === 0) return json({ error: "Leere Datei" }, 400, corsHeaders);
  if (bytes.length > MAX_FILE_BYTES) return json({ error: "Datei zu groß (max. 10 MB)" }, 413, corsHeaders);

  const { data, rev } = await readJsonWithRev(url, authHeader, { meta: {}, auftraege: [] });
  const doc = normalizeFotoauftraegeDoc(data);
  const auftrag = doc.auftraege.find((a) => a && a.id === id);
  if (!auftrag) return json({ error: "Auftrag nicht gefunden" }, 404, corsHeaders);
  if (!auftrag.ordnerPfad) {
    return json({ error: "Für diesen Auftrag existiert noch kein Ordner" }, 400, corsHeaders);
  }

  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  const user = getOwn(usersDoc.users, session.username);
  const isEditor = await resolveEditPermission("fotoauftraege", session, env, authHeader);
  if (!isEditor && !mayActOnFotoauftragTeam(auftrag.mannschaft, user)) {
    return json({ error: "Keine Berechtigung, für dieses Team einen Spielbericht hochzuladen" }, 403, corsHeaders);
  }

  const fileUrl = `${FOTOAUFTRAEGE_ORDNER_BASIS}/${auftrag.ordnerPfad}/Spielbericht.docx`;
  const putHeaders = { Authorization: authHeader, "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "PUT", headers: putHeaders, body: bytes });
    if (resp.status === 409 || resp.status === 404) {
      await ensureCollection(fileUrl.slice(0, fileUrl.lastIndexOf("/")), authHeader, 0);
      resp = await fetch(fileUrl, { method: "PUT", headers: putHeaders, body: bytes });
    }
  } catch (e) {
    return json({ error: "Nextcloud nicht erreichbar: " + e.message }, 502, corsHeaders);
  }
  if (!resp.ok) return json({ error: `Nextcloud PUT ${resp.status}` }, 502, corsHeaders);

  auftrag.spielbericht = text;
  auftrag.spielberichtHochgeladenVon = session.username;
  auftrag.spielberichtHochgeladenVonVorname = (user && user.vorname) || null;
  auftrag.spielberichtHochgeladenVonNachname = (user && user.nachname) || null;
  auftrag.spielberichtHochgeladenAm = new Date().toISOString();

  try {
    const newRev = await writeJson(url, authHeader, doc, rev);
    return json({ ok: true, auftrag, rev: newRev }, 200, corsHeaders);
  } catch (e) {
    if (e instanceof ConflictError) {
      // Datei liegt bereits erfolgreich in Nextcloud (PUT war schon erfolgreich) --
      // nur das JSON-Update kollidierte. Client soll neu laden + erneut versuchen;
      // ein wiederholter Upload überschreibt lediglich dieselbe Datei nochmal, harmlos.
      return json({ error: "Auftrag wurde zwischenzeitlich verändert — bitte neu laden und erneut versuchen", conflict: true }, 409, corsHeaders);
    }
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }
}

// Löscht einen Auftrag vollständig -- inkl. des zugehörigen Nextcloud-Ordners
// (Fotos + Spielbericht), falls einer existiert. Editor-only (wie der
// Löschen-Button clientseitig es schon war), anders als ordner-anlegen/
// spielbericht-hochladen: das Entfernen echter Cloud-Daten ist bewusst NICHT
// dem zuständigen Trainer selbst überlassen. Schlägt das Nextcloud-DELETE mit
// einem echten Fehler fehl (nicht nur 404 = schon weg), wird NICHT trotzdem
// der JSON-Eintrag entfernt -- sonst verliert man die einzige Spur zu einem
// verwaisten, nicht wirklich gelöschten Ordner. WebDAV DELETE auf einen
// Ordner (Collection) ist per Spec (RFC 4918) implizit rekursiv -- kein
// zusätzlicher Depth-Header nötig, löscht Fotos+Spielbericht mit.
async function handleFotoauftragLoeschen(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const url = getOwn(DAV_APPS, "fotoauftraege");
  if (!url) return json({ error: "Unbekannte App" }, 400, corsHeaders);
  if (!(await userMayAccessTool("fotoauftraege", session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }
  if (!(await resolveEditPermission("fotoauftraege", session, env, authHeader))) {
    return json({ error: "Kein Bearbeiten-Recht für dieses Tool" }, 403, corsHeaders);
  }

  const id = String(body.id || "");
  if (!id) return json({ error: "Fehlende id" }, 400, corsHeaders);

  const { data, rev } = await readJsonWithRev(url, authHeader, { meta: {}, auftraege: [] });
  const doc = normalizeFotoauftraegeDoc(data);
  const auftrag = doc.auftraege.find((a) => a && a.id === id);
  if (!auftrag) return json({ error: "Auftrag nicht gefunden" }, 404, corsHeaders);

  // Der zugehoerige Nextcloud-Ordner bleibt bewusst stehen (2026-07-21, Kehrtwende
  // zurueck zum urspruenglichen Verhalten): die Fotos sind das ARCHIV des Vereins
  // und ueberleben den Auftrag. Geloescht wird nur der Listeneintrag -- der Auftrag
  // ist ein Arbeitszettel, das Bildmaterial nicht. Gilt genauso fuer die
  // automatische Bereinigung nach Ablauf der Frist (AUTO_PRUNE_APPS, siehe dort).
  doc.auftraege = doc.auftraege.filter((a) => !(a && a.id === id));
  try {
    const newRev = await writeJson(url, authHeader, doc, rev);
    return json({ ok: true, rev: newRev }, 200, corsHeaders);
  } catch (e) {
    if (e instanceof ConflictError) {
      // Nichts ist passiert -- der Handler fasst ausser dieser JSON-Datei nichts
      // mehr an, ein erneuter Versuch auf frischem Stand ist folgenlos wiederholbar.
      return json({ error: "Auftrag wurde zwischenzeitlich verändert — bitte neu laden und erneut versuchen", conflict: true }, 409, corsHeaders);
    }
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }
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
// Datei-Id (UUID) und Tool-Sichtbarkeit (wie dav-load/dav-save). Mit
// { requireEdit: true } (put/delete) zusätzlich ein Bearbeiten-Recht für Apps
// in WRITE_REQUIRES_EDIT_PERMISSION — get (Ansehen/Herunterladen) verlangt das
// bewusst nicht. Liefert { dir, fileUrl } oder { error: <fertige Response> }.
async function prepareFileAction(request, body, env, authHeader, corsHeaders, opts) {
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
  if (opts && opts.requireEdit && WRITE_REQUIRES_EDIT_PERMISSION.has(app) &&
      !(await resolveEditPermission(app, session, env, authHeader))) {
    return { error: json({ error: "Kein Bearbeiten-Recht für dieses Tool" }, 403, corsHeaders) };
  }
  return { dir, fileUrl: dir + "/" + id };
}

async function handleDavFilePut(request, body, env, authHeader, corsHeaders) {
  const p = await prepareFileAction(request, body, env, authHeader, corsHeaders, { requireEdit: true });
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
  // 409 oder 404 beim PUT = ein Elternordner existiert noch nicht -> anlegen und
  // EINMAL wiederholen (MKCOL-Autofix, wie bei der ersten JSON-Speicherung).
  // Nextcloud liefert 409, wenn nur EIN Ordner-Level fehlt (z.B. nur "dateien"),
  // aber 404, wenn zwei oder mehr Ebenen zugleich fehlen — das passiert, wenn eine
  // App ihre erste Datei hochlädt, bevor sie je ihre JSON-Datei gespeichert hat
  // (dann fehlen der App-Ordner UND dessen "dateien"-Unterordner gleichzeitig).
  if (resp.status === 409 || resp.status === 404) {
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
  const p = await prepareFileAction(request, body, env, authHeader, corsHeaders, { requireEdit: true });
  if (p.error) return p.error;

  const resp = await fetch(p.fileUrl, { method: "DELETE", headers: { Authorization: authHeader } });
  // 204/200 = gelöscht, 404 = war schon weg — beides ist Erfolg fürs Aufräumen.
  if (resp.ok || resp.status === 404) return json({ ok: true }, 200, corsHeaders);
  return json({ error: `Nextcloud DELETE ${resp.status}` }, 502, corsHeaders);
}

// ---------- Aktionen: Abgeschottete Datei-Anhänge (nur Eigentümer/Gruppe/Admin) ----------
//
// Anders als dav-file-* (jede Datei-Id für jeden mit Tool-Zugriff lesbar) ist dieser
// Bereich echt serverseitig abgeschottet: die Datei liegt unter <app>/<subdir>/<owner>,
// wobei owner ein validierter Nutzername ist. dav-file-get kann ihn nicht erreichen
// (fester "dateien/"-Pfad + UUID-Pflicht), und get/delete verlangen mayViewRestricted.

// Verzeichnis-URL (ohne Slash am Ende) + Sicht-Gruppe des abgeschotteten Bereichs
// einer App; null, wenn die App keinen solchen Bereich konfiguriert hat.
function restrictedFileDir(app) {
  const jsonUrl = getOwn(DAV_APPS, app);
  const cfg = getOwn(RESTRICTED_FILE_APPS, app);
  if (!jsonUrl || !cfg) return null;
  return { dir: jsonUrl.slice(0, jsonUrl.lastIndexOf("/")) + "/" + cfg.subdir, viewGroupId: cfg.viewGroupId };
}

// Darf diese Sitzung die abgeschottete Datei des Eigentümers <owner> sehen/löschen?
// Eigentümer selbst, Admins und Mitglieder der viewGroupId — sonst nein.
function mayViewRestricted(session, viewGroupId, owner) {
  if (session.isAdmin) return true;
  if (session.username === owner) return true;
  return session.groupIds.includes(viewGroupId);
}

// Eigene abgeschottete Datei hochladen. Der Dateiname ist IMMER der eigene, aus dem
// signierten Token stammende Nutzername — ein Client kann so ausschließlich seine
// EIGENE Datei schreiben, niemals eine fremde überschreiben (kein id/owner aus dem Body).
async function handleDavRestrictedPut(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  const app = String(body.app || "");
  const rf = restrictedFileDir(app);
  if (!rf) return json({ error: "Unbekannte App" }, 400, corsHeaders);
  if (!(await userMayAccessTool(app, session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }
  const owner = session.username; // aus dem Token, nie aus dem Body
  if (!USERNAME_RE.test(owner)) return json({ error: "Ungültiger Eigentümer" }, 400, corsHeaders);

  let bytes;
  try {
    bytes = base64ToBytes(String(body.dataBase64 || ""));
  } catch (_) {
    return json({ error: "Datei-Inhalt ist kein gültiges base64" }, 400, corsHeaders);
  }
  if (bytes.length === 0) return json({ error: "Leere Datei" }, 400, corsHeaders);
  if (bytes.length > MAX_FILE_BYTES) return json({ error: "Datei zu groß" }, 413, corsHeaders);

  let ctype = String(body.contentType || "").replace(/[^\x20-\x7e]/g, "");
  if (!ctype || ctype.length > 200) ctype = "application/octet-stream";

  const fileUrl = rf.dir + "/" + owner;
  const headers = { Authorization: authHeader, "Content-Type": ctype };
  let resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
  // 409/404 = ein Elternordner (App-Ordner und/oder "fuehrerscheine") fehlt noch -> anlegen und EINMAL wiederholen.
  if (resp.status === 409 || resp.status === 404) {
    await ensureCollection(rf.dir, authHeader, 0);
    resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
  }
  if (!resp.ok) return json({ error: `Nextcloud PUT ${resp.status}` }, 502, corsHeaders);
  return json({ ok: true }, 200, corsHeaders);
}

// Abgeschottete Datei eines Eigentümers holen — nur mit mayViewRestricted-Recht.
async function handleDavRestrictedGet(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  const app = String(body.app || "");
  const rf = restrictedFileDir(app);
  if (!rf) return json({ error: "Unbekannte App" }, 400, corsHeaders);
  if (!(await userMayAccessTool(app, session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }
  const owner = normalizeUsername(body.owner);
  if (!USERNAME_RE.test(owner)) return json({ error: "Ungültiger Eigentümer" }, 400, corsHeaders);
  if (!mayViewRestricted(session, rf.viewGroupId, owner)) {
    return json({ error: "Kein Zugriff auf diese Datei" }, 403, corsHeaders);
  }
  const fileUrl = rf.dir + "/" + owner;
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
}

// Abgeschottete Datei löschen — gleiches Recht wie das Ansehen (Eigentümer/Gruppe/Admin).
async function handleDavRestrictedDelete(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  const app = String(body.app || "");
  const rf = restrictedFileDir(app);
  if (!rf) return json({ error: "Unbekannte App" }, 400, corsHeaders);
  if (!(await userMayAccessTool(app, session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }
  const owner = normalizeUsername(body.owner);
  if (!USERNAME_RE.test(owner)) return json({ error: "Ungültiger Eigentümer" }, 400, corsHeaders);
  if (!mayViewRestricted(session, rf.viewGroupId, owner)) {
    return json({ error: "Kein Zugriff auf diese Datei" }, 403, corsHeaders);
  }
  const fileUrl = rf.dir + "/" + owner;
  const resp = await fetch(fileUrl, { method: "DELETE", headers: { Authorization: authHeader } });
  if (resp.ok || resp.status === 404) return json({ ok: true }, 200, corsHeaders);
  return json({ error: `Nextcloud DELETE ${resp.status}` }, 502, corsHeaders);
}

// ---------- Aktionen: Fahrtenbuch extern (ohne Login, Zugriffscode) ----------
//
// Eltern ohne eigenes Tools-Übersicht-Konto tragen eine Fahrt ein bzw. laden
// Mängelfotos/Führerschein hoch. Kein getVerifiedSession() — jeder der drei
// Handler prüft stattdessen unabhängig über requireFahrtenbuchExternCode()
// denselben Zugriffscode. Bewusst fest an app "fahrtenbuch" gebunden, kein
// generisches app-Feld aus dem Body (kein Login -> kein Bezug zu
// userMayAccessTool, das Konzept "Tool-Sichtbarkeit" existiert hier nicht).

// Schema-Ausschnitt aus fahrtenbuch/config.js (ALLE_CHECK_KEYS). Der Worker hat
// keinen Import-Zugriff auf die App-eigene config.js (separates Deployment) —
// bei Änderung der Checkbox-Keys dort IMMER auch hier nachziehen.
const FAHRTENBUCH_CHECK_KEYS = [
  "chkFuehrerschein", "chkMindestalter", "chkKeinAlkohol",
  "chkSicherheitVor", "chkSichtVor",
  "chkVollgetankt", "chkReinigung", "chkSicherheitNach", "chkSichtNach"
];

const MAX_SIGNATURE_DATA_URL_LENGTH = 2 * 1024 * 1024; // ~1.5 MB dekodiert – reicht für eine Canvas-Unterschrift
const MAX_EXTERN_FOTOS = 20;

function capStr(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

// Gemeinsame Codeprüfung der drei fahrtenbuch-extern-*-Aktionen. Bewusst EIN
// Secret für Fahrt-Eintrag + Mängelfoto + Führerschein (kein separater Vorab-
// Verify-Call nötig — jeder der drei Handler ruft dies selbst auf, ist also für
// sich vollständig authentifiziert, exakt wie handleVerifyActionPassword selbst).
async function requireFahrtenbuchExternCode(body, env, corsHeaders) {
  if (!env.PW_FAHRTENBUCH_EXTERN) {
    return { error: json({ error: "Zugriffscode ist serverseitig nicht konfiguriert" }, 500, corsHeaders) };
  }
  const ok = await staticPasswordEquals(String(body.code || ""), env.PW_FAHRTENBUCH_EXTERN);
  if (!ok) {
    // Bremse gegen Durchprobieren — die Aktion ist ohne Login erreichbar.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { error: json({ error: "Falscher Zugriffscode" }, 403, corsHeaders) };
  }
  return { ok: true };
}

async function handleFahrtenbuchExternSubmit(body, env, authHeader, corsHeaders) {
  const codeCheck = await requireFahrtenbuchExternCode(body, env, corsHeaders);
  if (codeCheck.error) return codeCheck.error;

  const f = body.fahrt && typeof body.fahrt === "object" ? body.fahrt : {};

  const fahrerName = capStr(f.fahrerName, 120);
  const reiseziel = capStr(f.reiseziel, 200);
  const unterschrift = typeof f.unterschriftDataUrl === "string" ? f.unterschriftDataUrl : "";
  if (!fahrerName) return json({ error: "Name des Fahrers fehlt" }, 400, corsHeaders);
  if (!reiseziel) return json({ error: "Reiseziel fehlt" }, 400, corsHeaders);
  if (!/^data:image\//.test(unterschrift)) return json({ error: "Unterschrift fehlt" }, 400, corsHeaders);
  if (unterschrift.length > MAX_SIGNATURE_DATA_URL_LENGTH) return json({ error: "Unterschrift zu groß" }, 400, corsHeaders);

  const id = (typeof f.id === "string" && /^[0-9a-f-]{8,64}$/i.test(f.id)) ? f.id : crypto.randomUUID();

  const fotosIn = Array.isArray(f.maengelFotos) ? f.maengelFotos.slice(0, MAX_EXTERN_FOTOS) : [];
  const maengelFotos = fotosIn.map((p) => {
    const fid = p && typeof p.id === "string" ? p.id : "";
    if (!FILE_ID_RE.test(fid)) return null;
    return {
      id: fid,
      name: capStr(p.name, 200) || "Foto",
      contentType: capStr(p.contentType, 100).replace(/[^\x20-\x7e]/g, "") || "image/jpeg"
    };
  }).filter(Boolean);

  let fuehrerscheinKey = null;
  if (typeof f.fuehrerscheinKey === "string" && f.fuehrerscheinKey) {
    if (!USERNAME_RE.test(f.fuehrerscheinKey)) {
      return json({ error: "Ungültiger Führerschein-Schlüssel" }, 400, corsHeaders);
    }
    fuehrerscheinKey = f.fuehrerscheinKey;
  }

  const entry = {
    id,
    erstelltVon: "",
    erstelltAm: new Date().toISOString(),
    quelle: "extern", // server-hart gesetzt, NIE aus dem Client-Body übernommen
    fahrerName, reiseziel,
    kennzeichen: capStr(f.kennzeichen, 20),
    abteilung: capStr(f.abteilung, 120),
    anzahlInsassen: capStr(f.anzahlInsassen, 5),
    kmStart: capStr(f.kmStart, 10),
    kmEnde: capStr(f.kmEnde, 10),
    datumStart: capStr(f.datumStart, 10),
    datumEnde: capStr(f.datumEnde, 10),
    uhrzeitStart: capStr(f.uhrzeitStart, 5),
    uhrzeitEnde: capStr(f.uhrzeitEnde, 5),
    uebernahmeVon: capStr(f.uebernahmeVon, 120),
    abholort: capStr(f.abholort, 120),
    uebergabeAn: capStr(f.uebergabeAn, 120),
    abstellort: capStr(f.abstellort, 120),
    maengelText: capStr(f.maengelText, 2000),
    maengelFotos,
    unterschriftDataUrl: unterschrift,
    status: "abgeschlossen", // extern immer sofort abgeschlossen, kein Zwischenspeichern
    fuehrerscheinKey
  };
  FAHRTENBUCH_CHECK_KEYS.forEach((k) => { entry[k] = !!f[k]; });

  const url = DAV_APPS.fahrtenbuch;
  const doc = await readJson(url, authHeader, { meta: {}, fahrten: [] });
  doc.meta = doc.meta && typeof doc.meta === "object" ? doc.meta : {};
  doc.fahrten = Array.isArray(doc.fahrten) ? doc.fahrten : [];

  // Idempotenz: erneuter Submit mit derselben (vom Client VOR diesem Aufruf
  // erzeugten) id — z.B. weil eine Mobilfunkverbindung mitten in der Antwort
  // abbrach und das Formular erneut sendet — überschreibt denselben Eintrag,
  // statt eine zweite Fahrt anzulegen. Der Abgleich läuft NUR gegen bereits
  // vorhandene EXTERNE Einträge (quelle==="extern") — sonst könnte ein
  // Zugriffscode-Inhaber über eine erratene/bekannte interne Fahrt-Id eine
  // echte, intern erfasste Fahrt überschreiben.
  const existingIdx = doc.fahrten.findIndex((x) => x && x.id === id && x.quelle === "extern");
  if (existingIdx >= 0) doc.fahrten[existingIdx] = entry;
  else doc.fahrten.push(entry);
  doc.meta.stand = new Date().toISOString();

  try {
    await writeJson(url, authHeader, doc); // unconditional, wie handleSubmitFeedback -- akzeptiertes Race-Risiko
  } catch (e) {
    return json({ error: "Speicherfehler: " + e.message }, 502, corsHeaders);
  }
  return json({ ok: true, id }, 200, corsHeaders);
}

async function handleFahrtenbuchExternFilePut(body, env, authHeader, corsHeaders) {
  const codeCheck = await requireFahrtenbuchExternCode(body, env, corsHeaders);
  if (codeCheck.error) return codeCheck.error;

  const dir = davFileDir("fahrtenbuch");
  const id = String(body.id || "");
  if (!FILE_ID_RE.test(id)) return json({ error: "Ungültige Datei-Id" }, 400, corsHeaders);

  let bytes;
  try {
    bytes = base64ToBytes(String(body.dataBase64 || ""));
  } catch (_) {
    return json({ error: "Datei-Inhalt ist kein gültiges base64" }, 400, corsHeaders);
  }
  if (bytes.length === 0) return json({ error: "Leere Datei" }, 400, corsHeaders);
  if (bytes.length > MAX_FILE_BYTES) return json({ error: "Datei zu groß" }, 413, corsHeaders);

  let ctype = String(body.contentType || "").replace(/[^\x20-\x7e]/g, "");
  if (!ctype || ctype.length > 200) ctype = "application/octet-stream";

  const fileUrl = dir + "/" + id;
  const headers = { Authorization: authHeader, "Content-Type": ctype };
  let resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
  if (resp.status === 409 || resp.status === 404) {
    await ensureCollection(dir, authHeader, 0);
    resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
  }
  if (!resp.ok) return json({ error: `Nextcloud PUT ${resp.status}` }, 502, corsHeaders);
  return json({ ok: true }, 200, corsHeaders);
}

async function handleFahrtenbuchExternFuehrerscheinPut(body, env, authHeader, corsHeaders) {
  const codeCheck = await requireFahrtenbuchExternCode(body, env, corsHeaders);
  if (codeCheck.error) return codeCheck.error;

  const rf = restrictedFileDir("fahrtenbuch");
  if (!rf) return json({ error: "Abgeschotteter Bereich nicht konfiguriert" }, 500, corsHeaders);

  // Owner-Schlüssel ist ein Zugriffs-Capability für ein sensibles Dokument —
  // wird NIE frei vom Client erfunden. Erst-Upload: Server generiert (leerer/
  // fehlender owner im Body). Re-Upload/Ersetzen in derselben Sitzung: Client
  // schickt den zuvor VOM SERVER erhaltenen Wert zurück, damit dieselbe Datei
  // überschrieben wird statt eine zweite, verwaiste Datei anzulegen.
  let owner = String(body.owner || "");
  if (owner && !USERNAME_RE.test(owner)) {
    return json({ error: "Ungültiger Owner-Schlüssel" }, 400, corsHeaders);
  }
  if (!owner) owner = crypto.randomUUID().replace(/-/g, ""); // 32 Hex-Zeichen, erfüllt USERNAME_RE {3,32}

  let bytes;
  try {
    bytes = base64ToBytes(String(body.dataBase64 || ""));
  } catch (_) {
    return json({ error: "Datei-Inhalt ist kein gültiges base64" }, 400, corsHeaders);
  }
  if (bytes.length === 0) return json({ error: "Leere Datei" }, 400, corsHeaders);
  if (bytes.length > MAX_FILE_BYTES) return json({ error: "Datei zu groß" }, 413, corsHeaders);

  let ctype = String(body.contentType || "").replace(/[^\x20-\x7e]/g, "");
  if (!ctype || ctype.length > 200) ctype = "application/octet-stream";

  const fileUrl = rf.dir + "/" + owner;
  const headers = { Authorization: authHeader, "Content-Type": ctype };
  let resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
  if (resp.status === 409 || resp.status === 404) {
    await ensureCollection(rf.dir, authHeader, 0);
    resp = await fetch(fileUrl, { method: "PUT", headers, body: bytes });
  }
  if (!resp.ok) return json({ error: `Nextcloud PUT ${resp.status}` }, 502, corsHeaders);
  return json({ ok: true, owner }, 200, corsHeaders);
}

// Listet per WebDAV PROPFIND (Depth:1) den Belegeingang-Ordner und liest nur die
// *.meta.json, deren Dateiname auf "_fahrt-<fahrtId>.meta.json" endet -- diesen
// Suffix hängt sc-heiligenstadt-budget/worker.js nur bei einer gültigen UUID an
// (siehe dort). Kein XML-Parser in Workers verfügbar und dieses Projekt bewusst
// dependency-frei -> schlanker Href-Extractor statt echtem XML-Parsing, zugeschnitten
// auf Nextclouds bekannte Depth:1-Multistatus-Antwort (nur die href-Werte zählen,
// die eigentlich angefragten Props sind irrelevant).
async function handleFahrtenbuchBelegeList(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);

  const app = String(body.app || "");
  if (app !== "fahrtenbuch") return json({ error: "Unbekannte App" }, 400, corsHeaders);
  if (!(await userMayAccessTool(app, session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }

  // Bewusst KEIN zusätzlicher Ownership-Check der konkreten Fahrt: fahrtId ist eine
  // nicht erratbare UUID, und ein Normalnutzer bekommt eine fremde fahrtId über die
  // App seit dem Sichtbarkeits-Fix (OWNER_FILTERED_APPS) ohnehin nicht mehr zu Gesicht.
  const fahrtId = String(body.fahrtId || "");
  if (!FILE_ID_RE.test(fahrtId)) return json({ error: "Ungültige Fahrt-Id" }, 400, corsHeaders);

  let resp;
  try {
    resp = await fetch(BELEGE_EINGANG_DIR, {
      method: "PROPFIND",
      headers: { Authorization: authHeader, Depth: "1", "Content-Type": "application/xml" },
      body: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`
    });
  } catch (e) {
    throw new NextcloudError("Nextcloud nicht erreichbar: " + e.message);
  }
  if (resp.status === 404) return json({ belege: [] }, 200, corsHeaders); // Ordner existiert noch nicht
  if (resp.status !== 207) throw new NextcloudError(`Nextcloud PROPFIND ${resp.status}`);

  const xml = await resp.text();
  const suffix = `_fahrt-${fahrtId}.meta.json`;
  const hrefs = Array.from(xml.matchAll(/<[a-zA-Z0-9]*:?href>([^<]+)<\/[a-zA-Z0-9]*:?href>/gi))
    .map((m) => decodeURIComponent(m[1]));
  const matches = hrefs.filter((href) => href.endsWith(suffix));

  const belege = [];
  for (const href of matches) {
    const fileUrl = new URL(href, BELEGE_EINGANG_DIR).href;
    const fileResp = await fetch(fileUrl, { headers: { Authorization: authHeader } });
    if (!fileResp.ok) continue; // einzelner Lesefehler soll nicht die ganze Liste kippen
    let meta;
    try { meta = await fileResp.json(); } catch (_) { continue; }
    if (!meta || typeof meta !== "object") continue;
    const files = Array.isArray(meta.files)
      ? meta.files
          .map((f) => ({ fileName: capStr(f && f.fileName, 300), fileMime: capStr(f && f.fileMime, 100) }))
          .filter((f) => f.fileName)
      : [];
    belege.push({
      submittedAt: typeof meta.submittedAt === "string" ? meta.submittedAt : null,
      amount: typeof meta.amount === "number" ? meta.amount : null,
      desc: capStr(meta.desc, 200),
      name: capStr(meta.name, 200),
      files
    });
  }
  belege.sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));
  return json({ belege }, 200, corsHeaders);
}

// Liest eine einzelne Beleg-Datei aus BELEGE_EINGANG_DIR für den "Beleg anzeigen"-Knopf im
// Fahrtenbuch-Modal -- fileName kommt vom Client (aus der fahrtenbuch-belege-list-Antwort),
// wird hier aber serverseitig gegen den Suffix "_fahrt-<fahrtId>[_<n>].<ext>" geprüft statt
// blind vertraut, sonst könnte ein Nutzer über einen erratenen/kopierten Dateinamen fremde
// Kassierer-Belege im selben geteilten Ordner lesen. Gleiches Streaming-Muster wie
// handleDavFileGet/handleDavRestrictedGet.
async function handleFahrtenbuchBelegFileGet(request, body, env, authHeader, corsHeaders) {
  const session = await getVerifiedSession(request, env, authHeader);
  if (!session) return json({ error: "Nicht angemeldet" }, 401, corsHeaders);
  const app = String(body.app || "");
  if (app !== "fahrtenbuch") return json({ error: "Unbekannte App" }, 400, corsHeaders);
  if (!(await userMayAccessTool(app, session, env, authHeader))) {
    return json({ error: "Kein Zugriff auf dieses Tool" }, 403, corsHeaders);
  }
  const fahrtId = String(body.fahrtId || "");
  if (!FILE_ID_RE.test(fahrtId)) return json({ error: "Ungültige Fahrt-Id" }, 400, corsHeaders);
  const fileName = String(body.fileName || "");
  const validSuffix = new RegExp(`_fahrt-${fahrtId}(?:_\\d+)?\\.[a-zA-Z0-9]+$`, "i");
  if (!validSuffix.test(fileName) || fileName.includes("/") || fileName.includes("..")) {
    return json({ error: "Ungültiger Dateiname" }, 400, corsHeaders);
  }

  const fileUrl = BELEGE_EINGANG_DIR + "/" + encodeURIComponent(fileName);
  let resp;
  try {
    resp = await fetch(fileUrl, { method: "GET", headers: { Authorization: authHeader } });
  } catch (_) {
    return json({ error: "Nextcloud nicht erreichbar" }, 502, corsHeaders);
  }
  if (resp.status === 404) return json({ error: "Datei nicht gefunden" }, 404, corsHeaders);
  if (!resp.ok) return json({ error: `Nextcloud GET ${resp.status}` }, 502, corsHeaders);
  const ctype = resp.headers.get("Content-Type") || "application/octet-stream";
  return new Response(resp.body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": ctype, "Cache-Control": "private, no-store" }
  });
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

// Startet einen Read, ohne auf ihn zu warten — für Reads, die nicht voneinander
// abhängen und deshalb nicht nacheinander laufen müssen (gemessen: ein
// Nextcloud-Read kostet 200-450 ms, ein Request ohne Read 70 ms).
// Das angehängte .catch() ist ein reiner Platzhalter, damit ein Fehlschlag keine
// unhandled rejection wirft, falls der Aufrufer die Promise am Ende gar nicht
// braucht (z.B. Admin-Kurzschluss in userMayAccessTool). Wer sie awaitet,
// bekommt den Fehler ganz normal aus der Original-Promise.
function prefetchJson(url, authHeader, fallback) {
  const p = readJson(url, authHeader, fallback);
  p.catch(() => {});
  return p;
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
  // Cache SOFORT verwerfen, nicht erst nach erfolgreichem PUT: fast alle
  // read-modify-write-Handler (submit-feedback, fahrtenbuch-extern-submit und
  // jeder nutzer.json-Handler ueber session.usersDoc) mutieren GENAU das Objekt,
  // das readJsonWithRev im Cache abgelegt hat. Schlug der PUT fehl und blieb der
  // Eintrag stehen, lieferte der Cache bis zu 5 Sekunden lang einen Stand, den
  // der Server nie bekommen hat -- und der naechste erfolgreiche Schreibvorgang
  // eines FREMDEN Handlers schrieb diese nie gespeicherte Aenderung dann
  // dauerhaft mit fest. Ein als fehlgeschlagen gemeldeter Vorgang (z.B.
  // archive-trainer 502) wurde so still doch wirksam. Ab dem Moment, in dem wir
  // einen Schreibversuch starten, ist die Kopie im Speicher ohnehin nicht mehr
  // vertrauenswuerdig -- egal ob der Versuch gelingt oder nicht.
  jsonCache.delete(url);
  const headers = { Authorization: authHeader, "Content-Type": "application/json" };
  if (ifMatch) headers["If-Match"] = ifMatch;
  const body = JSON.stringify(data, null, 2);
  let resp = await fetch(url, { method: "PUT", headers, body });
  // 409 ODER 404 beim PUT heißt in WebDAV: ein Elternordner existiert noch nicht
  // (passiert bei der allerersten Speicherung einer neu angebundenen App). 409 bei
  // nur einer fehlenden Ebene, 404 wenn zwei oder mehr Ebenen zugleich fehlen.
  // Ordner anlegen und EINMAL wiederholen. Mit ifMatch kann das hier nicht aus
  // einem fehlenden Ordner stammen (die Datei — und damit ihr Ordner — existierte
  // ja schon), daher nur im unbedingten Fall automatisch anlegen.
  if ((resp.status === 409 || resp.status === 404) && !ifMatch) {
    await ensureParentCollection(url, authHeader);
    resp = await fetch(url, { method: "PUT", headers, body });
  }
  if (resp.status === 412) throw new ConflictError("Datei wurde zwischenzeitlich geändert");
  if (!resp.ok) throw new Error(`Nextcloud PUT ${resp.status}`);
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

// Leitet aus einem rohen Nutzerdatensatz die EFFEKTIVE Identität ab (siehe
// set-view-as oben): ein Admin mit gültigem viewAsGroupId gilt für jede
// Zugriffsprüfung als normales, nicht-admin Mitglied genau dieser einen
// Gruppe. "Gültig" heißt: die Gruppe existiert noch (sonst z.B. nach einem
// delete-group ein toter Verweis, der den Admin dauerhaft aussperren würde).
// realIsAdmin bleibt immer der echte Wert aus nutzer.json.
function deriveIdentity(user, usersDoc) {
  const realIsAdmin = !!user.isAdmin;
  const viewAsGroupId = (realIsAdmin && user.viewAsGroupId && getOwn(usersDoc.groups || {}, user.viewAsGroupId))
    ? user.viewAsGroupId
    : null;
  const isAdmin = realIsAdmin && !viewAsGroupId;
  const groupIds = viewAsGroupId ? [viewAsGroupId] : (isAdmin ? [] : getUserGroupIds(usersDoc, user.username));
  return { isAdmin, realIsAdmin, viewAsGroupId, groupIds };
}

// ---------- Auto-Provisioning: gruppengesteuertes Anlegen von Tool-Einträgen ----------
//
// Legt beim Anlegen eines Nutzers (bzw. per provision-group nachträglich) einen
// verknüpften Eintrag in den fachlich passenden Tools an — z.B. ein "Trainer" wird
// automatisch zur Zeile in der Personalkosten-Kostenliste. Welche App für welche
// Gruppe, steht als provisionGroupIds je Tool in sichtbarkeit.json (parallel zu
// groupIds/editGroupIds). Rein ADDITIV und IDEMPOTENT: jeder Eintrag trägt
// linkedUsername; ein zweiter Lauf legt kein Duplikat an, es wird nie etwas
// gelöscht/überschrieben.

// Nur diese Apps haben einen Adapter (die restlichen Tools bekommen keine Checkbox).
const PROVISION_ADAPTERS = {
  "personalkosten": provisionPersonalkosten,
  "trainercheckliste": provisionTrainercheckliste,
  "kadermanager": provisionKadermanager,
  "trainerdaten": provisionTrainerdaten
};

function provisionPathFor(app) {
  return getOwn(DAV_APPS, app) || getOwn(PROVISION_ONLY_PATHS, app) || null;
}

// Leerstruktur je App, falls die Datei noch nicht existiert (Fallback beim Lesen).
function provisionDefault(app) {
  switch (app) {
    case "personalkosten":    return { meta: {}, seasons: {}, parameter: {} };
    case "trainercheckliste": return { trainerEintraege: [] };
    case "kadermanager":      return { meta: {}, teams: [] };
    case "trainerdaten":      return { trainer: [] };
    default:                  return {};
  }
}

// Welche Provisioning-Adapter für einen Spieler überhaupt laufen dürfen.
// trainerdaten/personalkosten/trainercheckliste sind Personal-Sachen: ein
// Spieler bekommt dort niemals einen Stub, auch wenn seine Gruppe versehentlich
// in provisionGroupIds dieser Tools steht. Sicherheitsnetz gegen einen
// Konfigurationsfehler, der sonst 200 Trainerdaten-Leichen anlegt -- die dann
// über den Namensfallback (findTrainerdatenRecord) auch noch mit echten
// Trainern gleichen Namens verwechselt werden könnten.
const PROVISION_APPS_SPIELER = new Set(["kadermanager"]);

function provisionErlaubtFuerArt(app, art) {
  return art === USER_ART_SPIELER ? PROVISION_APPS_SPIELER.has(app) : true;
}

function provisionProfile(user) {
  return {
    username: user.username,
    vorname: String(user.vorname || "").trim(),
    nachname: String(user.nachname || "").trim(),
    lizenz: user.lizenz || "",
    mannschaften: Array.isArray(user.mannschaften) ? user.mannschaften : []
  };
}

function sameText(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

// Menschliche Dateneingabe vertauscht Vorname/Nachname gelegentlich (Bugreport
// 2026-07-08: TrainerCheckliste-Testeintrag Vorname="user"/Name="test" fuer ein
// Konto mit Vorname="Test"/Nachname="User"). Ohne linkedUsername beide
// Reihenfolgen zulassen, statt den Namensabgleich lautlos scheitern zu lassen.
function sameNamePair(aFirst, aLast, bFirst, bLast) {
  return (sameText(aFirst, bFirst) && sameText(aLast, bLast)) ||
         (sameText(aFirst, bLast) && sameText(aLast, bFirst));
}

// --- Adapter: mutieren die App-Daten in place, geben das Ergebnis je Nutzer zurück
// ("created" | "exists" | "no-team" | "no-season"). "created" => Datei muss geschrieben werden.

function provisionPersonalkosten(data, p) {
  if (!data.meta || typeof data.meta !== "object") data.meta = {};
  if (!data.seasons || typeof data.seasons !== "object") data.seasons = {};
  let seasonKey = data.meta.currentSeason;
  if (!seasonKey || !data.seasons[seasonKey]) seasonKey = Object.keys(data.seasons)[0];
  if (!seasonKey) return "no-season"; // ohne Saison nicht raten
  const season = data.seasons[seasonKey];
  if (!Array.isArray(season.trainer)) season.trainer = [];
  const fullName = `${p.vorname} ${p.nachname}`.trim();
  const fullNameReversed = `${p.nachname} ${p.vorname}`.trim();
  const exists = season.trainer.some((t) =>
    (t.linkedUsername && sameText(t.linkedUsername, p.username)) ||
    sameText(t.name, fullName) || sameText(t.name, fullNameReversed));
  if (exists) return "exists";
  season.trainer.push({
    id: crypto.randomUUID(),
    name: fullName,
    mannschaft: p.mannschaften[0] || "",
    position: "",
    jahrgangsleiter: "",
    lizenz: p.lizenz || "",
    landesebene: "",
    stelle: "",
    manuellAE: "",
    besonderheit: "",
    linkedUsername: p.username
  });
  return "created";
}

function provisionTrainercheckliste(data, p) {
  if (!Array.isArray(data.trainerEintraege)) data.trainerEintraege = [];
  const exists = data.trainerEintraege.some((e) =>
    (e.linkedUsername && sameText(e.linkedUsername, p.username)) ||
    sameNamePair(e.vorname, e.name, p.vorname, p.nachname));
  if (exists) return "exists";
  // Minimal-Stub: die Client-migrateData ergänzt zugang/abgang beim Laden selbst.
  data.trainerEintraege.push({
    id: crypto.randomUUID(),
    name: p.nachname, // in dieser App ist "name" der Nachname
    vorname: p.vorname,
    geburtsdatum: "",
    anschrift: "",
    telefon: "",
    email: "",
    linkedUsername: p.username
  });
  return "created";
}

function provisionKadermanager(data, p) {
  if (!Array.isArray(data.teams)) return "no-team";
  // Erstes Team, dessen Name zu einer betreuten Mannschaft des Nutzers passt.
  const team = data.teams.find((t) => p.mannschaften.some((m) => sameText(t.name, m)));
  if (!team) return "no-team";
  if (!Array.isArray(team.kader)) team.kader = [];
  const exists = team.kader.some((s) => s.linkedUsername && sameText(s.linkedUsername, p.username));
  if (exists) return "exists";
  team.kader.push({
    id: crypto.randomUUID(),
    name: `${p.vorname} ${p.nachname}`.trim(),
    position: "",
    nummer: "",
    linkedUsername: p.username,
    rollen: ["trainer"],
    fotoId: ""
  });
  return "created";
}

function provisionTrainerdaten(data, p) {
  if (!Array.isArray(data.trainer)) data.trainer = [];
  // Stub wie _createStubTrainer der App (ohne username -> Admin-Liste zeigt
  // "Unvollständig"; ein späteres Self-Submit merged per exaktem Namensabgleich).
  const exists = data.trainer.some((t) =>
    (t.linkedUsername && sameText(t.linkedUsername, p.username)) ||
    sameNamePair(t.vorname, t.nachname, p.vorname, p.nachname));
  if (exists) return "exists";
  data.trainer.push({
    id: crypto.randomUUID(),
    vorname: p.vorname,
    nachname: p.nachname,
    lizenz: p.lizenz || "",
    pauschale: "",
    erstelltAm: new Date().toISOString(),
    vertragsGeneriert: false,
    linkedUsername: p.username
  });
  return "created";
}

// Ermittelt die Ziel-Apps für eine Menge Gruppen-Ids aus der Sichtbarkeits-Config
// (tools[].provisionGroupIds), gefiltert auf Apps, die überhaupt einen Adapter haben.
function provisionAppsForGroups(config, groupIds) {
  const tools = (config && config.tools) || {};
  const apps = [];
  for (const [appId, entry] of Object.entries(tools)) {
    if (!getOwn(PROVISION_ADAPTERS, appId)) continue;
    const pg = Array.isArray(entry.provisionGroupIds) ? entry.provisionGroupIds : [];
    if (pg.some((g) => groupIds.includes(g))) apps.push(appId);
  }
  return apps;
}

// Schreibt EINE App-Datei für ALLE Mitglieder auf einmal (1 Read + 1 Write statt pro
// Mitglied — schont die Cloudflare-Subrequest-Grenze). Bei Konflikt einmal frisch
// neu laden und erneut anwenden (Adapter sind idempotent). Gibt je Nutzer das
// Ergebnis zurück.
async function provisionAppBatch(app, adapter, url, members, env, authHeader) {
  let outcomes = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) jsonCache.delete(url); // frischen Stand erzwingen
    const { data, rev } = await readJsonWithRev(url, authHeader, provisionDefault(app));
    const doc = (data && typeof data === "object") ? data : provisionDefault(app);
    outcomes = {};
    let anyCreated = false;
    for (const u of members) {
      const o = adapter(doc, provisionProfile(u));
      outcomes[u.username] = o;
      if (o === "created") anyCreated = true;
    }
    if (!anyCreated) return outcomes; // nichts zu schreiben
    try {
      await writeJson(url, authHeader, doc, rev || undefined);
      return outcomes;
    } catch (e) {
      if (e instanceof ConflictError && attempt === 0) continue;
      Object.keys(outcomes).forEach((k) => { if (outcomes[k] === "created") outcomes[k] = "error"; });
      return outcomes;
    }
  }
  return outcomes;
}

// Provisioniert eine Mitgliederliste in eine Liste von Apps. Report: { [app]: { [username]: ergebnis } }.
async function provisionUsers(members, apps, env, authHeader) {
  const report = {};
  for (const app of apps) {
    const adapter = getOwn(PROVISION_ADAPTERS, app);
    const url = provisionPathFor(app);
    if (!adapter || !url) continue;
    try {
      report[app] = await provisionAppBatch(app, adapter, url, members, env, authHeader);
    } catch (e) {
      const o = {};
      members.forEach((u) => { o[u.username] = "error"; });
      report[app] = o;
    }
  }
  return report;
}

// ---------- Nutzer-Art (Personal vs. Spieler) ----------
// Trennt Vereinspersonal (Trainer, Betreuer, Geschäftsstelle, Vorstand) von
// Spielern/Eltern. Grund: nutzer.json kannte bisher nur "Nutzer", weil jeder
// Login Personal WAR. Sobald Spielerkonten dazukommen, würden sie sonst
// automatisch in der Personalakte (ein Datensatz je Konto), in jedem
// Teilen-Picker (list-directory) und im Namensfallback der Trainerdaten-
// Zuordnung landen — überall dort, wo "Nutzer" implizit "Personal" meinte.
//
// Der Default steht bewusst im LESEPFAD, nicht als Migration in der Datei:
// jedes Konto ohne art-Feld ist "personal". Damit bleiben alle bestehenden
// Konten unverändert gültig und nutzer.json muss nicht angefasst werden --
// ein Konto wird erst dann zum Spieler, wenn es explizit so angelegt wird.
// WICHTIG: Neue Auswertungen, die "alle Nutzer" durchgehen, müssen sich
// entscheiden -- Vorgabe ist istPersonal(), Spieler sind die Ausnahme.
const USER_ART_SPIELER = "spieler";
const USER_ART_PERSONAL = "personal";

function userArt(user) {
  return (user && user.art === USER_ART_SPIELER) ? USER_ART_SPIELER : USER_ART_PERSONAL;
}

function istPersonal(user) {
  return userArt(user) === USER_ART_PERSONAL;
}

// Nimmt nur die beiden bekannten Werte an; alles andere (fehlt/Tippfehler/null)
// fällt auf "personal" zurück -- nie versehentlich zum Spieler degradieren.
function normalizeArt(raw) {
  return String(raw || "").trim() === USER_ART_SPIELER ? USER_ART_SPIELER : USER_ART_PERSONAL;
}

// ---------- Trainerprofil-Helfer (Lizenz + Mannschaften) ----------

function normalizeLizenz(raw) {
  const v = String(raw || "").trim();
  return LIZENZ_OPTIONEN.includes(v) ? v : "";
}

function normalizeMannschaften(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  raw.forEach((m) => {
    const t = String(m || "").trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  });
  return out;
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

function baseUsernameFor(vorname, nachname) {
  const vornamePart = slugifyNamePart(vorname);
  const nachnamePart = slugifyNamePart(nachname);
  let base = [vornamePart, nachnamePart].filter(Boolean).join(".");
  if (base.length < 3) base = (base + "nutzer").slice(0, 32);
  return base.slice(0, 32);
}

function generateUsername(vorname, nachname, existingUsernames) {
  const base = baseUsernameFor(vorname, nachname);
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

// Baut ein echtes, standardkonformes LiveKit-JWT (3 Teile: header.payload.sig)
// von Hand über Web-Crypto -- bewusst NICHT das signToken()-Format oben
// (das ist ein bewusst simplifiziertes 2-Teile-Eigenformat nur für die
// eigenen Session-Tokens dieses Workers). LiveKit Cloud selbst verifiziert
// dieses Token und erwartet echtes JWT mit "video"-Grant-Claim, deshalb der
// eigene, vollständige Header+Payload-Aufbau hier.
async function buildLivekitToken({ apiKey, apiSecret, identity, name, video, ttlSeconds }) {
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    video, // Grant-Objekt: Teilnehmer {room, roomJoin, canPublish, ...} ODER Moderation {roomAdmin, room}
    iss: apiKey,
    sub: identity,
    iat: now,
    nbf: now,
    exp: now + ttlSeconds
  };
  if (name) payload.name = name;
  const signingInput = bytesToBase64Url(enc.encode(JSON.stringify(header))) + "." + bytesToBase64Url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", enc.encode(apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
  return signingInput + "." + bytesToBase64Url(new Uint8Array(sig));
}

// Ruft die LiveKit-Server-API (Twirp/RoomService) mit einem kurzlebigen
// roomAdmin-Token auf — für die Moderations-Aktionen kicken/stummschalten.
// LIVEKIT_URL ist die wss://-Client-Adresse; die HTTP-API sitzt auf demselben
// Host über https://.
async function livekitRoomService(env, method, payload) {
  const adminToken = await buildLivekitToken({
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    identity: "besprechung-moderation",
    video: { roomAdmin: true, room: payload.room },
    ttlSeconds: 60
  });
  const httpBase = env.LIVEKIT_URL.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:").replace(/\/+$/, "");
  const resp = await fetch(`${httpBase}/twirp/livekit.RoomService/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + adminToken },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`LiveKit ${method} (HTTP ${resp.status})${txt ? ": " + txt.slice(0, 200) : ""}`);
  }
  return resp.json().catch(() => ({}));
}

async function getSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return await verifyToken(match[1], env.SESSION_SECRET);
}

// Verifiziert das Token UND gleicht es mit dem aktuellen Nutzerbestand ab —
// zustandslose Tokens allein überleben sonst Nutzer-Löschung, Passwort-Reset
// und Admin-Entzug bis zu 7 Tage. Regeln: Token muss nach dem globalen Stichtag
// SESSIONS_INVALID_BEFORE ausgestellt sein; Nutzer muss noch existieren und ein
// gesetztes Passwort haben; Tokens von VOR dem letzten Passwort-Setzen sind
// ungültig (Reset durch Admin wirft damit alle alten Sitzungen raus); isAdmin
// kommt aus dem aktuellen Datensatz, nicht aus dem Token. Gibt zusätzlich das
// bereits gelesene usersDoc zurück, damit Handler es weiterverwenden können
// (kein zweiter Nextcloud-Read pro Request).
// onTokenValid (optional) wird genau dann aufgerufen, wenn der Token echt und
// nicht durch den Stichtag entwertet ist — aber noch BEVOR nutzer.json gelesen
// wird. Genau dieser Moment ist der richtige, um einen zweiten, unabhängigen
// Nextcloud-Read (sichtbarkeit.json für die Tool-Rechte) parallel zu starten:
// früher würde jeder Request OHNE gültigen Token Nextcloud-Last auslösen,
// später liefe der Read wieder hinter dem nutzer.json-Read her.
async function getVerifiedSession(request, env, authHeader, onTokenValid) {
  const payload = await getSession(request, env);
  if (!payload) return null;
  // Vor dem Nutzer-Abgleich, damit ein Token von vor dem Stichtag gar keinen
  // Nextcloud-Lesezugriff mehr auslöst.
  if ((Number(payload.iat) || 0) < SESSIONS_INVALID_BEFORE) return null;
  if (onTokenValid) onTokenValid(payload);
  const usersDoc = await readJson(env.NEXTCLOUD_NUTZER_URL, authHeader, emptyUsersDoc());
  const user = getOwn(usersDoc.users, String(payload.username || ""));
  if (!user || user.mustSetPassword || !user.passwordHash) return null;
  // Archivierte Konten (Personalakte) verlieren jede Session sofort, nicht nur
  // künftige Logins — usersDoc wird oben ohnehin bei jedem Request frisch
  // gelesen, also reicht ein einzelner Check hier.
  if (user.archiviert) return null;
  if (user.passwordSetAt) {
    const setAt = Math.floor(Date.parse(user.passwordSetAt) / 1000);
    if (Number.isFinite(setAt) && (Number(payload.iat) || 0) < setAt) return null;
  }
  const identity = deriveIdentity(user, usersDoc);
  // art bewusst NACH ...identity und aus dem echten Datensatz: anders als isAdmin/
  // groupIds ist die Art nicht Teil der Testansicht (set-view-as). Ein Admin, der
  // sich testweise als Gruppe ausgibt, bleibt Personal -- sonst würde die
  // Testansicht die Personal/Spieler-Trennung aushebeln statt sie zu zeigen.
  return { username: user.username, usersDoc, ...identity, art: userArt(user) };
}

// ---------- sonstige Helfer ----------

function normalizeUsername(raw) {
  // Umlaute EXAKT wie beim Anlegen transliterieren (generateUsername -> slugifyNamePart
  // -> transliterate: ö->oe usw.), sonst wird "Uwe Förster" beim Login zu "uwe.förster",
  // der Account liegt aber unter "uwe.foerster" -> Konto nie gefunden, 401 statt
  // needsPasswordSetup (Login zeigt fälschlich das Passwort-Feld statt "Konto einrichten").
  return transliterate(String(raw || "")).trim().toLowerCase().replace(/\s+/g, ".");
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
