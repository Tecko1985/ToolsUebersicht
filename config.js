const APP_VERSION = "1.6";

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
    version: "1.1"
  },
  {
    id: "trainercheckliste",
    name: "TrainerCheckliste",
    description: "Digitale Checkliste für Trainerzu- und -abgang im Nachwuchsbereich.",
    url: "https://tecko1985.github.io/TrainerCheckliste/",
    icon: "📋",
    category: "Verein",
    version: "1.2"
  },
  {
    id: "materialliste",
    name: "Materialliste",
    description: "Vereinsmaterial (Trikots, Bälle, Leibchen) pro Mannschaft verwalten.",
    url: "https://tecko1985.github.io/Materialliste/",
    icon: "🎽",
    category: "Verein",
    version: "1.1"
  },
  {
    id: "sc1911-anmeldung",
    name: "Trainerversammlung-Anmeldung",
    description: "Digitales Anmeldesystem für Trainerversammlungen beim 1. SC 1911 Heiligenstadt.",
    url: "https://tecko1985.github.io/sc1911-anmeldung/verwaltung.html",
    icon: "🗳️",
    category: "Verein",
    version: "1.0"
  },
  {
    id: "vereinsbudget",
    name: "Vereinsbudget",
    description: "Budgetübersicht, Einnahmen/Ausgaben und Belegverwaltung für den Kassierer.",
    url: "https://tecko1985.github.io/sc-heiligenstadt-budget/vereinsbudget.html",
    icon: "💶",
    category: "Verein",
    version: "1.2"
  },
  {
    id: "beleg-eingang",
    name: "Beleg-Eingang",
    description: "Mobiles Formular für Helfer zum Einreichen von Belegen.",
    url: "https://tecko1985.github.io/sc-heiligenstadt-budget/beleg-eingang.html",
    icon: "🧾",
    category: "Verein",
    version: "1.2"
  },
  {
    id: "geschaeftsstelle",
    name: "Geschäftsstelle",
    description: "Eingegangene Belege prüfen, korrigieren und als geprüft markieren — ohne Einblick in die Budgetplanung.",
    url: "https://tecko1985.github.io/sc-heiligenstadt-budget/geschaeftsstelle.html",
    icon: "📋",
    category: "Verein",
    version: "1.2"
  },
  {
    id: "spielertool-test",
    name: "Spielertool",
    description: "Bewertung und Förderung von Nachwuchsspielern im Vereinsbetrieb.",
    url: "https://tecko1985.github.io/spielertool-test/",
    icon: "⚽",
    category: "Verein",
    version: "1.1"
  },
  {
    id: "kassenbuch",
    name: "Kassenbuch",
    description: "Persönliches Kassenbuch als PWA fürs iPad.",
    url: "https://tecko1985.github.io/kassenbuch/",
    icon: "💰",
    category: "Privat",
    version: "1.0"
  },
  {
    id: "familien-quartett",
    name: "Familien-Quartett",
    description: "Digitales Kartenspiel nach dem Quartett-Prinzip mit Familienkarten.",
    url: "https://tecko1985.github.io/familien-quartett/",
    icon: "🃏",
    category: "Privat",
    version: "1.0"
  },
  {
    id: "beleg-scanner",
    name: "Beleg-Scanner",
    description: "Foto vom Beleg per KI analysieren, als durchsuchbares PDF ablegen.",
    url: "https://tecko1985.github.io/beleg-scanner/",
    icon: "📷",
    category: "Privat",
    version: "1.0"
  },
  {
    id: "vereinskalender",
    name: "Vereinskalender",
    description: "Zentraler Vereinskalender für Termine, Trainingszeiten und Veranstaltungen.",
    url: "https://tecko1985.github.io/vereinskalender/",
    icon: "📅",
    category: "Verein",
    wip: true
  },
  {
    id: "platzbelegung",
    name: "Platzbelegung",
    description: "Belegungsplan für Trainingsplätze und Halle — wer nutzt wann welchen Platz.",
    url: "https://tecko1985.github.io/platzbelegung/",
    icon: "🏟️",
    category: "Verein",
    wip: true
  },
  {
    id: "spielersichtung",
    name: "Spielersichtung",
    description: "Sichtung und Bewertung von Nachwuchsspielern für Kader- und Förderentscheidungen.",
    url: "https://tecko1985.github.io/spielersichtung/",
    icon: "🔍",
    category: "Verein",
    wip: true
  },
  {
    id: "trainerkodex",
    name: "Trainerkodex",
    description: "Verhaltenskodex für Trainer:innen — digital einsehbar und bestätigbar.",
    url: "https://tecko1985.github.io/trainerkodex/",
    icon: "📜",
    category: "Verein",
    version: "1.5",
    wip: true
  },
  {
    id: "spielerplus-klon",
    name: "Spielerplus-Klon",
    description: "Vereinsinterne Alternative zu SpielerPlus: Teamorganisation, An-/Abmeldungen, Kommunikation.",
    url: "https://tecko1985.github.io/spielerplus-klon/",
    icon: "⚽",
    category: "Verein",
    wip: true
  }
];

