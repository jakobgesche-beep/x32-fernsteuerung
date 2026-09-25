# X32 Fernsteuerung (Mac-App)

Native macOS-App (Electron) zur Fernsteuerung eines **Behringer X32** (oder
M32) Digitalmischpults im lokalen Netzwerk: Fader, Mute, Live-Pegelanzeige
für alle 32 Eingangskanäle, sowie EQ (4 Bänder) und Kompressor/Dynamics pro
Kanal.

## Wie es funktioniert

Das X32 spricht ein dokumentiertes Netzwerkprotokoll (**OSC über UDP, Port
10023**), auf dem auch Mixing Station, X32-Edit und andere Apps basieren. Die
Umsetzung folgt der "UNOFFICIAL X32/M32 OSC REMOTE PROTOCOL" von
Patrick-Gilles Maillot und den Erkenntnissen aus Mixing Station und dem
Bitfocus-Companion-Modul:

- **Lokaler Zwischenspeicher** aller Werte (Pfad -> Wert). Beim Verbinden
  werden Kanäle, Icons, Farben, Fader usw. geholt, danach meldet das Pult
  Änderungen per `/xremote` von selbst.
- **Anfragen im Fenster**: höchstens 20 gleichzeitig offen, 500 ms Timeout,
  bis zu 3 Versuche — sonst überfordert man das Pult, und im WLAN gehen
  Pakete verloren.
- **Herzschlag & Überwachung**: `/xremote` und Ping über `/xinfo` alle 1,5 s
  (Ping-Anzeige in ms, Verlust in %), bei 3 s Funkstille automatisch
  "Verbindung verloren" und Neuaufbau samt erneutem Abgleich.
- **Änderungen am Pult kommen sofort** (`/xremote`, ohne Wartezeit an die
  Oberfläche). Weil UDP im WLAN Pakete verlieren kann, gibt es zwei
  Sicherheitsnetze:
  1. **Schnappschüsse per `/formatsubscribe`**: das Pult schickt alle 100 ms
     alle Mute- und Fader-Werte der sichtbaren Ebene in einem Paket. Weicht ein
     Wert vom Zwischenspeicher ab, wird der echte Wert sofort einzeln geholt.
     Nur ein Hinweis, nie direkt angezeigt; wird abgeschaltet, wenn das Format
     nicht passt.
  2. **Nachfragen**: Mute alle 0,5 s, Fader alle 1 s (bei gesunden
     Schnappschüssen seltener, meldet das Pult nichts selbst, doppelt so oft).
- **Eigene Änderungen**: sofort lokal und sofort zum Pult (danach höchstens ~100
  Pakete/s je Parameter, immer mit dem neuesten Wert). Während du ziehst, haben
  Hintergrundanfragen Pause, damit ein langsames Pult keinen Rückstau bekommt.
  Danach ein Kontroll-Lesen; stimmt der Wert am Pult nicht (Paket verloren),
  wird er automatisch erneut gesendet.
- **Meter**: Strom `/meters/0` (32 Kanäle, Aux, FX, Bus, Matrix) und
  `/meters/2` (Main, Gain Reduction von Bus/Matrix/Main); `/meters/1` (Gain
  Reduction der Kanäle) nur, solange die Ansicht eines Kanals offen ist.

**Wichtig:** Das läuft nur im selben lokalen Netzwerk wie das X32 (UDP, nicht
übers Internet). Browser können kein rohes UDP senden, deshalb ist das eine
native App (Electron + Node) und keine Website.

## Verbindung zum X32

Mac und Pult müssen im **selben Netzwerk** sein (zum Beispiel am selben Router: Pult per Kabel, Mac per WLAN oder Kabel).
Die IP-Adresse des Pults steht am Pult unter **SETUP → Reiter NETWORK** (die Adresse ist meist vom Router vergeben und kann sich ändern).
Sie kann in das Feld oben eingetragen werden, oder man drückt **Pult suchen**: die App durchsucht dann alle Netze des Macs (WLAN und
Kabel) und findet das Pult selbst. (192.168.0.64 kommt nur als Beispiel in der Protokoll-Beschreibung vor, es ist keine Werks-Adresse.)

