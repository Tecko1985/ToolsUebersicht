const APP_VERSION = "1.16";

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
    description: "Trainer-Stammdaten erfassen und Trainerverträge automatisch als Word-Dokument erzeugen.",
    url: "https://tecko1985.github.io/Trainerdaten/",
    icon: "📝",
    category: "Verein",
    version: "1.6",
    devices: ["mobile", "desktop"]
  },
  {
    id: "trainercheckliste",
    name: "TrainerCheckliste",
    description: "Digitale Checkliste für Trainerzu- und -abgang im Nachwuchsbereich.",
    url: "https://tecko1985.github.io/TrainerCheckliste/",
    icon: "📋",
    category: "Verein",
    version: "1.1",
    devices: ["mobile", "desktop"]
  },
  {
    id: "materialliste",
    name: "Materialliste",
    description: "Vereinsmaterial (Trikots, Bälle, Leibchen) pro Mannschaft verwalten.",
    url: "https://tecko1985.github.io/Materialliste/",
    icon: "🎽",
    category: "Verein",
    version: "1.1",
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
    version: "1.3",
    devices: ["mobile", "desktop"]
  },
  {
    id: "vereinskalender",
    name: "Vereinskalender",
    description: "Kommende Vereinstermine im Überblick (gesperrte Hallen/Plätze, Trainingszeiten, Veranstaltungen) — Pflege durch die Geschäftsstelle.",
    url: "https://tecko1985.github.io/vereinskalender/",
    icon: "📅",
    category: "Verein",
    version: "1.1",
    devices: ["mobile", "desktop"]
  },
  {
    id: "platzbelegung",
    name: "Platzbelegung",
    description: "Belegungsplan für Trainingsplätze und Halle — wer nutzt wann welchen Platz.",
    url: "https://tecko1985.github.io/platzbelegung/",
    icon: "🏟️",
    category: "Verein",
    version: "1.1",
    devices: ["mobile", "desktop"]
  },
  {
    id: "spielersichtung",
    name: "Spielersichtung",
    description: "Sichtung und Bewertung von Nachwuchsspielern für Kader- und Förderentscheidungen.",
    url: "https://tecko1985.github.io/spielersichtung/",
    icon: "🔍",
    category: "Verein",
    version: "1.2",
    devices: ["mobile", "desktop"]
  },
  {
    id: "trainerkodex",
    name: "Trainerkodex",
    description: "Verhaltenskodex für Trainer:innen — digital einsehbar und bestätigbar.",
    url: "https://tecko1985.github.io/trainerkodex/",
    icon: "📜",
    category: "Verein",
    version: "1.3",
    devices: ["mobile", "desktop"]
  },
  {
    id: "personalkosten",
    name: "Personalkosten",
    description: "Personalkosten / Aufwandsentschädigungen der Mannschaften planen und auswerten (nur für berechtigte Gruppe).",
    url: "https://tecko1985.github.io/Personalkosten/",
    icon: "💶",
    category: "Verein",
    version: "1.2",
    devices: ["mobile", "desktop"]
  },
  {
    id: "kadermanager",
    name: "Kadermanager",
    description: "Vereinsinterne Alternative zu SpielerPlus: Termine mit An-/Abmeldung, Aufgaben, Aufstellung, Spielberichte, Urlaub/Krank, Umfragen, Mannschaftskasse und Dateiablage je Mannschaft.",
    url: "https://tecko1985.github.io/kadermanager/",
    icon: "⚽",
    category: "Verein",
    version: "1.3",
    devices: ["mobile", "desktop"]
  },
  {
    id: "busplan",
    name: "Busplan",
    description: "Bus-/Transportplanung für die Auswärtsspiele der Nachwuchsmannschaften (nur für berechtigte Gruppe).",
    url: "https://tecko1985.github.io/busplan/",
    icon: "🚌",
    category: "Verein",
    version: "1.4",
    devices: ["mobile", "desktop"]
  },
  {
    id: "digitaler-stempel",
    name: "Digitaler Stempel",
    description: "PDF-Dokumente digital stempeln (Position, Größe, Drehung frei wählbar) — jede Stempelung wird mit Nutzer und Zeitpunkt archiviert (nur für berechtigte Gruppe).",
    url: "https://tecko1985.github.io/digitaler-stempel/",
    icon: "🖋️",
    category: "Verein",
    version: "1.2",
    devices: ["mobile", "desktop"]
  },
  {
    id: "kleiderbestellung",
    name: "Kleiderbestellung",
    description: "Trainer:innen bestellen Vereinskleidung/-ausrüstung mit ihrer Größe aus einem Artikelkatalog; Admin verwaltet Katalog und Bestellfenster und exportiert eine Lieferanten-Bestellliste.",
    url: "https://tecko1985.github.io/kleiderbestellung/",
    icon: "👕",
    category: "Verein",
    version: "1.2",
    devices: ["mobile", "desktop"]
  },
  {
    id: "fahrtenbuch",
    name: "Fahrtenbuch",
    description: "Digitale Fahrer-Checkliste für Vereinsfahrzeuge: Fahrt mit Fahrzeug-/Fahrtdaten und Sicherheits-Checklisten erfassen, Mängel mit Fotos hochladen, unterschreiben — plus Führerschein-Kopie je Saison hinterlegen.",
    url: "https://tecko1985.github.io/fahrtenbuch/",
    icon: "🚐",
    category: "Verein",
    version: "1.6",
    devices: ["mobile", "desktop"]
  },
  {
    id: "spiele",
    name: "Spiele",
    description: "Mini-Spiele-Sammlung fürs Team — den Anfang macht Auto-Quartett, ideal für die Busfahrt zur Auswärtsfahrt.",
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
    version: "1.1",
    devices: ["mobile", "desktop"]
  }
];

