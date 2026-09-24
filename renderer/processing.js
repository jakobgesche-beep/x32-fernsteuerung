// ================= Processing-Ansicht: EQ + Kompressor im Stil der X32-Oberfläche =================
// Benötigt aus app.js: el(), esc(), fmt(), toast(), channels, chColor(), levelToPct()

const V = X32V;
const EQ_TYPES = V.EQ_TYPES_EXT;
const DYN_RATIOS = V.DYN_RATIOS;
const FILTER_TYPES = V.FILTER_TYPES;
const HP_SLOPES = V.HP_SLOPES;
const KEY_SOURCES = V.KEY_SOURCES;
const BAND_NAMES = { 4: ['Low', 'LoMid', 'HiMid', 'High'], 6: ['Low', 'Low2', 'LoMid', 'HiMid', 'High2', 'High'] };
const BAND_COLORS = { 4: ['#3EC9C9', '#4C9BE0', '#E8548C', '#F0A83C'], 6: ['#4FD0D0', '#3AA0A0', '#E8548C', '#F0A83C', '#E0524F', '#4CAF60'] };
const bandName = (i) => BAND_NAMES[proc.strip.eqBands][i];
const bandColor = (i) => BAND_COLORS[proc.strip.eqBands][i];

const SAMPLE_RATE = 48000;
const EQ_MIN_DB = -15, EQ_MAX_DB = 15, EQ_MIN_F = 20, EQ_MAX_F = 20000;
const EQ_PAD = { l: 40, r: 14, t: 36, b: 24 };
const ORANGE = '#E0952F';
const TURQ = '#3DE6DC';
const KNEE_DB_PER_STEP = 2;

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

// ---------- reine Rechenfunktionen: shared/eqmath.js ----------
const { biquadCoeffs, magnitudeDb, hpfDb, extendedCutDb, bandIsCut, eqResponseDb, transferOut, sidechainDb, grFromFactor } = X32EQ;

// ---------- Canvas-Helfer ----------
function canvasCtx(canvas){
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if(canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)){
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W: w, H: h };
}
function fmtFreq(f){ return f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : (Math.round(f * 10) / 10) + ' Hz'; }

// ---------- Zustand ----------
let proc = null;

const MISC_LEAF = { eqOn: 'eq/on', hpOn: 'preamp/hpon', hpSlope: 'preamp/hpslope', hpf: 'preamp/hpf' };
// Eigene Änderungen gehen sofort in den lokalen Zwischenspeicher (Anzeige aktualisiert sich über
// das Abonnement) und zum Pult.
function setEqLocal(band, field, value){ X.set(proc.strip.base + '/eq/' + (band + 1) + '/' + field, value); }
function setMiscLocal(key, value){ X.set(proc.strip.base + '/' + MISC_LEAF[key], value); }
function setDynLocal(field, value){ X.set(proc.strip.base + '/dyn/' + field, value); }

// Werte des Kanals aus dem Zwischenspeicher in die Anzeige-Struktur übernehmen
function pullFromStore(){
  const s = proc.strip, b = s.base;
  proc.eq.forEach((band, i) => {
    const base = b + '/eq/' + (i + 1) + '/';
    band.type = X.get(base + 'type');
    band.f = X.actual(base + 'f');
    band.g = X.actual(base + 'g');
    band.q = X.actual(base + 'q');
  });
  proc.misc.eqOn = X.get(b + '/eq/on');
  if(s.hpf){
    proc.misc.hpOn = X.get(b + '/preamp/hpon');
    proc.misc.hpSlope = X.get(b + '/preamp/hpslope');
    proc.misc.hpf = X.actual(b + '/preamp/hpf');
  }
  if(s.dyn) V.DYN_KEYS.forEach((k) => { proc.dyn[k] = X.actual(b + '/dyn/' + k); });
}

// ---------- kleine UI-Bausteine ----------
function makeXButton(label, onClick, extraClass){
  const b = el('<button class="x-btn ' + (extraClass || '') + '">' + esc(label) + '</button>');
  b.addEventListener('click', onClick);
  return b;
}

function makeRadioGroup(items, onChange, cls){
  const wrap = el('<div class="radio-group ' + (cls || '') + '"></div>');
  const nodes = items.map((it) => {
    const lab = el('<label class="radio"><span class="dot"></span><span class="rtxt">' + esc(it.label) + '</span></label>');
    lab.addEventListener('click', (e) => { e.preventDefault(); onChange(it.value); });
    wrap.appendChild(lab);
    return { lab, value: it.value };
  });
  return { el: wrap, set(v){ nodes.forEach((n) => n.lab.classList.toggle('on', n.value === v)); } };
}

