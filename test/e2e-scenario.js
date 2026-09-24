const params = new URLSearchParams(location.search);
const out = []; let fails = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail){ if(!ok) fails++; out.push((ok ? 'OK    ' : 'FEHLER') + ' ' + name + (detail !== undefined ? '  ' + detail : '')); }
async function waitFor(fn, timeout){ const t0 = Date.now(); while(Date.now() - t0 < (timeout || 5000)){ if(fn()) return true; await sleep(15); } return false; }
const ptr = (type, target, x, y) => target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
Element.prototype.setPointerCapture = function(){};

// ---- realistische Beispieldaten im simulierten Pult ----
window.__mockInit = (mock) => {
  const put = (path, actual) => mock.store.set(path, X32V.toWire(path, actual).value);
  const names = ['Kick In','Kick Out','Snare Top','Snare Bot','HiHat','Floor Tom','Rack Tom','Ride','OH L','OH R','Bass DI','Bass Amp','Git L','Git R','Keys','Piano','Lead Voc','Backing 1','Backing 2','Choir','Talk A','Talk B','FX Rtn','Click'];
  const icons = [2,3,4,5,9,8,6,10,48,49,17,24,21,25,30,27,41,42,42,43,45,46,61,15];
  const colors = [1,1,1,1,1,1,1,1,1,1,6,6,3,3,5,5,2,2,2,2,7,7,4,0];
  names.forEach((n, i) => {
    const b = '/ch/' + String(i + 1).padStart(2, '0');
    mock.store.set(b + '/config/name', n); mock.store.set(b + '/config/icon', icons[i]); mock.store.set(b + '/config/color', colors[i]);
    mock.store.set(b + '/mix/fader', 0.5 + (i % 6) * 0.07);
  });
  mock.store.set('/ch/07/mix/on', 0);
  ['Mon 1','Mon 2','Mon 3','Mon 4','IEM L','IEM R','Front','Sub'].forEach((n, i) => {
    const b = '/bus/' + String(i + 1).padStart(2, '0');
    mock.store.set(b + '/config/name', n); mock.store.set(b + '/config/icon', i < 4 ? 63 : i < 6 ? 53 : 64 + (i % 2)); mock.store.set(b + '/config/color', i < 4 ? 3 : i < 6 ? 4 : 1);
  });
  mock.store.set('/main/st/config/name', 'Main LR'); mock.store.set('/main/st/config/icon', 66); mock.store.set('/main/st/config/color', 1);
  mock.store.set('/main/m/config/name', 'Mono'); mock.store.set('/main/m/config/icon', 65); mock.store.set('/main/m/config/color', 6);
  ['Drums','Bass','Gitarren','Keys','Voc','Chor','FX','Alles'].forEach((n, i) => { mock.store.set('/dca/' + (i + 1) + '/config/name', n); mock.store.set('/dca/' + (i + 1) + '/config/icon', [11,17,21,30,41,43,61,70][i]); mock.store.set('/dca/' + (i + 1) + '/config/color', [1,6,3,5,2,2,4,7][i]); });
  // interessanter EQ / Kompressor
  const eq = (b, i, type, f, g, q) => { mock.store.set(b + '/eq/' + i + '/type', type); put(b + '/eq/' + i + '/f', f); put(b + '/eq/' + i + '/g', g); put(b + '/eq/' + i + '/q', q); };
  eq('/ch/02', 1, 2, 376.7, -6.5, 1.1); eq('/ch/02', 2, 2, 94.6, 5, 1); eq('/ch/02', 3, 2, 195.4, -15, 0.8); eq('/ch/02', 4, 4, 3430, -5.25, 1);
  mock.store.set('/ch/02/preamp/hpon', 1); put('/ch/02/preamp/hpf', 44);
  eq('/bus/03', 1, 9, 45, 0, 1); eq('/bus/03', 2, 2, 120, 4, 1.2); eq('/bus/03', 3, 3, 400, -3.5, 2); eq('/bus/03', 4, 2, 2500, 3, 1.5); eq('/bus/03', 5, 4, 8000, -2, 1); eq('/bus/03', 6, 11, 16000, 0, 1);
  eq('/main/st', 1, 11, 40, 0, 1); eq('/main/st', 2, 1, 200, 3.9, 0.42); eq('/main/st', 3, 2, 1000, -5.8, 0.6); eq('/main/st', 4, 2, 4900, -5.7, 0.31); eq('/main/st', 5, 2, 13700, -2.1, 1.17); eq('/main/st', 6, 4, 18000, 4.2, 4.43);
  mock.store.set('/bus/03/dyn/on', 1); put('/bus/03/dyn/thr', -24); mock.store.set('/bus/03/dyn/ratio', 6);
};