Kommt keine Antwort, zeigt die App nach etwa 6 Sekunden **„Keine Antwort vom Pult“** und die **Verbindungshilfe** sucht die Ursache
(Netz, Ping, Antwort des Pults, Zugriff der App aufs lokale Netzwerk) und erklärt sie mit Schritten und Knöpfen.

**macOS-Freigabe „Lokales Netzwerk“.** Seit macOS 15 darf eine App nur mit Freigabe auf Geräte im Netz zugreifen (Systemeinstellungen →
Datenschutz & Sicherheit → **Lokales Netzwerk** → „X32 Fernsteuerung“ einschalten). Die App prüft das beim Start; ist der Zugriff
verweigert, steht im Startbildschirm eine Warnung mit einem Knopf zu den Systemeinstellungen. Eine Sperre meldet macOS ohne Fehlermeldung
in der App: einzelne Pakete an Geräte werden still verworfen, nur ein Rundruf (Multicast) scheitert mit `EHOSTUNREACH`. Daran erkennt die
App die Sperre. Eine Notlösung (`sudo defaults write com.apple.network.local-network AllowedWiFiLocalNetworkAddresses …`, danach Neustart)
gibt ein ganzes Netz für alle Programme frei; die Hilfe zeigt den fertigen Befehl.

Jede App bekommt beim Bauen eine **eigene UUID** (`scripts/macho-uuid.js`), weil macOS die Freigabe unter der UUID des Hauptprogramms
speichert und Electron-Apps derselben Version sonst dieselbe UUID haben. Die UUID hängt nur vom App-Namen ab und bleibt bei Updates gleich.

Protokolldatei: `~/Library/Application Support/x32-fernsteuerung/verbindung.log` (auch in der Verbindungshilfe unter „Protokoll“).

Tests der Netzwerk-Schicht laufen mit Node (auch mit der Electron-Datei der App):
`ELECTRON_RUN_AS_NODE=1 "/Applications/X32 Fernsteuerung.app/Contents/MacOS/X32 Fernsteuerung" test/net-test.js` (Adressen, Ursachen,
echte UDP-Sockets, Suche), `test/macho-test.js` (UUID) und `test/smoke.js` (Rauchtest im echten Electron mit unsichtbarem Fenster).

## Funktionen

- **Alle Zeilen des Pults** in fünf Ebenen: Kanäle 1–32, Aux/FX-Returns,
  Busse 1–16, Matrizen/Main LR/Mono, DCA 1–8
- Fader-Streifen wie am Pult: **Icon** (eigene Piktogramme für die 74
  X32-Icons), **Name und Farbe** aus dem Pult, Mute, Live-Pegel (dB-Skala,
  Main mit L/R) und ein eigener **Pult-Fader**: langer Schlitz, breite
  Silberkappe mit Farbstrich in der Kanalfarbe, dB-Skala. Bedienung: Kappe
  ziehen, in den Schlitz klicken (springt hin), **Shift** = Feineinstellung,
  rastet bei 0 dB ein, Mausrad, Pfeiltasten, Doppelklick = 0 dB
- Klick auf den Namen öffnet die Processing-Ansicht, nachgebaut nach den
  X32-Seiten (und Elementen der Allen&Heath-Avantis-Oberfläche):
  - **EQ**: große Kurve mit farbigen Ring-Markern (Ziehen = Frequenz & Gain,
    Mausrad = Güte/Q), orange Gesamtkurve. **4 Bänder** bei Kanälen, Aux und
    FX-Returns, **6 Bänder** (Low, Low2, LoMid, HiMid, High2, High) bei Bus,
    Matrix und Main, dort mit den zusätzlichen Filtertypen BU6/12/18/24,
    BS12/24, LR12/24 für Band 1 und 6. EQ-Ein/Aus, Reset, Low Cut (nur
    Kanäle: Ein/Aus, 20–400 Hz, 12/18/24 dB/Okt) in der Kurve eingezeichnet
  - **Kompressor** (Kanäle, Bus, Matrix, Main): Übertragungskurve (Threshold-
    und Ratio-Punkt ziehbar, Knee 0–5, Comp/Exp, Live-Punkt), senkrechte
    Balken mit Live-Gain-Reduction, Gain Envelope (Attack/Hold/Release,
    Lin/Log, Peak/RMS, Auto Time), Side-Chain-Filter
