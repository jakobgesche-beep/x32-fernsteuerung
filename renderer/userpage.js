// "Meine Seite": eine eigene Ebene, auf der man sich die wichtigsten Kanalzüge aus allen Ebenen selbst zusammenstellt.
// Die Auswahl (Reihenfolge inklusive) liegt im lokalen Speicher. Bearbeiten: Stern an jedem Kanalzug oder das Fenster "Bearbeiten".
const UserPage = (function () {
  const KEY = 'x32.userpage';
  let list = [];
  const listeners = [];
  let overlay = null;

  try { const v = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(v)) list = v.filter((x) => typeof x === 'string'); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} listeners.forEach((fn) => fn()); }

  const ids = () => list.filter((id) => STRIP_BY_ID[id]);
  const has = (id) => list.includes(id);
  function add(id) { if (STRIP_BY_ID[id] && !has(id)) { list.push(id); save(); } }
  function remove(id) { const i = list.indexOf(id); if (i >= 0) { list.splice(i, 1); save(); } }
  const toggle = (id) => (has(id) ? remove(id) : add(id));
  function move(id, delta) {
    const i = list.indexOf(id), j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    save();
  }
  function clear() { list = []; save(); }
  const onChange = (fn) => listeners.push(fn);

  // ---------- Bearbeiten-Fenster ----------
  const nameOf = (s) => { const n = X.get(s.base + '/config/name'); return n !== undefined && n !== '' ? n : s.label; };
  const GROUPS = [['ch', 'Kanäle'], ['aux', 'Aux / FX'], ['bus', 'Bus'], ['mtx', 'Matrix'], ['dca', 'DCA']];
  const pickable = () => STRIPS.filter((s) => !DOCK_IDS.includes(s.id));

  function close() { if (overlay) { overlay.remove(); overlay = null; } }
  function render() {
    if (!overlay) return;
    const onlyNamed = overlay.querySelector('.up-named').checked, q = overlay.querySelector('.up-search').value.trim().toLowerCase();
    const avail = overlay.querySelector('.up-avail'), mine = overlay.querySelector('.up-mine');
    avail.innerHTML = ''; mine.innerHTML = '';
    GROUPS.forEach(([layer, title]) => {
      const strips = pickable().filter((s) => s.layer === layer).filter((s) => {
        if (onlyNamed && !has(s.id) && (X.get(s.base + '/config/name') || '') === '') return false;
        return !q || (nameOf(s) + ' ' + s.label).toLowerCase().includes(q);
      });
      if (!strips.length) return;
      avail.appendChild(el('<div class="up-group">' + esc(title) + '</div>'));
      strips.forEach((s) => {
        const on = has(s.id);
        const b = el('<button class="up-item' + (on ? ' on' : '') + '" title="' + (on ? 'Von Meiner Seite entfernen' : 'Zu Meiner Seite hinzufügen') + '"><span class="up-check">' + (on ? '✓' : '+') + '</span><span class="up-label">' + esc(s.label) + '</span><span class="up-name">' + esc(nameOf(s) === s.label ? '' : nameOf(s)) + '</span></button>');
        b.addEventListener('click', () => { toggle(s.id); render(); });
        avail.appendChild(b);
      });
    });
    if (!avail.children.length) avail.appendChild(el('<div class="up-empty">Nichts gefunden.</div>'));
    const cur = ids();
    overlay.querySelector('.up-count').textContent = cur.length;
    if (!cur.length) mine.appendChild(el('<div class="up-empty">Noch leer. Links Kanäle antippen, die auf deine Seite sollen.</div>'));
    cur.forEach((id, i) => {
      const s = STRIP_BY_ID[id];
      const row = el('<div class="up-row"><span class="up-pos">' + (i + 1) + '</span><span class="up-label">' + esc(s.label) + '</span><span class="up-name">' + esc(nameOf(s) === s.label ? '' : nameOf(s)) + '</span><span class="up-btns"><button class="up-mv" data-d="-1" title="Nach vorn">▲</button><button class="up-mv" data-d="1" title="Nach hinten">▼</button><button class="up-rm" title="Entfernen">✕</button></span></div>');
      row.querySelectorAll('.up-mv').forEach((b) => b.addEventListener('click', () => { move(id, +b.dataset.d); render(); }));
      row.querySelector('.up-rm').addEventListener('click', () => { remove(id); render(); });
      mine.appendChild(row);
    });
  }
  function openEditor() {
    if (overlay) return;
    overlay = el('<div class="overlay" id="userpage-editor"></div>');
    const box = el('<div class="detail-card up-card"><div class="detail-header"><div class="section-title" style="margin:0;">Meine Seite zusammenstellen</div></div>' +
      '<p class="up-help">Suche dir aus allen Ebenen die Kanalzüge aus, die du brauchst. Die Reihenfolge rechts ist die Reihenfolge auf der Seite.</p>' +
      '<div class="up-cols"><div class="up-col"><div class="up-tools"><input class="up-search" type="text" placeholder="Suchen (Name oder Nummer)"><label class="up-check-row"><input class="up-named" type="checkbox"> nur benannte</label></div><div class="up-avail"></div></div>' +
      '<div class="up-col"><div class="up-title">Meine Seite (<span class="up-count">0</span>)</div><div class="up-mine"></div></div></div>' +
      '<div class="ob-actions" style="margin-top:14px;"><button class="btn up-done">Fertig</button><button class="btn secondary up-clear">Alle entfernen</button></div></div>');
    const closeBtn = el('<button class="close-btn">&times;</button>');
    closeBtn.addEventListener('click', close);
    box.querySelector('.detail-header').appendChild(closeBtn);
    box.querySelector('.up-done').addEventListener('click', close);
    box.querySelector('.up-clear').addEventListener('click', () => { clear(); render(); });
    box.querySelector('.up-search').addEventListener('input', render);
    box.querySelector('.up-named').addEventListener('change', render);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    render();
  }

  return { ids, has, add, remove, toggle, move, clear, onChange, openEditor, closeEditor: close, render };
})();
