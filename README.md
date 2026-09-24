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
- **Herzschlag & Überwachung**: `/xremote` alle 2 s, Ping über `/xinfo`
  (Anzeige in ms), bei Funkstille automatisch "Verbindung verloren" und
  Neuaufbau samt erneutem Abgleich.
- **Nachgleich im Hintergrund** (UDP kann Pakete verlieren): sichtbare
  Fader/Mute alle 5 s, alles alle 60 s.
- **Eigene Änderungen**: sofort lokal, zum Pult bis zu ~80 Pakete/s pro
  Parameter (gebündelt), danach ein Kontroll-Lesen; stimmt der Wert am Pult
  nicht (Paket verloren), wird er einmal automatisch erneut gesendet. Das Pult
  meldet Änderungen, die per OSC kommen, nicht zurück.
- **Meter**: Strom `/meters/0` (32 Kanäle, Aux, FX, Bus, Matrix) und
  `/meters/2` (Main, Gain Reduction von Bus/Matrix/Main); `/meters/1` (Gain
  Reduction der Kanäle) nur, solange die Ansicht eines Kanals offen ist.

**Wichtig:** Das läuft nur im selben lokalen Netzwerk wie das X32 (UDP, nicht
übers Internet). Browser können kein rohes UDP senden, deshalb ist das eine
native App (Electron + Node) und keine Website.

## Verbindung zum X32

Beim X32 Compact hängt meist ein WLAN-Router am Netzwerkport, mit dem sich
der Mac verbindet. Die Werks-Standard-IP-Adresse des X32 ist **192.168.0.64**
(als Platzhalter schon im Eingabefeld voreingestellt) — falls euer Router
ein anderes Subnetz vergibt, steht die tatsächliche IP am X32 unter
**Setup → Network**.

## Funktionen

- **Alle Zeilen des Pults** in fünf Ebenen: Kanäle 1–32, Aux/FX-Returns,
  Busse 1–16, Matrizen/Main LR/Mono, DCA 1–8
- Fader-Streifen wie am Pult: **Icon** (eigene Piktogramme für die 74
  X32-Icons), **Name und Farbe** aus dem Pult, Fader mit dB-Anzeige
  (Doppelklick = 0 dB), Mute, Live-Pegel (dB-Skala, Main mit L/R)
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
- Änderungen am Pult (Fader, Mute, EQ, Kompressor, Namen, Icons) erscheinen
  live in der App
- "Pult suchen": durchsucht das aktuelle WLAN nach X32/M32-Konsolen und zeigt
  sie zur Auswahl an — keine IP-Adresse nötig
- Verbindungsstatus mit Ping, automatischer Wiederverbindung und Abgleich
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
renderer/             Oberfläche: store.js (Spiegel des Zwischenspeichers), icons.js,
                      app.js (Ebenen/Fader-Streifen), processing.js (EQ/Kompressor)
test/                 Tests und simuliertes X32 (nicht Teil der App)
```