function makeVBar(opts){
  const min = opts.min, max = opts.max, log = !!opts.log, step = opts.step;
  const wrap = el('<div class="vbar"></div>');
  const valEl = el('<div class="vbar-val">–</div>');
  const track = el('<div class="vbar-track"></div>');
  const fill = el('<div class="vbar-fill"></div>');
  const handle = el('<div class="vbar-handle"></div>');
  track.appendChild(opts.handle ? handle : fill);
  if(opts.ticks) wrap.classList.add('with-scale');
  if(opts.ticks){
    opts.ticks.forEach((tv) => {
      const t = log ? Math.log(tv / min) / Math.log(max / min) : (tv - min) / (max - min);
      const tick = el('<div class="vbar-tick" style="bottom:' + (t * 100) + '%"><span>' + esc(tv) + '</span></div>');
      track.appendChild(tick);
    });
  }
  wrap.appendChild(valEl);
  wrap.appendChild(track);
  wrap.appendChild(el('<div class="vbar-label">' + esc(opts.label) + '</div>'));

  let value = null, dragging = false, lastSend = 0;
  const toT = (v) => clamp(log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min), 0, 1);
  const fromT = (t) => {
    t = clamp(t, 0, 1);
    let v = log ? min * Math.pow(max / min, t) : min + t * (max - min);
    if(step && !log) v = Math.round(v / step) * step;
    return clamp(v, min, max);
  };
  function paint(){
    if(value === null) return;
    const pct = toT(value) * 100;
    fill.style.height = pct + '%';
    handle.style.bottom = 'calc(' + pct + '% - 6px)';
    valEl.textContent = opts.format(value);
  }
  function emit(final){
    const now = performance.now();
    if(!final && now - lastSend < 25) return;
    lastSend = now;
    opts.onChange(value);
  }
  function move(e){
    const r = track.getBoundingClientRect();
    value = fromT(1 - (e.clientY - r.top) / r.height);
    paint();
    emit(false);
  }
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); move(e); });
  track.addEventListener('pointermove', (e) => { if(dragging) move(e); });
  const endDrag = () => { if(dragging){ dragging = false; emit(true); } };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('wheel', (e) => {
    e.preventDefault();
    if(value === null) return;
    const dir = e.deltaY < 0 ? 1 : -1;
    value = (step && !log) ? clamp(value + dir * step, min, max) : fromT(toT(value) + dir * 0.02);
    paint();
    emit(true);
  }, { passive: false });

  return { el: wrap, set(v){ if(dragging) return; value = v; paint(); } };
}

function makeGrMeter(){
  const wrap = el('<div class="vbar gr"></div>');
  wrap.appendChild(el('<div class="vbar-val">GR</div>'));
  const track = el('<div class="vbar-track gr-track"></div>');
  [3, 6, 9, 12, 15, 18].forEach((db) => {
    track.appendChild(el('<div class="vbar-tick top" style="top:' + (db / 18 * 100) + '%"><span>' + db + '</span></div>'));
  });
  const fill = el('<div class="gr-fill"></div>');
  track.appendChild(fill);
  wrap.appendChild(track);
  wrap.appendChild(el('<div class="vbar-label">Reduktion</div>'));
  return { el: wrap, set(db){ fill.style.height = clamp(db / 18, 0, 1) * 100 + '%'; } };
}

// ---------- EQ-Seite ----------
function buildEqPage(){
  const page = el('<div class="eq-page"></div>');
  const canvas = el('<canvas class="eq-canvas"></canvas>');
  page.appendChild(canvas);
  page.appendChild(el('<p class="hint">Ring ziehen: Frequenz &amp; Gain · Mausrad auf einem Ring: Güte (Q) · Klick wählt das Band</p>'));

  const nBands = proc.strip.eqBands;
  const controls = el('<div class="eq-controls' + (nBands > 4 ? ' dense' : '') + '" style="grid-template-columns:150px repeat(' + nBands + ',minmax(0,1fr))"></div>');
  const left = el('<div class="eq-left"></div>');
  const eqBtn = makeXButton('EQ', () => setMiscLocal('eqOn', proc.misc.eqOn === 0 ? 1 : 0), 'wide');
  const resetBtn = makeXButton('Reset', () => {
    proc.eq.forEach((b, i) => { if(b.g !== undefined && b.g !== 0) setEqLocal(i, 'g', 0); });
  }, 'wide gray');
  left.appendChild(eqBtn);
  left.appendChild(resetBtn);

  const lowcut = el('<div class="lowcut"></div>');
  const hpBtn = makeXButton('', () => setMiscLocal('hpOn', proc.misc.hpOn ? 0 : 1), 'hp-btn');
  hpBtn.innerHTML = '<svg viewBox="0 0 24 18" width="26" height="20"><path d="M2 16 L9 16 C11 16 12 4 15 4 L22 4" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const hpInput = el('<input type="number" min="20" max="400" step="1">');
  hpInput.addEventListener('change', () => { setMiscLocal('hpf', clamp(parseFloat(hpInput.value) || 20, 20, 400)); hpInput.blur(); });
  const hpSlope = el('<select></select>');
  HP_SLOPES.forEach((s, i) => hpSlope.appendChild(el('<option value="' + i + '">' + s + ' dB/Okt</option>')));
  hpSlope.addEventListener('change', () => setMiscLocal('hpSlope', parseInt(hpSlope.value, 10)));
  lowcut.appendChild(hpBtn);
  lowcut.appendChild(el('<div class="lc-row"></div>'));
  lowcut.lastChild.appendChild(hpInput);
  lowcut.lastChild.appendChild(el('<span>Hz</span>'));
  lowcut.appendChild(hpSlope);
  lowcut.appendChild(el('<div class="lc-label">Low Cut</div>'));
  if(proc.strip.hpf) left.appendChild(lowcut);
  controls.appendChild(left);

  const cols = [];
  for(let b = 0; b < nBands; b++){
    const col = el('<div class="eq-col" style="--bc:' + bandColor(b) + '"></div>');
    const head = el('<button class="eq-band-btn">' + bandName(b) + '</button>');
    head.addEventListener('click', () => { proc.sel = b; refreshEq(); });
    const typeSel = el('<select></select>');
    const extended = nBands === 6 && (b === 0 || b === nBands - 1);
    EQ_TYPES.forEach((t, i) => { if(extended || i < 6) typeSel.appendChild(el('<option value="' + i + '">' + t + '</option>')); });
    typeSel.addEventListener('change', () => setEqLocal(b, 'type', parseInt(typeSel.value, 10)));
    const mk = (label, attrs, unit, field, parse) => {
      const row = el('<label class="eq-row"><span>' + label + '</span></label>');
      const input = el('<input type="number" ' + attrs + '>');
      input.addEventListener('focus', () => { proc.sel = b; });
      input.addEventListener('change', () => { const v = parse(input.value); if(!isNaN(v)) setEqLocal(b, field, v); input.blur(); });
      row.appendChild(input);
      row.appendChild(el('<em>' + unit + '</em>'));
      return { row, input };
    };
    const gain = mk('Gain', 'min="-15" max="15" step="0.25"', 'dB', 'g', (v) => clamp(parseFloat(v), -15, 15));
    const freq = mk('Freq', 'min="20" max="20000" step="1"', 'Hz', 'f', (v) => clamp(parseFloat(v), 20, 20000));
    const q = mk('Güte', 'min="0.3" max="10" step="0.1"', '', 'q', (v) => clamp(parseFloat(v), 0.3, 10));
    const modeRow = el('<label class="eq-row"><span>Mode</span></label>');
    modeRow.appendChild(typeSel);
    [head, modeRow, gain.row, freq.row, q.row].forEach((n) => col.appendChild(n));
    controls.appendChild(col);
    cols.push({ col, head, typeSel, gain: gain.input, freq: freq.input, q: q.input });
  }
  page.appendChild(controls);

  bindEqCanvas(canvas);
  return { page, canvas, eqBtn, hpBtn, hpInput, hpSlope, cols };
}

