const APP_VERSION = "1.0";

// WhatsApp-Kontakt für die Hilfe-Kachel im Feedback-Tab (intl. Format ohne "+"/Leerzeichen,
// direkt für eine wa.me-URL nutzbar — siehe setupWhatsappLink() in app.js).
const WHATSAPP_CONTACT = "491778587294";

// Statische Stammdaten aller Tool-Links. Die Sichtbarkeit (visible) wird NICHT
// hier gepflegt, sondern zur Laufzeit vom Admin-Worker geladen/überschrieben
// (siehe admin-worker.js) — nur die Existenz eines Tools + seine Metadaten
// (inkl. version) ändern sich hier, das braucht einen Code-Push und muss von
// Hand mit der jeweiligen Version des verlinkten Tools synchron gehalten werden.
//
// Optionales Flag `mail: true` -> Briefumschlag-Symbol unten links auf der Kachel
// (siehe renderToolGrid() in app.js). Es markiert Werkzeuge, die im Betrieb
// tatsächlich E-Mails nach außen verschicken -- damit vor dem Klick sichtbar ist,
// wo eine Handlung beim Empfänger im Postfach landet. **Maßgeblich ist der
// admin-worker.js**, dort laufen ALLE Mails der Flotte über Brevo: vier
// Sendestellen (`raumnutzung-mail-antrag`, `notify-user` -> Vereinskalender,
// `vereinsaufgabe-anlegen`, `beleg-eingang-notify` -> Beleg-Eingang, ausgelöst
// vom Worker sc-heiligenstadt-beleg-upload). Kommt eine Sendestelle dazu oder
// weg, muss dieses Flag mitgezogen werden -- es gibt keine automatische
// Verbindung zwischen Worker und Kachel.
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
    id: "vereinsverwaltung",
    name: "Vereinsverwaltung",
    description: "Mitglieder, Beiträge und Vereinsfinanzen an einer Stelle — mit Sparten, Haushalten und Beitragsklassen. Löst den GLS Vereinsmeister ab. Abteilungsleitungen sehen ausschließlich ihre eigene Sparte, ohne Bankdaten.",
    url: "https://tecko1985.github.io/vereinsverwaltung/",
    icon: "👥",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  },
  {
    id: "vereinsaufgaben",
    name: "Vereinsaufgaben",
    description: "Aufgaben an Funktionäre vergeben — mit verbindlicher Frist, Zuständigkeit über Ressorts, Abnahme und dauerhaft einsehbarer Historie. Zeigt auf einen Blick, wer was offen hat und wo etwas liegen bleibt.",
    url: "https://tecko1985.github.io/Vereinsaufgaben/",
    icon: "🗂️",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"],
    mail: true
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
    devices: ["mobile"],
    mail: true
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
    devices: ["mobile", "desktop"],
    mail: true
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
    description: "Mini-Spiele-Sammlung fürs Team: Auto-, Fußball- und Fußball-Vereine-Quartett sowie Der Maulwurf als Verräterspiel (auch solo gegen KI) — ideal für die Busfahrt zur Auswärtsfahrt.",
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
    id: "raumnutzung",
    name: "Raumnutzung",
    description: "Anträge auf Raumnutzung für Veranstaltungen (Landkreis Eichsfeld) digital erfassen und daraus das ausgefüllte Original-Formular als PDF für das Liegenschaftsamt erzeugen.",
    url: "https://tecko1985.github.io/raumnutzung/",
    icon: "🏛️",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"],
    mail: true
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
  },
  {
    id: "ausbildungsplan",
    name: "Ausbildungsplan",
    description: "Trainingsschwerpunkte und passende Übungen für jede Altersklasse von den Bambini bis zur U23, auf Grundlage der Trainingsphilosophie Deutschland — dazu der Spieltag als Leistungsnachweis: nach dem Spiel wird je Mannschaft auf einer Ampel bewertet, wie weit das Erlernte bereits umgesetzt wird.",
    url: "https://tecko1985.github.io/ausbildungsplan/",
    icon: "🎯",
    category: "Verein",
    version: "1.0",
    devices: ["mobile", "desktop"]
  }
];

