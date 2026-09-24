const app = document.getElementById('app');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const ipInput = document.getElementById('ip-input');
const connectBtn = document.getElementById('connect-btn');
const scanBtn = document.getElementById('scan-btn');
const layerTabs = document.getElementById('layer-tabs');

function el(html){ const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function toast(msg, isError){
  const t = el('<div class="toast">' + esc(msg) + '</div>');
  if(isError) t.classList.add('error');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function fmt(n, digits){ return Number(n).toFixed(digits); }

const CH_HUES = [null, '#E5484D', '#3FB950', '#E8C23D', '#4C7CE0', '#D946A8', '#3EC9C9', '#E7EBF0'];
function chColor(v){
  const hue = CH_HUES[(v || 0) % 8];
  if(!hue) return { bg: 'transparent', fg: 'var(--text-dim)', border: 'var(--line)' };
  if(v >= 8) return { bg: 'transparent', fg: hue, border: hue };
  return { bg: hue, fg: (v === 3 || v === 6 || v === 7) ? '#0D1117' : '#fff', border: hue };
}
function levelToPct(v){
  if(!(v > 0.0001)) return 0;
  return Math.max(0, Math.min(100, (20 * Math.log10(v) + 60) / 60 * 100));
}

const STRIPS = X32V.buildStrips();
const STRIP_BY_ID = {};
STRIPS.forEach((s) => { STRIP_BY_ID[s.id] = s; });

// ================= Verbindung =================
let wantedOnce = false;
let lastState = 'idle';

function updateStatus(s){
  const st = s.state;
  statusBadge.classList.remove('live', 'warn', 'bad', 'ping-good', 'ping-mid', 'ping-bad');
  const consoleEl = document.getElementById('console');
  consoleEl.classList.toggle('offline', st === 'idle');
  consoleEl.classList.toggle('reconnecting', st === 'lost' || st === 'connecting');
  let text = 'nicht verbunden';
  if(st === 'connecting'){ text = 'Verbinde…'; statusBadge.classList.add('warn'); }
  else if(st === 'lost'){ text = 'Verbindung verloren – suche…'; statusBadge.classList.add('bad'); }
  else if(st === 'online'){
    statusBadge.classList.add('live');
    if(s.progress < 1 && s.open > 40) text = 'Synchronisiere ' + Math.round(s.progress * 100) + ' %';
    else text = 'Verbunden' + (s.info && s.info.model ? ' · ' + s.info.model : '') + (s.rtt != null ? ' · ' + Math.round(s.rtt) + ' ms' : '') + (s.loss != null && s.loss >= 2 ? ' · ' + Math.round(s.loss) + ' % Verlust' : '');
    if(s.rtt != null) statusBadge.classList.add(s.rtt < 15 && !(s.loss >= 5) ? 'ping-good' : s.rtt < 40 && !(s.loss >= 10) ? 'ping-mid' : 'ping-bad');
  }
  statusText.textContent = text;
  connectBtn.textContent = st === 'idle' ? 'Verbinden' : 'Trennen';
  if(st === 'online' && !wantedOnce){ wantedOnce = true; wantAll(); }
  if(st === 'lost' && lastState !== 'lost') toast('Verbindung zum Pult verloren – die App versucht es automatisch weiter.', true);
  lastState = st;
}
let diagOverlay = null;
X.onStatus((s) => { updateStatus(s); if(diagOverlay) renderDiagnostics(s); });

document.getElementById('hint-scan-btn').addEventListener('click', () => scanBtn.click());

// Verbindungs-Diagnose (Klick auf den Status-Balken)
function diagRow(k, v){ return '<div class="diag-k">' + esc(k) + '</div><div class="diag-v">' + esc(v) + '</div>'; }
function renderDiagnostics(s){
  const st = s.stats || {};
  const info = s.info || {};
  const stateText = { idle: 'nicht verbunden', connecting: 'verbinde', online: 'online', lost: 'Verbindung verloren' }[s.state] || s.state;
  diagOverlay.querySelector('.diag-body').innerHTML =
    diagRow('Zustand', stateText) +
    diagRow('Pult', [info.model, info.name].filter(Boolean).join(' · ') || '–') +
    diagRow('Firmware', info.version || '–') +
    diagRow('Pult-IP', info.ip || '–') +
    diagRow('Ping (Ø / 95 % / max)', s.rttStats ? Math.round(s.rttStats.avg) + ' / ' + Math.round(s.rttStats.p95) + ' / ' + Math.round(s.rttStats.max) + ' ms' : '–') +
    diagRow('App-interne Verzögerung (Eingabe → Netzwerk)', s.appLatency ? 'Ø ' + ((s.appLatency.ipc ? s.appLatency.ipc.avg : 0) + (s.appLatency.pace ? s.appLatency.pace.avg : 0)).toFixed(1) + ' ms, max ' + Math.round((s.appLatency.ipc ? s.appLatency.ipc.max : 0) + (s.appLatency.pace ? s.appLatency.pace.max : 0)) + ' ms (' + s.appLatency.n + ' Bewegungen)' : 'noch nichts bewegt') +
    diagRow('Paketverlust (Ping)', s.loss != null ? Math.round(s.loss) + ' %' : '–') +
    diagRow('Pult meldet Änderungen selbst', st.pushChanges > 0 ? 'ja (' + st.pushChanges + ' erhalten)' : s.pushBroken ? 'nein – es wird schneller nachgefragt' : 'noch keine Änderung am Pult beobachtet') +
    diagRow('Schnappschüsse (Sicherheitsnetz)', s.hints ? (s.hints.disabled ? 'abgeschaltet (Format passte nicht)' : s.hints.active ? 'aktiv, ' + s.hints.found + ' verlorene Meldungen aufgefangen' : 'aus') : '–') +
    diagRow('Bekannte / geladene Werte', (s.known || 0) + ' / ' + (s.cached || 0)) +
    diagRow('Offene Anfragen', String(s.open || 0)) +
    diagRow('Pakete gesendet / empfangen', (st.sent || 0) + ' / ' + (st.received || 0)) +
    diagRow('Anfragen wiederholt', String(st.retries || 0)) +
    diagRow('Anfragen aufgegeben', String(st.failed || 0)) +
    diagRow('Änderungen gesendet', String(st.writes || 0)) +
    diagRow('Verlorene Änderungen erneut gesendet', String(st.resends || 0)) +
    diagRow('Pfade ohne Antwort vom Pult', (s.dead || []).length ? s.dead.join(', ') : 'keine');
}
// Netzwerk-Test (nur lesend): misst Laufzeit, Schwankung und Verlust zwischen App und Pult
async function runNetTest(){
  const btn = document.getElementById('net-test-btn'), out = document.getElementById('net-test-result');
  if(!btn) return;
  btn.disabled = true; btn.textContent = 'Test läuft…'; out.innerHTML = '';
  const res = await window.x32API.networkTest();
  if(!diagOverlay) return;
  btn.disabled = false; btn.textContent = 'Netzwerk-Test wiederholen';
  if(!res){ out.textContent = 'Test nicht möglich (nicht mit dem Pult verbunden oder läuft schon).'; return; }
  const q = res.seq, b = res.burst;
  const good = q.avg < 15 && q.lossPct < 2 && b.lossPct < 5, ok = q.avg < 40 && q.lossPct < 8 && b.lossPct < 15;
  const verdict = good ? 'Sehr gut: Fader und Mute laufen praktisch verzögerungsfrei.'
    : ok ? 'Brauchbar: kleine Verzögerungen möglich. Näher an den Router gehen oder das 5-GHz-Netz nutzen hilft.'
    : 'Schlecht: Pakete gehen verloren oder kommen spät an. Kabel zum Router oder 5-GHz-WLAN in kurzer Entfernung nutzen.';
  const tip = good ? '' : ' Tipp: AirDrop und Handoff am Mac ausschalten (können das WLAN alle paar Sekunden kurz stören) und andere Netzwerk-Programme schließen.';
  out.innerHTML = '<div class="net-verdict ' + (good ? 'good' : ok ? 'mid' : 'bad') + '">' + esc(verdict + tip) + '</div>' +
    '<div class="diag-grid">' +
    diagRow('Einzelanfragen beantwortet', q.got + ' von ' + q.sent + ' (' + Math.round(q.lossPct) + ' % Verlust)') +
    diagRow('Laufzeit Ø / min / max', q.got ? Math.round(q.avg) + ' / ' + Math.round(q.min) + ' / ' + Math.round(q.max) + ' ms' : '–') +
    diagRow('Schwankung', q.jitter != null ? Math.round(q.jitter) + ' ms' : '–') +
    diagRow('Ansturm (32 auf einmal)', b.got + ' von ' + b.sent + (b.spanMs != null ? ' in ' + Math.round(b.spanMs) + ' ms' : '')) + '</div>';
}

function showDiagnostics(){
  if(diagOverlay) return;
  diagOverlay = el('<div class="overlay"></div>');
const box = el('<div class="detail-card" style="max-width:560px;"><div class="detail-header"><div class="detail-title">Verbindungs-Diagnose</div></div><div class="diag-body diag-grid"></div>' +
    '<div class="diag-test"><button class="btn small" id="net-test-btn">Netzwerk-Test starten (3 Sekunden)</button><div id="net-test-result" class="net-result"></div></div>' +
    '<p class="hint">Bei Problemen hilft ein Foto dieses Fensters.</p></div>');
  box.querySelector('#net-test-btn').addEventListener('click', runNetTest);
  const closeBtn = el('<button class="close-btn">&times;</button>');
  const close = () => { diagOverlay.remove(); diagOverlay = null; };
  closeBtn.addEventListener('click', close);
  box.querySelector('.detail-header').appendChild(closeBtn);
  diagOverlay.appendChild(box);
  diagOverlay.addEventListener('click', (e) => { if(e.target === diagOverlay) close(); });
  document.body.appendChild(diagOverlay);
  renderDiagnostics(X.status());
}
statusBadge.style.cursor = 'pointer';
statusBadge.title = 'Verbindungs-Diagnose anzeigen';
statusBadge.addEventListener('click', showDiagnostics);

// alle Kanäle laden: sichtbare Ebene zuerst
function wantAll(){
  X.setSubs(X32V.subscriptionSpecs(currentLayer));
  X.want(dockStrips.flatMap((s) => X32V.basicPaths(s)));
  const order = X32V.LAYERS.map((l) => l.id).sort((a, b) => (a === currentLayer ? -1 : b === currentLayer ? 1 : 0));
  order.forEach((id) => X.want(layerPaths(id)));
}
const DOCK_IDS = ['st', 'mono'];
function layerStrips(id){ return STRIPS.filter((s) => s.layer === id && !DOCK_IDS.includes(s.id)); }
const dockStrips = STRIPS.filter((s) => DOCK_IDS.includes(s.id));
function layerPaths(id){ return layerStrips(id).flatMap((s) => X32V.basicPaths(s)); }

async function connectTo(ip){
  ipInput.value = ip;
  try { localStorage.setItem('x32-ip', ip); } catch(e){}
  wantedOnce = false;
  const res = await window.x32API.connect(ip);
  if(!res.ok) toast('Verbindung fehlgeschlagen: ' + res.error, true);
}

connectBtn.addEventListener('click', async () => {
  if(X.status().state !== 'idle'){
    await window.x32API.disconnect();
    updateStatus({ state: 'idle', progress: 1 });
    return;
  }
  connectTo(ipInput.value.trim() || '192.168.0.64');
});
try { const savedIp = localStorage.getItem('x32-ip'); if(savedIp) ipInput.value = savedIp; } catch(e){}

// ---------- Pult-Suche (aktuelles WLAN durchsuchen) ----------
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

// ================= Ebenen & Fader-Streifen =================
let currentLayer = 'ch';
let stripUI = {};
const dockUI = {};
let unsubscribers = [];

function buildStrip(strip){
  const ui = { strip, iconId: null, tracks: [], fills: [] };
  const wrap = el('<div class="strip"></div>');
  wrap.appendChild(el('<div class="strip-num">' + esc(strip.label) + '</div>'));

  const plate = el('<div class="strip-plate"></div>');
  const icon = el('<div class="strip-icon"></div>');
  const name = el('<div class="strip-name"></div>');
  plate.appendChild(icon);
  plate.appendChild(name);
  wrap.appendChild(plate);

  const row = el('<div class="meter-fader-row"></div>');
  const nMeters = strip.meter ? strip.meter.idx.length : 0;
  for(let i = 0; i < nMeters; i++){
    const track = el('<div class="meter-track"></div>');
    const fill = el('<div class="meter-fill" style="height:100%;"></div>');
    track.appendChild(fill);
    row.appendChild(track);
    ui.fills.push(fill);
  }
  const fader = makeFader();
  row.appendChild(fader);
  wrap.appendChild(row);

  const dbLabel = el('<div class="db-label">-oo</div>');
  wrap.appendChild(dbLabel);
  const muteBtn = el('<button class="mute-btn">MUTE</button>');
  wrap.appendChild(muteBtn);

  const faderPath = X32V.stripPath(strip, strip.faderLeaf);
  const onPath = X32V.stripPath(strip, strip.onLeaf);
  fader.addEventListener('input', () => {
    const v = parseFloat(fader.value);
    dbLabel.textContent = v <= 0 ? '-oo' : fmt(X32V.faderToDb(v), 1);
    X.setWire(faderPath, 'f', v);
  });
  fader.addEventListener('dblclick', () => X.setWire(faderPath, 'f', 0.75));
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = X.get(onPath);
    X.setWire(onPath, 'i', on === 0 ? 1 : 0);
  });
  plate.addEventListener('click', () => openDetail(strip));
  plate.title = 'Klicken: EQ, Kompressor, Name, Farbe und Icon bearbeiten';

  Object.assign(ui, { wrap, icon, name, fader, dbLabel, muteBtn, faderPath, onPath });
  return ui;
}

