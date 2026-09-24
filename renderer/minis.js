// Mini-Anzeigen über dem Fader jedes Kanalzugs: EQ-Kurve, Kompressor-Kennlinie mit Gain-Reduction, Spitzenpegel.
// Rechnung wie auf der EQ-/Kompressor-Seite (shared/eqmath.js). Klick auf EQ oder Kompressor öffnet die jeweilige Seite.
const Minis = (function () {
  const EQ = X32EQ;
  const DYN_KEYS = ['on', 'mode', 'thr', 'ratio', 'knee', 'mgain'];      // Kompressor-Werte, die die Kennlinie braucht
  const F_MIN = 20, F_MAX = 20000, EQ_DB = 15, TF_MIN = -60, GR_MAX = 20;
  const dirty = new Set();
  let raf = 0;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const cssVar = (name, fallback) => getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;

  // Pfade, die für die Mini-Anzeigen eines Kanalzugs vom Pult gelesen werden
  function paths(s) {
    const b = s.base, p = [];
    if (s.eqBands) {
      p.push(b + '/eq/on');
      for (let i = 1; i <= s.eqBands; i++) ['type', 'f', 'g', 'q'].forEach((k) => p.push(b + '/eq/' + i + '/' + k));
    }
    if (s.hpf) ['hpon', 'hpslope', 'hpf'].forEach((k) => p.push(b + '/preamp/' + k));
    if (s.dyn) DYN_KEYS.forEach((k) => p.push(b + '/dyn/' + k));
    return p;
  }
  // Pfad gehört zu EQ, Low Cut oder Kompressor (nicht zu Fader, Mute oder Name)?
  const isMiniPath = (p) => p.includes('/eq/') || p.includes('/dyn/') || p.includes('/preamp/');

  function attach(ui) {
    const s = ui.strip;
    if (!s.eqBands && !s.meter) return null;
    const box = document.createElement('div');
    box.className = 'mini';
    box.innerHTML =
      (s.eqBands ? '<canvas class="mini-eq" title="EQ: Klick öffnet den EQ"></canvas>' : '') +
      (s.dyn ? '<div class="mini-row"><canvas class="mini-tf" title="Kompressor: Klick öffnet den Kompressor"></canvas><div class="mini-gr" title="Gain Reduction (wie stark der Kompressor gerade regelt)"><i></i></div></div>' : '') +
      '<div class="mini-nums"><span class="mini-peak" title="Spitzenpegel in dBFS">–∞</span>' + (s.dyn ? '<span class="mini-grv" title="Gain Reduction in dB">GR 0</span>' : '') + '</div>';
    const m = { box, eq: box.querySelector('.mini-eq'), tf: box.querySelector('.mini-tf'), grFill: box.querySelector('.mini-gr i'), peak: box.querySelector('.mini-peak'), grv: box.querySelector('.mini-grv'), peakText: '–∞', grText: 'GR 0' };
    ui.mini = m;
    box._ui = ui;
    if (m.eq) m.eq.addEventListener('click', () => openDetail(s));
    if (m.tf) m.tf.addEventListener('click', () => { openDetail(s); if (typeof setTab === 'function') setTab('dyn'); });
    return box;
  }

  function read(s) {
    const b = s.base, eq = [];
    for (let i = 1; i <= s.eqBands; i++) eq.push({ type: X.get(b + '/eq/' + i + '/type'), f: X.actual(b + '/eq/' + i + '/f'), g: X.actual(b + '/eq/' + i + '/g'), q: X.actual(b + '/eq/' + i + '/q') });
    const misc = { eqOn: X.get(b + '/eq/on') };
    if (s.hpf) { misc.hpOn = X.get(b + '/preamp/hpon'); misc.hpSlope = X.get(b + '/preamp/hpslope'); misc.hpf = X.actual(b + '/preamp/hpf'); }
    const dyn = {};
    if (s.dyn) DYN_KEYS.forEach((k) => { dyn[k] = X.actual(b + '/dyn/' + k); });
    return { eq, misc, dyn };
  }

  function surface(canvas) {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return null;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, W: w, H: h };
  }

  function drawEq(ui, st) {
    const sf = ui.mini.eq && surface(ui.mini.eq);
    if (!sf) return;
    const { ctx, W, H } = sf, mid = H / 2, k = (H / 2 - 2) / EQ_DB;
    ctx.strokeStyle = 'rgba(140,140,150,0.25)'; ctx.lineWidth = 1;
    [100, 1000, 10000].forEach((f) => { const x = Math.round(W * Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(0, Math.round(mid) + 0.5); ctx.lineTo(W, Math.round(mid) + 0.5); ctx.stroke();
    if (!st.eq.every((b) => b.type !== undefined && b.f !== undefined && b.g !== undefined && b.q !== undefined)) return;   // noch nicht geladen
    const off = st.misc.eqOn === 0, col = cssVar('--chart', '#3DC7E8');
    const pts = [];
    for (let x = 0; x <= W; x += 2) pts.push([x, mid - clamp(EQ.eqResponseDb(F_MIN * Math.pow(F_MAX / F_MIN, x / W), st.eq, st.misc), -EQ_DB, EQ_DB) * k]);
    ctx.beginPath(); ctx.moveTo(0, mid); pts.forEach((p) => ctx.lineTo(p[0], p[1])); ctx.lineTo(W, mid); ctx.closePath();
    ctx.globalAlpha = off ? 0.06 : 0.2; ctx.fillStyle = col; ctx.fill();
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.globalAlpha = off ? 0.3 : 1; ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawTf(ui, st) {
    const sf = ui.mini.tf && surface(ui.mini.tf);
    if (!sf) return;
    const { ctx, W, H } = sf, pad = 2;
    const X_ = (db) => pad + (db - TF_MIN) / -TF_MIN * (W - 2 * pad), Y_ = (db) => H - pad - (db - TF_MIN) / -TF_MIN * (H - 2 * pad);
    ctx.strokeStyle = 'rgba(140,140,150,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X_(TF_MIN), Y_(TF_MIN)); ctx.lineTo(X_(0), Y_(0)); ctx.stroke();       // 1:1-Linie
    const d = st.dyn;
    if (d.thr === undefined || d.ratio === undefined) return;
    const off = d.on === 0, col = cssVar('--chart', '#3DC7E8');
    ctx.globalAlpha = off ? 0.3 : 1; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let x = TF_MIN; x <= 0; x += 2) { const y = clamp(EQ.transferOut(x, d), TF_MIN, 0); if (x === TF_MIN) ctx.moveTo(X_(x), Y_(y)); else ctx.lineTo(X_(x), Y_(y)); }
    ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X_(d.thr), Y_(clamp(d.thr, TF_MIN, 0)), 2, 0, 6.3); ctx.fill();   // Schwelle
    ctx.globalAlpha = 1;
  }

  function paint(ui) {
    if (!ui.mini) return;
    const st = read(ui.strip);
    drawEq(ui, st);
    if (ui.strip.dyn) drawTf(ui, st);
  }
  function flush() {
    raf = 0;
    dirty.forEach((ui) => paint(ui));
    dirty.clear();
  }
  function schedule(ui) {
    if (!ui || !ui.mini) return;
    dirty.add(ui);
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function redrawAll() { document.querySelectorAll('.mini').forEach((b) => { if (b._ui) schedule(b._ui); }); }

  // Live-Werte aus den Pult-Metern
  function setPeak(ui, v) {
    const m = ui.mini;
    if (!m) return;
    const t = v > 0.0005 ? (20 * Math.log10(v)).toFixed(1) : '–∞';
    if (t !== m.peakText) { m.peakText = t; m.peak.textContent = t; m.peak.classList.toggle('hot', v >= 0.7); }   // ab ca. -3 dBFS
  }
  function setGr(ui, grDb) {
    const m = ui.mini;
    if (!m || !m.grFill) return;
    m.grFill.style.height = (clamp(grDb / GR_MAX, 0, 1) * 100).toFixed(0) + '%';
    const t = 'GR ' + (grDb >= 0.05 ? grDb.toFixed(1) : '0');
    if (t !== m.grText) { m.grText = t; m.grv.textContent = t; }
  }

  return { paths, isMiniPath, attach, paint, schedule, redrawAll, setPeak, setGr };
})();