// Als "sensibel" markierte Tools (Baustein 4, Spec klare-rechte-trennung 2026-07-24):
// werden im Sichtbarkeits-Panel in einer eigenen, benannten Sektion gruppiert und je
// Zeile mit einem Warn-Badge versehen, damit Rechte-Zuweisungen hier besonders bewusst
// passieren. Rein visuell -- kein Server-Zwang, keine Sperre. Enthaelt bewusst auch die
// Nicht-Gateway-Apps (vereinsbudget/geschaeftsstelle/sc1911-anmeldung), deren
// Schreibschutz je App separat liegt.
const KRITISCHE_TOOLS = [
  "trainercheckliste", "sc1911-anmeldung", "vereinsbudget", "geschaeftsstelle",
  "spielertool-test", "personalkosten", "kadermanager", "digitaler-stempel",
  "personalakte", "dokumentenvorlagen", "vereinsverwaltung"
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

// Feste Auswahl an Reaktions-Emojis unter jeder Neuigkeit. MUSS mit
// NEWS_REACTION_EMOJIS im admin-worker.js übereinstimmen — der Worker validiert
// jeden Klick strikt gegen seine eigene Kopie. Reihenfolge = Anzeigereihenfolge.
const NEWS_REACTION_EMOJIS = ["👍", "❤️", "🎉", "👏", "🔥", "😍", "😮", "😂", "🙏", "💪"];

const APP_CHANGELOG = [
  {
    version: "1.17",
    groups: [
      {
        title: "Unterschrift anfordern: auf Wunsch mit E-Mail",
        items: [
          "Beim Anfordern einer Unterschrift steht unten im Fenster jetzt das Häkchen „Empfänger zusätzlich per E-Mail benachrichtigen“. Ist es gesetzt, bekommt jeder Empfänger eine kurze Nachricht mit Bezeichnung des Dokuments, Frist und dem Weg zur Unterschrift.",
          "Ohne Häkchen wird nichts verschickt — genau wie bisher. Das Häkchen ist bei jedem neuen Vorgang wieder leer, es bleibt also nichts aus der letzten Anforderung stehen.",
          "Der Betreff nennt die Bezeichnung des Dokuments bewusst nicht: er ist in der Handy-Vorschau und beim Mail-Versanddienst sichtbar, und hier gehen Verträge und Personalunterlagen um. Was drinsteht, steht in der Mail selbst.",
          "Hat jemand keine E-Mail-Adresse in den Trainerdaten, wird das nach dem Absenden mit Namen gemeldet — die Anforderung selbst gilt trotzdem, sie liegt in der App bereit."
        ]
      }
    ]
  },
  {
    version: "1.16",
    groups: [
      {
        title: "Auf einen Blick: welches Werkzeug E-Mails verschickt",
        items: [
          "Auf den Kacheln steht unten links jetzt ein Briefumschlag ✉️, wenn das Werkzeug im Betrieb E-Mails nach außen verschickt. Damit ist schon vor dem Klick zu sehen, wo ein Eintrag beim Empfänger im Postfach landet und nicht nur in einer Liste steht.",
          "Markiert sind vier Werkzeuge: Vereinsaufgaben (Benachrichtigung an die Empfänger einer neuen Aufgabe), Vereinskalender (Hinweis an die Personen, mit denen ein privater Termin geteilt wird), Raumnutzung (der fertige Antrag geht als PDF ans Schulverwaltungsamt) und Beleg-Eingang (Info nach einer Einreichung).",
          "Am Rechner erscheint der Hinweis als Text, wenn die Maus auf dem Umschlag stehen bleibt."
        ]
      }
    ]
  },
  {
    version: "1.15",
    groups: [
      {
        title: "Neues Werkzeug „Ausbildungsplan“",
        items: [
          "Es gibt ein neues Werkzeug „Ausbildungsplan“: für jede Altersklasse von den Bambini bis zur U23 stehen dort die Trainingsschwerpunkte und die passenden Übungen — auf Grundlage der Trainingsphilosophie Deutschland des DFB. Jede Stufe zeigt außerdem ihr Profil: Altersspanne, die höchstzulässige Spielform, die wöchentliche Nettospielzeit und die Trainingsfrequenz.",
          "Der Übungskatalog umfasst 28 Spielformen in den vier Säulen Gleichzahlspiele, Spiele mit Anspielern, eine Linie verteidigen und Über-/Unterzahlspiele. Eine Übung, die über der DFB-Obergrenze der gerade betrachteten Altersklasse liegt, wird deutlich markiert.",
          "Die Spieltage sind als Leistungsnachweis eingebaut: nach dem Spiel wird je Mannschaft auf einer Ampel festgehalten, wie weit die Schwerpunkte im Spiel schon umgesetzt waren. Die Auswertung stellt das als Verlauf über die Saison dar. Bewertet wird die Mannschaft, nicht der einzelne Spieler — dafür bleibt die Spielerbewertung zuständig.",
          "Für den Platz gibt es eine Druckansicht je Altersklasse mit allen Schwerpunkten und vollständigen Übungsbeschreibungen.",
          "Lesen darf jeder Angemeldete, die Spieltag-Bögen füllt aus wer Bearbeiten-Recht hat, und Schwerpunkte, Übungen und Mannschaften pflegt die Nachwuchsleitung über das Administrieren-Recht."
        ]
      }
    ]
  },
  {
    version: "1.14",
    groups: [
      {
        title: "Unterschriften nur noch dort, wo sie hingehören",
        items: [
          "Der Knopf „Unterschriften“ oben erscheint jetzt nur noch, wenn du damit auch etwas zu tun hast: entweder du darfst Unterschriften anfordern, oder es liegt gerade eine für dich an. Wer beides nicht hat, sieht ihn gar nicht mehr.",
          "Bekommst du ein Dokument zum Unterschreiben, taucht der Knopf mit Zähler auf — am Unterschreiben selbst ändert sich also nichts.",
          "„Selbst unterschreiben“ — ein eigenes PDF unterschreiben und herunterladen — ist ebenfalls auf die Gruppen beschränkt, die Unterschriften anfordern dürfen. Für alle anderen bleibt dafür der digitale Stempel.",
          "Wer nicht anfordern darf, liest auf dem Knopf nur noch „Unterschriften“ statt „Unterschriften anfordern“."
        ]
      }
    ]
  },
  {
    version: "1.13",
    groups: [
      {
        title: "ToDos und Unterschriften sind getrennt",
        items: [
          "Der Knopf „Meine Aufgaben“ oben heißt jetzt „Unterschriften anfordern“ und enthält auch nur noch das: die Dokumente, die du unterschreiben sollst, die du selbst verschickt hast, und den Weg zum eigenen Unterschreiben.",
          "Deine persönliche ToDo-Liste hat einen eigenen Knopf „Meine ToDos“ bekommen — er steht auf der rechten Seite der Kopfzeile, neben deinem Namen. Anlegen, Fälligkeit setzen, abhaken und aufräumen funktionieren dort unverändert.",
          "Beide Knöpfe zählen jetzt getrennt: links steht, wie viele Dokumente auf deine Unterschrift warten, rechts, wie viele eigene ToDos offen sind. Rot wird die Zahl weiterhin, sobald etwas neu, heute fällig oder überfällig ist — und der Mauszeiger verrät, was genau.",
          "Ein Dokument, das du unterschreiben sollst, steht damit nur noch an einer Stelle statt an zweien. Vorher tauchte es zusätzlich in der ToDo-Liste auf, ließ sich dort aber nicht abhaken."
        ]
      }
    ]
  },
  {
    version: "1.12",
    groups: [
      {
        title: "Unterschrift anfordern: Hinweis und erreichbare Knöpfe",
        items: [
          "Nach dem Auswählen einer PDF waren die Knöpfe „Abbrechen“ und „Anfordern“ nicht mehr zu erreichen — das Fenster wuchs über den Bildschirmrand hinaus, und man kam nur über den Browser-Zoom heran. Das Fenster scrollt jetzt in sich selbst.",
          "Mit einer Seitenvorschau wird das Fenster außerdem breiter, damit sich die Stelle im Dokument überhaupt treffen lässt.",
          "Über der Vorschau steht jetzt ein Hinweis, der die Funktion erklärt: dass man ein Rechteck auf die gewünschte Stelle ziehen kann, dass sich das jederzeit ändern lässt und was passiert, wenn man es weglässt. Bisher stand dort nur ein knapper Satz unter der Seite — also erst nach dem Scrollen sichtbar."
        ]
      }
    ]
  },
  {
    version: "1.11",
    groups: [
      {
        title: "Unterschrift lässt sich wieder platzieren",
        items: [
          "Beim Unterschreiben eines Dokuments verschwand das aufgezogene Rechteck, sobald man die Maustaste losließ — behoben.",
          "Hat der Absender keine Stelle vorgegeben, darfst du sie jetzt selbst wählen: Rechteck aufziehen, fertig. Vorher landete die Unterschrift in diesem Fall zwangsläufig auf einem zusätzlichen Blatt am Ende, obwohl man genau wusste, wohin sie gehört.",
          "Hat der Absender eine Stelle vorgegeben, gilt sie weiterhin — das steht jetzt aber als Satz über dem Dokument, mit Namen und Seitenzahl. Bisher sprang das Rechteck dabei kommentarlos zurück und sah nach einem Fehler aus.",
          "Über der Seitenvorschau steht in beiden Fällen, was als Nächstes zu tun ist."
        ]
      }
    ]
  },
  {
    version: "1.10",
    groups: [
      {
        title: "Einstellungen aufgeräumt",
        items: [
          "Das Panel „Aufgaben“ in den Einstellungen heißt jetzt „Unterschriften anfordern“ und enthält nur noch die eine Häkchenreihe, die auch wirklich etwas schaltet.",
          "Die obere Reihe „wer darf anderen eine Aufgabe in die Liste legen“ ist entfallen: seit die Aufgaben für andere in den Vereinsaufgaben vergeben werden, gab es dafür keinen Knopf mehr, den sie hätte freischalten können. Die Häkchen sahen nach einer Freigabe aus, bewirkten aber nichts.",
          "Wer in den Vereinsaufgaben zuweisen darf, richtet sich dort nach den Ressorts — wer ein Ressort verantwortet oder vertritt, darf dessen Mitgliedern etwas auftragen. Das war schon immer so und ändert sich nicht.",
          "Bereits zugewiesene Aufgaben aus der alten Liste bleiben unverändert abhakbar und zurückziehbar."
        ]
      }
    ]
  },
  {
    version: "1.9",
    groups: [
      {
        title: "Kleinigkeit",
        items: [
          "Im Fenster „Meine Aufgaben“ führt jetzt ein richtiger Knopf zu den Vereinsaufgaben statt eines Wortes im Fließtext — er sieht aus wie die übrigen Knöpfe der Werkzeuge und ist damit als Weg dorthin auch zu erkennen."
        ]
      }
    ]
  },
  {
    version: "1.8",
    groups: [
      {
        title: "Meine Aufgaben meldet sich von selbst",
        items: [
          "Der Knopf „Meine Aufgaben“ oben zeigt jetzt, wenn etwas deine Aufmerksamkeit braucht: die Zahl wird rot, sobald dir jemand eine neue Aufgabe zugewiesen hat, heute eine fällig ist oder eine Frist verstrichen ist. Fährst du mit der Maus darüber, steht dort im Klartext, worum es geht.",
          "Im Fenster selbst steht der Hinweis noch einmal ausgeschrieben über der Liste — zum Beispiel „1 neue Aufgabe für dich · 2 Aufgaben sind heute fällig“.",
          "„Heute fällig“ und „überfällig“ werden nicht mehr in einen Topf geworfen: heute fällig steht jetzt in Bernstein, erst eine verstrichene Frist wird rot. Bis dahin sah eine Aufgabe, für die noch der ganze Tag Zeit ist, genauso alarmierend aus wie eine, die seit einer Woche liegt.",
          "Neu zugewiesene Aufgaben sind in der Liste zusätzlich mit „neu“ gekennzeichnet, solange du sie noch nicht angesehen hast."
        ]
      }
    ]
  },
  {
    version: "1.7",
    groups: [
      {
        title: "Aufgaben für andere ziehen um",
        items: [
          "Es gibt ein neues Werkzeug „Vereinsaufgaben“: dort werden Aufgaben vergeben, die jemand anderem aufgetragen werden — mit verbindlicher Frist, Zuständigkeit über Ressorts und einer Historie, die dauerhaft bestehen bleibt.",
          "„Aufgabe zuweisen“ ist deshalb aus dem Fenster „Meine Aufgaben“ verschwunden. Die Liste hier ist ab jetzt ausschließlich das, was du dir selbst notierst — so ist immer klar, wo eine Aufgabe zu suchen ist.",
          "Unterschriften anfordern bleibt unverändert an dieser Stelle: das ist ein eigenes Recht und von der Trennung nicht betroffen.",
          "Bereits zugewiesene Aufgaben aus der bisherigen Liste bleiben sichtbar und lassen sich weiterhin abhaken und zurückziehen."
        ]
      }
    ]
  },
  {
    version: "1.6",
    groups: [
      {
        title: "Dokumente zum Unterschreiben",
        items: [
          "Das Fenster ist in zwei Hälften geteilt: oben deine eigene Liste samt „Aufgabe zuweisen“, unten alles rund um Unterschriften — anfordern, selbst unterschreiben und der Rücklauf. Jeder Knopf steht bei dem Teil, zu dem er gehört.",
          "„Unterschrift anfordern“ schickt ein PDF direkt zum Unterschreiben. Beim „Aufgabe zuweisen“ lässt sich zusätzlich ein PDF mitschicken, wenn beides zusammengehört. Beides braucht ein eigenes Recht — wer Aufgaben verteilen darf, kann deshalb nicht automatisch Unterschriften einfordern.",
          "Beim Anfordern wählst du das PDF aus und ziehst direkt in der Seitenvorschau ein Rechteck auf die Stelle, an der unterschrieben werden soll.",
          "Alles rund um Aufgaben steckt jetzt hinter dem Knopf „Meine Aufgaben“ oben in der Kopfzeile neben dem Materialcontainercode: die eigene Liste, das Zuweisen an andere, die Dokumente und der Rücklauf. Die Karte unten links auf der Startseite ist dafür ganz entfallen — dort stehen nur noch die Termine.",
          "Am Knopf zeigt ein Zähler, wie viele Aufgaben offen sind; er wird rot, sobald etwas überfällig oder neu zugewiesen ist. So sieht man es beim Aufrufen der Seite, ohne das Fenster zu öffnen.",
          "Unterschrieben wird mit dem Finger oder der Maus, in der eigenen Anmeldung. Danach steht das fertige Dokument bei dir zum Herunterladen bereit, mit Name und Zeitpunkt unter der Unterschrift.",
          "Anders als beim Stempel-Werkzeug kann niemand für jemand anderen unterschreiben: die Unterschrift entsteht in der Sitzung der unterschreibenden Person, und der Server hält fest, wer wann unterschrieben hat.",
          "Wer nicht unterschreiben möchte, kann mit einer Begründung ablehnen — sie kommt bei dir an. Abhaken lässt sich eine solche Aufgabe nicht; wer es versucht, bekommt einen Knopf direkt zum Dokument statt einer Absage.",
          "Unter „Von mir zugewiesen“ lassen sich abgeschlossene Einträge jetzt selbst wegräumen — einzeln über das ✕ oder alle auf einmal. Offene bleiben stehen, die zieht man weiterhin zurück. Ein unterschriebenes Dokument bleibt dabei erhalten; es verschwindet nur aus der Erinnerungsliste.",
          "Bei mehreren Empfängern unterschreibt jeder sein eigenes Exemplar, und du siehst pro Person, wer schon dran war.",
          "Unterschriebene Dokumente bleiben erhalten, auch wenn die Aufgabe nach 14 Tagen aus der Liste läuft — sie verschwinden erst, wenn du sie löschst.",
          "„Selbst unterschreiben“ im Aufgaben-Fenster: eigenes PDF wählen, unterschreiben, die Unterschrift an die richtige Stelle im Dokument ziehen und herunterladen — ohne jemandem etwas zuzuweisen.",
          "Beim Platzieren erscheint die tatsächliche Unterschrift an der gewählten Stelle, nicht nur ein leeres Rechteck — man sieht vor dem Herunterladen, wie das Blatt wirklich aussieht.",
          "Beim eigenen Dokument wird nie eine zusätzliche Seite angehängt: die Unterschrift muss platziert werden, dafür bleibt das PDF genau so lang wie vorher.",
          "Freigeben, wer Unterschriften einfordern darf: Einstellungen → Aufgaben. Das ist eine eigene, engere Stufe als das normale Zuweisen; ohne Häkchen kann es niemand außer den Administratoren."
        ]
      }
    ]
  },
  {
    version: "1.5",
    groups: [
      {
        title: "Meine Aufgaben",
        items: [
          "Neue Aufgabenliste: jedes Mitarbeiterkonto hat seine eigene, mit optionalem Fälligkeitsdatum. Überfällige stehen oben und sind rot markiert.",
          "Erledigte bleiben durchgestrichen stehen, bis sie über „Erledigte aufräumen“ weggeräumt werden. Ein Fehlklick lässt sich also zurücknehmen.",
          "Wer in einer dafür freigegebenen Gruppe ist, kann anderen eine Aufgabe zuweisen — auch mehreren auf einmal. Jeder bekommt seine eigene Kopie und hakt für sich ab.",
          "Zugewiesene Aufgaben lassen sich abhaken, aber nicht löschen. Zurücknehmen kann sie nur, wer sie vergeben hat; der Empfänger sieht dann den Hinweis, dass sie zurückgezogen wurde.",
          "Unter „Von mir zugewiesen“ steht, was man selbst verteilt hat und ob es erledigt ist.",
          "Freigeben, wer zuweisen darf: Einstellungen → Aufgaben. Ohne Häkchen kann das niemand außer den Administratoren."
        ]
      }
    ]
  },
  {
    version: "1.4",
    groups: [
      {
        title: "Bedienung am Handy",
        items: [
          "Am Handy stehen die Neuigkeiten jetzt über den Terminen. Vorher schob sich die Terminliste beim Umbruch auf eine Spalte über die Meldungen, sodass beim Öffnen der Seite zuerst der Kalender im Bild war."
        ]
      }
    ]
  },
  {
    version: "1.3",
    groups: [
      {
        title: "Bedienung am Handy",
        items: [
          "Die Tab-Leiste bricht am Handy jetzt um, statt seitlich aus dem Bild zu laufen. Vorher waren die hinteren Tabs auf schmalen Bildschirmen nicht erreichbar.",
          "Eingabefelder sind am Handy mindestens 16 Pixel groß. Dadurch zoomt der iPhone-Browser beim Antippen eines Feldes nicht mehr ungefragt in die Seite hinein und bleibt danach verschoben stehen."
        ]
      }
    ]
  },
  {
    version: "1.2",
    groups: [
      {
        title: "Zusagen direkt im Dashboard",
        items: [
          "Bei einem Termin mit mehreren Terminmöglichkeiten stehen die Zu- und Absagen jetzt direkt im Widget „Nächste Termine“ — mit Anzahl je Möglichkeit.",
          "Zu- und absagen geht von dort aus mit einem Klick auf den Haken bzw. das Kreuz, ohne den Vereinskalender zu öffnen. Ein zweiter Klick auf denselben Knopf zieht die eigene Stimme wieder zurück; die eigene Wahl ist farbig hervorgehoben.",
          "Abstimmen darf wie im Vereinskalender jeder, der den Termin sehen kann — nicht nur Bearbeiter."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Dashboard: Nächste Termine",
        items: [
          "Bei einem Termin mit mehreren Terminmöglichkeiten (Umfrage aus dem Vereinskalender) zeigt das Widget jetzt jede Möglichkeit als eigene Zeile — bisher erschien nur die früheste, alle weiteren fehlten.",
          "Bereits vergangene Möglichkeiten einer noch laufenden Umfrage werden dabei ausgeblendet; die Zeilen stehen chronologisch zwischen den übrigen Terminen."
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
          "Widget 'Nächste Termine' zeigt bis zu 8 anstehende Vereinstermine aus dem Vereinskalender, dazu die nächsten anstehenden Einträge aus dem Abwesenheitskalender, sofern Zugriff besteht. Private Termine stehen in einem eigenen Bereich darunter und werden nur dem jeweiligen Ersteller bzw. den damit geteilten Personen/Gruppen angezeigt.",
          "Hat laut Trainerdaten heute jemand Geburtstag, erscheint das als eigener Eintrag ganz oben im Termine-Widget (🎂 Name hat Geburtstag) — nur am Geburtstag selbst, ohne Geburtsjahr.",
          "Jede Neuigkeit lässt sich mit einem Emoji bereagieren (👍 ❤️ 🎉 👏 🔥 😍 😮 😂 🙏 💪): eine Reaktion pro Person und Meldung, erneuter Klick nimmt sie zurück, ein anderes Emoji wechselt.",
          "Neuigkeiten sind Vereinsinterna und werden erst nach dem Anmelden angezeigt — samt Reaktionszählern. Wer nicht angemeldet ist, sieht auf der Startseite nur noch die öffentlich freigegebenen Tool-Kacheln; die Meldungen werden dann auch nicht mehr an den Browser übertragen."
        ]
      },
      {
        title: "Login & Nutzerverwaltung",
        items: [
          "Echte Nutzerkonten statt geteiltem PIN: Admin legt per Vorname/Nachname an (Nutzername wird automatisch generiert), jeder Nutzer vergibt sich selbst ein Passwort beim ersten Login.",
          "Anmeldung ist zweistufig: erst nur Nutzername eingeben, danach je nach Ergebnis entweder Passwortfeld (bestehender Account) oder das Formular 'Konto einrichten' (erster Login) — beide Schritte mit 'Zurück'-Button zur Nutzernamen-Eingabe.",
          "Neue Passwörter müssen mindestens 12 Zeichen lang sein und Groß- und Kleinbuchstaben sowie eine Zahl oder ein Sonderzeichen enthalten.",
          "Passwörter werden mit PBKDF2 (Web Crypto, 100.000 Iterationen, Salt pro Nutzer) gehasht, niemals im Klartext gespeichert. Sessions sind signierte Bearer-Token (7 Tage gültig), danach ist eine neue Anmeldung nötig.",
          "Admin kann Nutzer bearbeiten (Vorname, Nachname, Admin-Status, „Vertrag benötigt“ unabhängig von der Gruppe „Trainer“), löschen oder ihr Passwort zurücksetzen — dem letzten Admin-Konto kann der Admin-Status nicht entzogen werden, es kann auch nicht gelöscht werden.",
          "Text-Massenimport für größere Listen: ein Name pro Zeile, alle durchlaufen beim ersten Login den normalen Erstlogin-Flow.",
          "Beim allerersten Besuch überhaupt (noch kein Nutzerkonto vorhanden) öffnet sich automatisch das Formular zum Anlegen des Admin-Kontos; danach ist dieser Weg dauerhaft gesperrt.",
          "Wird Vor- oder Nachname eines Kontos im Bearbeiten-Panel korrigiert, zieht der Login-Nutzername automatisch mit um (z. B. „alex.rohner“ → „alexander.rohner“). Kollidiert die neue Kennung mit einem bereits bestehenden Konto, bleibt der Nutzername unverändert und ein Warnhinweis erscheint.",
          "Die Nutzerliste hat genau zwei Abschnitte — „Personal“ und „Spieler“ — statt eines Abschnitts je Gruppe; jedes Konto steht damit an genau einer Stelle. Darüber filtern eine Namenssuche und ein Gruppen-Dropdown (mit „Ohne Gruppe“) die Liste, die Zähler zeigen dabei die Treffer.",
          "„Abmelden“ sitzt oben rechts im Header direkt neben dem eigenen Namen und ist damit von jedem Tab aus erreichbar — vorher lag der Button nur im Einstellungen-Tab.",
          "„Mein Konto“ ist ein eigener Tab und zeigt eigenen Namen, Nutzername sowie — sofern hinterlegt — Trainerlizenz und Mannschaften. Solange niemand angemeldet ist, heißt derselbe Tab „Anmelden“ und enthält die Anmeldemaske.",
          "Der Tab „Einstellungen“ enthält nur noch Verwaltungsfunktionen und wird deshalb ausschließlich Admins angezeigt — alle anderen sehen ihn gar nicht erst.",
          "„Mein Konto“ zeigt zusätzlich die eigenen Gruppen im Klartext (bisher nur Admins), in welchen Tools man bearbeiten darf statt nur zuzusehen, wann das Passwort zuletzt geändert wurde und bis wann die aktuelle Anmeldung gilt.",
          "In „Mein Konto“ lässt sich das eigene Passwort ändern: bisheriges und neues Passwort eingeben, fertig. Aus Sicherheitsgründen werden dabei alle anderen Geräte abgemeldet — dort ist eine neue Anmeldung nötig.",
          "Der Tab „Info“ mit der Änderungsliste wird erst nach dem Anmelden angezeigt — sie beschreibt Anmeldewege und interne Abläufe, die nicht öffentlich stehen sollen. Ohne Anmeldung führt auch das Versionsbadge im Header nicht mehr dorthin."
        ]
      },
      {
        title: "Nutzergruppen & Sichtbarkeit",
        items: [
          "Gruppen anlegen (z.B. 'Vorstand', 'Trainer U15'), Mitglieder per Checkbox zuordnen — direkt in der Nutzerliste oder in der Gruppenverwaltung.",
          "Sichtbarkeit pro Tool über ein einzelnes Dropdown mit vier eindeutigen Zuständen: Versteckt, Öffentlich, Alle eingeloggten Nutzer, oder Nur bestimmte Gruppen (Gruppen-Auswahl erscheint dann darunter). Der 'Apps'-Bereich je Gruppe legt alternativ direkt fest, welche Tools diese Gruppe nutzen darf.",
          "Pro App und Gruppe lässt sich neben 'Sehen' zusätzlich 'Bearbeiten' vergeben — sowohl im Gruppen-Bereich als auch in der Ansicht 'Sichtbarkeit der Tools'. Ersetzt die früher nötigen dedizierten Bearbeiter-Gruppen je App; die jeweilige App fragt diese Berechtigung selbst ab.",
          "Dritte Rechte-Stufe 'Administrieren' pro App und Gruppe: schaltet App-interne Admin-Funktionen frei (z.B. den vollen Trainerdaten-Zugriff inkl. IBAN oder die Rechte-Matrix im Kadermanager), ohne dass die Person globaler Admin der Tools-Übersicht sein muss. Administrieren schließt Bearbeiten automatisch mit ein; die Häkchen koppeln sich entsprechend. In der Karte 'Mein Konto' werden solche Tools mit dem Zusatz '(administrieren)' ausgewiesen.",
          "Wer für ein Tool Bearbeiten- oder Administrieren-Recht bekommt, sieht das Tool jetzt automatisch — ein Häkchen bei „Bearbeiten“ setzt „Sehen“ mit; „nur Bearbeiten ohne Sehen“ lässt eine App nicht länger unsichtbar.",
          "Als sensibel eingestufte Tools (z. B. Personalakte, Kadermanager, Vereinsbudget, Dokumentenvorlagen) stehen im Bereich „Sichtbarkeit der Tools“ in einer eigenen, aufklappbaren Sektion ganz oben und tragen ein ⚠️-Zeichen — damit ihre Rechte-Vergabe besonders bewusst passiert.",
          "Alle übrigen Tools stehen darunter ebenfalls in einer eigenen aufklappbaren Sektion „Weitere Tools“ — so bleibt das Sichtbarkeits-Panel übersichtlich und beide Gruppen lassen sich getrennt ein- und ausklappen.",
          "Welche Tools als „sensibel“ gelten, legt der Admin jetzt selbst fest: pro Tool-Zeile im Sichtbarkeits-Panel ein Häkchen „Sensibel“ — das Tool wandert sofort in die passende Sektion und die Auswahl wird beim Speichern zentral hinterlegt (keine Code-Änderung mehr nötig).",
          "Beim Vorlagen-Katalog (Dokumentenvorlagen) und in der Personalakte ist das Speichern jetzt zusätzlich serverseitig auf Bearbeiter beschränkt — reines Ansehen kann dort nichts mehr überschreiben.",
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
        title: "Materialcontainer-Code",
        items: [
          "Knopf „🔐 Materialcontainercode“ oben im Kopfbereich: ein Klick zeigt den aktuellen Code des Zahlenschlosses am Materialcontainer in einem kleinen Fenster, groß und gut ablesbar. Optional steht ein kurzer Hinweis darunter (z. B. wie das Schloss zu schließen ist).",
          "Der Code wird erst beim Öffnen des Fensters geladen und nirgends gespeichert. Sichtbar für alle angemeldeten Mitarbeitenden, nicht für Spielerkonten.",
          "Gepflegt wird er von Admins unter „Einstellungen → Materialcontainer-Code“ — dort steht auch, wann er zuletzt und von wem geändert wurde."
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
