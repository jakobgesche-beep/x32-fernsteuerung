// "Neu in dieser Version": erscheint einmal nach einem Update. Neue Einträge oben in CHANGELOG ergänzen.
const CHANGELOG = {
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
