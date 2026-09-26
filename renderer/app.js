const app = document.getElementById('app');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const ipInput = document.getElementById('ip-input');
const connectBtn = document.getElementById('connect-btn');
const scanBtn = document.getElementById('scan-btn');
const layerTabs = document.getElementById('layer-tabs');
const offlineBtn = document.getElementById('offline-btn');

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
  statusBadge.classList.remove('live', 'warn', 'bad', 'ping-good', 'ping-mid', 'ping-bad', 'offline-mode');
  const consoleEl = document.getElementById('console');
  consoleEl.classList.toggle('offline', st === 'idle');
  consoleEl.classList.toggle('reconnecting', st === 'lost' || st === 'connecting');
  let text = 'nicht verbunden';
  if(st === 'connecting'){
    const secs = Math.floor((s.waitMs || 0) / 1000);
    text = s.noReply ? 'Keine Antwort vom Pult' : 'Verbinde mit ' + (s.target || '') + ' …' + (secs >= 2 ? ' ' + secs + ' s' : '');
    statusBadge.classList.add(s.noReply ? 'bad' : 'warn');
  }
  else if(st === 'lost'){ text = 'Verbindung verloren – suche…'; statusBadge.classList.add('bad'); }
  else if(st === 'offline'){ text = 'Offline-Modus'; statusBadge.classList.add('offline-mode'); }
  else if(st === 'online'){
    statusBadge.classList.add('live');
    if(s.progress < 1 && s.open > 40) text = 'Synchronisiere ' + Math.round(s.progress * 100) + ' %';
    else text = 'Verbunden' + (s.info && s.info.model ? ' · ' + s.info.model : '') + (s.rtt != null ? ' · ' + Math.round(s.rtt) + ' ms' : '') + (s.loss != null && s.loss >= 2 ? ' · ' + Math.round(s.loss) + ' % Verlust' : '');
    if(s.rtt != null) statusBadge.classList.add(s.rtt < 15 && !(s.loss >= 5) ? 'ping-good' : s.rtt < 40 && !(s.loss >= 10) ? 'ping-mid' : 'ping-bad');
  }
  statusText.textContent = text;
  connectBtn.textContent = st === 'idle' || st === 'offline' ? 'Verbinden' : 'Trennen';
  offlineBtn.textContent = st === 'offline' ? 'Offline beenden' : 'Offline-Modus';
  offlineBtn.disabled = st !== 'idle' && st !== 'offline';
  offlineBtn.title = offlineBtn.disabled ? 'Erst vom Pult trennen' : 'Ohne Pult arbeiten: alle Regler lassen sich ausprobieren und vorbereiten';
  if(typeof Offline !== 'undefined') Offline.update(s);
  if(st === 'idle' || st === 'offline') resetMeterDisplays();      // keine alten Pegel stehen lassen
  if(st === 'online' && s.target){ try { localStorage.setItem('x32-ip-ok', s.target); } catch(e){} }      // diese Adresse hat wirklich funktioniert
  if(typeof ConnectHelp !== 'undefined') ConnectHelp.updateBanner(s);
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
  const tip = good ? '' : (X32PLAT.isMac ? ' Tipp: AirDrop und Handoff am Mac ausschalten (können das WLAN alle paar Sekunden kurz stören) und andere Netzwerk-Programme schließen.' : ' Tipp: In den Energieoptionen den WLAN-Adapter nicht sparen lassen (Geräte-Manager → Netzwerkadapter → Energieverwaltung), und andere Netzwerk-Programme schließen.');
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
    '<div class="diag-test"><button class="btn small" id="net-test-btn">Netzwerk-Test starten (3 Sekunden)</button> <button class="btn small secondary" id="help-btn">Verbindungshilfe</button><div id="net-test-result" class="net-result"></div></div>' +
    '<p class="hint">Bei Problemen hilft ein Foto dieses Fensters.</p></div>');
  box.querySelector('#net-test-btn').addEventListener('click', runNetTest);
  box.querySelector('#help-btn').addEventListener('click', () => { ConnectHelp.open(ipInput.value.trim()); });
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
  X.want(layerPaths(currentLayer));                    // erst die sichtbare Ebene, dann ihre Mini-Anzeigen (EQ/Kompressor), dann der Rest
  X.want(layerMiniPaths(currentLayer));
  const order = X32V.LAYERS.map((l) => l.id).filter((id) => id !== currentLayer);
  order.forEach((id) => X.want(layerPaths(id)));
}
const DOCK_IDS = ['st', 'mono'];
function layerStrips(id){
  if(id === 'user') return UserPage.ids().map((sid) => STRIP_BY_ID[sid]);      // Meine Seite: eigene Auswahl in eigener Reihenfolge
  return STRIPS.filter((s) => s.layer === id && !DOCK_IDS.includes(s.id));
}
const dockStrips = STRIPS.filter((s) => DOCK_IDS.includes(s.id));
function layerPaths(id){ return layerStrips(id).flatMap((s) => X32V.basicPaths(s)); }
// Werte für die Mini-Anzeigen (EQ, Kompressor) der sichtbaren Kanalzüge samt Main/Mono
function layerMiniPaths(id){ return layerStrips(id).concat(dockStrips).flatMap((s) => Minis.paths(s)); }
// Meter-Ströme: Kanäle und Main immer; Strom 1 (Gain Reduction der Kanäle) nur, wenn Kanäle sichtbar sind
function applyMeterStreams(){
  const needs1 = layerStrips(currentLayer).concat(dockStrips).some((s) => s.gr && s.gr.stream === '1');
  X.setMeters(needs1 ? ['0', '1', '2'] : ['0', '2']);
}