function eqGeometry(canvas){
  const W = canvas.clientWidth, H = canvas.clientHeight;
  return { W, H, pw: W - EQ_PAD.l - EQ_PAD.r, ph: H - EQ_PAD.t - EQ_PAD.b };
}
function eqX(f, g){ return EQ_PAD.l + (Math.log10(f) - Math.log10(EQ_MIN_F)) / (Math.log10(EQ_MAX_F) - Math.log10(EQ_MIN_F)) * g.pw; }
function eqFreqAt(x, g){ const t = clamp((x - EQ_PAD.l) / g.pw, 0, 1); return Math.pow(10, Math.log10(EQ_MIN_F) + t * (Math.log10(EQ_MAX_F) - Math.log10(EQ_MIN_F))); }
function eqY(db, g){ return EQ_PAD.t + (EQ_MAX_DB - db) / (EQ_MAX_DB - EQ_MIN_DB) * g.ph; }
function eqDbAt(y, g){ const t = clamp((y - EQ_PAD.t) / g.ph, 0, 1); return EQ_MAX_DB - t * (EQ_MAX_DB - EQ_MIN_DB); }
function bandHandleY(b, g){ return eqY(bandIsCut(b) ? 0 : clamp(b.g, EQ_MIN_DB, EQ_MAX_DB), g); }

