// Szenen: Fader- und Mute-Stände (optional Namen, Farben, Icons) aller Kanalzüge lokal speichern und wieder laden.
// Liegt nur in dieser App (nicht im Pult). Vor jedem Laden wird der alte Stand gesichert -> "Rückgängig".
const Scenes = (function () {
  const KEY = 'x32.scenes', BACKUP_KEY = 'x32.scenes.backup';
  const CHUNK = 6, CHUNK_MS = 25;              // beim Laden ~240 Werte/s, damit das Pult nicht überrollt wird
  const MAX_SCENES = 60;

  const load = (key, fb) => { try { const v = JSON.parse(localStorage.getItem(key)); return v || fb; } catch (e) { return fb; } };
  const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} };

  // aktueller Stand aller Kanalzüge aus dem Zwischenspeicher
  function capture(withLabels) {
    const data = {}; let count = 0;
    for (const s of STRIPS) {
      const e = {};
      const f = X.get(X32V.stripPath(s, s.faderLeaf)), on = X.get(X32V.stripPath(s, s.onLeaf));
      if (f !== undefined) e.f = f;
      if (on !== undefined) e.on = on;
      if (withLabels) {
        const n = X.get(s.base + '/config/name'), c = X.get(s.base + '/config/color'), i = X.get(s.base + '/config/icon');
        if (n !== undefined) e.n = n;
        if (c !== undefined) e.c = c;
        if (i !== undefined) e.i = i;
      }
      if (Object.keys(e).length) { data[s.id] = e; count++; }
    }
    return { data, count };
  }

  // Was müsste geschrieben werden, damit der Stand data erreicht wird? (nur echte Unterschiede)
  function diff(data) {
    const writes = [];
    for (const s of STRIPS) {
      const e = data[s.id];
      if (!e) continue;
      const add = (path, type, v) => { if (v !== undefined && X.get(path) !== v) writes.push([path, type, v]); };
      add(X32V.stripPath(s, s.faderLeaf), 'f', e.f);
      add(X32V.stripPath(s, s.onLeaf), 'i', e.on);
      add(s.base + '/config/name', 's', e.n);
      add(s.base + '/config/color', 'i', e.c);
      add(s.base + '/config/icon', 'i', e.i);
    }
    return writes;
  }

  function apply(writes) {
    return new Promise((resolve) => {
      let i = 0;
      (function step() {
        const end = Math.min(writes.length, i + CHUNK);
        for (; i < end; i++) X.setWire(writes[i][0], writes[i][1], writes[i][2]);
        if (i < writes.length) setTimeout(step, CHUNK_MS); else resolve();
      })();
    });
  }

  const list = () => load(KEY, []);
  const fmtTime = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '. ' + p(d.getHours()) + ':' + p(d.getMinutes()); };

  function saveScene(name, withLabels, replaceId) {
    const { data, count } = capture(withLabels);
    if (!count) return null;
    const scenes = list();
    const prev = replaceId ? scenes.find((s) => s.id === replaceId) : null;
    if (prev) Object.assign(prev, { data, count, labels: withLabels, time: Date.now() });
    else {
      if (scenes.length >= MAX_SCENES) scenes.shift();
      scenes.push({ id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: (name || '').trim() || 'Szene ' + (scenes.length + 1), time: Date.now(), count, labels: withLabels, data });
    }
    save(KEY, scenes);
    return prev || scenes[scenes.length - 1];
  }

  async function recall(id) {
    const scene = list().find((s) => s.id === id);
    if (!scene) return { ok: false };
    const writes = diff(scene.data);
    save(BACKUP_KEY, { time: Date.now(), name: scene.name, ...capture(true) });     // alter Stand für "Rückgängig"
    await apply(writes);
    return { ok: true, changed: writes.length };
  }
  async function undo() {
    const b = load(BACKUP_KEY, null);
    if (!b) return { ok: false };
    const writes = diff(b.data);
    localStorage.removeItem(BACKUP_KEY);
    await apply(writes);
    return { ok: true, changed: writes.length };
  }

  // ---------- Oberfläche ----------
  let overlay = null;
  function close() { if (overlay) { overlay.remove(); overlay = null; } }
  function render() {
    if (!overlay) return;
    const body = overlay.querySelector('.scenes-body');
    const online = X.isLive();
    const scenes = list().slice().reverse();
    const backup = load(BACKUP_KEY, null);
    body.innerHTML = '';
    body.appendChild(el('<p class="scenes-help">Speichert Fader und Mute aller Kanalzüge (Kanäle, Aux, FX, Bus, Matrix, Main, DCA). Die Szenen liegen nur in dieser App, nicht im Pult.</p>'));
    const row = el('<div class="scenes-save"><input class="scene-name" type="text" maxlength="40" placeholder="Name, z. B. Soundcheck">' +
      '<label class="scene-check"><input class="scene-labels" type="checkbox"> mit Namen, Farben, Icons</label>' +
      '<button class="btn scene-save-btn">Aktuellen Stand speichern</button></div>');
    const saveBtn = row.querySelector('.scene-save-btn');
    saveBtn.disabled = !online;
    saveBtn.title = online ? '' : 'Erst mit dem Pult verbinden';
    saveBtn.addEventListener('click', () => {
      const s = saveScene(row.querySelector('.scene-name').value, row.querySelector('.scene-labels').checked);
      if (!s) { toast('Noch keine Werte vom Pult – erst verbinden.', true); return; }
      toast('Szene „' + s.name + '“ gespeichert (' + s.count + ' Kanalzüge).');
      render();
    });
    body.appendChild(row);
    if (!online) body.appendChild(el('<p class="scenes-help warn">Zum Speichern und Laden muss die App mit dem Pult verbunden sein (oder im Offline-Modus).</p>'));
    if (backup) {
      const u = el('<div class="scene-undo"><span>Zuletzt geladen: „' + esc(backup.name) + '“ (' + fmtTime(backup.time) + ')</span><button class="btn secondary small">Rückgängig</button></div>');
      u.querySelector('button').addEventListener('click', async () => { const r = await undo(); toast(r.ok ? 'Alter Stand wiederhergestellt (' + r.changed + ' Werte).' : 'Nichts zum Rückgängigmachen.'); render(); });
      body.appendChild(u);
    }
    if (!scenes.length) body.appendChild(el('<p class="scenes-empty">Noch keine Szenen gespeichert.</p>'));
    scenes.forEach((s) => {
      const r = el('<div class="scene-row"><div class="scene-info"><div class="scene-title">' + esc(s.name) + '</div><div class="scene-meta">' + fmtTime(s.time) + ' · ' + s.count + ' Kanalzüge' + (s.labels ? ' · mit Beschriftung' : '') + '</div></div><div class="scene-actions"></div></div>');
      const act = r.querySelector('.scene-actions');
      const btn = (label, cls, fn) => { const b = el('<button class="btn small ' + cls + '">' + label + '</button>'); b.addEventListener('click', fn); act.appendChild(b); return b; };
      const idle = () => {
        act.innerHTML = '';
        const load_ = btn('Laden', '', () => confirmLoad());
        load_.disabled = !online;
        btn('Überschreiben', 'secondary', () => confirmOver());
        btn('Löschen', 'danger', () => confirmDel());
      };
      const ask = (text, yesLabel, yes) => {
        act.innerHTML = '<span class="scene-ask">' + text + '</span>';
        btn(yesLabel, '', yes); btn('Abbrechen', 'secondary', idle);
      };
      const confirmLoad = () => {
        const n = diff(s.data).length;
        ask(n ? n + ' Werte am Pult ändern? Fader springen.' : 'Schon identisch.', 'Ja, laden', async () => {
          const res = await recall(s.id); toast('Szene „' + s.name + '“ geladen (' + res.changed + ' Werte geändert).'); render();
        });
      };
      const confirmOver = () => ask('Mit dem aktuellen Stand ersetzen?', 'Ja, ersetzen', () => { saveScene(s.name, s.labels, s.id); toast('Szene „' + s.name + '“ überschrieben.'); render(); });
      const confirmDel = () => ask('Szene löschen?', 'Ja, löschen', () => { save(KEY, list().filter((x) => x.id !== s.id)); render(); });
      idle();
      body.appendChild(r);
    });
  }

  function open() {
    if (overlay) return;
    overlay = el('<div class="overlay" id="scenes-overlay"></div>');
    const box = el('<div class="detail-card scenes-card"><div class="detail-header"><div class="section-title" style="margin:0;">Szenen</div></div><div class="scenes-body"></div></div>');
    const closeBtn = el('<button class="close-btn">&times;</button>');
    closeBtn.addEventListener('click', close);
    box.querySelector('.detail-header').appendChild(closeBtn);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    render();
  }

  return { open, close, capture, diff, saveScene, recall, undo, list, render };
})();