// Offline-Modus: ohne Pult arbeiten (Startwerte, Änderungen bleiben in der App, später aufs Pult übertragbar)
async function enterOffline(){
  const st = X.status().state;
  if(st === 'offline') return;
  if(st !== 'idle') await window.x32API.disconnect();
  Object.keys(METER_STATE).forEach((k) => delete METER_STATE[k]);
  CLIPPED.clear(); clipChanged();
  X.enterOffline();
  wantedOnce = false;
  X.want(STRIPS.flatMap((s) => X32V.basicPaths(s)));      // alle Kanalzüge, damit auch Szenen alles erfassen
  setLayer(currentLayer);
}
function leaveOffline(){
  if(!X.isOffline()) return;
  X.leaveOffline();
  setLayer(currentLayer);
}
offlineBtn.addEventListener('click', () => (X.isOffline() ? leaveOffline() : enterOffline()));
document.getElementById('hint-offline-btn').addEventListener('click', enterOffline);

async function connectTo(ip){
  ip = String(ip == null ? '' : ip).trim();
  if(X.isOffline()) leaveOffline();
  ipInput.value = ip;
  wantedOnce = false;
  const res = await window.x32API.connect(ip);
  if(!res.ok){ toast(res.error || 'Verbindung fehlgeschlagen.', true); updateStatus({ state: 'idle', progress: 1 }); return; }
  ipInput.value = res.ip || ip;
  try { localStorage.setItem('x32-ip', ipInput.value); } catch(e){}
}

