# X32 Fernsteuerung (Mac-App)

Native macOS-App (Electron) zur Fernsteuerung eines **Behringer X32** (oder
M32) Digitalmischpults im lokalen Netzwerk: Fader, Mute, Live-Pegelanzeige
für alle 32 Eingangskanäle, sowie EQ (4 Bänder) und Kompressor/Dynamics pro
Kanal.

## Wie es funktioniert

Das X32 spricht ein dokumentiertes Netzwerkprotokoll (**OSC über UDP, Port
10023**), auf dem auch offizielle/andere Fernsteuer-Apps basieren (X32-Edit,
Mixing Station, ...). Diese App implementiert das Protokoll direkt
(`x32-protocol.js`) nach der "UNOFFICIAL X32/M32 OSC REMOTE PROTOCOL"-
Dokumentation von Patrick-Gilles Maillot — keine Zusatz-Bibliothek nötig.

**Wichtig:** Das läuft nur im selben lokalen Netzwerk wie das X32 (UDP,
nicht übers Internet). Browser können kein rohes UDP senden, deshalb ist
das eine native App (Electron + Node) und keine Website.

## Verbindung zum X32

Beim X32 Compact hängt meist ein WLAN-Router am Netzwerkport, mit dem sich
der Mac verbindet. Die Werks-Standard-IP-Adresse des X32 ist **192.168.0.64**
(als Platzhalter schon im Eingabefeld voreingestellt) — falls euer Router
ein anderes Subnetz vergibt, steht die tatsächliche IP am X32 unter
**Setup → Network**.

## Funktionen

- 32 Kanalzüge: Name (vom Pult), Fader (mit dB-Anzeige), Mute, Live-Pegel
- Klick auf einen Kanal öffnet EQ (4 parametrische Bänder: Typ, Frequenz,
  Gain, Q) und Kompressor/Dynamics (Ein/Aus, Threshold, Ratio, Makeup-Gain,
  Attack, Hold, Release, Knee, Mix)
- Änderungen, die direkt am Pult gemacht werden (Fader, Mute), erscheinen
  automatisch auch in der App (`/xremote`-Abo)
- Grafische EQ-Kurve pro Kanal (wie an einem Allen&Heath Avantis o.ä.):
  zeigt die kombinierte Filterkurve aller 4 Bänder live an; Punkte direkt
  auf der Kurve ziehen ändert Frequenz &amp; Gain, Mausrad über einem Punkt
  ändert die Bandbreite (Q)
- "Pult suchen": durchsucht automatisch das aktuelle WLAN/Netzwerk nach
  X32/M32-Konsolen (OSC `/xinfo`-Anfrage an alle Adressen im Subnetz) und
  zeigt sie zur Auswahl an — keine IP-Adresse mehr nötig, sofern der Mac
  im selben Netzwerk wie das Pult ist
- Eigener Auto-Update: prüft beim Start auf GitHub nach einer neueren
  Version, zeigt oben einen Balken "Jetzt aktualisieren"; ein Klick lädt
  die neue App herunter, tauscht sie aus und startet neu (kein Terminal, keine
  Neuinstallation). Bewusst nicht `electron-updater`: dessen macOS-Updater
  braucht eine echte Apple-Signatur und bricht bei unserer ad-hoc-Signatur
  stillschweigend ab. Bei Problemen steht ein Protokoll in
  `~/Library/Application Support/X32 Fernsteuerung/update.log`.

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

## Ungetestet an echter Hardware

Das OSC-Protokoll (Fader-Kurve, Meter-Blob-Format, EQ/Dynamics-Adressen) ist
nach der offiziellen Dokumentation umgesetzt, aber noch nicht an einem
echten X32 getestet. Erster Test: verbinden, einen Fader in der App bewegen
und schauen, ob sich der Fader-Wert am Pult (per Pult-Anzeige oder Mixing-
Station-App zum Vergleich) auch ändert.

## Struktur

```
main.js              Electron-Hauptprozess: UDP/OSC-Kommunikation, Zustand
                      pro Kanal, Umrechnung norm. Werte <-> Hz/dB/ms
preload.js            Sichere Brücke (contextBridge) zur UI (window.x32API)
x32-protocol.js       OSC-Codec + X32-Wertumrechnungen (Fader-Kurve, linf/logf)
renderer/
  index.html, style.css, app.js   Kanalzüge, EQ/Dynamics-Detailansicht
```