function bindEqCanvas(canvas){
  let dragBand = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function nearest(x, y){
    const g = eqGeometry(canvas);
    let best = null, bestDist = 24;
    proc.eq.forEach((b, i) => {
      if(b.f === undefined || b.g === undefined) return;
      const d = Math.hypot(x - eqX(b.f, g), y - bandHandleY(b, g));
      if(d < bestDist){ bestDist = d; best = i; }
    });
    return best;
  }
  canvas.addEventListener('pointerdown', (e) => {
    const p = pos(e);
    dragBand = nearest(p.x, p.y);
    if(dragBand !== null){ proc.sel = dragBand; canvas.setPointerCapture(e.pointerId); refreshEq(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if(dragBand === null){ canvas.style.cursor = nearest(p.x, p.y) !== null ? 'grab' : 'default'; return; }
    canvas.style.cursor = 'grabbing';
    const g = eqGeometry(canvas);
    const b = proc.eq[dragBand];
    const base = proc.strip.base + '/eq/' + (dragBand + 1) + '/';
    const pairs = [[base + 'f', clamp(Math.round(eqFreqAt(p.x, g)), EQ_MIN_F, EQ_MAX_F)]];
    if(!bandIsCut(b)) pairs.push([base + 'g', Math.round(eqDbAt(p.y, g) * 4) / 4]);
    X.setMany(pairs);
  });
  const finish = () => { dragBand = null; canvas.style.cursor = 'default'; };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('wheel', (e) => {
    const p = pos(e);
    const i = nearest(p.x, p.y);
    if(i === null) return;
    e.preventDefault();
    const cur = proc.eq[i].q !== undefined ? proc.eq[i].q : 1;
    setEqLocal(i, 'q', clamp(cur * (e.deltaY < 0 ? 1.08 : 0.92), 0.3, 10));
  }, { passive: false });
}

function drawEq(){
  const cv = proc.els.eq.canvas;
  const { ctx, W, H } = canvasCtx(cv);
  if(!W) return;
  const g = eqGeometry(cv);
  const eqOn = proc.misc.eqOn !== 0;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, W, H);

  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for(let db = EQ_MIN_DB; db <= EQ_MAX_DB; db += 5){
    const y = Math.round(eqY(db, g)) + 0.5;
    ctx.strokeStyle = db === 0 ? '#8a8a8a' : '#262626';
    ctx.lineWidth = db === 0 ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(EQ_PAD.l, y); ctx.lineTo(W - EQ_PAD.r, y); ctx.stroke();
    ctx.fillStyle = '#6b6b6b';
    ctx.fillText((db > 0 ? '+' : '') + db, EQ_PAD.l - 7, y);
  }
  ctx.lineWidth = 1;
  [10, 100, 1000, 10000].forEach((dec) => {
    for(let m = 1; m <= 9; m++){
      const f = m * dec;
      if(f < EQ_MIN_F || f > EQ_MAX_F) continue;
      const x = Math.round(eqX(f, g)) + 0.5;
      ctx.strokeStyle = m === 1 ? '#343434' : '#1e1e1e';
      ctx.beginPath(); ctx.moveTo(x, EQ_PAD.t); ctx.lineTo(x, H - EQ_PAD.b); ctx.stroke();
    }
  });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#6b6b6b';
  [[20, '20'], [50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k'], [20000, '20k']]
    .forEach(([f, label]) => ctx.fillText(label, eqX(f, g), H - EQ_PAD.b + 6));

  const pts = [];
  const steps = Math.max(120, Math.floor(g.pw / 3));
  for(let i = 0; i <= steps; i++){
    const f = Math.pow(10, Math.log10(EQ_MIN_F) + (i / steps) * (Math.log10(EQ_MAX_F) - Math.log10(EQ_MIN_F)));
    pts.push({ x: eqX(f, g), y: eqY(eqResponseDb(f, proc.eq, proc.misc), g) });
  }
  const zeroY = eqY(0, g);
  ctx.save();
  ctx.beginPath();
  ctx.rect(EQ_PAD.l, EQ_PAD.t, g.pw, g.ph);
  ctx.clip();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.lineTo(pts[pts.length - 1].x, zeroY);
  ctx.lineTo(pts[0].x, zeroY);
  ctx.closePath();
  ctx.fillStyle = eqOn ? 'rgba(224,149,47,0.28)' : 'rgba(150,150,150,0.14)';
  ctx.fill();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = eqOn ? ORANGE : '#8a8a8a';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();

  proc.eq.forEach((b, i) => {
    if(b.f === undefined || b.g === undefined) return;
    const x = eqX(b.f, g), y = bandHandleY(b, g);
    const color = bandColor(i), sel = proc.sel === i;
    ctx.globalAlpha = eqOn ? 1 : 0.4;
    ctx.strokeStyle = color;
    ctx.globalAlpha = eqOn ? 0.5 : 0.2;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 0.5, EQ_PAD.t - 6); ctx.lineTo(x + 0.5, H - EQ_PAD.b); ctx.stroke();
    ctx.globalAlpha = eqOn ? 1 : 0.4;
    ctx.beginPath(); ctx.arc(x, y, sel ? 19 : 17, 0, Math.PI * 2);
    ctx.strokeStyle = sel ? '#ffffff' : color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, 17, 11, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#0d0d0d';
    ctx.font = '600 12px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, 17.5);
    ctx.globalAlpha = 1;
  });
}

function refreshEq(){
  if(!proc || !proc.els.eq) return;
  const e = proc.els.eq, m = proc.misc;
  const active = (n) => document.activeElement === n;
  e.eqBtn.classList.toggle('on', m.eqOn !== 0);
  e.hpBtn.classList.toggle('on', !!m.hpOn);
  if(m.hpf !== undefined && !active(e.hpInput)) e.hpInput.value = Math.round(m.hpf);
  if(m.hpSlope !== undefined) e.hpSlope.value = m.hpSlope;
  proc.eq.forEach((b, i) => {
    const c = e.cols[i];
    c.col.classList.toggle('sel', proc.sel === i);
    if(b.type !== undefined) c.typeSel.value = b.type;
    if(b.g !== undefined && !active(c.gain)) c.gain.value = fmt(b.g, 2);
    if(b.f !== undefined && !active(c.freq)) c.freq.value = Math.round(b.f);
    if(b.q !== undefined && !active(c.q)) c.q.value = fmt(b.q, 2);
    c.gain.disabled = bandIsCut(b);
  });
  drawEq();
}

// ---------- Kompressor-Seite ----------
const TF_MIN = -60, TF_MAX = 0;
const TF_PAD = 8;

function tfX(db, W){ return TF_PAD + (db - TF_MIN) / (TF_MAX - TF_MIN) * (W - 2 * TF_PAD); }
function tfY(db, H){ return H - TF_PAD - (db - TF_MIN) / (TF_MAX - TF_MIN) * (H - 2 * TF_PAD); }
function tfDbAtX(x, W){ return clamp(TF_MIN + (x - TF_PAD) / (W - 2 * TF_PAD) * (TF_MAX - TF_MIN), TF_MIN, TF_MAX); }
function tfDbAtY(y, H){ return TF_MIN + (H - TF_PAD - y) / (H - 2 * TF_PAD) * (TF_MAX - TF_MIN); }

function drawTransfer(){
  const cv = proc.els.dyn.tfCanvas;
  const { ctx, W, H } = canvasCtx(cv);
  if(!W) return;
  const d = proc.dyn;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1;
  for(let db = -50; db <= -10; db += 10){
    ctx.strokeStyle = '#1b1b1b';
    const x = Math.round(tfX(db, W)) + 0.5, y = Math.round(tfY(db, H)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, TF_PAD); ctx.lineTo(x, H - TF_PAD); ctx.moveTo(TF_PAD, y); ctx.lineTo(W - TF_PAD, y); ctx.stroke();
  }
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = '#3a3a3a';
  ctx.beginPath(); ctx.moveTo(tfX(TF_MIN, W), tfY(TF_MIN, H)); ctx.lineTo(tfX(TF_MAX, W), tfY(TF_MAX, H)); ctx.stroke();
  ctx.setLineDash([]);

  const active = d.on !== 0;
  ctx.save();
  ctx.beginPath(); ctx.rect(TF_PAD, TF_PAD, W - 2 * TF_PAD, H - 2 * TF_PAD); ctx.clip();
  ctx.beginPath();
  for(let x = TF_MIN; x <= TF_MAX; x += 0.5){
    const px = tfX(x, W), py = tfY(transferOut(x, d), H);
    if(x === TF_MIN) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = active ? '#5B6CFF' : '#4a4f7a';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  const T = d.thr !== undefined ? d.thr : -20;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(tfX(T, W), clamp(tfY(transferOut(T, d), H), TF_PAD, H - TF_PAD), 5, 0, Math.PI * 2); ctx.fill();
  if(d.mode !== 1){
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tfX(0, W), clamp(tfY(transferOut(0, d), H), TF_PAD, H - TF_PAD), 5, 0, Math.PI * 2); ctx.stroke();
  }
  if(proc.inDb > TF_MIN){
    const x = clamp(proc.inDb, TF_MIN, TF_MAX);
    ctx.fillStyle = TURQ;
    ctx.beginPath(); ctx.arc(tfX(x, W), clamp(tfY(transferOut(x, d), H), TF_PAD, H - TF_PAD), 4, 0, Math.PI * 2); ctx.fill();
  }
}

function bindTransferCanvas(cv){
  let dragging = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function hit(p){
    const W = cv.clientWidth, H = cv.clientHeight, d = proc.dyn;
    const T = d.thr !== undefined ? d.thr : -20;
    const a = Math.hypot(p.x - tfX(T, W), p.y - clamp(tfY(transferOut(T, d), H), TF_PAD, H - TF_PAD));
    const b = Math.hypot(p.x - tfX(0, W), p.y - clamp(tfY(transferOut(0, d), H), TF_PAD, H - TF_PAD));
    if(a < 16 && a <= b) return 'thr';
    if(b < 16 && d.mode !== 1) return 'ratio';
    return null;
  }
  cv.addEventListener('pointerdown', (e) => { dragging = hit(pos(e)); if(dragging) cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if(!dragging){ cv.style.cursor = hit(p) ? 'grab' : 'default'; return; }
    const W = cv.clientWidth, H = cv.clientHeight, d = proc.dyn;
    if(dragging === 'thr'){
      setDynLocal('thr', clamp(Math.round(tfDbAtX(p.x, W) * 2) / 2, -60, 0));
    } else {
      const T = d.thr !== undefined ? d.thr : -20;
      const outAt0 = tfDbAtY(p.y, H) - (d.mgain || 0);
      let ratio = outAt0 <= T + 0.2 ? 100 : (0 - T) / (outAt0 - T);
      ratio = clamp(ratio, 1.1, 100);
      let best = 0, bestDiff = Infinity;
      DYN_RATIOS.forEach((r, i) => { const diff = Math.abs(Math.log(r) - Math.log(ratio)); if(diff < bestDiff){ bestDiff = diff; best = i; } });
      if(best !== d.ratio) setDynLocal('ratio', best);
    }
  });
  const finish = () => { dragging = null; cv.style.cursor = 'default'; };
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', finish);
}

function drawEnvelope(){
  const cv = proc.els.dyn.envCanvas;
  const { ctx, W, H } = canvasCtx(cv);
  if(!W) return;
  const d = proc.dyn;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);
  const att = d.attack !== undefined ? d.attack : 10;
  const hold = d.hold !== undefined ? d.hold : 10;
  const rel = d.release !== undefined ? d.release : 150;
  const aw = 14 + 50 * (att / 120);
  const hw = 12 + 50 * (Math.log10(Math.max(hold, 0.02) / 0.02) / 5);
  const rw = 16 + 70 * (Math.log10(Math.max(rel, 5) / 5) / 2.9);
  const total = aw + hw + rw;
  const x0 = (W - total) / 2, top = 12, bottom = H - 8;
  const x1 = x0 + aw, x2 = x1 + hw, x3 = x2 + rw;
  ctx.beginPath();
  ctx.moveTo(x0, bottom); ctx.lineTo(x1, top); ctx.lineTo(x2, top); ctx.lineTo(x3, bottom); ctx.closePath();
  ctx.fillStyle = 'rgba(61,230,220,0.35)';
  ctx.fill();
  ctx.strokeStyle = TURQ;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, H); ctx.moveTo(x2, 0); ctx.lineTo(x2, H); ctx.stroke();
}