- **Kanal bearbeiten** (Reiter "Kanal" in der Ansicht, gilt für alle Zeilen
  inkl. DCA): Name (12 Zeichen, Umlaute werden ersetzt), Farbe (16 Varianten
  inkl. "invers") und Icon (alle 74, mit Suche); Änderungen gehen sofort zum
  Pult und sind live auf dem Streifen sichtbar
- Änderungen am Pult (Fader, Mute, EQ, Kompressor, Namen, Icons) erscheinen
  live in der App
- "Pult suchen": durchsucht das aktuelle WLAN nach X32/M32-Konsolen und zeigt
  sie zur Auswahl an — keine IP-Adresse nötig
- Main LR und Mono sind **fest am rechten Rand** auf jeder Ebene sichtbar
- Verbindungsstatus als Ampel (Ping/Verlust), automatische Wiederverbindung;
  Klick auf den Status-Balken öffnet die **Diagnose** mit einem **Netzwerk-Test**
  (misst Laufzeit, Schwankung und Verlust, ändert nichts am Pult)
- Eigener Auto-Update: prüft beim Start auf GitHub nach einer neueren
  Version, ein Klick auf "Jetzt aktualisieren" lädt, tauscht aus und startet
  neu. Bewusst nicht `electron-updater` (dessen macOS-Updater braucht eine
  echte Apple-Signatur). Protokoll bei Problemen:
  `~/Library/Application Support/X32 Fernsteuerung/update.log`

**Noch nicht enthalten:** Gate-Seite, Solo/Abhören, Bus-Sends (Sends on Fader),
Routing, Effekte, Szenen.

## Setup (einmalig, braucht Node.js)

```bash
cd x32-fernsteuerung
npm install
npm start
```

## Als echte Mac-App bauen und veröffentlichen

Der Build läuft automatisch bei GitHub (kein Node.js/Terminal auf dem
eigenen Mac nötig) — siehe `.github/workflows/build-mac.yml`. Ein neues
Release auslösen:

