// "Neu in dieser Version": erscheint einmal nach einem Update. Neue Einträge oben in CHANGELOG ergänzen.
const CHANGELOG = {
  '2.11.0': {
    title: 'Neu in Version 2.11.0 – Live-Pegel ruhiger und genauer',
    items: [
      ['Ruhige Zahlen', 'Die große Zahl ändert sich höchstens zweimal pro Sekunde, damit man sie ablesen kann. Balken und Diagramm laufen weiter flüssig. Einstellbar: schnell (0,125 s), langsam (1 s, Standard) oder ruhig (Mittel über 3 s). Mit „Halten“ bleibt die Zahl stehen.'],
      ['dB(A), dB(C) oder dB(Z)', 'Die Bewertung ist jetzt wählbar. Ohne Kalibrierung steht „dBFS“ (relativ zur Vollaussteuerung, deshalb immer unter 0, z. B. −60): das sind keine echten dB. Ein Hinweis erklärt das, mit Knopf zum Umrechnen.'],
      ['Kalibrieren mit Prüfung', 'Mit Kalibrator (die App prüft, dass wirklich ein ruhiger Ton anliegt, nicht Musik oder Raumlärm) oder ohne Kalibrator mit einem Referenz-Messgerät (z. B. Handy-App) und Rauschen. Übersteuerte Signale werden abgelehnt. Nach dem Kalibrieren zeigt die App, wie viel Aussteuerung übrig ist und wo das Rauschen des Interfaces liegt.'],
      ['Mikrofon-Kalibrierdatei', 'Für das ECM8000 gibt es keine offizielle Datei. Jetzt kann man eine Datei laden (REW-, Text- oder CSV-Format), eigene Werte eintippen und speichern. Die Kurve gleicht den Frequenzgang des Mikrofons aus (Spektrum und dB(A)) und wird bei 1 kHz auf 0 dB gelegt, damit die Kalibrierung gültig bleibt.'],
      ['Übersteuerungs-Warnung', 'Erreicht der Eingang die Vollaussteuerung, zeigt der Live-Pegel „Übersteuert“, denn dann stimmen die Werte nicht mehr.'],
    ],
  },
  '2.10.0': {
    title: 'Neu in Version 2.10.0 – Verbindung zum Pult verbessert',
    items: [
      ['Verbindungshilfe', 'Kommt keine Antwort vom Pult, sagt die App nach wenigen Sekunden in einfachen Worten, woran es liegt: falsches Netz, Pult nicht erreichbar, falsche Adresse, oder macOS blockiert die App im lokalen Netzwerk. Mit den passenden Schritten und Knöpfen.'],
      ['macOS-Freigabe „Lokales Netzwerk“', 'Neuere macOS-Versionen verlangen eine Freigabe, damit eine App Geräte im Netz erreichen darf. Die App prüft das beim Start und zeigt eine Warnung mit Knopf zu den Systemeinstellungen. Jede App hat jetzt eine eigene Kennung (UUID), damit macOS sie nicht mit anderen verwechselt.'],
      ['Pult suchen findet mehr', 'Die Suche durchsucht jetzt alle Netzwerke des Macs (WLAN und Kabel), mit Einzelanfragen und Rundruf. Sie sagt, welche Netze durchsucht wurden.'],
      ['Keine erfundene Adresse mehr', 'Die Adresse 192.168.0.64 war nur ein Beispiel aus einer Anleitung. Ist das Feld leer, sucht die App das Pult im Netz, statt zu raten. Ungültige Eingaben werden erklärt.'],
      ['Protokoll und Wartezeit', 'Beim Verbinden zeigt die App die Zieladresse und die Wartezeit. Alles wird in einer Protokolldatei festgehalten (Verbindungshilfe → Protokoll), die bei der Fehlersuche hilft.'],
    ],
  },
  '2.9.0': {
    title: 'Neu in Version 2.9.0',
    items: [
      ['Touch-Modus: nichts verschwindet mehr', 'Die Übersicht klappt nicht mehr von selbst ein. Es wird nichts kleiner, nur größer.'],
      ['Geteilter Bildschirm für große Monitore', 'Ab etwa 1500 Pixel Breite (z. B. 27-Zoll-Touch-Monitor): links das Mischpult (halbe Breite), rechts oben die Pegelanzeige mit Live-Pegel, Main-Pegel und „Auf einen Blick“, rechts unten eine freie Fläche für später.'],
      ['Vollbild-Knopf', 'Im Touch-Modus steht oben „Vollbild“, damit man ohne Tastatur den ganzen Monitor nutzen kann.'],
    ],
  },
  '2.8.0': {
    title: 'Neu in Version 2.8.0',
    items: [
      ['Touch-Modus', 'Für Touch-Monitore: Knopf „Touch“ oben. Große Tasten, breite Fader mit großer Kappe, die die ganze Bildschirmhöhe nutzen, und Pfeile zum Blättern durch die Kanäle. Schaltet sich beim ersten Fingertipp auch selbst ein.'],
      ['Fader mit dem Finger', 'Mehrere Fader gleichzeitig mit mehreren Fingern. Die dB stehen in einer Blase über dem Finger. Fein einstellen: Finger kurz ruhig halten oder beim Ziehen seitlich wegrücken. Doppeltippen auf die Kappe = 0 dB.'],
      ['EQ mit dem Finger', 'Größere Griffe, dazu Tasten „Güte −/+“ und „Gain 0 dB“ für das gewählte Band.'],
    ],
  },
  '2.7.0': {
    title: 'Neu in Version 2.7.0',
    items: [
      ['Mini-Anzeigen über jedem Fader', 'EQ-Kurve, Kompressor-Kennlinie mit Gain-Reduction-Balken und der Spitzenpegel als Zahl. Ein Klick auf EQ oder Kompressor öffnet die jeweilige Seite.'],
      ['Meine Seite (★)', 'Stell dir die wichtigsten Kanäle aus allen Ebenen selbst zusammen: Stern (☆) an einem Kanalzug oder „Bearbeiten“, dazu Reihenfolge festlegen. Die App merkt sich Seite und zuletzt benutzte Ebene.'],
      ['Schlichteres Design', 'Flach, neutrale Grautöne, Systemschrift, ein ruhiges Blau. Oben links lässt sich auf „Klassisch“ zurückschalten.'],
      ['Übersicht über den Fadern', 'Live-Pegel vom Messmikrofon, Main-Pegel groß und „Auf einen Blick“ (Signal, stumm, übersteuert). Mit dem Pfeil einklappbar. „REW öffnen“ steht oben in der Kopfzeile.'],
      ['Offline-Modus', 'Ohne Pult alle Regler ausprobieren und vorbereiten, später aufs Pult übertragen.'],
    ],
  },
  '2.5.0': {
    title: 'Neu in Version 2.5.0',
    items: [
      ['Automatisch verbinden', 'Beim Start sucht die App das Pult im Netzwerk und verbindet sich selbst (abschaltbar auf dem Startbildschirm).'],
      ['Spitzenwert & Übersteuerung', 'Auf jedem Kanal hält ein kleiner Strich den höchsten Pegel. Die rote Lampe oben leuchtet bei Übersteuerung, bis du sie anklickst.'],
      ['Szenen', 'Fader- und Mute-Stände speichern und wieder laden (Reiter „Szenen"). Vor dem Laden merkt sich die App den alten Stand: „Rückgängig" bringt ihn zurück.'],
      ['Werkzeuge', 'Rechner für Delay/Laufzeit, Echo-Zeiten nach Tempo, Pegel über Entfernung, Frequenz und Wellenlänge, Töne.'],
      ['Pegelverlauf & Protokoll', 'In der Messung: Verlauf der letzten 30 Minuten und Speichern als CSV-Datei (z. B. als Nachweis für Veranstaltungen).'],
    ],
  },
};