function paintStrip(ui){
  const s = ui.strip, b = s.base;
  const nameV = X.get(b + '/config/name');
  ui.name.textContent = nameV !== undefined && nameV !== '' ? nameV : s.label;
  const color = X.get(b + '/config/color');
  const c = chColor(color);
  ui.icon.parentElement.style.background = c.bg;
  ui.icon.parentElement.style.color = c.fg;
  ui.icon.parentElement.style.borderColor = c.border;
  const iconId = X.get(b + '/config/icon');
  if(iconId !== ui.iconId){ ui.iconId = iconId; ui.icon.innerHTML = iconId ? X32Icons.svg(iconId, 26) : ''; }
  const f = X.get(ui.faderPath);
  if(f !== undefined){
    if(!ui.fader.isDragging()) ui.fader.value = f;
    ui.dbLabel.textContent = f <= 0 ? '-oo' : fmt(X32V.faderToDb(f), 1);
  }
  const on = X.get(ui.onPath);
  const muted = on === 0;
  ui.wrap.style.setProperty('--cap-line', CH_HUES[(color || 0) % 8] || '#3DC7E8');
  ui.wrap.classList.toggle('muted', muted);
  ui.muteBtn.classList.toggle('active', muted);
}

function setLayer(id){
  currentLayer = id;
  layerTabs.querySelectorAll('.layer-tab').forEach((b) => b.classList.toggle('on', b.dataset.layer === id));
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  stripUI = {};
  const row = el('<div class="strip-row"></div>');
  layerStrips(id).forEach((strip) => {
    const ui = buildStrip(strip);
    stripUI[strip.id] = ui;
    row.appendChild(ui.wrap);
    paintStrip(ui);
    unsubscribers.push(X.subscribe(strip.base + '/', () => paintStrip(ui)));
  });
  app.innerHTML = '';
  app.appendChild(row);
  if(X.status().state === 'online') X.want(layerPaths(id).concat(dockStrips.flatMap((s) => X32V.basicPaths(s))));
  X.setSubs(X32V.subscriptionSpecs(id));
  updateHot();
}