1. Auf [github.com/jakobgesche-beep/x32-fernsteuerung/actions/workflows/build-mac.yml](https://github.com/jakobgesche-beep/x32-fernsteuerung/actions/workflows/build-mac.yml)
   gehen → **"Run workflow"**.
2. Ein paar Minuten warten — danach liegt ein Release mit
   `X32-Fernsteuerung.dmg` bereit.

**Hinweis:** Ohne Apple-Entwicklerzertifikat wird die App automatisch
"ad-hoc" signiert (siehe `scripts/afterSignAdHoc.js`) — ohne das würde
macOS sie als "beschädigt" ablehnen. Trotzdem kann macOS beim allerersten
Start einmalig warnen; Rechtsklick → "Öffnen" → nochmal "Öffnen" bestätigen.

## Tests

Ohne echtes Pult prüft ein **simuliertes X32** (`test/mock-console.js`) die
Verbindungsschicht: Handshake, Fenster (max. 20), gebündeltes Schreiben,
verlorene Pakete, Ausfall und Wiederverbindung, Meter, unbeantwortete
Anfragen. Die Tests laufen im Browser — einfach die Seiten öffnen:

- `test/osc-test.html` — OSC-Codec gegen die Hex-Beispiele der Spezifikation
- `test/client-test.html` — Verbindungsschicht gegen das simulierte Pult
- `test/e2e.html?test=1` — Oberfläche + Verbindungsschicht + simuliertes Pult
- `test/latency-test.html` — Latenz-Messung unter fünf Netz-/Pult-Bedingungen
- `test/calc-test.html` — Rechner (Delay, Tempo, Pegel, Ton)
- `test/e2e.html?test=1` prüft auch Mini-Anzeigen (Pixel der Kurven) und Meine Seite
- `test/offline-test.html` — Startwerte für alle Parameter und der Offline-Speicher
- `test/spl-test.html` — Pegel-Rechnung (Bewertungskurven, Fast/Slow, Leq, Terzbänder) und REW-Suche mit erzeugten Signalen
- `test/measure-test.html` — Messung Ende zu Ende mit simuliertem Mikrofon; braucht Echtzeit und einen kleinen Hilfsserver
  (Chrome mit `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=ton.wav`, Ton: links 1 kHz mit -23 dBFS)

## Latenz-Messung (simuliert)

`test/latency-test.html` misst gegen das simulierte X32, wie lange eine
Mute-Änderung am Pult bis zur App braucht und wie stark ein in der App
gezogener Fader am Pult hinterherhinkt (alle Werte in Millisekunden):

| Bedingung | Mute Pult -> App (p95 / max) | Fader App -> Pult (p95) |
|---|---|---|
| Kabel | 4 / 4 | 8 |
| WLAN gut (1 % Verlust) | 9 / 12 | 12 |
| WLAN mäßig (5 % Verlust, Ausreißer) | 70 / 244 | 38 |
| WLAN schlecht (15 % Verlust) | 208 / 623 | 160 |
| sehr langsames Pult (150 Nachrichten/s) | 8 / 11 | 15 |

Das sind Simulationswerte (Netzlaufzeit ist darin enthalten, dazu die 4-ms-
Taktung der Test-Uhr). Am echten Pult bestimmt vor allem das Netz die Werte;
der Netzwerk-Test in der Diagnose zeigt sie direkt. Die Diagnose zeigt außerdem
die App-interne Verzögerung (von der Bewegung in der Oberfläche bis zum
Netzwerk-Paket), gemessen auf dem eigenen Rechner.

Was die App selbst tut, damit nichts ausgebremst wird: keine Drosselung bei
verdecktem Fenster (App Nap / Chromium-Hintergrund-Drosselung aus), Schlafmodus
wird während der Verbindung verhindert, Änderungen gehen sofort und danach
höchstens alle 10 ms je Parameter (immer mit dem neuesten Wert) ans Pult.

Tipps für kurze Zeiten: Mac und Pult am selben Router, wenn möglich 5 GHz und
kurzer Abstand oder Kabel/USB-C-LAN-Adapter zum Router; AirDrop und Handoff am
Mac ausschalten (stören das WLAN gelegentlich); der Router nur für die Anlage.
Unter etwa 50 ms fühlt sich nichts mehr verzögert an – der Motor-Fader am Pult
selbst braucht ohnehin länger.

## Weitere Funktionen (Version 2.5)

- **Automatisch verbinden**: beim Start sucht die App das Pult im Netzwerk; genau eins gefunden (oder das zuletzt benutzte
  dabei) = verbinden, mehrere = Auswahl. Abschaltbar auf dem Startbildschirm (`x32-auto` im lokalen Speicher).
- **Spitzenwert und Übersteuerung**: jeder Kanalzug mit Meter hält den höchsten Pegel 1,2 s als Strich fest; die rote Lampe
  oben rechts leuchtet ab 0,98 (ca. -0,2 dBFS) und bleibt an, bis man sie anklickt.
- **Szenen** (`renderer/scenes.js`): Fader/Mute aller Kanalzüge (optional Namen, Farben, Icons) lokal speichern und laden.
  Laden fragt nach (nennt die Zahl der Änderungen), schickt nur echte Unterschiede (~240 Werte/s) und sichert den alten
  Stand für "Rückgängig". Die Szenen liegen nur in der App, nicht im Pult.
- **Werkzeuge** (`renderer/tools.js`, `shared/calc.js`): Laufzeit/Delay aus Entfernung und Temperatur, Echo-Zeiten nach Tempo
  (mit Tippen), Pegel über Entfernung und Addition mehrerer Quellen, Frequenz -> Wellenlänge/Ton.
- **Pegelverlauf und Protokoll** im Live-Pegel: Leq je Sekunde bis 30 Minuten, "CSV" schreibt eine Datei (Semikolon,
  Dezimalkomma) über den Speichern-Dialog.
- **Neu in dieser Version**: Fenster einmal nach einem Update (`renderer/changelog.js`).

Jede Funktion steckt in einer eigenen Datei bzw. einem eigenen Commit und lässt sich einzeln wieder entfernen.

## Live-Pegel, Übersicht und REW (seit Version 2.6)

Über den Fadern liegt eine **Übersicht** (mit dem Pfeil oben einklappbar):

- **Live-Pegel** (`renderer/measure.js`): dB(A) (Fast) vom Messmikrofon am USB-Audio-Interface, Balken, Leq 30 min, Maximum,
  Pegelverlauf (Leq je Sekunde, bis 30 min, CSV-Export) und Terzband-Spektrum. Aufnahme ohne Echo-Filter, Rauschunterdrückung
  und Auto-Gain; der Ton wird nie ausgegeben. Das ECM8000 braucht 48 V Phantomspeisung am Interface. Zahnrad: Kalibrierung
  (Kalibrator, z. B. 94 dB bei 1 kHz, oder Referenzgerät; Offset je Gerät und Kanal), Grenzwert-Warnung (z. B. 99 dB(A)) und
  REW-Programm. Ohne Kalibrierung sind die Werte relativ (dBFS). Die Feinmessung (Frequenzgang, Nachhall usw.) macht REW.
- **Main LR** groß mit Spitzenwert und Übersteuerungs-Lampe, **Auf einen Blick**: Kanäle mit Signal, stumme und übersteuerte Kanäle.
- **REW öffnen** (Kopfzeile): startet die lokal installierte Software (sucht `REW.app` in /Applications und ~/Applications,
  sonst von Hand wählbar) und hält dafür die Live-Anzeige an, damit das Interface frei ist.
- macOS fragt beim ersten Start des Live-Pegels nach dem Mikrofon-Zugriff (nicht schon beim Programmstart). Weil die App nur
  ad-hoc signiert ist, kann macOS nach einem Update erneut fragen.

Rechnung in `shared/spl.js` (Bewertungsfilter A/C/Z nach IEC 61672, Fast/Slow, Leq, Spitze, Terzbänder), REW-Suche in `shared/rew.js`,
Aufnahme über AudioWorklet mit ScriptProcessor als Ersatz, Mikrofon-Freigabe und REW-Start in `main.js`.

## Offline-Modus (seit Version 2.6)

Knopf **Offline-Modus** (Kopfzeile oder Startbildschirm): die ganze Oberfläche läuft ohne Pult mit Startwerten
(`X32V.defaultWire`: Fader 0 dB, EQ glatt, Kompressor/Gate aus). Änderungen wirken nur in der App, bleiben im lokalen Speicher
(überleben den Neustart) und lassen sich mit den Szenen kombinieren. Nach dem Verbinden erscheint "Offline vorbereitet: N
Einstellungen" mit **Aufs Pult übertragen** (nach Rückfrage, gebremst mit ~240 Werten/s; es werden nur Werte geschrieben, die vom
Startwert abweichen) oder Verwerfen.

