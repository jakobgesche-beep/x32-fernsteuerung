// Übersicht über den Fadern: Live-Pegel (Messmikrofon), Main-Pegel groß, "Auf einen Blick" (Signal, stumm, übersteuert).
// Alles lesend; nichts davon verändert etwas am Pult (außer dem Zurücksetzen der Übersteuerungs-Lampen in der App).
const Overview = (function () {
  const SIGNAL_LEVEL = 0.003;            // ca. -50 dBFS: Kanal "hat Signal"
  const MAX_CHIPS = 8;
  let root = null, built = false, els = {}, timer = null, tickNo = 0;

  const dbText = (v) => (v > 0.0005 ? (20 * Math.log10(v)).toFixed(1) : '–∞');
  const nameOf = (s) => { const n = X.get(s.base + '/config/name'); return n !== undefined && n !== '' ? n : s.label; };

  function init() {
    if (built) return;
    built = true;
    root = document.getElementById('overview');
    root.innerHTML = '';
    const bar = el('<div class="ov-bar"><span class="ov-bar-title">Übersicht</span><button class="ov-toggle" title="Übersicht ein-/ausklappen" aria-label="Übersicht ein- oder ausklappen">▾</button></div>');
    const grid = el('<div class="ov-grid"></div>');
    const live = el('<section class="ov-card ov-live" id="live-panel"></section>');
    const side = el('<section class="ov-card ov-side"></section>');
    const main = el('<div class="ov-main"><div class="ov-title">Main LR <button class="clip-led ov-clip" title="Übersteuerung – Klick zum Zurücksetzen" aria-label="Übersteuerung zurücksetzen"></button></div>' +
      ['L', 'R'].map((c, i) => '<div class="ov-mrow"><span>' + c + '</span><div class="ov-mbar"><div class="ov-mfill" data-i="' + i + '"></div><div class="ov-mpeak" data-i="' + i + '"></div></div><b data-i="' + i + '">–∞</b></div>').join('') +
      '<div class="ov-mscale"><span>-60</span><span>-40</span><span>-20</span><span>-10</span><span>0 dBFS</span></div></div>');
    const glance = el('<div class="ov-glance"><div class="ov-title">Auf einen Blick</div>' +
      '<div class="ov-stats"><div class="ov-stat"><b id="ov-signal">–</b><span>Kanäle mit Signal</span></div><div class="ov-stat"><b id="ov-muted">0</b><span>Kanäle stumm</span></div></div>' +
      '<div class="ov-sub">Übersteuert</div><div class="ov-chips" id="ov-clips"></div>' +
      '<div class="ov-sub">Stumm</div><div class="ov-chips" id="ov-mutedlist"></div></div>');
    side.append(main, glance);
    grid.append(live, side);
    root.append(bar, grid);
    els = {
      grid, fills: main.querySelectorAll('.ov-mfill'), peaks: main.querySelectorAll('.ov-mpeak'), vals: main.querySelectorAll('.ov-mrow b'), mainClip: main.querySelector('.ov-clip'),
      signal: glance.querySelector('#ov-signal'), muted: glance.querySelector('#ov-muted'), clips: glance.querySelector('#ov-clips'), mutedList: glance.querySelector('#ov-mutedlist'),
    };
    els.mainClip.addEventListener('click', () => { CLIPPED.delete('st'); clipChanged(); });
    bar.querySelector('.ov-toggle').addEventListener('click', () => {
      const c = root.classList.toggle('collapsed');
      try { localStorage.setItem('x32.overview.collapsed', c ? '1' : '0'); } catch (e) {}
      autoCollapsedOverview = false;
      setTimeout(() => { if (!c) Measure.redraw(); if (typeof fitFaders === 'function') fitFaders(); }, 0);
    });
    try { if (localStorage.getItem('x32.overview.collapsed') === '1') root.classList.add('collapsed'); } catch (e) {}
    Measure.init(live);
    refresh();
    timer = setInterval(tick, 90);
  }

  // Übersteuerungs-Chips und Main-Lampe
  function refresh() {
    if (!built) return;
    els.mainClip.classList.toggle('on', CLIPPED.has('st'));
    els.clips.innerHTML = '';
    const ids = STRIPS.filter((s) => CLIPPED.has(s.id));
    if (!ids.length) els.clips.appendChild(el('<span class="ov-none">keine</span>'));
    ids.slice(0, MAX_CHIPS).forEach((s) => {
      const c = el('<button class="ov-chip clip" title="Klick: zurücksetzen">' + esc(nameOf(s)) + '</button>');
      c.addEventListener('click', () => { CLIPPED.delete(s.id); clipChanged(); });
      els.clips.appendChild(c);
    });
    if (ids.length > MAX_CHIPS) els.clips.appendChild(el('<span class="ov-none">+' + (ids.length - MAX_CHIPS) + '</span>'));
    if (ids.length > 1) {
      const all = el('<button class="ov-link">alle zurücksetzen</button>');
      all.addEventListener('click', () => { CLIPPED.clear(); clipChanged(); });
      els.clips.appendChild(all);
    }
  }

  function tick() {
    if (!built || root.hidden || root.classList.contains('collapsed')) return;
    const st = METER_STATE.st;
    ['0', '1'].forEach((i) => {
      const k = +i, v = st ? st.last[k] || 0 : 0, pk = st ? st.peaks[k].v : 0;
      els.fills[k].parentElement.style.setProperty('--lvl', levelToPct(v).toFixed(0) + '%');
      els.peaks[k].style.left = levelToPct(pk).toFixed(0) + '%';
      els.peaks[k].style.opacity = pk > 0.002 ? '1' : '0';
      els.vals[k].textContent = dbText(v);
    });
    if (tickNo++ % 4) return;            // Zähler und Listen ca. 3x pro Sekunde
    const chans = STRIPS.filter((s) => s.type === 'ch');
    const haveMeters = chans.some((s) => METER_STATE[s.id]);
    els.signal.textContent = haveMeters ? chans.filter((s) => METER_STATE[s.id] && METER_STATE[s.id].level > SIGNAL_LEVEL).length + ' / ' + chans.length : '–';
    const muted = chans.filter((s) => X.get(X32V.stripPath(s, s.onLeaf)) === 0);
    els.muted.textContent = muted.length;
    els.mutedList.innerHTML = '';
    if (!muted.length) els.mutedList.appendChild(el('<span class="ov-none">keiner</span>'));
    muted.slice(0, MAX_CHIPS).forEach((s) => els.mutedList.appendChild(el('<span class="ov-chip">' + esc(nameOf(s)) + '</span>')));
    if (muted.length > MAX_CHIPS) els.mutedList.appendChild(el('<span class="ov-none">+' + (muted.length - MAX_CHIPS) + '</span>'));
  }

  return { init, refresh, tick, show() { if (root) root.hidden = false; }, hide() { if (root) root.hidden = true; } };
})();