function drawFilter(){
  const cv = proc.els.dyn.scCanvas;
  const { ctx, W, H } = canvasCtx(cv);
  if(!W) return;
  const d = proc.dyn;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);
  const on = !!d['filter/on'];
  const pts = [];
  for(let i = 0; i <= 100; i++){
    const f = Math.pow(10, Math.log10(20) + (i / 100) * 3);
    pts.push({ x: i / 100 * W, y: 8 + clamp(-sidechainDb(f, d) / 36, 0, 1) * (H - 16) });
  }
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = on ? 'rgba(200,200,200,0.4)' : 'rgba(120,120,120,0.2)';
  ctx.fill();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = on ? '#e0e0e0' : '#6a6a6a';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function buildDynPage(){
  const page = el('<div class="dyn-page"></div>');
  const top = el('<div class="dyn-top"></div>');
  const active = makeXButton('Active', () => setDynLocal('on', proc.dyn.on === 0 ? 1 : 0), 'active-btn');
  top.appendChild(active);
  page.appendChild(top);
  const grid = el('<div class="dyn-grid3"></div>');

  // --- Gain ---
  const secGain = el('<section class="dyn-sec"><h4>Gain</h4></section>');
  const gainTop = el('<div class="dyn-top-row"></div>');
  const tfCanvas = el('<canvas class="dyn-canvas tf"></canvas>');
  const kneeCol = el('<div class="knee-col"></div>');
  const knee = makeRadioGroup([0, 1, 2, 3, 4, 5].map((k) => ({ label: String(k), value: k })), (k) => setDynLocal('knee', k), 'col');
  kneeCol.appendChild(knee.el);
  kneeCol.appendChild(el('<div class="mini-label">Knee</div>'));
  gainTop.appendChild(tfCanvas);
  gainTop.appendChild(kneeCol);
  secGain.appendChild(gainTop);
  const mode = makeRadioGroup([{ label: 'Comp', value: 0 }, { label: 'Exp', value: 1 }], (v) => setDynLocal('mode', v), 'row center');
  secGain.appendChild(mode.el);
  const bars1 = el('<div class="vbars"></div>');
  const thr = makeVBar({ label: 'Threshold', min: -60, max: 0, step: 0.5, handle: true, ticks: [-10, -20, -30, -40, -50, -60], format: (v) => fmt(v, 1) + ' dB', onChange: (v) => setDynLocal('thr', v) });
  const gr = makeGrMeter();
  const ratio = makeVBar({ label: 'Ratio', min: 0, max: 11, step: 1, format: (v) => fmt(DYN_RATIOS[v], 1), onChange: (v) => setDynLocal('ratio', v) });
  const mix = makeVBar({ label: 'Mix', min: 0, max: 100, step: 5, format: (v) => Math.round(v) + ' %', onChange: (v) => setDynLocal('mix', v) });
  const mgain = makeVBar({ label: 'Gain', min: 0, max: 24, step: 0.5, format: (v) => fmt(v, 2) + ' dB', onChange: (v) => setDynLocal('mgain', v) });
  [thr.el, gr.el, ratio.el, mix.el, mgain.el].forEach((n) => bars1.appendChild(n));
  secGain.appendChild(bars1);
  grid.appendChild(secGain);

  // --- Gain Envelope ---
  const secEnv = el('<section class="dyn-sec"><h4>Gain Envelope</h4></section>');
  const envTop = el('<div class="dyn-top-row"></div>');
  const envRadios = el('<div class="env-radios"></div>');
  const env = makeRadioGroup([{ label: 'Lin', value: 0 }, { label: 'Log', value: 1 }], (v) => setDynLocal('env', v), 'col');
  const det = makeRadioGroup([{ label: 'Peak', value: 0 }, { label: 'RMS', value: 1 }], (v) => setDynLocal('det', v), 'col');
  envRadios.appendChild(env.el);
  envRadios.appendChild(det.el);
  const envCanvas = el('<canvas class="dyn-canvas env"></canvas>');
  envTop.appendChild(envRadios);
  envTop.appendChild(envCanvas);
  secEnv.appendChild(envTop);
  const autoBtn = makeXButton('Auto Time', () => setDynLocal('auto', proc.dyn.auto ? 0 : 1), 'center-btn');
  secEnv.appendChild(autoBtn);
  const bars2 = el('<div class="vbars"></div>');
  const attack = makeVBar({ label: 'Attack', min: 0, max: 120, step: 1, format: (v) => Math.round(v) + ' ms', onChange: (v) => setDynLocal('attack', v) });
  const hold = makeVBar({ label: 'Hold', min: 0.02, max: 2000, log: true, format: (v) => (v < 10 ? fmt(v, 2) : fmt(v, 1)) + ' ms', onChange: (v) => setDynLocal('hold', v) });
  const release = makeVBar({ label: 'Release', min: 5, max: 4000, log: true, format: (v) => Math.round(v) + ' ms', onChange: (v) => setDynLocal('release', v) });
  [attack.el, hold.el, release.el].forEach((n) => bars2.appendChild(n));
  secEnv.appendChild(bars2);
  grid.appendChild(secEnv);

  // --- Side Chain Filter ---
  const secSc = el('<section class="dyn-sec"><h4>Side Chain Filter</h4></section>');
  const scCanvas = el('<canvas class="dyn-canvas sc"></canvas>');
  secSc.appendChild(scCanvas);
  const keyRow = el('<div class="key-row"><span>Key Source</span></div>');
  const keySel = el('<select></select>');
  KEY_SOURCES.forEach((n, i) => keySel.appendChild(el('<option value="' + i + '">' + esc(n) + '</option>')));
  keySel.addEventListener('change', () => setDynLocal('keysrc', parseInt(keySel.value, 10)));
  keyRow.appendChild(keySel);
  secSc.appendChild(keyRow);
  const scBtn = makeXButton('Filter', () => setDynLocal('filter/on', proc.dyn['filter/on'] ? 0 : 1), 'center-btn');
  secSc.appendChild(scBtn);
  const bars3 = el('<div class="vbars"></div>');
  const scType = makeVBar({ label: 'Type', min: 0, max: 8, step: 1, format: (v) => FILTER_TYPES[v], onChange: (v) => setDynLocal('filter/type', v) });
  const scFreq = makeVBar({ label: 'Frequency', min: 20, max: 20000, log: true, format: (v) => fmtFreq(v), onChange: (v) => setDynLocal('filter/f', v) });
  [scType.el, scFreq.el].forEach((n) => bars3.appendChild(n));
  secSc.appendChild(bars3);
  grid.appendChild(secSc);

  page.appendChild(grid);
  bindTransferCanvas(tfCanvas);
  return { page, active, tfCanvas, envCanvas, scCanvas, knee, mode, thr, gr, ratio, mix, mgain, env, det, autoBtn, attack, hold, release, keySel, scBtn, scType, scFreq };
}