const APP_CHANGELOG = [
  {
    version: "1.6",
    groups: [
      {
        title: "Übersicht",
        items: [
          "Vereinswappen oben rechts im Header ergänzt.",
          "Trainerversammlung-Anmeldung zeigt jetzt ebenfalls eine Version (1.0) auf ihrer Karte."
        ]
      }
    ]
  },
  {
    version: "1.5",
    groups: [
      {
        title: "Übersicht",
        items: [
          "Tool-Karten lassen sich per Greifpunkt oben rechts frei verschieben und innerhalb ihrer Kategorie neu anordnen — funktioniert per Maus und Touch.",
          "Die eigene Reihenfolge wird direkt im Browser gemerkt (nicht geräteübergreifend synchronisiert) und bleibt auch nach einem Neuladen erhalten."
        ]
      }
    ]
  },
  {
    version: "1.4",
    groups: [
      {
        title: "Übersicht",
        items: [
          "Jede Tool-Karte zeigt oben rechts die Version des verlinkten Tools an (sofern bekannt).",
          "Nach dem Anmelden ist der eigene Nutzername (inkl. Admin-Kennzeichnung) direkt im Header sichtbar, nicht mehr nur im Einstellungen-Tab."
        ]
      }
    ]
  },
  {
    version: "1.3",
    groups: [
      {
        title: "Neue Tools (in Bearbeitung)",
        items: [
          "Fünf weitere Tools als Platzhalter angelegt und mit einem \"In Bearbeitung\"-Hinweis auf der Übersicht sichtbar: Vereinskalender, Platzbelegung, Spielersichtung, Trainerkodex und Spielerplus-Klon."
        ]
      }
    ]
  },
  {
    version: "1.2",
    groups: [
      {
        title: "Sicherheit (Worker-Update + neue Secrets nötig)",
        items: [
          "Zentrale Passwortprüfung für geschützte Aktionen der Tool-Apps (TrainerCheckliste entsperren, Teilnehmer-Tab der Anmeldung, Vereinsbudget \"Saison leeren\"): Die Passwörter stehen jetzt als Worker-Secrets auf dem Server statt für jeden lesbar im Quellcode der Apps."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Stabilität & Datensicherheit (Worker-Update nötig)",
        items: [
          "Ist Nextcloud vorübergehend nicht erreichbar, antwortet der Worker jetzt mit einer klaren Fehlermeldung statt mit leeren Daten — vorher konnte ein einziger Lesefehler dazu führen, dass der nächste Speichervorgang alle Nutzerkonten bzw. die Daten einer App überschreibt.",
          "WebDAV-Gateway mit Konfliktschutz: Speichern die Apps (Materialliste, TrainerCheckliste, Spielertool) von zwei Geräten gleichzeitig, wird der Konflikt erkannt und gemeldet, statt dass eine Änderung stillschweigend verloren geht."
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
          "Andere Vereins-Apps (Materialliste, TrainerCheckliste, Spielertool), die ihre Daten per WebDAV in derselben Nextcloud speichern, nutzen dieselbe Anmeldung: kein eigenes WebDAV-Formular und kein App-Passwort mehr in diesen Apps nötig.",
          "Der Worker prüft Login-Token und Gruppen-Sichtbarkeit, bevor er serverseitig mit den Vereins-Zugangsdaten auf die jeweilige Nextcloud-Datei zugreift — der Client erhält nie ein Passwort zu Gesicht."
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