connectBtn.addEventListener('click', async () => {
  if(X.status().state !== 'idle' && X.status().state !== 'offline'){
    await window.x32API.disconnect();
    updateStatus({ state: 'idle', progress: 1 });
    return;
  }
  const typed = ipInput.value.trim();
  if(!typed){                                                    // nichts eingetragen: nicht raten, sondern das Pult im Netz suchen
    toast('Keine IP-Adresse eingetragen: ich suche das Pult im Netz …');
    scanBtn.click();
    return;
  }
  connectTo(typed);
});
try {
  let savedIp = localStorage.getItem('x32-ip');
  // Alte Version: als Vorgabe stand hier 192.168.0.64 (nur ein Beispiel aus einer Anleitung, keine echte Pult-Adresse). Nur behalten, wenn sie je funktioniert hat.
  if(savedIp === '192.168.0.64' && localStorage.getItem('x32-ip-ok') !== savedIp){ localStorage.removeItem('x32-ip'); savedIp = null; }
  if(savedIp) ipInput.value = savedIp;
} catch(e){}
// Darf die App ins lokale Netzwerk? (macOS verlangt eine Freigabe.) Bei Sperre: Hinweis im Startbildschirm; nach Rückkehr in die App wird neu geprüft.
function showNetAccess(a){
  const box = document.getElementById('net-warning');
  if(box) box.hidden = !(a && a.blocked);
}
async function recheckNetAccess(force){ try { showNetAccess(await window.x32API.netAccess(!!force)); } catch(e){} }
if(window.x32API.onNetAccess) window.x32API.onNetAccess(showNetAccess);
window.addEventListener('focus', () => recheckNetAccess(true));
document.querySelectorAll('.pc-name').forEach((e) => { e.textContent = X32PLAT.pc; });
document.getElementById('nw-open').addEventListener('click', () => window.x32API.openPrivacy());
document.getElementById('nw-help').addEventListener('click', () => ConnectHelp.open(ipInput.value.trim()));
recheckNetAccess(false);
document.getElementById('cp-help').addEventListener('click', () => ConnectHelp.open(ipInput.value.trim()));
document.getElementById('cp-scan').addEventListener('click', () => scanBtn.click());
document.getElementById('cp-cancel').addEventListener('click', () => connectBtn.click());

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
    const scan = await window.x32API.scan();
    const results = scan.results || [];
    if(!results.length){
      const nets = (scan.ifaces || []).map((f) => f.network + '/' + f.prefix + ' (' + f.name + ')').join(', ');
      toast(!(scan.ifaces || []).length ? 'Der ' + X32PLAT.pc + ' ist mit keinem Netzwerk verbunden (WLAN oder Kabel prüfen).' : 'Kein X32/M32 gefunden. Durchsucht: ' + nets + '. Pult an? Im selben Netz? Für Details auf „Verbindungshilfe“ drücken.', true);
      ConnectHelp.open(ipInput.value.trim());                       // nichts gefunden: gleich erklären, woran es liegen kann
    }
    else if(results.length === 1 && !X.status().state.match(/connecting|online/)) { connectTo(results[0].ip); toast('Pult gefunden: ' + (results[0].model || 'X32') + ' bei ' + results[0].ip + ' – verbinde …'); }
    else showConsolePicker(results);
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = 'Pult suchen';
  }
});

// ---------- Automatisch verbinden (beim Start) ----------
// Sucht das Pult im Netzwerk. Genau eins gefunden (oder das zuletzt benutzte dabei) -> verbinden; mehrere -> Auswahl.
const autoBox = document.getElementById('auto-connect');
try { if(autoBox) autoBox.checked = localStorage.getItem('x32-auto') !== 'off'; } catch(e){}
if(autoBox) autoBox.addEventListener('change', () => { try { localStorage.setItem('x32-auto', autoBox.checked ? 'on' : 'off'); } catch(e){} });
async function autoConnect(){
  if(autoBox && !autoBox.checked) return 'aus';
  if(X.status().state !== 'idle') return 'schon verbunden';
  const hintText = document.querySelector('#connect-hint .hint-title');
  const oldText = hintText ? hintText.textContent : '';
  if(hintText) hintText.textContent = 'Suche das Pult im Netzwerk…';
  let results = [];
  try { const scan = await window.x32API.scan(); results = (scan && scan.results) || []; } catch(e){}
  if(hintText) hintText.textContent = oldText;
  if(X.status().state !== 'idle') return 'schon verbunden';   // du warst schneller
  let saved = '';
  try { saved = localStorage.getItem('x32-ip') || ''; } catch(e){}
  const known = results.find((r) => r.ip === saved);
  if(known){ connectTo(known.ip); return 'verbunden'; }
  if(results.length === 1){ connectTo(results[0].ip); return 'verbunden'; }
  if(results.length > 1){ showConsolePicker(results); return 'auswahl'; }
  return 'nichts gefunden';
}

// ================= Ebenen & Fader-Streifen =================
let currentLayer = 'ch';
let stripUI = {};
const dockUI = {};
let unsubscribers = [];

