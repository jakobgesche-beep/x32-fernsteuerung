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

function faderToDb(f){
  if(f >= 0.5) return f * 40 - 30;
  if(f >= 0.25) return f * 80 - 50;
  if(f >= 0.0625) return f * 160 - 70;
  if(f > 0) return f * 480 - 90;
  return -90;
}

let connected = false;
const channels = {};
for(let ch = 1; ch <= 32; ch++) channels[ch] = { name: 'CH ' + String(ch).padStart(2, '0'), fader: 0, faderDb: -90, muted: false, color: 0 };

const stripEls = {};

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
  const meterFill = el('<div class="meter-fill" style="height:100%;"></div>');
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
  s.name = data.name; s.fader = data.fader; s.faderDb = data.faderDb; s.muted = data.muted; s.color = data.color || 0;
  const ui = stripEls[data.ch];
  if(!ui) return;
  ui.name.textContent = data.name;
  const c = chColor(s.color);
  ui.name.style.background = c.bg; ui.name.style.color = c.fg; ui.name.style.borderColor = c.border;
  if(document.activeElement !== ui.fader) ui.fader.value = data.fader;
  ui.dbLabel.textContent = data.faderDb <= -89.9 ? '-oo' : fmt(data.faderDb, 1);
  ui.wrap.classList.toggle('muted', data.muted);
  ui.muteBtn.classList.toggle('active', data.muted);
}

window.x32API.onChannel((data) => applyChannelUpdate(data));
window.x32API.onMeters((payload) => {
  payload.levels.forEach((v, i) => {
    const ui = stripEls[i + 1];
    if(ui) ui.meterFill.style.height = (100 - levelToPct(v)).toFixed(0) + '%';
  });
  if(typeof processingMeters === 'function') processingMeters(payload);
});
window.x32API.onLog((msg) => { /* könnte in ein Log-Panel, aktuell nur Toast bei Bedarf */ });

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