## Mini-Anzeigen und "Meine Seite" (Version 2.7)

- **Mini-Anzeigen über jedem Fader** (`renderer/minis.js`): EQ-Kurve (inkl. Low Cut), Kompressor-Kennlinie mit
  Gain-Reduction-Balken (Meter-Strom 1 bzw. 2) und Spitzenpegel/GR als Zahl. Gerechnet mit denselben Funktionen wie die
  EQ-/Kompressor-Seite (`shared/eqmath.js`), Klick öffnet die jeweilige Seite. Die Werte dafür (ca. 35 je Kanalzug) werden für
  die sichtbare Ebene nachgeladen; Änderungen am Pult kommen per `/xremote`.
- **Meine Seite** (`renderer/userpage.js`): eigene Ebene mit selbst gewählten Kanalzügen aus allen Ebenen (Kanäle, Aux, FX,
  Bus, Matrix, DCA) in eigener Reihenfolge. Stern am Kanalzug oder Fenster "Bearbeiten" (mit Suche und "nur benannte").
  Auswahl und zuletzt benutzte Ebene liegen im lokalen Speicher.

## Touch-Modus (Version 2.8)

Knopf **Touch** in der Kopfzeile (`renderer/touch.css`, Klasse `touch` am `<body>`; schaltet sich beim ersten echten Fingertipp
oder auf Touch-Geräten selbst ein, gemerkt unter `x32-touch`): Bedienelemente mindestens 44 px, breite Fader mit großer Kappe, die
Fader nutzen die Fensterhöhe (`--fader-h`), es wird nichts eingeklappt, Bank-Tasten ‹ › zum Blättern, größere
EQ-Griffe mit Tasten für Güte und Gain, kein Zoomen mit zwei Fingern, kein Kontextmenü bei langem Drücken.
Fader (`renderer/fader.js`): mehrere Finger gleichzeitig (jeder Fader merkt sich seinen Finger), Wert-Blase über der Kappe,
Feineinstellung (1/5) mit Shift, Finger ruhig halten oder seitlich wegrücken, Doppeltippen/Doppelklick = 0 dB.
**Geteiltes Layout** auf breiten Bildschirmen (ab 1500 px Fensterbreite, Klasse `touch-split`, Container `#workspace`): links das
Mischpult (halbe Breite, Fader in voller Höhe), rechts oben die Pegelanzeige (Live-Pegel, Main LR, Auf einen Blick; nimmt so viel Höhe,
wie sie braucht), rechts unten eine freie Fläche (`#reserve`, für spätere Bedienelemente). Schmalere Fenster stapeln wie sonst.
**Vollbild**-Knopf im Touch-Modus.
Hinweis: macOS liefert die Berührungen eines externen Touch-Monitors oft nur als Mausklicks (ein Finger, keine Multi-Touch-Ereignisse);
dann bleibt alles einzeln bedienbar, und der Knopf "Touch" schaltet die großen Bedienelemente von Hand ein.