// Werte, die regelmäßig nachgelesen werden: Fader/Mute der sichtbaren Ebene
function updateHot(){
  X.setHotGroup('layer', layerStrips(currentLayer).concat(dockStrips).flatMap((s) => [X32V.stripPath(s, s.faderLeaf), X32V.stripPath(s, s.onLeaf)]));
}

// Main LR und Mono: fest am rechten Rand, auf jeder Ebene sichtbar
function buildDock(){
  const dock = document.getElementById('dock');
  const row = el('<div class="dock-strips"></div>');
  dockStrips.forEach((strip) => {
    const ui = buildStrip(strip);
    dockUI[strip.id] = ui;
    row.appendChild(ui.wrap);
    paintStrip(ui);
    X.subscribe(strip.base + '/', () => paintStrip(ui));
  });
  dock.appendChild(row);
}

function buildLayerTabs(){
  X32V.LAYERS.forEach((l) => {
    const b = el('<button class="layer-tab" data-layer="' + l.id + '">' + esc(l.label) + '</button>');
    b.addEventListener('click', () => setLayer(l.id));
    layerTabs.appendChild(b);
  });
}

// Pegel auf die sichtbaren Streifen verteilen
X.onMeter((id, floats) => {
  for(const ui of Object.values(stripUI).concat(Object.values(dockUI))){
    const m = ui.strip.meter;
    if(!m || m.stream !== id) continue;
    m.idx.forEach((idx, i) => { if(ui.fills[i] && idx < floats.length) ui.fills[i].style.height = (100 - levelToPct(floats[idx])).toFixed(0) + '%'; });
  }
  if(typeof processingMeters === 'function') processingMeters(id, floats);
});
window.x32API.onLog((msg) => { /* Diagnose-Meldungen, aktuell nicht angezeigt */ });

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

// ================= Start =================
buildLayerTabs();
buildDock();
setLayer('ch');
X.loadSnapshot().then(() => { STRIPS.forEach((s) => { if(stripUI[s.id]) paintStrip(stripUI[s.id]); }); });
