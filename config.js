const APP_VERSION = "1.0";

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
