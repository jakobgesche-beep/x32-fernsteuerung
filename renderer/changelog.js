// "Neu in dieser Version": erscheint einmal nach einem Update. Neue Einträge oben in CHANGELOG ergänzen.
const CHANGELOG = {
  '2.6.0': {
    title: 'Neu in Version 2.6.0',
    items: [
      ['Neues Design „Studio"', 'Warmes Graphit mit Bernstein, LED-Meter, farbige Kanalköpfe. Oben links lässt sich jederzeit auf „Klassisch" zurückschalten.'],
      ['Übersicht über den Fadern', 'Live-Pegel vom Messmikrofon mit Verlauf und Spektrum, Main-Pegel groß, und „Auf einen Blick": Kanäle mit Signal, stumme und übersteuerte Kanäle. Mit dem Pfeil oben einklappbar.'],
      ['Offline-Modus', 'Ohne Pult alle Regler ausprobieren und vorbereiten (Knopf „Offline-Modus"). Beim Verbinden lässt sich der Stand aufs Pult übertragen.'],
      ['REW-Knopf oben', 'Der Reiter „Messung" ist weg: Die Feinmessung macht REW, „REW öffnen" steht immer oben in der Kopfzeile. Die Grenzwert-Warnung bleibt.'],
      ['Weniger Rechner', 'Der dB-Umrechner ist entfernt.'],
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