function buildStrip(strip){
  const ui = { strip, iconId: null, tracks: [], fills: [], peakEls: [] };
  const wrap = el('<div class="strip"></div>');
  wrap.appendChild(el('<div class="strip-num">' + esc(strip.label) + '</div>'));
  if(strip.meter){                                   // Übersteuerungs-Lampe: leuchtet, bis man sie anklickt
    const clip = el('<button class="clip-led" title="Übersteuerung – Klick zum Zurücksetzen" aria-label="Übersteuerung zurücksetzen"></button>');
    clip.addEventListener('click', (e) => { e.stopPropagation(); CLIPPED.delete(strip.id); clipChanged(); });
    clip.classList.toggle('on', CLIPPED.has(strip.id));
    wrap.appendChild(clip);
    ui.clipEl = clip;
  }

  const plate = el('<div class="strip-plate"></div>');
  const icon = el('<div class="strip-icon"></div>');
  const name = el('<div class="strip-name"></div>');
  plate.appendChild(icon);
  plate.appendChild(name);
  wrap.appendChild(plate);
  const mini = Minis.attach(ui);                     // EQ, Kompressor, Pegel über dem Fader
  if(mini) wrap.appendChild(mini);
  const pin = el('<button class="pin-btn" aria-label="Meine Seite"></button>');
  pin.addEventListener('click', (e) => { e.stopPropagation(); UserPage.toggle(strip.id); });
  wrap.appendChild(pin);
  ui.pinEl = pin;
  setPin(ui);

  const row = el('<div class="meter-fader-row"></div>');
  const nMeters = strip.meter ? strip.meter.idx.length : 0;
  for(let i = 0; i < nMeters; i++){
    const track = el('<div class="meter-track"></div>');
    const fill = el('<div class="meter-fill" style="height:100%;"></div>');
    track.appendChild(fill);
    const peak = el('<div class="meter-peak"></div>');   // hält den höchsten Pegel kurz fest
    track.appendChild(peak);
    row.appendChild(track);
    ui.fills.push(fill);
    ui.peakEls.push(peak);
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

// Stern am Kanalzug: gehört der Zug zu "Meine Seite"?
function setPin(ui){
  const on = UserPage.has(ui.strip.id);
  ui.pinEl.classList.toggle('on', on);
  ui.pinEl.textContent = on ? '★' : '☆';
  ui.pinEl.title = on ? 'Von „Meine Seite“ entfernen' : 'Zu „Meine Seite“ hinzufügen';
}
UserPage.onChange(() => {
  Object.values(stripUI).concat(Object.values(dockUI)).forEach(setPin);
  if(currentLayer === 'user') setLayer('user');       // Reihenfolge/Auswahl geändert: Seite neu aufbauen
  if(X.isLive()) X.want(layerMiniPaths(currentLayer));
});

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
  const hue = CH_HUES[(color || 0) % 8];
  if(hue) ui.wrap.style.setProperty('--cap-line', hue); else ui.wrap.style.removeProperty('--cap-line');     // ohne Farbe: Standardfarbe des Designs
  ui.wrap.classList.toggle('muted', muted);
  ui.muteBtn.classList.toggle('active', muted);
}

// Ansicht: Pult (Ebenen) oder Messung (Pegel/RTA/REW, unabhängig vom Pult)
let currentView = 'console';
function showView(view){
  currentView = view;
  document.getElementById('console').hidden = view !== 'console';
  document.getElementById('tools').hidden = view !== 'tools';
  document.getElementById('reserve').hidden = view !== 'console';
  if(view === 'console'){ Overview.show(); Measure.show(); } else { Overview.hide(); Measure.hide(); }
  layerTabs.querySelectorAll('.layer-tab').forEach((b) => b.classList.toggle('on', b.dataset.layer === (view === 'console' ? currentLayer : view)));
  if(view === 'tools'){ if(typeof closeDetail === 'function') closeDetail(); Tools.init(document.getElementById('tools')); }
  if(typeof fitFaders === 'function') fitFaders();
}

// Änderungen eines Kanalzugs: Name/Fader/Mute sofort, EQ/Kompressor gebündelt für die Mini-Anzeige
function watchStrip(ui, paths){
  const s = ui.strip;
  if(paths.some((p) => !Minis.isMiniPath(p))) paintStrip(ui);
  if(paths.some(Minis.isMiniPath)) Minis.schedule(ui);
}

function setLayer(id){
  currentLayer = id;
  if(currentView === 'console') layerTabs.querySelectorAll('.layer-tab').forEach((b) => b.classList.toggle('on', b.dataset.layer === id));
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  stripUI = {};
  const row = el('<div class="strip-row"></div>');
  layerStrips(id).forEach((strip) => {
    const ui = buildStrip(strip);
    stripUI[strip.id] = ui;
    row.appendChild(ui.wrap);
    paintStrip(ui);
    unsubscribers.push(X.subscribe(strip.base + '/', (ps) => watchStrip(ui, ps)));
  });
  app.innerHTML = '';
  if(id === 'user'){
    const head = el('<div class="user-head"><span>Meine Seite – die Kanalzüge, die du wirklich brauchst. Stern an jedem Kanalzug oder „Bearbeiten“.</span><button class="btn secondary small">Bearbeiten</button></div>');
    head.querySelector('button').addEventListener('click', () => UserPage.openEditor());
    app.appendChild(head);
    if(!row.children.length) app.appendChild(el('<div class="user-empty">Noch leer. Tippe bei einem Kanalzug auf den Stern (☆) oder auf „Bearbeiten“, um ihn hierher zu holen.</div>'));
  }
  app.appendChild(row);
  try { localStorage.setItem('x32-layer', id); } catch(e){}
  if(X.isLive()){
    X.want(layerPaths(id).concat(dockStrips.flatMap((s) => X32V.basicPaths(s))));
    X.want(layerMiniPaths(id));
  }
  applyMeterStreams();
  X.setSubs(X32V.subscriptionSpecs(id));
  updateHot();
  repaintMinis();
  requestAnimationFrame(fitFaders);
}
function repaintMinis(){ Object.values(stripUI).forEach((ui) => Minis.schedule(ui)); }

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
    X.subscribe(strip.base + '/', (ps) => watchStrip(ui, ps));
    Minis.schedule(ui);
  });
  dock.appendChild(row);
}