function showChangelog(version){
  const entry = CHANGELOG[version];
  if(!entry || document.getElementById('changelog-overlay')) return;
  const overlay = el('<div class="overlay" id="changelog-overlay"></div>');
  const box = el('<div class="detail-card" style="max-width:520px;"></div>');
  box.appendChild(el('<div class="detail-header"><div class="section-title" style="margin:0;">' + esc(entry.title) + '</div></div>'));
  const list = el('<div class="changelog-list"></div>');
  entry.items.forEach(([head, text]) => list.appendChild(el('<div class="changelog-item"><b>' + esc(head) + '</b><span>' + esc(text) + '</span></div>')));
  box.appendChild(list);
  const ok = el('<button class="btn" style="margin-top:16px;width:100%;">Verstanden</button>');
  ok.addEventListener('click', () => overlay.remove());
  box.appendChild(ok);
  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if(e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// einmal pro Version zeigen (nicht bei allerersten Start ohne gespeicherte Version? doch, auch dann: es ist ein Überblick)
function maybeShowChangelog(version){
  if(!CHANGELOG[version]) return;
  let seen = null;
  try { seen = localStorage.getItem('x32.seenVersion'); } catch(e){}
  if(seen === version) return;
  try { localStorage.setItem('x32.seenVersion', version); } catch(e){}
  showChangelog(version);
}