function refreshDyn(){
  if(!proc || !proc.els.dyn) return;
  const d = proc.dyn, e = proc.els.dyn;
  e.active.classList.toggle('on', d.on !== 0);
  if(d.thr !== undefined) e.thr.set(d.thr);
  if(d.ratio !== undefined) e.ratio.set(d.ratio);
  if(d.mix !== undefined) e.mix.set(d.mix);
  if(d.mgain !== undefined) e.mgain.set(d.mgain);
  if(d.attack !== undefined) e.attack.set(d.attack);
  if(d.hold !== undefined) e.hold.set(d.hold);
  if(d.release !== undefined) e.release.set(d.release);
  if(d['filter/type'] !== undefined) e.scType.set(d['filter/type']);
  if(d['filter/f'] !== undefined) e.scFreq.set(d['filter/f']);
  if(d.knee !== undefined) e.knee.set(Math.round(d.knee));
  if(d.mode !== undefined) e.mode.set(d.mode);
  if(d.env !== undefined) e.env.set(d.env);
  if(d.det !== undefined) e.det.set(d.det);
  e.autoBtn.classList.toggle('on', !!d.auto);
  e.scBtn.classList.toggle('on', !!d['filter/on']);
  if(d.keysrc !== undefined) e.keySel.value = d.keysrc;
  drawTransfer();
  drawEnvelope();
  drawFilter();
}

