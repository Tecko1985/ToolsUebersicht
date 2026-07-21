const APP_VERSION = "1.0";

// WhatsApp-Kontakt für die Hilfe-Kachel im Feedback-Tab (intl. Format ohne "+"/Leerzeichen,
// direkt für eine wa.me-URL nutzbar — siehe setupWhatsappLink() in app.js).
const WHATSAPP_CONTACT = "491778587294";

// Statische Stammdaten aller Tool-Links. Die Sichtbarkeit (visible) wird NICHT
// hier gepflegt, sondern zur Laufzeit vom Admin-Worker geladen/überschrieben
// (siehe admin-worker.js) — nur die Existenz eines Tools + seine Metadaten
// (inkl. version) ändern sich hier, das braucht einen Code-Push und muss von
// Hand mit der jeweiligen Version des verlinkten Tools synchron gehalten werden.
const TOOLS = [
  {
    id: "trainerdaten",
    name: "Trainerdaten",
    description: "Trainer-Stammdaten erfassen, Trainerverträge automatisch als Word-Dokument erzeugen und digital unterschreiben, dazu Führerschein, Führungszeugnis und Trainerlizenz zentral hochladen und verwalten.",
    url: "https://tecko1985.github.io/Trainerdaten/",
    icon: "📝",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "trainercheckliste",
    name: "TrainerCheckliste",
    description: "Digitale Checkliste für Trainerzu- und -abgang im Nachwuchsbereich.",
    url: "https://tecko1985.github.io/TrainerCheckliste/",
    icon: "📋",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "materialliste",
    name: "Materialliste",
    description: "Vereinsmaterial (Trikots, Bälle, Leibchen) pro Mannschaft verwalten.",
    url: "https://tecko1985.github.io/Materialliste/",
    icon: "🎽",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "sc1911-anmeldung",
    name: "Trainerversammlung-Anmeldung",
    description: "Digitales Anmeldesystem für Trainerversammlungen beim 1. SC 1911 Heiligenstadt.",
    url: "https://tecko1985.github.io/sc1911-anmeldung/verwaltung.html",
    icon: "🗳️",
    category: "Verein",
    version: "1.0",
    devices: ["desktop"]
  },
  {
    id: "vereinsbudget",
    name: "Vereinsbudget",
    description: "Budgetübersicht, Einnahmen/Ausgaben und Belegverwaltung für den Kassierer.",
    url: "https://tecko1985.github.io/sc-heiligenstadt-budget/vereinsbudget.html",
    icon: "💶",
    category: "Verein",
    version: "1.0",
    devices: ["desktop"]
  },
  {
    id: "beleg-eingang",
    name: "Beleg-Eingang",
    description: "Mobiles Formular für Helfer zum Einreichen von Belegen.",
    url: "https://tecko1985.github.io/sc-heiligenstadt-budget/beleg-eingang.html",
    icon: "🧾",
    category: "Verein",
    version: "1.0",
    devices: ["mobile"]
  },
  {
    id: "geschaeftsstelle",
    name: "Geschäftsstelle",
    description: "Eingegangene Belege prüfen, korrigieren und als geprüft markieren — ohne Einblick in die Budgetplanung.",
    url: "https://tecko1985.github.io/sc-heiligenstadt-budget/geschaeftsstelle.html",
    icon: "📋",
    category: "Verein",
    version: "1.0",
    devices: ["desktop"]
  },
  {
    id: "spielertool-test",
    name: "Spielertool",
    description: "Bewertung und Förderung von Nachwuchsspielern im Vereinsbetrieb.",
    url: "https://tecko1985.github.io/spielertool-test/",
    icon: "⚽",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "vereinskalender",
    name: "Vereinskalender",
    description: "Kommende Vereinstermine im Überblick (gesperrte Hallen/Plätze, Trainingszeiten, Veranstaltungen) — Pflege durch die Geschäftsstelle.",
    url: "https://tecko1985.github.io/vereinskalender/",
    icon: "📅",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "platzbelegung",
    name: "Platzbelegung",
    description: "Belegungsplan für Trainingsplätze und Halle — wer nutzt wann welchen Platz.",
    url: "https://tecko1985.github.io/platzbelegung/",
    icon: "🏟️",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "spielersichtung",
    name: "Spielersichtung",
    description: "Sichtung und Bewertung von Nachwuchsspielern für Kader- und Förderentscheidungen.",
    url: "https://tecko1985.github.io/spielersichtung/",
    icon: "🔍",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "personalkosten",
    name: "Personalkosten",
    description: "Personalkosten / Aufwandsentschädigungen der Mannschaften planen und auswerten (nur für berechtigte Gruppe).",
    url: "https://tecko1985.github.io/Personalkosten/",
    icon: "💶",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "kadermanager",
    name: "Kadermanager",
    description: "Vereinsinterne Alternative zu SpielerPlus: Termine mit An-/Abmeldung, Aufgaben, Aufstellung/Taktikboard, Spielberichte, Urlaub/Krank, Umfragen und Mannschaftskasse je Mannschaft.",
    url: "https://tecko1985.github.io/kadermanager/",
    icon: "⚽",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "busplan",
    name: "Busplan",
    description: "Bus-/Transportplanung für die Auswärtsspiele der Nachwuchsmannschaften (nur für berechtigte Gruppe).",
    url: "https://tecko1985.github.io/busplan/",
    icon: "🚌",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "digitaler-stempel",
    name: "Digitaler Stempel",
    description: "PDF- und Word-Dokumente digital stempeln (Position, Größe, Drehung und Deckkraft frei wählbar) — jede Stempelung wird mit Nutzer und Zeitpunkt archiviert (nur für berechtigte Gruppe).",
    url: "https://tecko1985.github.io/digitaler-stempel/",
    icon: "🖋️",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "kleiderbestellung",
    name: "Kleiderbestellung",
    description: "Trainer:innen bestellen Vereinskleidung/-ausrüstung mit ihrer Größe aus einem Artikelkatalog; Admin verwaltet Katalog und Bestellfenster und exportiert eine Lieferanten-Bestellliste.",
    url: "https://tecko1985.github.io/kleiderbestellung/",
    icon: "👕",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "fahrtenbuch",
    name: "Fahrtenbuch",
    description: "Digitale Fahrer-Checkliste für Vereinsfahrzeuge: Fahrt mit Fahrzeug-/Fahrtdaten und Sicherheits-Checklisten erfassen, Mängel mit Fotos hochladen, unterschreiben.",
    url: "https://tecko1985.github.io/fahrtenbuch/",
    icon: "🚐",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "fahrtenbuch-extern",
    name: "Fahrtenbuch (extern)",
    description: "Für Eltern ohne Vereinskonto: Fahrt mit einem Vereinsfahrzeug eintragen und Führerschein-Kopie hochladen — zugriffscode-geschützt statt Login.",
    url: "https://tecko1985.github.io/fahrtenbuch/extern.html",
    icon: "🔗",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "spiele",
    name: "Spiele",
    description: "Mini-Spiele-Sammlung fürs Team: Auto-, Fußball- und Fußball-Vereine-Quartett sowie Elfmeterschießen als Echtzeit-Duell (auch solo gegen eine KI) — ideal für die Busfahrt zur Auswärtsfahrt.",
    url: "https://tecko1985.github.io/spiele/",
    icon: "🎮",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "materialbedarf",
    name: "Materialbedarf",
    description: "Trainer:innen melden Materialbedarf (z.B. neue Bälle, Erste-Hilfe-Set) an den Verein; Admin entscheidet über Annahme/Ablehnung und markiert den Kauf.",
    url: "https://tecko1985.github.io/materialbedarf/",
    icon: "🛒",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "testspielplaner",
    name: "Testspielplaner",
    description: "Testspiele und Leistungsvergleiche planen: Termin anfragen, Admin genehmigt nach DFBnet-Eintragung, Gegner wird nachgetragen — mit Saison-Kontingent je Trainer.",
    url: "https://tecko1985.github.io/testspielplaner/",
    icon: "🆚",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "personalakte",
    name: "Personalakte",
    description: "Zusammengeführte Trainer-Übersicht für die Geschäftsstelle: Stammdaten, Vertrags-/Kodex-Status, Checklisten, Führerschein, Personalkosten und Kadermanager-Rolle auf einen Blick, inkl. Archivieren/Reaktivieren ausgeschiedener Trainer (nur für berechtigte Gruppe).",
    url: "https://tecko1985.github.io/personalakte/",
    icon: "🗂️",
    category: "Verein",
    version: "1.0",
    devices: ["desktop"]
  },
  {
    id: "fotoauftraege",
    name: "Fotoaufträge",
    description: "Das Social-Media-Team fragt Fotos von einer Mannschaft an; der zuständige Trainer legt per Klick einen eigenen, freigegebenen Nextcloud-Ordner für den Bilder-Upload an und bekommt einen teilbaren Link.",
    url: "https://tecko1985.github.io/fotoauftraege/",
    icon: "📸",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "abwesenheitskalender",
    name: "Abwesenheitskalender",
    description: "Übersicht, wer wann abwesend ist (Urlaub, Krankheit, Fortbildung u.a.) — jede:r Berechtigte trägt eigene Abwesenheiten ein, alle mit Tool-Zugriff sehen die komplette Übersicht.",
    url: "https://tecko1985.github.io/abwesenheitskalender/",
    icon: "🧳",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "besprechung",
    name: "Besprechung",
    description: "Digitaler Treffpunkt für Trainer: Sprachraum direkt im Browser, inklusive Bildschirm teilen — z. B. für die hybride Trainerversammlung.",
    url: "https://tecko1985.github.io/besprechung/",
    icon: "🎙️",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"],
    newTab: true
  },
  {
    id: "dokumentenvorlagen",
    name: "Dokumentenvorlagen",
    description: "Word-Vorlagen (Trainervertrag, Anfragen, Bescheinigungen) mit Platzhaltern zentral verwalten und in einem Rutsch für viele Empfänger befüllen — Daten aus dem Trainerprofil oder (mit App-Passwort) aus den Trainerdaten inkl. Adresse/Bankverbindung; Ausgabe als Word-Dokumente, originalgetreue PDFs über ein beiliegendes Skript (nur für berechtigte Gruppe).",
    url: "https://tecko1985.github.io/dokumentenvorlagen/",
    icon: "📄",
    category: "Verein",
    version: "1.0",
    devices: ["desktop"]
  }
];