function buildLayerTabs(){
  X32V.LAYERS.forEach((l) => {
    const b = el('<button class="layer-tab" data-layer="' + l.id + '">' + esc(l.label) + '</button>');
    b.addEventListener('click', () => { setLayer(l.id); if(currentView !== 'console') showView('console'); });
    layerTabs.appendChild(b);
  });
  const up = el('<button class="layer-tab" data-layer="user">★ Meine Seite</button>');
  up.addEventListener('click', () => { setLayer('user'); if(currentView !== 'console') showView('console'); });
  layerTabs.appendChild(up);
  const sc = el('<button class="layer-tab right-group" data-layer="scenes">Szenen</button>');
  sc.addEventListener('click', () => Scenes.open());
  layerTabs.appendChild(sc);
  const tl = el('<button class="layer-tab" data-layer="tools">Werkzeuge</button>');
  tl.addEventListener('click', () => showView('tools'));
  layerTabs.appendChild(tl);
  const bank = el('<span class="bank-btns"><button class="layer-tab bank-btn" aria-label="Kanalzüge nach links blättern">‹</button><button class="layer-tab bank-btn" aria-label="Kanalzüge nach rechts blättern">›</button></span>');
  bank.children[0].addEventListener('click', () => bankScroll(-1));
  bank.children[1].addEventListener('click', () => bankScroll(1));
  layerTabs.appendChild(bank);
}

