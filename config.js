const APP_VERSION = "2.6";

// Statische Stammdaten aller Tool-Links. Die Sichtbarkeit (visible) wird NICHT
// hier gepflegt, sondern zur Laufzeit vom Admin-Worker geladen/überschrieben
// (siehe admin-worker.js) — nur die Existenz eines Tools + seine Metadaten
// ändern sich hier, das braucht einen Code-Push.
const TOOLS = [
  {
    id: "trainervertrag",
    name: "TrainerVertrag",
    description: "Trainer-Stammdaten erfassen und Trainerverträge automatisch als Word-Dokument erzeugen.",
    url: "https://tecko1985.github.io/TrainerVertrag/",
    icon: "📝",
    category: "Verein"
  },
  {
    id: "trainercheckliste",
    name: "TrainerCheckliste",
    description: "Digitale Checkliste für Trainerzu- und -abgang im Nachwuchsbereich.",
    url: "https://tecko1985.github.io/TrainerCheckliste/",
    icon: "📋",
    category: "Verein"
  },
  {
    id: "materialliste",
    name: "Materialliste",
    description: "Vereinsmaterial (Trikots, Bälle, Leibchen) pro Mannschaft verwalten.",
    url: "https://tecko1985.github.io/Materialliste/",
    icon: "🎽",
    category: "Verein"
  },
  {
    id: "sc1911-anmeldung",
    name: "Trainerversammlung-Anmeldung",
    description: "Digitales Anmeldesystem für Trainerversammlungen beim 1. SC 1911 Heiligenstadt.",
    url: "https://tecko1985.github.io/sc1911-anmeldung/",
    icon: "🗳️",
    category: "Verein"
  },
  {
    id: "vereinsbudget",
    name: "Vereinsbudget",
    description: "Budgetübersicht, Einnahmen/Ausgaben und Belegverwaltung für den Kassierer.",
    url: "https://tecko1985.github.io/sc-heiligenstadt-budget/vereinsbudget.html",
    icon: "💶",
    category: "Verein"
  },
  {
    id: "beleg-eingang",
    name: "Beleg-Eingang",
    description: "Mobiles Formular für Helfer zum Einreichen von Belegen.",
    url: "https://tecko1985.github.io/sc-heiligenstadt-budget/beleg-eingang.html",
    icon: "🧾",
    category: "Verein"
  },
  {
    id: "geschaeftsstelle",
    name: "Geschäftsstelle",
    description: "Eingegangene Belege prüfen, korrigieren und als geprüft markieren — ohne Einblick in die Budgetplanung.",
    url: "https://tecko1985.github.io/sc-heiligenstadt-budget/geschaeftsstelle.html",
    icon: "📋",
    category: "Verein"
  },
  {
    id: "spielertool-test",
    name: "Spielertool",
    description: "Bewertung und Förderung von Nachwuchsspielern im Vereinsbetrieb.",
    url: "https://tecko1985.github.io/spielertool-test/",
    icon: "⚽",
    category: "Verein"
  },
  {
    id: "kassenbuch",
    name: "Kassenbuch",
    description: "Persönliches Kassenbuch als PWA fürs iPad.",
    url: "https://tecko1985.github.io/kassenbuch/",
    icon: "💰",
    category: "Privat"
  },
  {
    id: "familien-quartett",
    name: "Familien-Quartett",
    description: "Digitales Kartenspiel nach dem Quartett-Prinzip mit Familienkarten.",
    url: "https://tecko1985.github.io/familien-quartett/",
    icon: "🃏",
    category: "Privat"
  },
  {
    id: "beleg-scanner",
    name: "Beleg-Scanner",
    description: "Foto vom Beleg per KI analysieren, als durchsuchbares PDF ablegen.",
    url: "https://tecko1985.github.io/beleg-scanner/",
    icon: "📷",
    category: "Privat"
  }
];

