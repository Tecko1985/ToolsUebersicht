const APP_VERSION = "1.0";

// WhatsApp-Kontakt für die Hilfe-Kachel im Feedback-Tab (intl. Format ohne "+"/Leerzeichen,
// direkt für eine wa.me-URL nutzbar — siehe setupWhatsappLink() in app.js).
const WHATSAPP_CONTACT = "491778587294";

// Statische Stammdaten aller Tool-Links. Die Sichtbarkeit (visible) wird NICHT
// hier gepflegt, sondern zur Laufzeit vom Admin-Worker geladen/überschrieben
// (siehe admin-worker.js) — nur die Existenz eines Tools + seine Metadaten
// ändern sich hier, das braucht einen Code-Push.
//
// Eine Versionsnummer je Tool gibt es hier bewusst NICHT mehr (2026-08-03): die
// Kacheln zeigen keine, das Badge im Kopfbereich ist weg, und damit hätte das Feld
// nur noch Pflegeaufwand ohne Anzeige bedeutet. Die einzige Versionsangabe der
// Übersicht steht im Info-Tab (APP_VERSION + APP_CHANGELOG unten).
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
    url: "https://sc1911heiligenstadt.github.io/Trainerdaten/",
    icon: "📝",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "vereinsverwaltung",
    name: "Vereinsverwaltung",
    description: "Mitglieder, Beiträge und Vereinsfinanzen an einer Stelle — mit Sparten, Haushalten und Beitragsklassen. Löst den GLS Vereinsmeister ab. Abteilungsleitungen sehen ausschließlich ihre eigene Sparte, ohne Bankdaten.",
    url: "https://sc1911heiligenstadt.github.io/vereinsverwaltung/",
    icon: "👥",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "vereinsaufgaben",
    name: "Vereinsaufgaben",
    description: "Aufgaben an Funktionäre vergeben — mit verbindlicher Frist, Zuständigkeit über Ressorts, Abnahme und dauerhaft einsehbarer Historie. Zeigt auf einen Blick, wer was offen hat und wo etwas liegen bleibt.",
    url: "https://sc1911heiligenstadt.github.io/Vereinsaufgaben/",
    icon: "🗂️",
    category: "Verein",
    devices: ["mobile", "desktop"],
    mail: true
  },
  {
    id: "trainercheckliste",
    name: "TrainerCheckliste",
    description: "Digitale Checkliste für Trainerzu- und -abgang im Nachwuchsbereich.",
    url: "https://sc1911heiligenstadt.github.io/TrainerCheckliste/",
    icon: "📋",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "materialliste",
    name: "Materialliste",
    description: "Vereinsmaterial (Trikots, Bälle, Leibchen) pro Mannschaft verwalten.",
    url: "https://sc1911heiligenstadt.github.io/Materialliste/",
    icon: "🎽",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "sc1911-anmeldung",
    name: "Trainerversammlung-Anmeldung",
    description: "Digitales Anmeldesystem für Trainerversammlungen beim 1. SC 1911 Heiligenstadt.",
    url: "https://sc1911heiligenstadt.github.io/sc1911-anmeldung/verwaltung.html",
    icon: "🗳️",
    category: "Verein",
    devices: ["desktop"]
  },
  {
    id: "vereinsbudget",
    name: "Vereinsbudget",
    description: "Budgetübersicht, Einnahmen/Ausgaben und Belegverwaltung für den Kassierer.",
    url: "https://sc1911heiligenstadt.github.io/sc-heiligenstadt-budget/vereinsbudget.html",
    icon: "💶",
    category: "Verein",
    devices: ["desktop"]
  },
  {
    id: "beleg-eingang",
    name: "Beleg-Eingang",
    description: "Mobiles Formular für Helfer zum Einreichen von Belegen.",
    url: "https://sc1911heiligenstadt.github.io/sc-heiligenstadt-budget/beleg-eingang.html",
    icon: "🧾",
    category: "Verein",
    devices: ["mobile"],
    mail: true
  },
  {
    id: "geschaeftsstelle",
    name: "Geschäftsstelle",
    description: "Eingegangene Belege prüfen, korrigieren und als geprüft markieren — ohne Einblick in die Budgetplanung.",
    url: "https://sc1911heiligenstadt.github.io/sc-heiligenstadt-budget/geschaeftsstelle.html",
    icon: "📋",
    category: "Verein",
    devices: ["desktop"]
  },
  {
    id: "spielertool-test",
    name: "Spielertool",
    description: "Bewertung und Förderung von Nachwuchsspielern im Vereinsbetrieb.",
    url: "https://sc1911heiligenstadt.github.io/spielertool-test/",
    icon: "⚽",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "vereinskalender",
    name: "Vereinskalender",
    description: "Kommende Vereinstermine im Überblick (gesperrte Hallen/Plätze, Trainingszeiten, Veranstaltungen) — Pflege durch die Geschäftsstelle.",
    url: "https://sc1911heiligenstadt.github.io/vereinskalender/",
    icon: "📅",
    category: "Verein",
    devices: ["mobile", "desktop"],
    mail: true
  },
  {
    id: "platzbelegung",
    name: "Platzbelegung",
    description: "Belegungsplan für Trainingsplätze und Halle — wer nutzt wann welchen Platz.",
    url: "https://sc1911heiligenstadt.github.io/platzbelegung/",
    icon: "🏟️",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "spielersichtung",
    name: "Spielersichtung",
    description: "Sichtung und Bewertung von Nachwuchsspielern für Kader- und Förderentscheidungen.",
    url: "https://sc1911heiligenstadt.github.io/spielersichtung/",
    icon: "🔍",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "personalkosten",
    name: "Personalkosten",
    description: "Personalkosten / Aufwandsentschädigungen der Mannschaften planen und auswerten (nur für berechtigte Gruppe).",
    url: "https://sc1911heiligenstadt.github.io/Personalkosten/",
    icon: "💶",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "kadermanager",
    name: "Kadermanager",
    description: "Vereinsinterne Alternative zu SpielerPlus: Termine mit An-/Abmeldung, Aufgaben, Aufstellung/Taktikboard, Spielberichte, Urlaub/Krank, Umfragen und Mannschaftskasse je Mannschaft.",
    url: "https://sc1911heiligenstadt.github.io/kadermanager/",
    icon: "⚽",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "busplan",
    name: "Busplan",
    description: "Bus-/Transportplanung für die Auswärtsspiele der Nachwuchsmannschaften (nur für berechtigte Gruppe).",
    url: "https://sc1911heiligenstadt.github.io/busplan/",
    icon: "🚌",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "digitaler-stempel",
    name: "Digitaler Stempel",
    description: "PDF- und Word-Dokumente digital stempeln (Position, Größe, Drehung und Deckkraft frei wählbar) — jede Stempelung wird mit Nutzer und Zeitpunkt archiviert (nur für berechtigte Gruppe).",
    url: "https://sc1911heiligenstadt.github.io/digitaler-stempel/",
    icon: "🖋️",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "kleiderbestellung",
    name: "Kleiderbestellung",
    description: "Trainer:innen bestellen Vereinskleidung/-ausrüstung mit ihrer Größe aus einem Artikelkatalog; Admin verwaltet Katalog und Bestellfenster und exportiert eine Lieferanten-Bestellliste.",
    url: "https://sc1911heiligenstadt.github.io/kleiderbestellung/",
    icon: "👕",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "fahrtenbuch",
    name: "Fahrtenbuch",
    description: "Digitale Fahrer-Checkliste für Vereinsfahrzeuge: Fahrt mit Fahrzeug-/Fahrtdaten und Sicherheits-Checklisten erfassen, Mängel mit Fotos hochladen, unterschreiben.",
    url: "https://sc1911heiligenstadt.github.io/fahrtenbuch/",
    icon: "🚐",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "fahrtenbuch-extern",
    name: "Fahrtenbuch (extern)",
    description: "Für Eltern ohne Vereinskonto: Fahrt mit einem Vereinsfahrzeug eintragen und Führerschein-Kopie hochladen — zugriffscode-geschützt statt Login.",
    url: "https://sc1911heiligenstadt.github.io/fahrtenbuch/extern.html",
    icon: "🔗",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "spiele",
    name: "Spiele",
    description: "Mini-Spiele-Sammlung fürs Team: Auto-, Fußball- und Fußball-Vereine-Quartett sowie Der Maulwurf als Verräterspiel (auch solo gegen KI) — ideal für die Busfahrt zur Auswärtsfahrt.",
    url: "https://sc1911heiligenstadt.github.io/spiele/",
    icon: "🎮",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "materialbedarf",
    name: "Materialbedarf",
    description: "Trainer:innen melden Materialbedarf (z.B. neue Bälle, Erste-Hilfe-Set) an den Verein; Admin entscheidet über Annahme/Ablehnung und markiert den Kauf.",
    url: "https://sc1911heiligenstadt.github.io/materialbedarf/",
    icon: "🛒",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "raumnutzung",
    name: "Raumnutzung",
    description: "Anträge auf Raumnutzung für Veranstaltungen (Landkreis Eichsfeld) digital erfassen und daraus das ausgefüllte Original-Formular als PDF für das Liegenschaftsamt erzeugen.",
    url: "https://sc1911heiligenstadt.github.io/raumnutzung/",
    icon: "🏛️",
    category: "Verein",
    devices: ["mobile", "desktop"],
    mail: true
  },
  {
    id: "testspielplaner",
    name: "Testspielplaner",
    description: "Testspiele und Leistungsvergleiche planen: Termin anfragen, Admin genehmigt nach DFBnet-Eintragung, Gegner wird nachgetragen — mit Saison-Kontingent je Trainer.",
    url: "https://sc1911heiligenstadt.github.io/testspielplaner/",
    icon: "🆚",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "personalakte",
    name: "Personalakte",
    description: "Zusammengeführte Trainer-Übersicht für die Geschäftsstelle: Stammdaten, Vertrags-/Kodex-Status, Checklisten, Führerschein, Personalkosten und Kadermanager-Rolle auf einen Blick, inkl. Archivieren/Reaktivieren ausgeschiedener Trainer (nur für berechtigte Gruppe).",
    url: "https://sc1911heiligenstadt.github.io/personalakte/",
    icon: "🗂️",
    category: "Verein",
    devices: ["desktop"]
  },
  {
    id: "fotoauftraege",
    name: "Fotoaufträge",
    description: "Das Social-Media-Team fragt Fotos von einer Mannschaft an; der zuständige Trainer legt per Klick einen eigenen, freigegebenen Nextcloud-Ordner für den Bilder-Upload an und bekommt einen teilbaren Link.",
    url: "https://sc1911heiligenstadt.github.io/fotoauftraege/",
    icon: "📸",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "abwesenheitskalender",
    name: "Abwesenheitskalender",
    description: "Übersicht, wer wann abwesend ist (Urlaub, Krankheit, Fortbildung u.a.) — jede:r Berechtigte trägt eigene Abwesenheiten ein, alle mit Tool-Zugriff sehen die komplette Übersicht.",
    url: "https://sc1911heiligenstadt.github.io/abwesenheitskalender/",
    icon: "🧳",
    category: "Verein",
    devices: ["mobile", "desktop"]
  },
  {
    id: "besprechung",
    name: "Besprechung",
    description: "Digitaler Treffpunkt für Trainer: Sprachraum direkt im Browser, inklusive Bildschirm teilen — z. B. für die hybride Trainerversammlung.",
    url: "https://sc1911heiligenstadt.github.io/besprechung/",
    icon: "🎙️",
    category: "Verein",
    devices: ["mobile", "desktop"],
    newTab: true
  },
  {
    id: "dokumentenvorlagen",
    name: "Dokumentenvorlagen",
    description: "Word-Vorlagen (Trainervertrag, Anfragen, Bescheinigungen) mit Platzhaltern zentral verwalten und in einem Rutsch für viele Empfänger befüllen — Daten aus dem Trainerprofil oder, mit der Stufe „Administrieren“ für Trainerdaten, inkl. Adresse und Bankverbindung; Ausgabe als Word-Dokumente, originalgetreue PDFs über ein beiliegendes Skript (nur für berechtigte Gruppe).",
    url: "https://sc1911heiligenstadt.github.io/dokumentenvorlagen/",
    icon: "📄",
    category: "Verein",
    devices: ["desktop"]
  },
  {
    id: "ausbildungsplan",
    name: "Ausbildungsplan",
    description: "Trainingsschwerpunkte und passende Übungen für jede Altersklasse von den Bambini bis zur U23, auf Grundlage der Trainingsphilosophie Deutschland — dazu der Spieltag als Leistungsnachweis: nach dem Spiel wird je Mannschaft auf einer Ampel bewertet, wie weit das Erlernte bereits umgesetzt wird. Die Auswertung folgt wahlweise der Mannschaft oder dem Geburtsjahrgang, sodass sich die Entwicklung einer Kohorte über mehrere Jahre und Altersstufen hinweg verfolgen lässt.",
    url: "https://sc1911heiligenstadt.github.io/ausbildungsplan/",
    icon: "🎯",
    category: "Verein",
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
    version: "1.2",
    groups: [
      {
        title: "Benachrichtigungen aufs Handy",
        items: [
          "Die App kann sich jetzt direkt auf dem Gerät melden, ohne den Umweg über eine E-Mail. Eingeschaltet wird das im Tab „Mein Konto“ unter „Benachrichtigungen aufs Handy“ — für jedes Gerät einmal.",
          "Drei Anlässe, jeder einzeln an- und abschaltbar: ein im Vereinskalender mit dir geteilter Termin, eine neue Aufgabe in den Vereinsaufgaben, und ein Dokument, das auf deine Unterschrift wartet.",
          "Die Nachricht nennt nie einen Namen, einen Termin- oder Dokumenttitel — nur, worum es geht. Sie steht auf dem Sperrbildschirm, wo auch andere mitlesen können. Was drinsteht, sieht man nach dem Antippen in der App.",
          "Die E-Mails bleiben unverändert bestehen. Benachrichtigungen kommen dazu, sie ersetzen nichts — wer sie nicht einschaltet, merkt keinen Unterschied.",
          "In der Liste der angemeldeten Geräte lässt sich jedes einzeln wieder abmelden, auch von einem anderen Gerät aus.",
          "Auf dem iPhone geht es nur, wenn die Übersicht als App auf dem Startbildschirm liegt — Apple bietet Benachrichtigungen im normalen Safari-Fenster nicht an. Nötig ist außerdem iOS 16.4 oder neuer, also ein iPhone 8 oder jünger. Auf Android und am Rechner genügt der Browser.",
          "Wird die Abfrage einmal abgelehnt, lässt sie sich nicht erneut stellen — das erlaubt nur der Browser selbst. In dem Fall steht in der Karte, wo es sich wieder freischalten lässt."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Anmelden",
        items: [
          "Zum Anmelden genügt jetzt auch die eigene E-Mail-Adresse. Der bisherige Nutzername funktioniert unverändert weiter — es kommt nur ein Weg dazu, es fällt keiner weg.",
          "Ebenso werden die üblichen Schreibweisen des Namens erkannt: „Michel Brunner“, „michel.brunner“, „michel_brunner“, „michel-brunner“ oder „MichelBrunner“ führen alle zum selben Konto. Groß- und Kleinschreibung sowie Umlaute spielen keine Rolle.",
          "Steht die E-Mail-Adresse in den Trainerdaten, wird das Konto auch dann gefunden, wenn die Adresse nichts mit dem Namen zu tun hat.",
          "Passt eine Eingabe auf mehr als ein Konto, wird bewusst nicht geraten — die Anmeldung wird dann abgelehnt, damit niemand im fremden Konto landet."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Die Übersicht",
        items: [
          "Kachelraster mit allen Vereins-Werkzeugen, nach Kategorie gruppiert. Jede Kachel nennt das geeignete Gerät — Handy, Laptop oder beides.",
          "Die Kacheln lassen sich am Greifpunkt frei verschieben und innerhalb ihrer Kategorie neu anordnen, mit Maus wie mit dem Finger. Die eigene Reihenfolge merkt sich der Browser.",
          "Ein Briefumschlag unten links auf einer Kachel bedeutet: dieses Werkzeug verschickt E-Mails. Die Handlung landet dort also im Postfach eines Empfängers und nicht nur in einer Liste.",
          "Nach dem Anmelden steht der eigene Name oben im Kopfbereich, bei Administratoren mit Kennzeichnung.",
          "Ist niemand angemeldet und dadurch keine Kachel sichtbar, erscheint ein Hinweis mit Anmelde-Knopf statt einer leeren Seite.",
          "Kacheln, Verlinkungen aus Neuigkeiten und das Termine-Widget öffnen im selben Tab; jedes Werkzeug hat oben einen Weg zurück zum Dashboard."
        ]
      },
      {
        title: "Als App auf dem Startbildschirm",
        items: [
          "Angemeldete Nutzer finden im Kopfbereich den Knopf „Als App ablegen“. Danach startet die Toolbox wie eine eigene App, ohne Browser-Adressleiste.",
          "Auf Android übernimmt das der Systemdialog. Auf dem iPhone geht es nur über Safari von Hand — der Knopf öffnet dort eine Anleitung: Teilen-Symbol, dann „Zum Home-Bildschirm“.",
          "Ist die App abgelegt, verschwindet der Knopf. Er erscheint auch gar nicht erst, wo der Browser nichts anbieten kann."
        ]
      },
      {
        title: "Neuigkeiten",
        items: [
          "Über den Kacheln laufen die Vereinsneuigkeiten als Karussell: eine Meldung sichtbar, per Pfeil blätterbar, mit Positionsanzeige.",
          "Gepflegt werden sie im Reiter „Einstellungen“ — anlegen, ändern, löschen, mit Typ, Datum, Titel, Text und wahlweise einer Verknüpfung zu einem Werkzeug.",
          "Jede Meldung lässt sich mit einem Emoji bereagieren. Eine Reaktion je Person und Meldung; ein erneuter Klick nimmt sie zurück, ein anderes Emoji wechselt.",
          "Wer mit der Maus über ein Emoji fährt, sieht die Namen der Personen, die so reagiert haben. Am Handy gibt es kein Überfahren, dort bleibt es beim Zähler.",
          "Neuigkeiten sind Vereinsinterna und erscheinen erst nach dem Anmelden, samt Zählern und Namen. Wer nicht angemeldet ist, bekommt sie gar nicht erst übertragen."
        ]
      },
      {
        title: "Nächste Termine",
        items: [
          "Das Widget zeigt bis zu acht anstehende Vereinstermine aus dem Vereinskalender, dazu die nächsten Einträge aus dem Abwesenheitskalender, sofern man darauf Zugriff hat.",
          "Private Termine stehen in einem eigenen Bereich darunter und nur bei denen, die sie angelegt haben oder mit denen sie geteilt wurden.",
          "Hat laut Trainerdaten jemand Geburtstag, steht das am Tag selbst ganz oben im Widget — ohne Geburtsjahr.",
          "Zu Terminen mit Umfrage lässt sich direkt aus dem Dashboard zusagen."
        ]
      },
      {
        title: "Meine ToDos",
        items: [
          "Der Knopf „Meine ToDos“ im Kopfbereich öffnet die persönliche Liste: Text und wahlweise ein Fälligkeitsdatum, abhaken, aufräumen.",
          "Der Zähler am Knopf meldet, was offen ist. Er wird rot, wenn etwas überfällig ist.",
          "Hier steht nur, was man sich selbst notiert. Was einem anderen aufgetragen wird, gehört in die Vereinsaufgaben — dorthin führt ein Knopf."
        ]
      },
      {
        title: "Unterschriften anfordern",
        items: [
          "Der Knopf „Unterschriften anfordern“ auf der anderen Seite des Kopfbereichs trägt den Unterschriften-Weg: ein PDF an eine Person schicken, die es am Bildschirm unterschreiben muss.",
          "Der Absender legt fest, wo die Unterschrift stehen soll. Tut er es nicht, darf der Unterzeichner die Stelle selbst wählen; wählt niemand eine, kommt eine Nachweisseite ans Ende.",
          "Unterschrieben wird per Freihand-Pad in der eigenen Sitzung. Den Zeitstempel setzt der Server — dadurch ist die Unterschrift an die Person gebunden.",
          "Nur PDF, hart geprüft. Ein unterschriebenes Word-Dokument bliebe editierbar und wäre als Nachweis wertlos.",
          "Bei mehreren Empfängern unterschreibt jeder eine eigene Kopie. Ablehnen ist möglich, verlangt aber eine Begründung.",
          "Auf Wunsch wird der Empfänger zusätzlich per E-Mail benachrichtigt. Das ist ein Häkchen je Vorgang und steht bei jedem Öffnen wieder auf aus; der Betreff nennt den Dokumenttitel bewusst nicht.",
          "Den Knopf sieht nur, wer Unterschriften anfordern darf — oder wer selbst ein offenes Dokument hat. Nach dem Unterschreiben verschwindet er wieder.",
          "Das unterschriebene Dokument bleibt erhalten, auch wenn die zugehörige Erinnerung nach 14 Tagen abläuft. Einsehen dürfen es die Beteiligten und Administratoren."
        ]
      },
      {
        title: "Materialcontainer-Code",
        items: [
          "Der Knopf im Kopfbereich zeigt den Code des Zahlenschlosses am Materialcontainer.",
          "Gepflegt wird er von Administratoren im Reiter „Einstellungen“, samt Hinweistext.",
          "Der Code wird erst beim Öffnen des Fensters geholt und nirgends zwischengespeichert. An unangemeldete Besucher geht er nie, und Spielerkonten bekommen ihn nicht — bei rund 200 Konten wäre das das Gegenteil eines Schlosses."
        ]
      },
      {
        title: "Anmelden und eigenes Konto",
        items: [
          "Echte Nutzerkonten statt eines geteilten Zugangs. Angelegt wird über Vor- und Nachname, der Nutzername entsteht daraus; das Passwort vergibt sich jeder beim ersten Anmelden selbst.",
          "Die Anmeldung läuft zweistufig: erst der Nutzername, danach je nach Konto entweder das Passwortfeld oder das Formular „Konto einrichten“. Beide Schritte haben einen Weg zurück.",
          "Ein neues Passwort braucht mindestens 12 Zeichen mit Groß- und Kleinbuchstaben sowie einer Zahl oder einem Sonderzeichen.",
          "Passwörter werden nie im Klartext gespeichert. Die Anmeldung gilt sieben Tage, danach ist eine neue nötig.",
          "„Abmelden“ steht oben rechts neben dem eigenen Namen und ist damit aus jedem Reiter erreichbar.",
          "Der Reiter „Mein Konto“ zeigt Name, Nutzername, Trainerlizenz und Mannschaften, die eigenen Gruppen im Klartext, in welchen Werkzeugen man mehr als zusehen darf, wann das Passwort zuletzt geändert wurde und bis wann die Anmeldung gilt. Solange niemand angemeldet ist, heißt derselbe Reiter „Anmelden“.",
          "Dort lässt sich auch das eigene Passwort ändern. Dabei werden alle Geräte abgemeldet — auch das eigene; eine neue Anmeldung danach ist normal."
        ]
      },
      {
        title: "Nutzer und Gruppen verwalten",
        items: [
          "Nutzer bearbeiten, löschen oder ihr Passwort zurücksetzen. Dem letzten Administrator lässt sich der Status nicht entziehen, und löschen lässt er sich auch nicht.",
          "Wird ein Vor- oder Nachname korrigiert, zieht der Anmeldename automatisch mit um. Kollidiert er mit einem bestehenden Konto, bleibt er unverändert und es kommt ein Warnhinweis.",
          "Text-Massenimport für größere Listen: ein Name je Zeile. Alle durchlaufen danach den normalen Erstanmelde-Weg.",
          "Die Nutzerliste hat genau zwei Abschnitte, Personal und Spieler, damit jedes Konto an genau einer Stelle steht. Darüber filtern eine Namenssuche und eine Gruppenauswahl.",
          "Gruppen anlegen und Mitglieder zuordnen, direkt in der Nutzerliste oder in der Gruppenverwaltung.",
          "Beim allerersten Besuch, wenn es noch kein Konto gibt, öffnet sich das Formular zum Anlegen des ersten Administrators. Danach ist dieser Weg dauerhaft zu."
        ]
      },
      {
        title: "Die drei Rechte-Stufen",
        items: [
          "Je Werkzeug und Gruppe gibt es Sehen, Bearbeiten und Administrieren.",
          "Sehen wird über ein Dropdown mit vier Zuständen gesteuert: versteckt, öffentlich, alle angemeldeten Nutzer oder nur bestimmte Gruppen.",
          "Bearbeiten erlaubt das Ändern von Daten und schließt Export, Druck und PDF ein.",
          "Administrieren schaltet die app-internen Verwaltungsfunktionen frei — etwa den vollen Trainerdaten-Zugriff samt Bankverbindung oder die Rechte-Matrix im Kadermanager. Dafür muss niemand globaler Administrator sein.",
          "Administrieren schließt Bearbeiten ein, und wer bearbeiten oder administrieren darf, sieht das Werkzeug automatisch. „Bearbeiten ohne Sehen“ lässt eine App nicht länger unsichtbar.",
          "Als sensibel eingestufte Werkzeuge stehen im Sichtbarkeits-Bereich in einer eigenen aufklappbaren Sektion ganz oben und tragen ein Warnzeichen, damit ihre Rechtevergabe bewusst passiert. Alle übrigen stehen darunter in der Sektion „Weitere Tools“.",
          "Welches Werkzeug als sensibel gilt, legt ein Häkchen je Zeile fest — dafür braucht es keine Code-Änderung.",
          "Entfernt man einer Gruppe die letzte Zuordnung, wird das Werkzeug wieder versteckt statt für alle sichtbar. Eine gelöschte Gruppe verschwindet automatisch aus allen Zuordnungen."
        ]
      },
      {
        title: "Gemeinsame Anmeldung für alle Werkzeuge",
        items: [
          "Alle Vereins-Apps, die ihre Daten in derselben Nextcloud ablegen, nutzen diese eine Anmeldung. Kein eigenes Verbindungsformular, kein zusätzliches Passwort auf dem Gerät.",
          "Der Server prüft bei jedem Zugriff Anmeldung und Gruppenrechte und greift dann selbst auf die Cloud zu. Die Zugangsdaten dazu liegen nur dort.",
          "Ändern zwei Geräte gleichzeitig dieselbe Datei, wird das erkannt und gemeldet, statt still zu überschreiben.",
          "Auch der gesamte E-Mail-Versand der Flotte läuft über diese Stelle — keine App verschickt selbst."
        ]
      },
      {
        title: "Bedienung am Handy",
        items: [
          "Die Übersicht ist für das Handy gebaut; die Kacheln stapeln sich auf schmalen Bildschirmen.",
          "Eingabefelder sind mindestens 16 Pixel groß, damit der iPhone-Browser beim Antippen nicht ungefragt in die Seite hineinzoomt und verschoben stehen bleibt.",
          "Auf schmalen Bildschirmen tragen die Kopfknöpfe kürzere Beschriftungen, damit die Kopfzeile nicht unnötig wächst."
        ]
      }
    ]
  }
];