// Neuigkeiten über den Kacheln. SEIT v1.2 werden diese normalerweise vom Admin im
// Einstellungen-Tab gepflegt und serverseitig in Nextcloud (news-Key der Config)
// gespeichert — dieses Array ist nur noch der Erst-Seed (solange der Admin noch nie
// gespeichert hat) und der Fallback, falls der Worker nicht erreichbar ist. Sortierung
// erfolgt beim Rendern nach date (neueste zuerst) — Reihenfolge hier egal.
// Felder: date "YYYY-MM-DD" | type "neu"|"update"|"fix"|"hinweis" | title | text
//         | toolId (optional; verlinkt auf den passenden TOOLS-Eintrag)
const NEWS = [
  {
    date: "2026-07-07",
    type: "neu",
    title: "Spiele ist online",
    text: "Neue Mini-Spiele-Sammlung fürs Team: den Anfang macht Auto-Quartett als digitales Multiplayer-Kartenspiel, ideal für die Busfahrt zur Auswärtsfahrt.",
    toolId: "spiele",
  },
  {
    date: "2026-07-06",
    type: "neu",
    title: "Fahrtenbuch ist online",
    text: "Die Fahrer-Checkliste für Vereinsfahrzeuge gibt es jetzt digital: Fahrt erfassen, Checklisten abhaken, Mängel mit Foto dokumentieren, unterschreiben und die Führerschein-Kopie je Saison hinterlegen.",
    toolId: "fahrtenbuch",
  },
  {
    date: "2026-07-06",
    type: "neu",
    title: "Kleiderbestellung ist online",
    text: "Trainer:innen können jetzt Vereinskleidung/-ausrüstung mit ihrer Größe direkt online bestellen.",
    toolId: "kleiderbestellung",
  },
  {
    date: "2026-07-06",
    type: "update",
    title: "Kadermanager stark erweitert",
    text: "Neu: Rollen je Spieler mit granularen Rechten, Aufgaben/Aufstellung/Spielberichte je Termin, Urlaub/Krank, Kasse-Kategorien mit Stornos und eine Dateiablage je Mannschaft.",
    toolId: "kadermanager",
  },
  {
    date: "2026-07-06",
    type: "neu",
    title: "Digitaler Stempel ist online",
    text: "PDF-Dokumente digital stempeln — jede Stempelung wird automatisch mit Nutzer und Zeitpunkt archiviert.",
    toolId: "digitaler-stempel",
  },
  {
    date: "2026-07-05",
    type: "neu",
    title: "Busplan-Tool ist online",
    text: "Bus-/Transportplanung für die Auswärtsspiele der Nachwuchsmannschaften löst die bisherige Excel-Liste ab.",
    toolId: "busplan",
  },
  {
    date: "2026-07-03",
    type: "neu",
    title: "Vereinskalender ist online",
    text: "Die als Nächstes anstehenden Vereinstermine (gesperrte Hallen/Plätze, Trainingszeiten, Veranstaltungen) jetzt auf einen Blick — Pflege durch die Geschäftsstelle.",
    toolId: "vereinskalender",
  },
  {
    date: "2026-07-03",
    type: "neu",
    title: "Neuigkeiten-Bereich",
    text: "Diese Übersicht hat jetzt oben einen Bereich für Neuigkeiten rund um die Vereins-Tools.",
  },
  {
    date: "2026-07-03",
    type: "neu",
    title: "Personalkosten-Tool ist online",
    text: "Aufwandsentschädigungen der Mannschaften lassen sich jetzt planen und auswerten.",
    toolId: "personalkosten",
  },
  {
    date: "2026-07-03",
    type: "update",
    title: "Platzbelegung: Hallenbelegung ergänzt",
    text: "Neben den Trainingsplätzen kann jetzt auch die Hallenbelegung geplant werden.",
    toolId: "platzbelegung",
  },
];