const APP_CHANGELOG = [
  {
    version: "2.6",
    groups: [
      {
        title: "Sichere Passwörter",
        items: [
          "Neue Passwörter müssen mindestens 12 Zeichen lang sein und Groß- und Kleinbuchstaben sowie eine Zahl oder ein Sonderzeichen enthalten (gilt für Admin-Anlage und Erstlogin)."
        ]
      },
      {
        title: "Einfacherer Erststart",
        items: [
          "Beim allerersten Besuch (noch kein Nutzerkonto vorhanden) öffnet sich direkt das Formular zum Anlegen des Admin-Kontos."
        ]
      },
      {
        title: "Gruppen-Sichtbarkeit",
        items: [
          "Entfernt man im \"Apps\"-Bereich einer Gruppe das letzte Häkchen eines Tools, wird das Tool wieder versteckt, statt für alle eingeloggten Nutzer sichtbar zu werden.",
          "Eine neu angelegte Gruppe erscheint sofort in der Sichtbarkeits-Verwaltung."
        ]
      },
      {
        title: "Sicherheit",
        items: [
          "Namen mit Sonderzeichen (z.B. Anführungszeichen) werden in den Bearbeiten-Formularen korrekt maskiert."
        ]
      }
    ]
  },
  {
    version: "2.5",
    groups: [
      {
        title: "Nutzer bearbeiten",
        items: [
          "Nutzerliste: neuer 'Bearbeiten'-Button je Nutzer zum Ändern von Vorname, Nachname und Admin-Status. Dem letzten Admin-Account kann der Admin-Status nicht entzogen werden."
        ]
      }
    ]
  },
  {
    version: "2.4",
    groups: [
      {
        title: "Nutzer löschen",
        items: [
          "Nutzerliste: neuer 'Löschen'-Button je Nutzer (mit Sicherheitsabfrage), entfernt den Nutzer auch aus allen Gruppen. Der letzte Admin-Account kann nicht gelöscht werden."
        ]
      }
    ]
  },
  {
    version: "2.3",
    groups: [
      {
        title: "Admin-Tab: Platz sparen",
        items: [
          "Alle Bereiche im Admin-Tab (Nutzer, Massenimport, Gruppen, Sichtbarkeit, Versionshistorie) sind jetzt einzeln auf-/zuklappbar und standardmäßig eingeklappt."
        ]
      }
    ]
  },
  {
    version: "2.2",
    groups: [
      {
        title: "Einfachere Gruppen-Zuweisung",
        items: [
          "Nutzerliste: Gruppen-Zugehörigkeit direkt in der Nutzerzeile über Checkboxen zuweisen, ohne den Umweg über die Gruppenverwaltung.",
          "Gruppenverwaltung: neuer 'Apps'-Bereich je Gruppe legt direkt fest, welche Tools diese Gruppe nutzen darf."
        ]
      }
    ]
  },
  {
    version: "2.1",
    groups: [
      {
        title: "Nutzergruppen & Massenanlage",
        items: [
          "Nutzergruppen anlegen (z.B. 'Vorstand', 'Trainer U15') und Mitglieder per Checkliste zuordnen.",
          "Tools können jetzt zusätzlich auf bestimmte Gruppen eingeschränkt werden, nicht nur auf 'jeder eingeloggte Nutzer'.",
          "Nutzer anlegen per Vorname/Nachname statt freiem Nutzernamen — der Nutzername wird automatisch generiert.",
          "Text-Massenimport: mehrere Nutzer auf einmal anlegen (ein Name pro Zeile)."
        ]
      }
    ]
  },
  {
    version: "2.0",
    groups: [
      {
        title: "Echtes Nutzer-Login",
        items: [
          "Der geteilte Admin-PIN entfällt komplett — stattdessen echte Nutzerkonten mit Nutzername/Passwort.",
          "Admin legt Nutzernamen an, jeder Nutzer vergibt sich beim ersten Login selbst ein Passwort.",
          "Pro Tool zusätzlich einstellbar: 'nur für eingeloggte Nutzer' sichtbar (statt nur öffentlich/versteckt).",
          "Admin-Bereich: Nutzerverwaltung (anlegen, Passwort zurücksetzen) direkt im Admin-Tab.",
          "Anmeldung bleibt bis zu 30 Tage im Browser gespeichert."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Erste Version",
        items: [
          "Kartenraster mit Links zu allen Tools.",
          "Admin-Tab: Sichtbarkeit jedes Links per PIN gesteuert ein-/ausblendbar.",
          "Sichtbarkeits-Konfiguration wird zentral über Nextcloud gespeichert und gilt für alle Besucher."
        ]
      }
    ]
  }
];