// ---------- Gerüst: Overlay, Tabs, Meter ----------
// ---------- Kanal-Seite: Name, Farbe, Icon ----------
const COLOR_NAMES = ['Aus', 'Rot', 'Grün', 'Gelb', 'Blau', 'Magenta', 'Cyan', 'Weiß'];
const UMLAUTS = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
// Das Pult zeigt nur einfache Zeichen und höchstens 12 Stück
function cleanName(text){
  return text.replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c]).replace(/[^\x20-\x7E]/g, '').slice(0, 12);
}

function buildCfgPage(){
  const s = proc.strip, b = s.base;
  const page = el('<div class="cfg-page"></div>');

  const nameBlock = el('<div class="cfg-block"><div class="section-title">Name</div></div>');
  const nameInput = el('<input type="text" class="cfg-name" maxlength="12" spellcheck="false" autocomplete="off" placeholder="' + esc(s.label) + '">');
  nameInput.addEventListener('input', () => {
    const cleaned = cleanName(nameInput.value);
    if(cleaned !== nameInput.value) nameInput.value = cleaned;
    X.set(b + '/config/name', cleaned);
  });
  nameInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') nameInput.blur(); });
  nameBlock.appendChild(nameInput);
  nameBlock.appendChild(el('<p class="hint" style="text-align:left;">Bis 12 Zeichen. Das Pult zeigt nur einfache Zeichen, Umlaute werden ersetzt (ä → ae, ö → oe, ü → ue, ß → ss). Leer lassen zeigt den Standardnamen.</p>'));
  page.appendChild(nameBlock);

  const colorBlock = el('<div class="cfg-block"><div class="section-title">Farbe</div></div>');
  const swatches = el('<div class="swatches"></div>');
  const colorBtns = [];
  for(let v = 0; v < 16; v++){
    const c = chColor(v);
    const label = COLOR_NAMES[v % 8] + (v >= 8 ? ' (invers)' : '');
    const btn = el('<button class="swatch' + (v >= 8 ? ' inv' : '') + (v % 8 === 0 ? ' none' : '') + '" title="' + esc(label) + '" style="' + (v % 8 === 0 ? '' : (v >= 8 ? 'border-color:' + c.border + ';color:' + c.fg : 'background:' + c.bg + ';border-color:' + c.border)) + '"></button>');
    btn.addEventListener('click', () => X.set(b + '/config/color', v));
    swatches.appendChild(btn);
    colorBtns.push(btn);
  }
  colorBlock.appendChild(swatches);
  colorBlock.appendChild(el('<p class="hint" style="text-align:left;">Obere Reihe: gefüllt, untere Reihe: nur Umrandung (wie am Pult "invers").</p>'));
  page.appendChild(colorBlock);

  const iconBlock = el('<div class="cfg-block"><div class="section-title">Icon</div></div>');
  const filter = el('<input type="text" class="cfg-filter" placeholder="Icon suchen (z. B. Snare, Vocal, Guitar)" spellcheck="false" autocomplete="off">');
  iconBlock.appendChild(filter);
  const grid = el('<div class="icon-grid"></div>');
  const iconBtns = [];
  for(let id = 1; id <= 74; id++){
    const name = id === 1 ? 'Kein Icon' : V.ICON_NAMES[id];
    const btn = el('<button class="icon-btn" title="' + esc(name) + '" data-name="' + esc(name.toLowerCase()) + '">' + (id === 1 ? '<span class="icon-none">–</span>' : X32Icons.svg(id, 28)) + '</button>');
    btn.addEventListener('click', () => X.set(b + '/config/icon', id));
    grid.appendChild(btn);
    iconBtns.push(btn);
  }
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    iconBtns.forEach((btn) => { btn.hidden = q !== '' && !btn.dataset.name.includes(q); });
  });
  iconBlock.appendChild(grid);
  page.appendChild(iconBlock);

  return { page, nameInput, colorBtns, iconBtns };
}

function refreshCfg(){
  if(!proc || !proc.els.cfg) return;
  const b = proc.strip.base, e = proc.els.cfg;
  const name = X.get(b + '/config/name');
  if(name !== undefined && document.activeElement !== e.nameInput) e.nameInput.value = name;
  const color = X.get(b + '/config/color') || 0;
  e.colorBtns.forEach((btn, v) => btn.classList.toggle('on', v === color));
  const icon = X.get(b + '/config/icon') || 1;
  e.iconBtns.forEach((btn, i) => btn.classList.toggle('on', i + 1 === icon));
}

// Namensschild oben in der Ansicht (zeigt Änderungen sofort)
function renderChip(){
  const strip = proc.strip;
  const c = chColor(X.get(strip.base + '/config/color'));
  const nameV = X.get(strip.base + '/config/name');
  const iconId = X.get(strip.base + '/config/icon');
  const chip = proc.els.chip;
  chip.style.background = c.bg; chip.style.color = c.fg; chip.style.borderColor = c.border;
  chip.innerHTML = '<div class="chip-icon">' + (iconId && iconId !== 1 ? X32Icons.svg(iconId, 26) : '') + '</div><b>' + esc(nameV || strip.label) + '</b><span>' + esc(strip.label) + '</span>';
}

