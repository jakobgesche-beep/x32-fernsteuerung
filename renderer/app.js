const app = document.getElementById('app');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const ipInput = document.getElementById('ip-input');
const connectBtn = document.getElementById('connect-btn');

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

    typeSel.addEventListener('change', () => window.x32API.setEq(ch, b, 'type', parseInt(typeSel.value, 10)));
    freqField.input.addEventListener('change', () => window.x32API.setEq(ch, b, 'f', parseFloat(freqField.input.value)));
    gainField.input.addEventListener('change', () => window.x32API.setEq(ch, b, 'g', parseFloat(gainField.input.value)));
    qField.input.addEventListener('change', () => window.x32API.setEq(ch, b, 'q', parseFloat(qField.input.value)));

    eqBandEls.push({ typeSel, freq: freqField.input, gain: gainField.input, q: qField.input });
  }

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
    eqBandEls, dynOnBtn,
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
  });
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
window.x32API.onUpdateReady((version) => {
  const bar = el('<div class="update-bar">Update ' + esc(version) + ' heruntergeladen. <button class="btn small" id="install-update-btn">Jetzt neu starten &amp; installieren</button></div>');
  document.body.appendChild(bar);
  bar.querySelector('#install-update-btn').addEventListener('click', () => window.x32API.installUpdateNow());
});

// ================= Aufbau =================
function render(){
  app.innerHTML = '';
  app.appendChild(el('<p class="hint">IP-Adresse des X32 eingeben (Standard-Werksadresse: 192.168.0.64) und „Verbinden" klicken. Klick auf einen Kanal öffnet EQ &amp; Kompressor.</p>'));
  const row = el('<div class="strip-row"></div>');
  for(let ch = 1; ch <= 32; ch++) row.appendChild(buildStrip(ch));
  app.appendChild(row);
}
render();