// Pegel auf die sichtbaren Streifen verteilen (mit Spitzenwert-Marke und Übersteuerungs-Lampe)
const PEAK_HOLD_MS = 1200;
const CLIP_LEVEL = 0.98;      // ca. -0,2 dBFS
// Zustand je Kanalzug (auch für nicht sichtbare Ebenen): letzte Werte, gehaltene Spitze; Übersteuerung bleibt gemerkt
const METER_STATE = {};
const CLIPPED = new Set();
function resetMeterDisplays(){
  Object.keys(METER_STATE).forEach((k) => delete METER_STATE[k]);
  Object.values(stripUI).concat(Object.values(dockUI)).forEach((ui) => {
    ui.fills.forEach((f) => { f.style.height = '100%'; });
    ui.peakEls.forEach((p) => { p.style.opacity = '0'; });
  });
}
function clipChanged(){
  Object.values(stripUI).concat(Object.values(dockUI)).forEach((ui) => { if(ui.clipEl) ui.clipEl.classList.toggle('on', CLIPPED.has(ui.strip.id)); });
  if(typeof Overview !== 'undefined') Overview.refresh();
}
X.onMeter((id, floats) => {
  const now = performance.now();
  for(const s of STRIPS){
    const m = s.meter;
    const ui = stripUI[s.id] || dockUI[s.id];
    if(s.gr && s.gr.stream === id && s.gr.idx[0] < floats.length){         // Gain Reduction des Kompressors
      const gr = grFromFactor(floats[s.gr.idx[0]]);
      const st0 = METER_STATE[s.id] || (METER_STATE[s.id] = { peaks: m ? m.idx.map(() => ({ v: 0, t: 0 })) : [], last: m ? m.idx.map(() => 0) : [], level: 0 });
      st0.gr = gr;
      if(ui) Minis.setGr(ui, gr);
    }
    if(!m || m.stream !== id) continue;
    const st = METER_STATE[s.id] || (METER_STATE[s.id] = { peaks: m.idx.map(() => ({ v: 0, t: 0 })), last: m.idx.map(() => 0), level: 0 });
    let level = 0;
    m.idx.forEach((idx, i) => {
      if(idx >= floats.length) return;
      const v = floats[idx], p = st.peaks[i];
      st.last[i] = v;
      if(v > level) level = v;
      if(v >= p.v){ p.v = v; p.t = now; }
      else if(now - p.t > PEAK_HOLD_MS) p.v = Math.max(v, p.v * 0.9);
      if(v >= CLIP_LEVEL && !CLIPPED.has(s.id)){ CLIPPED.add(s.id); clipChanged(); }
      if(ui && ui.fills[i]){
        ui.fills[i].style.height = (100 - levelToPct(v)).toFixed(0) + '%';
        ui.peakEls[i].style.top = (100 - levelToPct(p.v)).toFixed(0) + '%';
        ui.peakEls[i].style.opacity = p.v > 0.002 ? '1' : '0';
      }
    });
    st.level = level;
    if(ui) Minis.setPeak(ui, Math.max(...st.peaks.map((p) => p.v)));
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
window.x32API.getVersion().then((v) => { document.getElementById('version-label').textContent = 'v' + v; if(!window.__noAutoConnect) maybeShowChangelog(v); });

// ---------- Design: Schlicht (Standard) oder Klassisch ----------
const designBtn = document.getElementById('design-btn');
function applyDesign(d){
  document.body.classList.toggle('plain', d === 'plain');
  designBtn.textContent = d === 'plain' ? 'Design: Schlicht' : 'Design: Klassisch';
  try { localStorage.setItem('x32-design', d); } catch(e){}
  if(typeof Measure !== 'undefined') Measure.redraw();
  if(typeof Minis !== 'undefined') Minis.redrawAll();
}
designBtn.addEventListener('click', () => applyDesign(document.body.classList.contains('plain') ? 'classic' : 'plain'));
try { applyDesign(localStorage.getItem('x32-design') === 'classic' ? 'classic' : 'plain'); } catch(e){}

// ---------- Touch-Modus (Touch-Monitor): große Bedienelemente, hohe Fader, Bank-Tasten ----------
const touchBtn = document.getElementById('touch-btn');
// Fader so hoch machen, wie der Bildschirm hergibt (mehr Weg = genauer)
// Geteiltes Touch-Layout (breite Bildschirme, z. B. 27-Zoll-Monitor): links das Mischpult, rechts oben die Pegelanzeige, rechts unten frei
function updateSplit(){
  const ws = document.getElementById('workspace');
  const on = document.body.classList.contains('touch') && window.innerWidth >= (window.__splitMinWidth || 1500) && currentView === 'console';
  document.body.classList.toggle('touch-split', on);
  if(on){
    const top = ws.getBoundingClientRect().top + window.scrollY;
    ws.style.setProperty('--workspace-h', Math.max(420, window.innerHeight - top - 12) + 'px');
  } else ws.style.removeProperty('--workspace-h');
}
function fitFaders(){
  const rootEl = document.documentElement;
  rootEl.style.removeProperty('--fader-h');
  updateSplit();
  if(!document.body.classList.contains('touch')) return;
  const strip = app.querySelector('.strip') || document.querySelector('#dock .strip');
  const fader = strip && strip.querySelector('.fader');
  if(!strip || !fader) return;
  const nonFader = strip.offsetHeight - fader.offsetHeight;
  const docTop = strip.getBoundingClientRect().top + window.scrollY;
  rootEl.style.setProperty('--fader-h', Math.max(210, Math.min(document.body.classList.contains('touch-split') ? 900 : 560, Math.floor(window.innerHeight - docTop - nonFader - 26))) + 'px');
}
function applyTouch(on, persist){
  document.body.classList.toggle('touch', on);
  touchBtn.textContent = on ? 'Touch: an' : 'Touch: aus';
  touchBtn.classList.toggle('on', on);
  if(persist){ try { localStorage.setItem('x32-touch', on ? 'on' : 'off'); } catch(e){} }
  fitFaders();                                       // sofort messen (erzwingt das Layout), danach noch einmal nach dem Zeichnen
  requestAnimationFrame(() => { fitFaders(); Minis.redrawAll(); Measure.redraw(); });
}
touchBtn.addEventListener('click', () => applyTouch(!document.body.classList.contains('touch'), true));
document.getElementById('full-btn').addEventListener('click', () => { if(window.x32API.toggleFullscreen) window.x32API.toggleFullscreen(); });
window.addEventListener('resize', () => fitFaders());
// Bank-Tasten: die Kanalzug-Reihe um etwa eine Bildschirmbreite weiterblättern
function bankScroll(dir){
  const row = app.querySelector('.strip-row');
  if(row) row.scrollBy({ left: dir * Math.max(240, row.clientWidth * 0.8), behavior: window.__instantScroll ? 'auto' : 'smooth' });
}
// Sobald wirklich mit dem Finger getippt wird (und der Touch-Modus nicht ausdrücklich aus ist): einschalten
document.addEventListener('pointerdown', (e) => {
  if(e.pointerType !== 'touch' || document.body.classList.contains('touch')) return;
  let saved = null; try { saved = localStorage.getItem('x32-touch'); } catch(err){}
  if(saved === 'off') return;
  applyTouch(true, false);
  toast('Touch-Modus eingeschaltet (oben mit „Touch“ abschaltbar).');
}, true);
document.addEventListener('contextmenu', (e) => { if(document.body.classList.contains('touch')) e.preventDefault(); });
{ let saved = null; try { saved = localStorage.getItem('x32-touch'); } catch(e){}
  const auto = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  applyTouch(saved === 'on' || (saved === null && auto), false); }

// ================= Start =================
const rewBtn = document.getElementById('rew-btn');
if(rewBtn) rewBtn.addEventListener('click', () => Measure.openRew());
buildLayerTabs();
buildDock();
Overview.init();
Measure.show();
{ let last = 'ch'; try { last = localStorage.getItem('x32-layer') || 'ch'; } catch(e){}
  setLayer(last === 'user' || X32V.LAYERS.some((l) => l.id === last) ? last : 'ch'); }
if(!window.__noAutoConnect) setTimeout(autoConnect, 300);
X.loadSnapshot().then(() => { STRIPS.forEach((s) => { if(stripUI[s.id]) paintStrip(stripUI[s.id]); }); });