## App-Icon

Quelle `build/icon.svg` (drei Fader auf dunklem Grund, ein Knopf blau). Ein früherer Entwurf (Beschriftungsschild "X32" mit rotem
Farbbalken) steht in der Git-Geschichte (Commit 6803fc0). `build/icon.png` (1024 px, mit transparenten Ecken) und
`build/icon.icns` entstehen daraus (Chrome headless -> `sips` -> `iconutil`); electron-builder nimmt `build/icon.icns`
(`mac.icon` in package.json). Dasselbe Zeichen steht klein in der Kopfzeile der App.

## Design (Version 2.7)

Standard ist **Schlicht** (`renderer/design-plain.css`, Klasse `plain` am `<body>`): flach, neutrale Grautöne, Systemschrift,
ein ruhiges Blau, keine Verläufe oder Leuchteffekte. Oben links schaltet "Design" auf **Klassisch** (das frühere
Türkis-Design) um; die Wahl wird gemerkt.

## Ungetestet an echter Hardware

Alles ist nach der Dokumentation und gegen das simulierte Pult geprüft,
aber noch nicht an einem echten X32. Erster Test: "Pult suchen", verbinden,
einen Fader in der App bewegen und schauen, ob er sich am Pult mitbewegt (und
umgekehrt). Besonders zu prüfen: Live-Gain-Reduction (als Verstärkungsfaktor
1.0 = keine Reduktion gelesen), Knee-Breite (Annäherung, 2 dB pro Stufe),
Zuordnung der Meter-Indizes für Bus/Matrix/Main und die Reaktionszeit im WLAN.

## Struktur

```
main.js               Electron-Hauptprozess: UDP-Socket, Fenster, Netzwerksuche, Updater
preload.js            sichere Brücke zur Oberfläche (window.x32API)
shared/osc.js         OSC-Codec (reines JS, läuft auch im Browser-Test)
shared/values.js      Umrechnungen, Parameter-Spezifikation, Definition aller Kanaltypen
shared/client.js      Verbindungsschicht (Zwischenspeicher, Fenster, Nachgleich, Reconnect)
renderer/             Oberfläche: store.js (Spiegel des Zwischenspeichers), icons.js, fader.js,
                      app.js (Ebenen/Fader-Streifen), processing.js (EQ/Kompressor)
test/                 Tests und simuliertes X32 (nicht Teil der App)
```