const APP_CHANGELOG = [
  {
    version: "1.16",
    groups: [
      {
        title: "Admin-Dashboard",
        items: [
          "Einstieg ins Admin-Dashboard von einer Kachel auf der Übersicht in einen zentrierten Button in der Kopfzeile umgestellt (nur für Admins sichtbar)."
        ]
      }
    ]
  },
  {
    version: "1.15",
    groups: [
      {
        title: "Admin-Dashboard",
        items: [
          "Neue Kachel „Admin-Dashboard“ oben auf der Übersicht (nur für Admins sichtbar) führt in eine eigene Ansicht mit sechs Kennzahlen auf einen Blick: Nutzer-Anmeldequote, Trainervertrag- und Trainerkodex-Quote (bezogen auf die Gruppe „Trainer“), offene Feedback- & Hilfe-Einträge, offene Materialbedarf-Meldungen sowie offene/klärungsbedürftige Busplan-Zusagen der aktuellen Saison.",
          "Ist die Gruppe „Trainer“ noch nicht angelegt, weist das Dashboard klar darauf hin statt einer irreführenden 0-von-0-Quote."
        ]
      }
    ]
  },
  {
    version: "1.14",
    groups: [
      {
        title: "Neues Tool",
        items: [
          "Materialbedarf: Trainer:innen melden Materialbedarf mit mehreren Positionen, Grund und Dringlichkeit; Admin entscheidet über Annahme/Ablehnung und markiert den Kauf, mit Text-/PDF-Export."
        ]
      }
    ]
  },
  {
    version: "1.13",
    groups: [
      {
        title: "Neues Tool",
        items: [
          "Spiele: Mini-Spiele-Sammlung fürs Team, startet mit Auto-Quartett als digitalem Multiplayer-Kartenspiel für die Busfahrt zur Auswärtsfahrt."
        ]
      }
    ]
  },
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
          "Widget 'Nächste Termine' zeigt bis zu 8 anstehende Vereinstermine aus dem Vereinskalender. Private Termine stehen in einem eigenen Bereich darunter und werden nur dem jeweiligen Ersteller bzw. den damit geteilten Personen/Gruppen angezeigt."
        ]
      },
      {
        title: "Login & Nutzerverwaltung",
        items: [
          "Echte Nutzerkonten statt geteiltem PIN: Admin legt per Vorname/Nachname an (Nutzername wird automatisch generiert), jeder Nutzer vergibt sich selbst ein Passwort beim ersten Login.",
          "Anmeldung ist zweistufig: erst nur Nutzername eingeben, danach je nach Ergebnis entweder Passwortfeld (bestehender Account) oder das Formular 'Konto einrichten' (erster Login) — beide Schritte mit 'Zurück'-Button zur Nutzernamen-Eingabe.",
          "Neue Passwörter müssen mindestens 12 Zeichen lang sein und Groß- und Kleinbuchstaben sowie eine Zahl oder ein Sonderzeichen enthalten.",
          "Passwörter werden mit PBKDF2 (Web Crypto, 100.000 Iterationen, Salt pro Nutzer) gehasht, niemals im Klartext gespeichert. Sessions sind signierte Bearer-Token (30 Tage gültig).",
          "Admin kann Nutzer bearbeiten (Vorname, Nachname, Admin-Status), löschen oder ihr Passwort zurücksetzen — dem letzten Admin-Konto kann der Admin-Status nicht entzogen werden, es kann auch nicht gelöscht werden.",
          "Text-Massenimport für größere Listen: ein Name pro Zeile, alle durchlaufen beim ersten Login den normalen Erstlogin-Flow.",
          "Beim allerersten Besuch überhaupt (noch kein Nutzerkonto vorhanden) öffnet sich automatisch das Formular zum Anlegen des Admin-Kontos; danach ist dieser Weg dauerhaft gesperrt."
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
        title: "Admin-Tab & Bedienung",
        items: [
          "Alle Admin-Bereiche (Nutzer, Massenimport, Gruppen, Sichtbarkeit, Versionshistorie) sind einzeln auf-/zuklappbar und standardmäßig eingeklappt.",
          "Namen mit Sonderzeichen (z.B. Anführungszeichen) werden in allen Formularen korrekt maskiert."
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
