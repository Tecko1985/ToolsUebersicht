const APP_VERSION = "1.10";

// Statische Stammdaten aller Tool-Links. Die Sichtbarkeit (visible) wird NICHT
// hier gepflegt, sondern zur Laufzeit vom Admin-Worker geladen/überschrieben
// (siehe admin-worker.js) — nur die Existenz eines Tools + seine Metadaten
// (inkl. version) ändern sich hier, das braucht einen Code-Push und muss von
// Hand mit der jeweiligen Version des verlinkten Tools synchron gehalten werden.
const TOOLS = [
  {
    id: "trainervertrag",
    name: "TrainerVertrag",
    description: "Trainer-Stammdaten erfassen und Trainerverträge automatisch als Word-Dokument erzeugen.",
    url: "https://tecko1985.github.io/TrainerVertrag/",
    icon: "📝",
    category: "Verein",
    version: "1.1",
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
    version: "1.1",
    devices: ["desktop"]
  },
  {
    id: "beleg-eingang",
    name: "Beleg-Eingang",
    description: "Mobiles Formular für Helfer zum Einreichen von Belegen.",
    url: "https://tecko1985.github.io/sc-heiligenstadt-budget/beleg-eingang.html",
    icon: "🧾",
    category: "Verein",
    version: "1.1",
    devices: ["mobile"]
  },
  {
    id: "geschaeftsstelle",
    name: "Geschäftsstelle",
    description: "Eingegangene Belege prüfen, korrigieren und als geprüft markieren — ohne Einblick in die Budgetplanung.",
    url: "https://tecko1985.github.io/sc-heiligenstadt-budget/geschaeftsstelle.html",
    icon: "📋",
    category: "Verein",
    version: "1.1",
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
    version: "1.5",
    devices: ["mobile", "desktop"]
  },
  {
    id: "platzbelegung",
    name: "Platzbelegung",
    description: "Belegungsplan für Trainingsplätze und Halle — wer nutzt wann welchen Platz.",
    url: "https://tecko1985.github.io/platzbelegung/",
    icon: "🏟️",
    category: "Verein",
    version: "1.5",
    devices: ["mobile", "desktop"]
  },
  {
    id: "spielersichtung",
    name: "Spielersichtung",
    description: "Sichtung und Bewertung von Nachwuchsspielern für Kader- und Förderentscheidungen.",
    url: "https://tecko1985.github.io/spielersichtung/",
    icon: "🔍",
    category: "Verein",
    version: "1.1",
    devices: ["mobile", "desktop"]
  },
  {
    id: "trainerkodex",
    name: "Trainerkodex",
    description: "Verhaltenskodex für Trainer:innen — digital einsehbar und bestätigbar.",
    url: "https://tecko1985.github.io/trainerkodex/",
    icon: "📜",
    category: "Verein",
    version: "1.1",
    devices: ["mobile", "desktop"]
  },
  {
    id: "personalkosten",
    name: "Personalkosten",
    description: "Personalkosten / Aufwandsentschädigungen der Mannschaften planen und auswerten (nur für berechtigte Gruppe).",
    url: "https://tecko1985.github.io/Personalkosten/",
    icon: "💶",
    category: "Verein",
    version: "1.1",
    devices: ["mobile", "desktop"]
  },
  {
    id: "kadermanager",
    name: "Kadermanager",
    description: "Vereinsinterne Alternative zu SpielerPlus: mehrere Mannschaften, Termine mit An-/Abmeldung, Anwesenheit, Umfragen und Mannschaftskasse.",
    url: "https://tecko1985.github.io/kadermanager/",
    icon: "⚽",
    category: "Verein",
    version: "1.4",
    devices: ["mobile", "desktop"]
  },
  {
    id: "busplan",
    name: "Busplan",
    description: "Bus-/Transportplanung für die Auswärtsspiele der Nachwuchsmannschaften (nur für berechtigte Gruppe).",
    url: "https://tecko1985.github.io/busplan/",
    icon: "🚌",
    category: "Verein",
    version: "1.7",
    devices: ["mobile", "desktop"]
  },
  {
    id: "digitaler-stempel",
    name: "Digitaler Stempel",
    description: "PDF-Dokumente digital stempeln (Position, Größe, Drehung frei wählbar) — jede Stempelung wird mit Nutzer und Zeitpunkt archiviert (nur für berechtigte Gruppe).",
    url: "https://tecko1985.github.io/digitaler-stempel/",
    icon: "🖋️",
    category: "Verein",
    version: "1.0",
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
    version: "1.10",
    groups: [
      {
        title: "Neues Tool",
        items: [
          "Digitaler Stempel: PDF-Dokumente digital stempeln, mit automatischer Archivierung (wer hat wann gestempelt, wer hat wann heruntergeladen)."
        ]
      }
    ]
  },
  {
    version: "1.9",
    groups: [
      {
        title: "Sichtbarkeit der Tools",
        items: [
          "Auch in der Ansicht „Sichtbarkeit der Tools“ lässt sich pro App und Gruppe jetzt neben „Sehen“ zusätzlich „Bearbeiten“ setzen."
        ]
      }
    ]
  },
  {
    version: "1.8",
    groups: [
      {
        title: "Gruppenverwaltung",
        items: [
          "Im Gruppen-Bereich lässt sich pro App jetzt neben „Sehen“ auch „Bearbeiten“ separat vergeben, statt für jede App eine eigene Bearbeiter-Gruppe anzulegen."
        ]
      }
    ]
  },
  {
    version: "1.7",
    groups: [
      {
        title: "Navigation",
        items: [
          "Der Tab „Einstellungen“ zeigt jetzt zusätzlich die aktuelle Versionsnummer direkt am Tab-Reiter an."
        ]
      }
    ]
  },
  {
    version: "1.6",
    groups: [
      {
        title: "Private Tools aus der Übersicht entfernt",
        items: [
          "Kassenbuch, Familien-Quartett und Beleg-Scanner sind keine Vereins-Tools und daher nicht mehr auf dieser Seite gelistet."
        ]
      }
    ]
  },
  {
    version: "1.5",
    groups: [
      {
        title: "Tools öffnen im gleichen Fenster",
        items: [
          "Tool-Kacheln, Neuigkeiten-Verlinkungen und das Termine-Widget öffnen das jeweilige Tool jetzt im selben Browser-Tab statt in einem neuen Fenster.",
          "Jedes verlinkte Tool hat dafür oben einen 'Zurück zum Dashboard'-Link bekommen, um wieder hierher zurückzukommen."
        ]
      }
    ]
  },
  {
    version: "1.4",
    groups: [
      {
        title: "Neuigkeiten als Karussell",
        items: [
          "Der Neuigkeiten-Bereich zeigt jetzt immer nur eine Meldung, umschaltbar über zwei Pfeile: der rechte Pfeil blättert zur nächstälteren Meldung, der linke zurück zur neueren.",
          "Eine kleine Anzeige (z. B. '2 / 5') zeigt, an welcher Stelle man sich befindet; nicht mehr erreichbare Pfeile sind sichtbar deaktiviert."
        ]
      }
    ]
  },
  {
    version: "1.3",
    groups: [
      {
        title: "Dashboard",
        items: [
          "Der Tab \"Übersicht\" heißt jetzt \"Dashboard\".",
          "Links neben den Tool-Kacheln zeigt ein neues Widget die nächsten 3 anstehenden Vereinstermine (aus dem Vereinskalender) — sichtbar für alle, die auch die Vereinskalender-Kachel sehen dürfen.",
          "Die Neuigkeiten zeigen jetzt standardmäßig nur die letzten 2 Meldungen; 'Mehr anzeigen' klappt bis zu 3 weitere auf (insgesamt max. 5)."
        ]
      },
      {
        title: "Einstellungen-Tab",
        items: [
          "Der Neuigkeiten-Bereich steht jetzt direkt unter 'Eingeloggt als ...', statt weiter unten zwischen den anderen Admin-Bereichen."
        ]
      }
    ]
  },
  {
    version: "1.2",
    groups: [
      {
        title: "Neuigkeiten verwalten",
        items: [
          "Admins können die Neuigkeiten jetzt direkt im Einstellungen-Tab pflegen (anlegen, bearbeiten, löschen) — mit Typ (Neu/Update/Fix/Hinweis), Datum, Titel, Text und optionaler Tool-Verknüpfung.",
          "Die Meldungen werden zentral in Nextcloud gespeichert und gelten sofort für alle Besucher — kein Code-Update mehr nötig, um eine Neuigkeit zu veröffentlichen."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Tools-Übersicht",
        items: [
          "Neuer Neuigkeiten-Bereich über den Kacheln: kurze Meldungen zu den Vereins-Tools (z. B. neues Tool oder neue Funktion), mit Datum, farbigem Typ-Kennzeichen (Neu/Update/Fix/Hinweis) und optionaler Verknüpfung, die direkt das betroffene Tool öffnet.",
          "Standardmäßig werden die neuesten Meldungen gezeigt; ältere lassen sich über 'Mehr anzeigen' aufklappen. Der Bereich ist für alle Besucher sichtbar (auch ohne Login)."
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
          "Kartenraster mit Links zu allen Vereins- und privaten Tools, gruppiert nach Kategorie.",
          "Jede Tool-Karte zeigt die Version des verlinkten Tools sowie das geeignete Endgerät (📱 Handy, 💻 Laptop, oder beides).",
          "Tool-Karten lassen sich per Greifpunkt frei verschieben und innerhalb ihrer Kategorie neu anordnen (Maus und Touch); die eigene Reihenfolge wird im Browser gemerkt.",
          "Nach dem Anmelden ist der eigene Nutzername (inkl. Admin-Kennzeichnung) direkt im Header sichtbar; Vereinswappen im Header und in allen verlinkten Apps.",
          "Ist niemand angemeldet und dadurch kein Tool sichtbar, erscheint ein Hinweis mit 'Jetzt anmelden'-Button statt einer reinen Leermeldung."
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
          "Entfernt man einer Gruppe die letzte Tool-Zuordnung, wird das Tool wieder versteckt statt für alle eingeloggten Nutzer sichtbar zu werden. Eine gelöschte Gruppe wird automatisch aus allen Tool-Zuordnungen entfernt."
        ]
      },
      {
        title: "WebDAV-Login-Gateway",
        items: [
          "Andere Vereins-Apps (Materialliste, TrainerCheckliste, Spielertool, Trainerkodex, Platzbelegung, Spielersichtung, Personalkosten), die ihre Daten in derselben Nextcloud speichern, nutzen dieselbe Anmeldung: kein eigenes WebDAV-Formular und kein App-Passwort mehr in diesen Apps nötig.",
          "Der Worker prüft Login-Token und Gruppen-Sichtbarkeit, bevor er serverseitig mit den Vereins-Zugangsdaten auf die jeweilige Nextcloud-Datei zugreift — der Client erhält nie ein Passwort zu Gesicht.",
          "Konfliktschutz: Speichern zwei Geräte gleichzeitig, wird der Konflikt erkannt und gemeldet, statt dass eine Änderung stillschweigend verloren geht.",
          "Ist Nextcloud vorübergehend nicht erreichbar, antwortet der Worker mit einer klaren Fehlermeldung statt mit leeren Daten — kein Speichervorgang kann dadurch Bestandsdaten überschreiben.",
          "Zentrale Passwortprüfung für geschützte Aktionen der Tool-Apps (z. B. Checklisten entsperren, Saison leeren, Beleg-Scanner-Suche/-Upload): Die Passwörter liegen als Worker-Secrets auf dem Server statt lesbar im Quellcode der Apps."
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
