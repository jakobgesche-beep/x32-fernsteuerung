const app = document.getElementById('app');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const ipInput = document.getElementById('ip-input');
const connectBtn = document.getElementById('connect-btn');
const scanBtn = document.getElementById('scan-btn');

function el(html){ const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function toast(msg, isError){
  const t = el('<div class="toast">' + esc(msg) + '</div>');
  if(isError) t.classList.add('error');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function fmt(n, digits){ return Number(n).toFixed(digits); }

const EQ_TYPES = ['LCut', 'LShv', 'PEQ', 'VEQ', 'HShv', 'HCut'];
const DYN_RATIOS = [1.1, 1.3, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.0, 10, 20, 100];

// ================= EQ-Kurvenberechnung (RBJ-Biquad-Formeln) =================
const SAMPLE_RATE = 48000;
const GRAPH_MIN_DB = -15, GRAPH_MAX_DB = 15;
const GRAPH_MIN_F = 20, GRAPH_MAX_F = 20000;
const BAND_COLORS = ['#E8C23D', '#3DC7E8', '#4CAF6D', '#E1604C'];

function biquadCoeffs(typeName, f, gainDb, Q){
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * f / SAMPLE_RATE;
  const cosw0 = Math.cos(w0), sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if(typeName === 'PEQ' || typeName === 'VEQ'){
    b0 = 1 + alpha * A; b1 = -2 * cosw0; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cosw0; a2 = 1 - alpha / A;
  } else if(typeName === 'LShv'){
    const sqrtA = Math.sqrt(A);
    b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * sqrtA * alpha);
    b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
    b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * sqrtA * alpha);
    a0 = (A + 1) + (A - 1) * cosw0 + 2 * sqrtA * alpha;
    a1 = -2 * ((A - 1) + (A + 1) * cosw0);
    a2 = (A + 1) + (A - 1) * cosw0 - 2 * sqrtA * alpha;
  } else if(typeName === 'HShv'){
    const sqrtA = Math.sqrt(A);
    b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * sqrtA * alpha);
    b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
    b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * sqrtA * alpha);
    a0 = (A + 1) - (A - 1) * cosw0 + 2 * sqrtA * alpha;
    a1 = 2 * ((A - 1) - (A + 1) * cosw0);
    a2 = (A + 1) - (A - 1) * cosw0 - 2 * sqrtA * alpha;
  } else if(typeName === 'LCut'){
    b0 = (1 + cosw0) / 2; b1 = -(1 + cosw0); b2 = (1 + cosw0) / 2;
    a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
  } else if(typeName === 'HCut'){
    b0 = (1 - cosw0) / 2; b1 = 1 - cosw0; b2 = (1 - cosw0) / 2;
    a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
  } else {
    b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
function magnitudeDb(coef, f){
  const w = 2 * Math.PI * f / SAMPLE_RATE;
  const cos1 = Math.cos(w), sin1 = -Math.sin(w);
  const cos2 = Math.cos(2 * w), sin2 = -Math.sin(2 * w);
  const numRe = coef.b0 + coef.b1 * cos1 + coef.b2 * cos2;
  const numIm = coef.b1 * sin1 + coef.b2 * sin2;
  const denRe = 1 + coef.a1 * cos1 + coef.a2 * cos2;
  const denIm = coef.a1 * sin1 + coef.a2 * sin2;
  const numMag = Math.sqrt(numRe * numRe + numIm * numIm);
  const denMag = Math.sqrt(denRe * denRe + denIm * denIm);
  return 20 * Math.log10(numMag / denMag);
}
function combinedResponse(bands, freqs){
  return freqs.map((f) => {
    let total = 0;
    bands.forEach((band) => {
      if(band.f === undefined || band.g === undefined || band.q === undefined || band.type === undefined) return;
      total += magnitudeDb(biquadCoeffs(EQ_TYPES[band.type], band.f, band.g, band.q), f);
    });
    return total;
  });
}
function freqToX(f, w){ return (Math.log10(f) - Math.log10(GRAPH_MIN_F)) / (Math.log10(GRAPH_MAX_F) - Math.log10(GRAPH_MIN_F)) * w; }
function xToFreq(x, w){ const t = Math.max(0, Math.min(1, x / w)); return Math.pow(10, Math.log10(GRAPH_MIN_F) + t * (Math.log10(GRAPH_MAX_F) - Math.log10(GRAPH_MIN_F))); }
function dbToY(db, h){ const t = (db - GRAPH_MAX_DB) / (GRAPH_MIN_DB - GRAPH_MAX_DB); return t * h; }
function yToDb(y, h){ const t = Math.max(0, Math.min(1, y / h)); return GRAPH_MAX_DB + t * (GRAPH_MIN_DB - GRAPH_MAX_DB); }

function drawEqGraph(canvas, bands){
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#090B0F';
  ctx.fillRect(0, 0, w, h);

  [-10, -5, 5, 10].forEach((db) => {
    const y = Math.round(dbToY(db, h)) + 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  });
  const zeroY = Math.round(dbToY(0, h)) + 0.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(w, zeroY); ctx.stroke();
  [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((f) => {
    const x = Math.round(freqToX(f, w)) + 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  });

  const sampleCount = 200;
  const freqs = [];
  for(let i = 0; i <= sampleCount; i++){
    freqs.push(Math.pow(10, Math.log10(GRAPH_MIN_F) + (i / sampleCount) * (Math.log10(GRAPH_MAX_F) - Math.log10(GRAPH_MIN_F))));
  }
  const dbs = combinedResponse(bands, freqs);
  ctx.beginPath();
  freqs.forEach((f, i) => {
    const x = freqToX(f, w);
    const y = dbToY(Math.max(GRAPH_MIN_DB, Math.min(GRAPH_MAX_DB, dbs[i])), h);
    if(i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#3DC7E8';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = 'rgba(61,199,232,0.12)';
  ctx.fill();

  bands.forEach((band, i) => {
    if(band.f === undefined || band.g === undefined) return;
    const x = freqToX(band.f, w);
    const y = dbToY(Math.max(GRAPH_MIN_DB, Math.min(GRAPH_MAX_DB, band.g)), h);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = BAND_COLORS[i];
    ctx.fill();
    ctx.strokeStyle = '#0D1117';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}

function faderToDb(f){
  if(f >= 0.5) return f * 40 - 30;
  if(f >= 0.25) return f * 80 - 50;
  if(f >= 0.0625) return f * 160 - 70;
  if(f > 0) return f * 480 - 90;
  return -90;
}

let connected = false;
const channels = {};
for(let ch = 1; ch <= 32; ch++) channels[ch] = { name: 'CH ' + String(ch).padStart(2, '0'), fader: 0, faderDb: -90, muted: false };

const stripEls = {};
let selectedChannel = null;

function setConnected(isConnected){
  connected = isConnected;
  statusText.textContent = isConnected ? 'Verbunden' : 'nicht verbunden';
  statusBadge.classList.toggle('live', isConnected);
  connectBtn.textContent = isConnected ? 'Trennen' : 'Verbinden';
}

connectBtn.addEventListener('click', async () => {
  if(connected){
    await window.x32API.disconnect();
    setConnected(false);
    return;
  }
  const ip = ipInput.value.trim() || '192.168.0.64';
  ipInput.value = ip;
  try { localStorage.setItem('x32-ip', ip); } catch(e){}
  const res = await window.x32API.connect(ip);
  if(res.ok){ setConnected(true); toast('Verbunden mit ' + ip); }
  else toast('Verbindung fehlgeschlagen: ' + res.error, true);
});

try { const savedIp = localStorage.getItem('x32-ip'); if(savedIp) ipInput.value = savedIp; } catch(e){}

// ================= Pult-Suche (aktuelles WLAN durchsuchen) =================
async function connectTo(ip){
  ipInput.value = ip;
  try { localStorage.setItem('x32-ip', ip); } catch(e){}
  const res = await window.x32API.connect(ip);
  if(res.ok){ setConnected(true); toast('Verbunden mit ' + ip); }
  else toast('Verbindung fehlgeschlagen: ' + res.error, true);
}

function showConsolePicker(results){
  const overlay = el('<div class="overlay"></div>');
  const box = el('<div class="detail-card" style="max-width:380px;"></div>');
  box.appendChild(el('<div class="section-title" style="margin-top:0;">Gefundene Pulte im Netzwerk</div>'));
  results.forEach((r) => {
    const row = el('<div class="scan-row"></div>');
    row.appendChild(el('<div><div class="scan-name">' + esc(r.model || 'X32') + '</div><div class="scan-sub">' + esc(r.ip) + (r.name ? ' — ' + esc(r.name) : '') + '</div></div>'));
    row.addEventListener('click', () => { overlay.remove(); connectTo(r.ip); });
    box.appendChild(row);
  });
  const closeBtn = el('<button class="btn secondary small" style="margin-top:14px;width:100%;">Abbrechen</button>');
  closeBtn.addEventListener('click', () => overlay.remove());
  box.appendChild(closeBtn);
  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if(e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

scanBtn.addEventListener('click', async () => {
  scanBtn.disabled = true;
  scanBtn.textContent = 'Suche läuft...';
  try {
    const results = await window.x32API.scan();
    if(!results.length) toast('Kein X32/M32 im aktuellen WLAN gefunden. IP manuell eingeben oder erneut versuchen.', true);
    else showConsolePicker(results);
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = 'Pult suchen';
  }
});

function buildStrip(ch){
  const wrap = el('<div class="strip"></div>');
  wrap.appendChild(el('<div class="strip-num">CH ' + String(ch).padStart(2, '0') + '</div>'));
  const name = el('<div class="strip-name"></div>');
  wrap.appendChild(name);

  const row = el('<div class="meter-fader-row"></div>');
  const meterTrack = el('<div class="meter-track"></div>');
  const meterFill = el('<div class="meter-fill" style="height:0%;"></div>');
  meterTrack.appendChild(meterFill);
  const fader = el('<input type="range" class="strip-fader" min="0" max="1" step="0.001" value="0">');
  row.appendChild(meterTrack);
  row.appendChild(fader);
  wrap.appendChild(row);

  const dbLabel = el('<div class="db-label">-oo</div>');
  wrap.appendChild(dbLabel);

  const muteBtn = el('<button class="mute-btn">MUTE</button>');
  wrap.appendChild(muteBtn);

  let lastFaderSend = 0;
  fader.addEventListener('input', () => {
    const v = parseFloat(fader.value);
    dbLabel.textContent = fmt(faderToDb(v), 1);
    const now = performance.now();
    if(now - lastFaderSend < 20) return;
    lastFaderSend = now;
    window.x32API.setFader(ch, v);
  });
  fader.addEventListener('change', () => window.x32API.setFader(ch, parseFloat(fader.value)));
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.x32API.setMute(ch, !channels[ch].muted);
  });
  wrap.addEventListener('click', () => openDetail(ch));

  stripEls[ch] = { wrap, name, meterFill, fader, dbLabel, muteBtn };
  return wrap;
}

function applyChannelUpdate(data){
  const s = channels[data.ch];
  s.name = data.name; s.fader = data.fader; s.faderDb = data.faderDb; s.muted = data.muted;
  const ui = stripEls[data.ch];
  if(!ui) return;
  ui.name.textContent = data.name;
  if(document.activeElement !== ui.fader) ui.fader.value = data.fader;
  ui.dbLabel.textContent = data.faderDb <= -89.9 ? '-oo' : fmt(data.faderDb, 1);
  ui.wrap.classList.toggle('muted', data.muted);
  ui.muteBtn.classList.toggle('active', data.muted);
}

window.x32API.onChannel((data) => applyChannelUpdate(data));
window.x32API.onMeters((levels) => {
  levels.forEach((v, i) => {
    const ui = stripEls[i + 1];
    if(!ui) return;
    const clamped = Math.max(0, Math.min(1, v));
    ui.meterFill.style.height = Math.round(clamped * 100) + '%';
  });
});
window.x32API.onLog((msg) => { /* könnte in ein Log-Panel, aktuell nur Toast bei Bedarf */ });

// ================= Detailansicht (EQ + Kompressor) =================
let detailOverlay = null;
let detailEls = null;

function buildDetailCard(ch){
  const card = el('<div class="detail-card"></div>');
  const header = el('<div class="detail-header"></div>');
  header.appendChild(el('<div class="detail-title">Kanal ' + String(ch).padStart(2, '0') + ' — ' + esc(channels[ch].name) + '</div>'));
  const closeBtn = el('<button class="close-btn">&times;</button>');
  closeBtn.addEventListener('click', closeDetail);
  header.appendChild(closeBtn);
  card.appendChild(header);

  card.appendChild(el('<div class="section-title">Equalizer (4 Bänder)</div>'));

  const bandsData = [{}, {}, {}, {}];
  const canvas = el('<canvas class="eq-graph" width="600" height="170"></canvas>');
  card.appendChild(canvas);
  card.appendChild(el('<p class="hint eq-graph-hint">Punkt ziehen: Frequenz &amp; Gain. Mausrad über einem Punkt: Q (Bandbreite).</p>'));

  let dragBand = null;
  function redrawGraph(){ drawEqGraph(canvas, bandsData); }
  function nearestBandAt(x, y){
    let best = null, bestDist = 16;
    bandsData.forEach((band, i) => {
      if(band.f === undefined || band.g === undefined) return;
      const bx = freqToX(band.f, canvas.width);
      const by = dbToY(Math.max(GRAPH_MIN_DB, Math.min(GRAPH_MAX_DB, band.g)), canvas.height);
      const dist = Math.hypot(x - bx, y - by);
      if(dist < bestDist){ bestDist = dist; best = i; }
    });
    return best;
  }
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    dragBand = nearestBandAt(x, y);
  });
  let lastEqSend = 0;
  function onWindowMouseMove(e){
    if(dragBand === null) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const f = Math.round(xToFreq(x, canvas.width));
    const g = Math.round(yToDb(y, canvas.height) * 4) / 4;
    bandsData[dragBand].f = f; bandsData[dragBand].g = g;
    eqBandEls[dragBand].freq.value = f;
    eqBandEls[dragBand].gain.value = fmt(g, 2);
    redrawGraph();
    const now = performance.now();
    if(now - lastEqSend < 20) return;
    lastEqSend = now;
    window.x32API.setEq(ch, dragBand, 'f', f);
    window.x32API.setEq(ch, dragBand, 'g', g);
  }
  function onWindowMouseUp(){
    if(dragBand === null) return;
    window.x32API.setEq(ch, dragBand, 'f', bandsData[dragBand].f);
    window.x32API.setEq(ch, dragBand, 'g', bandsData[dragBand].g);
    dragBand = null;
  }
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);
  canvas.addEventListener('wheel', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const band = nearestBandAt(x, y);
    if(band === null) return;
    e.preventDefault();
    const cur = bandsData[band].q !== undefined ? bandsData[band].q : 1;
    const next = Math.max(0.3, Math.min(10, cur * (e.deltaY < 0 ? 1.08 : 0.92)));
    bandsData[band].q = next;
    eqBandEls[band].q.value = fmt(next, 2);
    redrawGraph();
    window.x32API.setEq(ch, band, 'q', next);
  }, { passive: false });

  const eqBandEls = [];
  for(let b = 0; b < 4; b++){
    const row = el('<div class="eq-band"></div>');
    const typeSel = el('<select></select>');
    EQ_TYPES.forEach((t, i) => typeSel.appendChild(el('<option value="' + i + '">' + t + '</option>')));
    const freqField = fieldInline('Freq (Hz)', 'number', { min: 20, max: 20000, step: 1 });
    const gainField = fieldInline('Gain (dB)', 'number', { min: -15, max: 15, step: 0.25 });
    const qField = fieldInline('Q', 'number', { min: 0.3, max: 10, step: 0.1 });
    row.appendChild(typeSel);
    row.appendChild(freqField.wrap);
    row.appendChild(gainField.wrap);
    row.appendChild(qField.wrap);
    card.appendChild(row);

    typeSel.addEventListener('change', () => { bandsData[b].type = parseInt(typeSel.value, 10); redrawGraph(); window.x32API.setEq(ch, b, 'type', bandsData[b].type); });
    freqField.input.addEventListener('change', () => { bandsData[b].f = parseFloat(freqField.input.value); redrawGraph(); window.x32API.setEq(ch, b, 'f', bandsData[b].f); });
    gainField.input.addEventListener('change', () => { bandsData[b].g = parseFloat(gainField.input.value); redrawGraph(); window.x32API.setEq(ch, b, 'g', bandsData[b].g); });
    qField.input.addEventListener('change', () => { bandsData[b].q = parseFloat(qField.input.value); redrawGraph(); window.x32API.setEq(ch, b, 'q', bandsData[b].q); });

    eqBandEls.push({ typeSel, freq: freqField.input, gain: gainField.input, q: qField.input });
  }
  redrawGraph();

  card.appendChild(el('<div class="section-title">Kompressor / Dynamics</div>'));
  const dynOnRow = el('<div class="toggle-row"></div>');
  const dynOnBtn = el('<button class="btn secondary small">Dynamics: AUS</button>');
  dynOnRow.appendChild(dynOnBtn);
  card.appendChild(dynOnRow);
  dynOnBtn.addEventListener('click', () => {
    const newState = dynOnBtn.dataset.on !== '1';
    window.x32API.setDyn(ch, 'on', newState ? 1 : 0);
  });

  const dynGrid = el('<div class="dyn-grid"></div>');
  const thrField = fieldInline('Threshold (dB)', 'number', { min: -60, max: 0, step: 0.5 });
  const ratioSel = el('<select></select>');
  DYN_RATIOS.forEach((r, i) => ratioSel.appendChild(el('<option value="' + i + '">' + r + ':1</option>')));
  const mgainField = fieldInline('Makeup (dB)', 'number', { min: 0, max: 24, step: 0.5 });
  const attackField = fieldInline('Attack (ms)', 'number', { min: 0, max: 120, step: 1 });
  const holdField = fieldInline('Hold (ms)', 'number', { min: 0.02, max: 2000, step: 1 });
  const releaseField = fieldInline('Release (ms)', 'number', { min: 5, max: 4000, step: 1 });
  const kneeField = fieldInline('Knee', 'number', { min: 0, max: 5, step: 1 });
  const mixField = fieldInline('Mix (%)', 'number', { min: 0, max: 100, step: 5 });
  [thrField.wrap, mgainField.wrap, attackField.wrap, holdField.wrap, releaseField.wrap, kneeField.wrap, mixField.wrap]
    .forEach((w) => dynGrid.appendChild(w));
  const ratioWrap = fieldInline('Ratio', null);
  ratioWrap.wrap.appendChild(ratioSel);
  dynGrid.insertBefore(ratioWrap.wrap, dynGrid.children[1]);
  card.appendChild(dynGrid);

  thrField.input.addEventListener('change', () => window.x32API.setDyn(ch, 'thr', parseFloat(thrField.input.value)));
  ratioSel.addEventListener('change', () => window.x32API.setDyn(ch, 'ratio', parseInt(ratioSel.value, 10)));
  mgainField.input.addEventListener('change', () => window.x32API.setDyn(ch, 'mgain', parseFloat(mgainField.input.value)));
  attackField.input.addEventListener('change', () => window.x32API.setDyn(ch, 'attack', parseFloat(attackField.input.value)));
  holdField.input.addEventListener('change', () => window.x32API.setDyn(ch, 'hold', parseFloat(holdField.input.value)));
  releaseField.input.addEventListener('change', () => window.x32API.setDyn(ch, 'release', parseFloat(releaseField.input.value)));
  kneeField.input.addEventListener('change', () => window.x32API.setDyn(ch, 'knee', parseFloat(kneeField.input.value)));
  mixField.input.addEventListener('change', () => window.x32API.setDyn(ch, 'mix', parseFloat(mixField.input.value)));

  detailEls = {
    eqBandEls, bandsData, redrawGraph, onWindowMouseMove, onWindowMouseUp, dynOnBtn,
    thr: thrField.input, ratio: ratioSel, mgain: mgainField.input, attack: attackField.input,
    hold: holdField.input, release: releaseField.input, knee: kneeField.input, mix: mixField.input,
  };
  return card;
}

function fieldInline(label, type, attrs){
  const wrap = el('<div class="field-inline"></div>');
  wrap.appendChild(el('<label>' + esc(label) + '</label>'));
  let input;
  if(type){
    let attrStr = '';
    if(attrs) for(const k in attrs) attrStr += ' ' + k + '="' + attrs[k] + '"';
    input = el('<input type="' + type + '"' + attrStr + '>');
    wrap.appendChild(input);
  }
  return { wrap, input };
}

function openDetail(ch){
  selectedChannel = ch;
  detailOverlay = el('<div class="overlay"></div>');
  detailOverlay.appendChild(buildDetailCard(ch));
  detailOverlay.addEventListener('click', (e) => { if(e.target === detailOverlay) closeDetail(); });
  document.body.appendChild(detailOverlay);
  window.x32API.selectChannel(ch);
}
function closeDetail(){
  if(detailEls){ window.removeEventListener('mousemove', detailEls.onWindowMouseMove); window.removeEventListener('mouseup', detailEls.onWindowMouseUp); }
  if(detailOverlay){ detailOverlay.remove(); detailOverlay = null; detailEls = null; selectedChannel = null; }
}

window.x32API.onChannelDetail((data) => {
  if(!detailEls || data.ch !== selectedChannel) return;
  data.eq.forEach((band, i) => {
    const ui = detailEls.eqBandEls[i];
    if(band.type !== undefined) ui.typeSel.value = band.type;
    if(band.f !== undefined && document.activeElement !== ui.freq) ui.freq.value = Math.round(band.f);
    if(band.g !== undefined && document.activeElement !== ui.gain) ui.gain.value = fmt(band.g, 2);
    if(band.q !== undefined && document.activeElement !== ui.q) ui.q.value = fmt(band.q, 2);
    const bd = detailEls.bandsData[i];
    if(band.type !== undefined) bd.type = band.type;
    if(band.f !== undefined) bd.f = band.f;
    if(band.g !== undefined) bd.g = band.g;
    if(band.q !== undefined) bd.q = band.q;
  });
  detailEls.redrawGraph();
  const d = data.dyn;
  if(d.on !== undefined){ detailEls.dynOnBtn.dataset.on = d.on ? '1' : '0'; detailEls.dynOnBtn.textContent = 'Dynamics: ' + (d.on ? 'AN' : 'AUS'); detailEls.dynOnBtn.classList.toggle('secondary', !d.on); }
  if(d.thr !== undefined && document.activeElement !== detailEls.thr) detailEls.thr.value = fmt(d.thr, 1);
  if(d.ratio !== undefined) detailEls.ratio.value = d.ratio;
  if(d.mgain !== undefined && document.activeElement !== detailEls.mgain) detailEls.mgain.value = fmt(d.mgain, 1);
  if(d.attack !== undefined && document.activeElement !== detailEls.attack) detailEls.attack.value = fmt(d.attack, 1);
  if(d.hold !== undefined && document.activeElement !== detailEls.hold) detailEls.hold.value = fmt(d.hold, 1);
  if(d.release !== undefined && document.activeElement !== detailEls.release) detailEls.release.value = fmt(d.release, 1);
  if(d.knee !== undefined && document.activeElement !== detailEls.knee) detailEls.knee.value = fmt(d.knee, 0);
  if(d.mix !== undefined && document.activeElement !== detailEls.mix) detailEls.mix.value = fmt(d.mix, 0);
});

// ================= Auto-Update =================
let updateBar = null;
window.x32API.onUpdateAvailable((version) => {
  if(updateBar) updateBar.remove();
  updateBar = el('<div class="update-bar"><span id="update-text">Neue Version ' + esc(version) + ' verfügbar.</span> <button class="btn small" id="install-update-btn">Jetzt aktualisieren</button></div>');
  document.body.appendChild(updateBar);
  updateBar.querySelector('#install-update-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const res = await window.x32API.installUpdate();
    if(!res.ok) e.target.disabled = false;
  });
});
window.x32API.onUpdateProgress((text) => {
  if(updateBar) updateBar.querySelector('#update-text').textContent = text;
});
window.x32API.onUpdateError((msg) => {
  if(updateBar) updateBar.querySelector('#update-text').textContent = 'Update fehlgeschlagen: ' + msg;
  toast('Update fehlgeschlagen: ' + msg, true);
});
window.x32API.getVersion().then((v) => { document.getElementById('version-label').textContent = 'v' + v; });

// ================= Aufbau =================
function render(){
  app.innerHTML = '';
  app.appendChild(el('<p class="hint">IP-Adresse des X32 eingeben (Standard-Werksadresse: 192.168.0.64) und „Verbinden" klicken. Klick auf einen Kanal öffnet EQ &amp; Kompressor.</p>'));
  const row = el('<div class="strip-row"></div>');
  for(let ch = 1; ch <= 32; ch++) row.appendChild(buildStrip(ch));
  app.appendChild(row);
}
render();
