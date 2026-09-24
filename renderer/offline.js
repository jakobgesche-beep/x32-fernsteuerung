// Offline-Modus, Oberfläche: Hinweisleiste unter den Reitern und "Aufs Pult übertragen".
// Die Werte selbst liegen im Speicher (store.js); hier nur Anzeige, Rückfragen und das gebremste Schreiben.
const Offline = (function () {
  const CHUNK = 6, CHUNK_MS = 25;              // ca. 240 Werte/s, wie beim Laden von Szenen
  let bar = null, countTimer = null, overlay = null;

  function init() {
    bar = el('<div id="offline-bar" class="offline-bar" hidden></div>');
    const tabs = document.getElementById('layer-tabs');
    tabs.parentNode.insertBefore(bar, tabs.nextSibling);
    X.subscribe('', () => { if (bar.hidden || countTimer) return; countTimer = setTimeout(() => { countTimer = null; render(); }, 300); });
    render();
  }
  function update() { render(); }

  const secondsFor = (n) => Math.max(1, Math.ceil(n / (CHUNK * 1000 / CHUNK_MS)));

  function render() {
    if (!bar) return;
    const st = X.status().state, n = X.offlineChanges();
    bar.innerHTML = '';
    if (st === 'offline') {
      bar.hidden = false; bar.className = 'offline-bar';
      bar.appendChild(el('<span class="ob-text"><b>Offline-Modus</b> – du arbeitest ohne Pult. Alles hier bleibt in der App (' + n + (n === 1 ? ' Änderung' : ' Änderungen') + ' gemerkt) und lässt sich später aufs Pult übertragen.</span>'));
      const reset = el('<button class="btn secondary small">Zurücksetzen</button>');
      reset.addEventListener('click', () => askReset());
      const end = el('<button class="btn small">Offline beenden</button>');
      end.addEventListener('click', () => leaveOffline());
      bar.append(reset, end);
    } else if (st === 'online' && n > 0) {
      bar.hidden = false; bar.className = 'offline-bar info';
      bar.appendChild(el('<span class="ob-text"><b>Offline vorbereitet:</b> ' + n + (n === 1 ? ' Einstellung' : ' Einstellungen') + ' aus dem Offline-Modus warten darauf, aufs Pult übertragen zu werden.</span>'));
      const go = el('<button class="btn small">Aufs Pult übertragen…</button>');
      go.addEventListener('click', () => askTransfer());
      const drop = el('<button class="btn secondary small">Verwerfen</button>');
      drop.addEventListener('click', () => askDiscard());
      bar.append(go, drop);
    } else { bar.hidden = true; }
  }

  // kleine Rückfrage-Fenster
  function dialog(title, text, buttons) {
    close();
    overlay = el('<div class="overlay" id="offline-dialog"></div>');
    const box = el('<div class="detail-card" style="max-width:440px;"><div class="detail-header"><div class="section-title" style="margin:0;">' + esc(title) + '</div></div><p class="ob-dialog-text">' + esc(text) + '</p><div class="ob-actions"></div></div>');
    buttons.forEach(([label, cls, fn]) => { const b = el('<button class="btn ' + cls + '">' + esc(label) + '</button>'); b.addEventListener('click', fn); box.querySelector('.ob-actions').appendChild(b); });
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return box;
  }
  function close() { if (overlay) { overlay.remove(); overlay = null; } }

  function askReset() {
    dialog('Offline-Stand zurücksetzen?', 'Alle im Offline-Modus gemachten Einstellungen werden gelöscht, die Regler stehen wieder auf den Startwerten.', [
      ['Ja, zurücksetzen', 'danger', () => { close(); X.clearOffline(); X.want(STRIPS.flatMap((s) => X32V.basicPaths(s))); setLayer(currentLayer); render(); toast('Offline-Stand zurückgesetzt.'); }],
      ['Abbrechen', 'secondary', close],
    ]);
  }
  function askDiscard() {
    dialog('Offline-Stand verwerfen?', 'Die vorbereiteten Einstellungen werden aus der App gelöscht, ohne sie aufs Pult zu übertragen.', [
      ['Ja, verwerfen', 'danger', () => { close(); X.clearOffline(); render(); }],
      ['Abbrechen', 'secondary', close],
    ]);
  }
  function askTransfer() {
    const n = X.offlineChanges();
    if (!n) { render(); return; }
    dialog('Aufs Pult übertragen?', n + ' Werte werden am Pult überschrieben (Fader, Mute, Namen, EQ, Kompressor …). Das dauert etwa ' + secondsFor(n) + ' s, die Fader springen. Bitte nur bei ruhigem Pult (nicht während der Veranstaltung).', [
      ['Ja, übertragen', '', () => transfer()],
      ['Abbrechen', 'secondary', close],
    ]);
  }

  async function transfer() {
    const writes = X.offlineWrites();
    const box = dialog('Übertrage…', '0 von ' + writes.length, []);
    const text = box.querySelector('.ob-dialog-text');
    for (let i = 0; i < writes.length; i += CHUNK) {
      if (X.status().state !== 'online') { text.textContent = 'Verbindung zum Pult verloren – Übertragung abgebrochen (' + i + ' von ' + writes.length + ' Werten).'; addOk(box); return { ok: false, sent: i }; }
      writes.slice(i, i + CHUNK).forEach(([p, t, v]) => X.setWire(p, t, v));
      text.textContent = Math.min(i + CHUNK, writes.length) + ' von ' + writes.length;
      await new Promise((r) => setTimeout(r, CHUNK_MS));
    }
    text.textContent = 'Fertig: ' + writes.length + ' Werte wurden aufs Pult übertragen.';
    addOk(box);
    return { ok: true, sent: writes.length };
  }
  function addOk(box) {
    const b = el('<button class="btn">OK</button>');
    b.addEventListener('click', close);
    box.querySelector('.ob-actions').appendChild(b);
  }

  return { init, update, render, transfer, askTransfer, close };
})();
Offline.init();       // erst hier: läuft nach app.js (braucht STRIPS, X, el)