// Neuigkeiten über den Kacheln. Werden ausschließlich vom Admin im Einstellungen-Tab
// gepflegt und serverseitig in Nextcloud (news-Key der Config) gespeichert; renderNews()
// läuft erst, wenn die Server-Antwort da ist. Dieses Array ist NUR noch der Fallback für
// den Erstbetrieb (Admin hat noch nie gespeichert) bzw. einen nicht erreichbaren Worker.
// **Bewusst leer** — vorher standen hier 13 alte Meldungen aus dem Juli 2026, die beim
// Laden jedes Mal kurz als Karussell aufblitzten, bevor die echte Server-News sie ersetzte.
// Wer hier wieder etwas einträgt, holt sich dieses Aufblitzen zurück.
// Felder: date "YYYY-MM-DD" | type "neu"|"update"|"fix"|"hinweis" | title | text
//         | toolId (optional; verlinkt auf den passenden TOOLS-Eintrag)
const NEWS = [];

const APP_CHANGELOG = [
  {
    version: "1.0",
    groups: [
      {
        title: "Tools-Übersicht",
        items: [
          "Kartenraster mit Links zu allen Vereins-Tools, gruppiert nach Kategorie.",
          "Jede Tool-Karte zeigt die Version des verlinkten Tools sowie das geeignete Endgerät (📱 Handy, 💻 Laptop, oder beides).",
          "Tool-Karten lassen sich per Greifpunkt frei verschieben und innerhalb ihrer Kategorie neu anordnen (Maus und Touch); die eigene Reihenfolge wird im Browser gemerkt.",
          "Nach dem Anmelden ist der eigene Nutzername (inkl. Admin-Kennzeichnung) direkt im Header sichtbar; Vereinswappen im Header und in allen verlinkten Apps.",
          "Ist niemand angemeldet und dadurch kein Tool sichtbar, erscheint ein Hinweis mit 'Jetzt anmelden'-Button statt einer reinen Leermeldung.",
          "Tool-Kacheln, Neuigkeiten-Verlinkungen und das Termine-Widget öffnen das jeweilige Tool im selben Browser-Tab; jedes verlinkte Tool hat dafür oben einen 'Zurück zum Dashboard'-Link."
        ]
      },
      {
        title: "Dashboard: Neuigkeiten & Termine",
        items: [
          "Neuigkeiten-Bereich über den Kacheln als Karussell (eine Meldung sichtbar, per Pfeiltasten blätterbar, Positionsanzeige z.B. '2 / 5'), für alle Besucher sichtbar auch ohne Login. Admins pflegen Neuigkeiten direkt im Einstellungen-Tab (anlegen, bearbeiten, löschen — Typ Neu/Update/Fix/Hinweis, Datum, Titel, Text, optionale Tool-Verknüpfung), zentral in Nextcloud gespeichert und sofort für alle sichtbar.",
          "Widget 'Nächste Termine' zeigt bis zu 8 anstehende Vereinstermine aus dem Vereinskalender, dazu die nächsten anstehenden Einträge aus dem Abwesenheitskalender, sofern Zugriff besteht. Private Termine stehen in einem eigenen Bereich darunter und werden nur dem jeweiligen Ersteller bzw. den damit geteilten Personen/Gruppen angezeigt.",
          "Hat laut Trainerdaten heute jemand Geburtstag, erscheint das als eigener Eintrag ganz oben im Termine-Widget (🎂 Name hat Geburtstag) — nur am Geburtstag selbst, ohne Geburtsjahr."
        ]
      },
      {
        title: "Login & Nutzerverwaltung",
        items: [
          "Echte Nutzerkonten statt geteiltem PIN: Admin legt per Vorname/Nachname an (Nutzername wird automatisch generiert), jeder Nutzer vergibt sich selbst ein Passwort beim ersten Login.",
          "Anmeldung ist zweistufig: erst nur Nutzername eingeben, danach je nach Ergebnis entweder Passwortfeld (bestehender Account) oder das Formular 'Konto einrichten' (erster Login) — beide Schritte mit 'Zurück'-Button zur Nutzernamen-Eingabe.",
          "Neue Passwörter müssen mindestens 12 Zeichen lang sein und Groß- und Kleinbuchstaben sowie eine Zahl oder ein Sonderzeichen enthalten.",
          "Passwörter werden mit PBKDF2 (Web Crypto, 100.000 Iterationen, Salt pro Nutzer) gehasht, niemals im Klartext gespeichert. Sessions sind signierte Bearer-Token (30 Tage gültig).",
          "Admin kann Nutzer bearbeiten (Vorname, Nachname, Admin-Status, „Vertrag benötigt“ unabhängig von der Gruppe „Trainer“), löschen oder ihr Passwort zurücksetzen — dem letzten Admin-Konto kann der Admin-Status nicht entzogen werden, es kann auch nicht gelöscht werden.",
          "Text-Massenimport für größere Listen: ein Name pro Zeile, alle durchlaufen beim ersten Login den normalen Erstlogin-Flow.",
          "Beim allerersten Besuch überhaupt (noch kein Nutzerkonto vorhanden) öffnet sich automatisch das Formular zum Anlegen des Admin-Kontos; danach ist dieser Weg dauerhaft gesperrt.",
          "Wird Vor- oder Nachname eines Kontos im Bearbeiten-Panel korrigiert, zieht der Login-Nutzername automatisch mit um (z. B. „alex.rohner“ → „alexander.rohner“). Kollidiert die neue Kennung mit einem bereits bestehenden Konto, bleibt der Nutzername unverändert und ein Warnhinweis erscheint."
        ]
      },
      {
        title: "Nutzergruppen & Sichtbarkeit",
        items: [
          "Gruppen anlegen (z.B. 'Vorstand', 'Trainer U15'), Mitglieder per Checkbox zuordnen — direkt in der Nutzerliste oder in der Gruppenverwaltung.",
          "Sichtbarkeit pro Tool über ein einzelnes Dropdown mit vier eindeutigen Zuständen: Versteckt, Öffentlich, Alle eingeloggten Nutzer, oder Nur bestimmte Gruppen (Gruppen-Auswahl erscheint dann darunter). Der 'Apps'-Bereich je Gruppe legt alternativ direkt fest, welche Tools diese Gruppe nutzen darf.",
          "Pro App und Gruppe lässt sich neben 'Sehen' zusätzlich 'Bearbeiten' vergeben — sowohl im Gruppen-Bereich als auch in der Ansicht 'Sichtbarkeit der Tools'. Ersetzt die früher nötigen dedizierten Bearbeiter-Gruppen je App; die jeweilige App fragt diese Berechtigung selbst ab.",
          "Entfernt man einer Gruppe die letzte Tool-Zuordnung, wird das Tool wieder versteckt statt für alle eingeloggten Nutzer sichtbar zu werden. Eine gelöschte Gruppe wird automatisch aus allen Tool-Zuordnungen entfernt."
        ]
      },
      {
        title: "WebDAV-Login-Gateway",
        items: [
          "Andere Vereins-Apps, die ihre Daten in derselben Nextcloud speichern, nutzen dieselbe Anmeldung: kein eigenes WebDAV-Formular und kein App-Passwort mehr in diesen Apps nötig.",
          "Der Worker prüft Login-Token und Gruppen-Sichtbarkeit, bevor er serverseitig mit den Vereins-Zugangsdaten auf die jeweilige Nextcloud-Datei zugreift — der Client erhält nie ein Passwort zu Gesicht.",
          "Konfliktschutz: Speichern zwei Geräte gleichzeitig, wird der Konflikt erkannt und gemeldet, statt dass eine Änderung stillschweigend verloren geht.",
          "Ist Nextcloud vorübergehend nicht erreichbar, antwortet der Worker mit einer klaren Fehlermeldung statt mit leeren Daten — kein Speichervorgang kann dadurch Bestandsdaten überschreiben.",
          "Zentrale Passwortprüfung für geschützte Aktionen der Tool-Apps (z. B. Checklisten entsperren, Saison leeren): Die Passwörter liegen als Worker-Secrets auf dem Server statt lesbar im Quellcode der Apps."
        ]
      },
      {
        title: "Admin-Dashboard",
        items: [
          "Eigene Dashboard-Ansicht (Zugang über einen zentrierten Button in der Kopfzeile, nur für Admins sichtbar) zeigt Kennzahlen auf einen Blick: Nutzer-Anmeldequote, Trainervertrag-, Trainerkodex- und Jugendschutzkonzept-Quote (bezogen auf die Gruppe „Trainer“, Trainervertrag zählt Gruppen-Mitglieder und individuell markierte Nutzer zusammen), offene Feedback- & Hilfe-Einträge, offene Materialbedarf-Meldungen, offene/klärungsbedürftige Busplan-Zusagen der aktuellen Saison sowie offene Testspiel-Anfragen.",
          "Ist die Gruppe „Trainer“ noch nicht angelegt, weist das Dashboard klar darauf hin statt einer irreführenden 0-von-0-Quote.",
          "Die Kennzahlen-Kacheln sind anklickbar und springen direkt zum jeweiligen Bereich.",
          "Dropdown „Zuletzt aktiv“ zeigt wahlweise die letzten 5 Anmeldungen, Trainervertrags-Einreichungen, Trainerkodex- oder Jugendschutzkonzept-Bestätigungen mit Name und Zeitpunkt.",
          "Karte „📦 Exporte“ sammelt die Export-Funktionen mehrerer Apps an einem Ort (Materialliste, Personalkosten, Busplan, Kleiderbestellung, Materialbedarf, Spielerbewertung); Apps mit eigenem, nicht zentral eingebundenem Export verlinken direkt auf die jeweilige App."
        ]
      },
      {
        title: "Admin-Testansicht",
        items: [
          "Umschalter oben rechts im Header (nur für Admins): eine Gruppe wählen, um Dashboard UND alle verlinkten Apps genau so zu sehen, wie ein echtes Mitglied dieser Gruppe sie sehen würde — inklusive echter Zugriffsbeschränkungen (z. B. Personalakte, Bearbeiten-Rechte). Spart das ständige Aus- und Wieder-Einloggen mit einem Test-Account. Ein deutlich sichtbarer Badge („🎭 Testansicht“) erinnert daran, dass gerade eine simulierte Rolle aktiv ist; „👑 Admin (echt)“ schaltet jederzeit zurück."
        ]
      },
      {
        title: "Tool-Kacheln: Status-Hinweise",
        items: [
          "Einzelne Tool-Kacheln zeigen zusätzlich einen eigenen Status- oder Erinnerungs-Badge, wenn dort für die eigene Person etwas ansteht — z. B. ein Ampel-Badge bei Trainerdaten (Stammdaten, Lizenz, Führerschein, Führungszeugnis, Kodex vollständig/aktuell?) mit manuellem Neulade-Knopf, oder ein Hinweis bei Testspielplaner, wenn ein genehmigter Termin bald keinen Gegner hat."
        ]
      },
      {
        title: "Feedback & Hilfe",
        items: [
          "Ganz oben im Tab „Feedback & Hilfe“ lässt sich direkt eine Frage ans Toolbox Wiki stellen, bevor man Feedback gibt oder Hilfe anfragt."
        ]
      },
      {
        title: "Admin-Tab & Bedienung",
        items: [
          "Alle Admin-Bereiche (Nutzer, Massenimport, Gruppen, Sichtbarkeit, Versionshistorie) sind einzeln auf-/zuklappbar und standardmäßig eingeklappt.",
          "Namen mit Sonderzeichen (z.B. Anführungszeichen) werden in allen Formularen korrekt maskiert.",
          "Der Versionshinweis oben neben dem Titel ist anklickbar und führt direkt zur aufgeklappten Versionshistorie in den Einstellungen."
        ]
      },
      {
        title: "Daten & Speicherung",
        items: [
          "Sichtbarkeits-Konfiguration und Nutzerkonten werden zentral über Nextcloud gespeichert (zwei JSON-Dateien) und gelten für alle Besucher, ohne zusätzliches Worker-Secret für Gruppen."
        ]
      }
    ]
  }
];