(async () => {
  document.getElementById('ip-input').value = '10.0.0.5';
  document.getElementById('connect-btn').click();
  const online = await waitFor(() => X.status().state === 'online' && X.status().progress >= 1, 10000);
  await sleep(200);
  const view = params.get('view') || 'ch';

  if(params.get('test')){
    check('verbunden und synchronisiert', online, JSON.stringify({ state: X.status().state, rtt: X.status().rtt && Math.round(X.status().rtt) }));
    check('Statusanzeige', /Verbunden · X32C/.test(document.getElementById('status-text').textContent), document.getElementById('status-text').textContent);
    // Kanal-Ebene
    const u2 = stripUI['ch02'];
    check('Kanal 2: Name, Icon, Farbe aus dem Pult', u2 && u2.name.textContent === 'Kick Out' && u2.icon.innerHTML.includes('<svg') && u2.strip && getComputedStyle(u2.icon.parentElement).backgroundColor !== 'rgba(0, 0, 0, 0)', u2 && u2.name.textContent);
    check('Kanal 7 stummgeschaltet dargestellt', stripUI['ch07'].wrap.classList.contains('muted'));
    check('32 Kanalzüge in der Ebene', Object.keys(stripUI).length === 32);

    // Fader schnell bewegen und Latenz messen
    const f = stripUI['ch05'].fader;
    const t0 = performance.now();
    f.value = 0.6; f.dispatchEvent(new Event('input', { bubbles: true }));
    const arrived = await waitFor(() => { const r = __ctl.mock.log.sets.get('/ch/05/mix/fader'); return r && Math.abs(r.last - 0.6) < 1e-6; }, 500);
    const rec = __ctl.mock.log.sets.get('/ch/05/mix/fader');
    check('Fader-Änderung kommt am Pult an', arrived, arrived ? ('nach ' + (rec.at - t0).toFixed(1) + ' ms (inkl. 2 ms simuliertem Netz)') : 'nicht angekommen');
    check('Fader-Latenz unter 15 ms', arrived && rec.at - t0 < 15, arrived && (rec.at - t0).toFixed(1) + ' ms');
    // Schnelle Bewegung
    const before = (__ctl.mock.log.sets.get('/ch/06/mix/fader') || { count: 0 }).count;
    const tw = performance.now();
    for(let i = 0; i <= 100; i++){ stripUI['ch06'].fader.value = i / 100; stripUI['ch06'].fader.dispatchEvent(new Event('input', { bubbles: true })); await sleep(4); }
    await sleep(150);
    const r6 = __ctl.mock.log.sets.get('/ch/06/mix/fader');
    check('Ziehen: Endwert am Pult stimmt', Math.abs(r6.last - 1) < 1e-6, 'Pult ' + r6.last + ', Pakete ' + (r6.count - before) + ' für 101 Bewegungen in ' + Math.round(performance.now() - tw) + ' ms');

    // Mute
    stripUI['ch03'].muteBtn.click();
    await sleep(60);
    check('Mute-Taste schaltet am Pult', __ctl.mock.store.get('/ch/03/mix/on') === 0 && stripUI['ch03'].wrap.classList.contains('muted'));

    // Änderung am Pult selbst erscheint in der App
    const ts = performance.now();
    __ctl.mock.surfaceChange('/ch/08/mix/fader', 0.3);
    const seen = await waitFor(() => Math.abs(parseFloat(stripUI['ch08'].fader.value) - 0.3) < 1e-4, 500);
    check('Fader am Pult bewegt: App folgt', seen, seen ? ((performance.now() - ts).toFixed(0) + ' ms, Anzeige ' + stripUI['ch08'].dbLabel.textContent + ' dB') : '');

    // Diagnose-Fenster
    document.getElementById('status-badge').click(); await sleep(150);
    const diagText = diagOverlay ? diagOverlay.textContent : '';
    check('Diagnose-Fenster zeigt Pult, Ping und Zähler', /X32C/.test(diagText) && /Ping/.test(diagText) && /Pakete gesendet/.test(diagText) && /X32-MOCK/.test(diagText), diagText.replace(/\s+/g, ' ').slice(0, 120));
    diagOverlay.querySelector('.close-btn').click();
    check('Diagnose-Fenster lässt sich schließen', diagOverlay === null);

    // Regressionstest: Fader angeklickt (behält Fokus), danach am Pult verschoben -> App muss folgen
    const fe = stripUI['ch09'].fader; fe.focus();
    fe.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup'));
    __ctl.mock.surfaceChange('/ch/09/mix/fader', 0.25);
    const follow = await waitFor(() => Math.abs(parseFloat(fe.value) - 0.25) < 1e-4, 500);
    check('angeklickter Fader folgt weiter dem Pult (kein Fokus-Problem)', follow && document.activeElement === fe, 'Wert ' + fe.value);
    // während des Ziehens wird die Anzeige nicht vom Pult überschrieben
    fe.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fe.value = 0.9; fe.dispatchEvent(new Event('input', { bubbles: true }));
    __ctl.mock.surfaceChange('/ch/09/mix/fader', 0.1);
    await sleep(80);
    check('beim Ziehen bleibt der Schieber unter dem Finger', Math.abs(parseFloat(fe.value) - 0.9) < 1e-4, 'Wert ' + fe.value);
    window.dispatchEvent(new PointerEvent('pointerup'));

    // Ebenen
    setLayer('bus'); await sleep(400);
    check('Bus-Ebene: 16 Züge, Namen', Object.keys(stripUI).length === 16 && stripUI['bus03'].name.textContent === 'Mon 3', Object.keys(stripUI).length + ' / ' + stripUI['bus03'].name.textContent);
    setLayer('mtx'); await sleep(400);
    check('Matrix/Main: 8 Züge, Main LR mit 2 Pegelbalken', Object.keys(stripUI).length === 8 && stripUI['st'].fills.length === 2 && stripUI['mono'].fills.length === 1, Object.keys(stripUI).length + ' Züge');
    setLayer('dca'); await sleep(300);
    check('DCA: 8 Züge ohne Pegelbalken, nicht anklickbar', Object.keys(stripUI).length === 8 && stripUI['dca1'].fills.length === 0 && stripUI['dca1'].name.textContent === 'Drums');
    stripUI['dca1'].fader.value = 0.4; stripUI['dca1'].fader.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(80);
    check('DCA-Fader schreibt /dca/1/fader', Math.abs((__ctl.mock.store.get('/dca/1/fader') || 0) - 0.4) < 1e-6);
    setLayer('aux'); await sleep(300);
    check('Aux/FX: 16 Züge', Object.keys(stripUI).length === 16);

    // 6-Band-EQ am Bus
    setLayer('bus'); await sleep(300);
    openDetail(STRIP_BY_ID['bus03']);
    await waitFor(() => proc && proc.eq[5] && proc.eq[5].f !== undefined && proc.dyn.thr !== undefined, 3000);
    check('Bus 3: 6 EQ-Bänder, Band 6 = 16 kHz', proc.eq.length === 6 && Math.abs(proc.eq[5].f - 16000) < 100, proc.eq.length + ' Bänder, Band 6 ' + Math.round(proc.eq[5].f) + ' Hz');
    check('Bus 3: 6 Spalten', proc.els.eq.cols.length === 6);
    check('Bus 3: Band 1/6 haben 14 Filtertypen, Band 3 nur 6', proc.els.eq.cols[0].typeSel.options.length === 14 && proc.els.eq.cols[5].typeSel.options.length === 14 && proc.els.eq.cols[2].typeSel.options.length === 6, proc.els.eq.cols.map((c) => c.typeSel.options.length).join('/'));
    check('Bus 3: Band 1 zeigt LR12 (Typ 9)', proc.els.eq.cols[0].typeSel.value === '9', proc.els.eq.cols[0].typeSel.value);
    check('Bus 3: Kompressor-Tab vorhanden und Threshold -24', !!proc.els.tabDyn.parentElement && Math.abs(proc.dyn.thr + 24) < 0.6, 'thr ' + (proc.dyn.thr && proc.dyn.thr.toFixed(1)));
    // Ring ziehen
    const cv = proc.els.eq.canvas, rr = cv.getBoundingClientRect(), g = eqGeometry(cv);
    const b2 = proc.eq[1];
    const bx = rr.left + eqX(b2.f, g), by = rr.top + bandHandleY(b2, g);
    ptr('pointerdown', cv, bx, by);
    ptr('pointermove', cv, rr.left + eqX(1000, g), rr.top + eqY(-4, g));
    ptr('pointerup', cv, rr.left + eqX(1000, g), rr.top + eqY(-4, g));
    await sleep(120);
    const fW = __ctl.mock.store.get('/bus/03/eq/2/f'), gW = __ctl.mock.store.get('/bus/03/eq/2/g');
    check('Ring ziehen schreibt Frequenz und Gain ans Pult', Math.abs(X32V.fromWire('/bus/03/eq/2/f', fW) - 1000) < 15 && Math.abs(X32V.fromWire('/bus/03/eq/2/g', gW) + 4) < 0.3, Math.round(X32V.fromWire('/bus/03/eq/2/f', fW)) + ' Hz, ' + X32V.fromWire('/bus/03/eq/2/g', gW).toFixed(2) + ' dB');
    // Änderung am Pult während der Ansicht offen ist
    __ctl.mock.surfaceChange('/bus/03/eq/4/g', X32V.toWire('/bus/03/eq/4/g', -9).value);
    const eqSeen = await waitFor(() => proc && Math.abs(proc.eq[3].g + 9) < 0.3, 500);
    check('EQ am Pult geändert: Ansicht folgt', eqSeen, proc && proc.eq[3].g.toFixed(2));
    closeDetail();
    // Kanal mit 4 Bändern + Low Cut
    setLayer('ch'); await sleep(200);
    openDetail(STRIP_BY_ID['ch02']);
    await waitFor(() => proc && proc.misc.hpf !== undefined && proc.eq[3].f !== undefined, 3000);
    check('Kanal 2: 4 Bänder, Low Cut 44 Hz aktiv', proc.eq.length === 4 && proc.misc.hpOn === 1 && Math.round(proc.misc.hpf) === 44, proc.eq.length + ' Bänder, hpf ' + Math.round(proc.misc.hpf));
    closeDetail();
    // Aux: nur EQ, kein Kompressor-Tab
    setLayer('aux'); await sleep(200);
    openDetail(STRIP_BY_ID['aux1']); await sleep(200);
    check('Aux 1: nur EQ-Tab (kein Kompressor)', proc.els.tabDyn.parentElement === null);
    closeDetail();
    out.push(fails ? ('==> ' + fails + ' FEHLER') : '==> alle Tests bestanden');
    const pre = document.getElementById('out'); pre.style.display = 'block'; pre.textContent = out.join('\n');
    return;
  }

  // ---- Ansichten für Screenshots ----
  if(view === 'diag'){ document.getElementById('status-badge').click(); await sleep(400); }
  if(['aux', 'bus', 'mtx', 'dca'].includes(view)) setLayer(view);
  if(view.startsWith('eq-') || view.startsWith('dyn-')){
    const id = { 'eq-ch2': 'ch02', 'eq-bus3': 'bus03', 'eq-main': 'st', 'dyn-bus3': 'bus03', 'dyn-ch2': 'ch02' }[view];
    if(id.startsWith('bus')) setLayer('bus'); else if(id === 'st') setLayer('mtx');
    openDetail(STRIP_BY_ID[id]);
    await sleep(500);
    if(view.startsWith('dyn-')) setTab('dyn');
  }
  await sleep(300);
})();