function redrawAll(){
  if(!proc) return;
  if(proc.tab === 'eq') drawEq();
  else if(proc.tab === 'dyn'){ drawTransfer(); drawEnvelope(); drawFilter(); }
}

function setTab(tab){
  proc.tab = tab;
  const e = proc.els;
  if(e.eq) e.eq.page.hidden = tab !== 'eq';
  if(e.dyn) e.dyn.page.hidden = tab !== 'dyn';
  e.cfg.page.hidden = tab !== 'cfg';
  e.tabEq.classList.toggle('on', tab === 'eq');
  e.tabDyn.classList.toggle('on', tab === 'dyn');
  e.tabCfg.classList.toggle('on', tab === 'cfg');
  requestAnimationFrame(redrawAll);
}

let procFrame = null;
function processingMeters(id, floats){
  if(!proc) return;
  const s = proc.strip;
  if(s.meter && s.meter.stream === id){
    let v = 0;
    if(!proc.els.inFill) return;
    s.meter.idx.forEach((k) => { if(k < floats.length) v = Math.max(v, floats[k]); });
    proc.inDb = v > 0.0001 ? 20 * Math.log10(v) : -90;
    proc.els.inFill.style.height = (100 - levelToPct(v)).toFixed(0) + '%';
  }
  if(s.gr && s.gr.stream === id && s.gr.idx[0] < floats.length) proc.gr = grFromFactor(floats[s.gr.idx[0]]);
  if(proc.tab === 'dyn' && proc.els.dyn && !procFrame){
    procFrame = requestAnimationFrame(() => {
      procFrame = null;
      if(!proc) return;
      proc.els.dyn.gr.set(proc.gr);
      drawTransfer();
    });
  }
}

function openDetail(strip){
  closeDetail();
  proc = { strip, tab: 'eq', eq: Array.from({ length: strip.eqBands }, () => ({})), misc: {}, dyn: {}, sel: 0, els: {}, inDb: -90, gr: 0, downOnOverlay: false };
  const overlay = el('<div class="overlay"></div>');
  const card = el('<div class="proc-card"></div>');

  const head = el('<div class="proc-head"></div>');
  const c = chColor(X.get(strip.base + '/config/color'));
  const nameV = X.get(strip.base + '/config/name');
  const iconId = X.get(strip.base + '/config/icon');
  const chip = el('<div class="proc-chip"></div>');
  const tabs = el('<div class="proc-tabs"></div>');
  const tabEq = el('<button class="proc-tab">EQ</button>');
  const tabDyn = el('<button class="proc-tab">Kompressor</button>');
  const tabCfg = el('<button class="proc-tab">Kanal</button>');
  tabEq.addEventListener('click', () => setTab('eq'));
  tabDyn.addEventListener('click', () => setTab('dyn'));
  tabCfg.addEventListener('click', () => setTab('cfg'));
  if(strip.eqBands) tabs.appendChild(tabEq);
  if(strip.dyn) tabs.appendChild(tabDyn);
  tabs.appendChild(tabCfg);
  const closeBtn = el('<button class="close-btn">&times;</button>');
  closeBtn.addEventListener('click', closeDetail);
  head.appendChild(chip); head.appendChild(tabs); head.appendChild(closeBtn);
  card.appendChild(head);

  const body = el('<div class="proc-body"></div>');
  const side = el('<div class="proc-side"></div>');
  const inTrack = el('<div class="pm-track"></div>');
  const inFill = el('<div class="pm-fill"></div>');
  inTrack.appendChild(inFill);
  side.appendChild(inTrack);
  side.appendChild(el('<div class="mini-label">In</div>'));
  const main = el('<div class="proc-main"></div>');
  const eqPage = strip.eqBands ? buildEqPage() : null;
  const dynPage = strip.eqBands ? buildDynPage() : null;
  const cfgPage = buildCfgPage();
  if(eqPage) main.appendChild(eqPage.page);
  if(dynPage) main.appendChild(dynPage.page);
  main.appendChild(cfgPage.page);
  if(strip.meter) body.appendChild(side);
  body.appendChild(main);
  card.appendChild(body);
  overlay.appendChild(card);

  proc.overlay = overlay;
  proc.els = { eq: eqPage, dyn: dynPage, cfg: cfgPage, chip, inFill, tabEq, tabDyn, tabCfg };

  overlay.addEventListener('mousedown', (e) => { proc.downOnOverlay = e.target === overlay; });
  overlay.addEventListener('click', (e) => { if(e.target === overlay && proc.downOnOverlay) closeDetail(); });
  proc.onResize = () => redrawAll();
  proc.onKey = (e) => { if(e.key === 'Escape') closeDetail(); };
  window.addEventListener('resize', proc.onResize);
  window.addEventListener('keydown', proc.onKey);

  document.body.appendChild(overlay);

  // Werte holen (frisch), regelmäßig nachgleichen, Änderungen live anzeigen
  const paths = V.detailPaths(strip);
  X.want(paths);
  X.refresh(paths, true);
  X.setHotGroup('detail', paths);
  if(strip.type === 'ch') X.setMeters(['0', '1', '2']);
  proc.unsub = X.subscribe(strip.base + '/', () => { pullFromStore(); refreshEq(); refreshDyn(); refreshCfg(); renderChip(); });

  setTab(strip.eqBands ? 'eq' : 'cfg');
  pullFromStore();
  refreshEq();
  refreshDyn();
  refreshCfg();
  renderChip();
}

function closeDetail(){
  if(!proc) return;
  window.removeEventListener('resize', proc.onResize);
  window.removeEventListener('keydown', proc.onKey);
  proc.unsub();
  proc.overlay.remove();
  proc = null;
  X.setHotGroup('detail', []);
  if(typeof applyMeterStreams === 'function') applyMeterStreams(); else X.setMeters(['0', '2']);
}
