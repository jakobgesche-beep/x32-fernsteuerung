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
  if(params.get('view') === 'offline'){ return; }
  const wasOffline = document.getElementById('console').classList.contains('offline');
  const autoResults = [];
  if(params.get('test')){
    // Automatisch verbinden: aus / nichts gefunden / mehrere / genau eins
    const box = document.getElementById('auto-connect') || (() => { const c = document.createElement('input'); c.type = 'checkbox'; c.id = 'auto-connect'; document.body.appendChild(c); return c; })();
    autoResults.push(['aus', box.checked = false, await autoConnect()]);
    box.checked = true;
    window.x32API.scan = async () => [];
    autoResults.push(['leer', null, await autoConnect()]);
    window.x32API.scan = async () => [{ ip: '10.0.0.5', model: 'X32C', name: 'Bühne' }, { ip: '10.0.0.6', model: 'X32', name: 'FOH' }];
    autoResults.push(['mehrere', null, await autoConnect()]);
    const pickerShown = !!document.querySelector('.scan-row');
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    check('Auto-Verbinden: aus = nichts tun, kein Pult = Hinweis, mehrere = Auswahl', autoResults[0][2] === 'aus' && autoResults[1][2] === 'nichts gefunden' && autoResults[2][2] === 'auswahl' && pickerShown, JSON.stringify(autoResults.map((r) => r[2])));
    window.x32API.scan = async () => [{ ip: '10.0.0.5', model: 'X32C', name: 'Bühne' }];
    autoResults.push(['eins', null, await autoConnect()]);
    check('Auto-Verbinden: genau ein Pult gefunden = verbindet selbst', autoResults[3][2] === 'verbunden' && document.getElementById('ip-input').value === '10.0.0.5', autoResults[3][2]);
  } else {
    document.getElementById('ip-input').value = '10.0.0.5';
    document.getElementById('connect-btn').click();
  }
  const online = await waitFor(() => X.status().state === 'online' && X.status().progress >= 1, 10000);
  await sleep(200);
  const view = params.get('view') || 'ch';

  if(params.get('test')){
    check('verbunden und synchronisiert', online, JSON.stringify({ state: X.status().state, rtt: X.status().rtt && Math.round(X.status().rtt) }));
    check('Startzustand: Pult-Fläche gedimmt mit Hinweis, nach dem Verbinden frei', wasOffline && !document.getElementById('console').classList.contains('offline'));
    check('Status-Ampel: guter Ping ist grün', document.getElementById('status-badge').classList.contains('ping-good'), document.getElementById('status-text').textContent);
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

    // ---- Pult-Fader: Bedienung ----
    const fc = stripUI['ch10'].fader, fcap = fc.capElement;
    const fp = (type, target, y, extra) => target.dispatchEvent(new PointerEvent(type, Object.assign({ clientX: 0, clientY: y, pointerId: 1, bubbles: true }, extra || {})));
    const trav = fc.querySelector('.fader-track').getBoundingClientRect().height;
    const mockFader = () => __ctl.mock.store.get('/ch/10/mix/fader');
    fc.value = 0.5;
    check('Fader: Kappe mittig bei 0.5', Math.abs(fcap.getBoundingClientRect().top + fcap.offsetHeight / 2 - fc.yForT(0.5)) < 1.5);
    const zeroTick = fc.querySelector('.fader-tick.zero').getBoundingClientRect();
    fc.value = 0.75;
    const capRect = fcap.getBoundingClientRect();
    check('Fader: 0-dB-Marke liegt auf Höhe der Kappenmitte', Math.abs(zeroTick.top - (capRect.top + capRect.height / 2)) < 1.5, 'Abstand ' + Math.abs(zeroTick.top - (capRect.top + capRect.height / 2)).toFixed(2) + ' px');
    fp('pointerdown', fc, fc.yForT(0.4)); fp('pointerup', fc, fc.yForT(0.4));
    const cr = fcap.getBoundingClientRect();
    check('Fader: Kappe liegt nach dem Klick genau unter dem Mauszeiger', Math.abs(cr.top + cr.height / 2 - fc.yForT(0.4)) < 1.5, 'Abweichung ' + Math.abs(cr.top + cr.height / 2 - fc.yForT(0.4)).toFixed(2) + ' px');
    await sleep(120);
    check('Fader: Klick in den Schlitz springt dorthin und sendet', Math.abs(parseFloat(fc.value) - 0.4) < 0.01 && Math.abs(mockFader() - 0.4) < 0.01, 'Fader ' + fc.value + ', Pult ' + mockFader());
    fp('pointerdown', fcap, fc.yForT(0.4)); fp('pointermove', fcap, fc.yForT(0.4) - 20);
    const moved = parseFloat(fc.value);
    const cr2 = fcap.getBoundingClientRect();
    const before20 = fc.yForT(0.4);
    check('Fader: Kappe folgt dem Zeiger 1:1 beim Ziehen', Math.abs((before20 - (cr2.top + cr2.height / 2)) - 20) < 1.5, 'Kappe bewegte sich ' + (before20 - (cr2.top + cr2.height / 2)).toFixed(1) + ' px bei 20 px Zeigerbewegung');
    fp('pointerup', fcap, fc.yForT(0.4) - 20);
    check('Fader: Kappe ziehen bewegt relativ (20 px hoch)', Math.abs(moved - (0.4 + 20 / trav)) < 0.004, 'Wert ' + moved.toFixed(3) + ', erwartet ' + (0.4 + 20 / trav).toFixed(3));
    fc.value = 0.4;
    fp('pointerdown', fcap, fc.yForT(0.4), { shiftKey: true }); fp('pointermove', fcap, fc.yForT(0.4) - 100, { shiftKey: true });
    const fine = parseFloat(fc.value);
    fp('pointerup', fcap, fc.yForT(0.4) - 100, { shiftKey: true });
    check('Fader: Shift = Feineinstellung (nur ein Fünftel der Bewegung)', Math.abs(fine - (0.4 + 100 / trav * 0.2)) < 0.004, 'Wert ' + fine.toFixed(3));
    fp('pointerdown', fc, fc.yForT(0.746)); fp('pointerup', fc, fc.yForT(0.746));
    check('Fader: rastet bei 0 dB ein', parseFloat(fc.value) === 0.75, 'Wert ' + fc.value);
    fc.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    check('Fader: Mausrad nach oben erhöht', Math.abs(parseFloat(fc.value) - 0.78) < 0.002, 'Wert ' + fc.value);
    fc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    check('Fader: Pfeiltaste runter -0.01', Math.abs(parseFloat(fc.value) - 0.77) < 0.002, 'Wert ' + fc.value);
    fc.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await sleep(120);
    check('Fader: Doppelklick setzt 0 dB (Anzeige und Pult)', Math.abs(parseFloat(fc.value) - 0.75) < 1e-6 && Math.abs(mockFader() - 0.75) < 1e-6 && stripUI['ch10'].dbLabel.textContent === '0.0', stripUI['ch10'].dbLabel.textContent + ' dB');

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

    // Main-Bereich (Dock) auf jeder Ebene sichtbar und bedienbar
    const dockVisible = () => ['st', 'mono'].every((id) => { const r = dockUI[id].wrap.getBoundingClientRect(); return r.width > 50 && r.height > 100; });
    let allLayers = true;
    for (const l of ['ch', 'aux', 'bus', 'mtx', 'dca']) { setLayer(l); await sleep(60); if (!dockVisible()) allLayers = false; }
    check('Main LR und Mono sind auf jeder Ebene sichtbar', allLayers);
    dockUI['st'].fader.value = 0.6; dockUI['st'].fader.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(80);
    check('Main-Fader (Dock) schreibt /main/st/mix/fader', Math.abs((__ctl.mock.store.get('/main/st/mix/fader') || 0) - 0.6) < 1e-6);
    dockUI['mono'].muteBtn.click(); await sleep(80);
    check('Mono-Mute (Dock) schaltet am Pult', __ctl.mock.store.get('/main/m/mix/on') === 0);
    __ctl.mock.surfaceChange('/main/st/mix/on', 0);
    const seenMute = await waitFor(() => dockUI['st'].wrap.classList.contains('muted'), 400);
    check('Main-Mute am Pult gedrückt: Dock zeigt es sofort', seenMute);
    // Schnappschuss-Abos folgen der sichtbaren Ebene
    setLayer('bus'); await sleep(200);
    check('Abos für die sichtbare Ebene am Pult angemeldet (Bus)', __ctl.mock.subs.has('/xm_bus') && __ctl.mock.subs.has('/xf_bus'), Array.from(__ctl.mock.subs.keys()).join(', '));
    setLayer('ch'); await sleep(100);

    // Diagnose: erweiterte Werte und Netzwerk-Test
    document.getElementById('status-badge').click(); await sleep(150);
    const dtext = diagOverlay.textContent;
    check('Diagnose zeigt Ping-Statistik, Verlust und Schnappschüsse', /Ping \(Ø \/ 95 % \/ max\)/.test(dtext) && /Paketverlust/.test(dtext) && /Schnappschüsse/.test(dtext));
    document.getElementById('net-test-btn').click();
    const netDone = await waitFor(() => /Einzelanfragen beantwortet/.test(document.getElementById('net-test-result').textContent), 8000);
    const ntext = document.getElementById('net-test-result').textContent;
    check('Netzwerk-Test: Ergebnis mit Bewertung', netDone && /32 von 32/.test(ntext) && /Sehr gut/.test(ntext), ntext.replace(/\s+/g, ' ').slice(0, 130));
    diagOverlay.querySelector('.close-btn').click();

    // Regressionstest: Fader angeklickt (behält Fokus), danach am Pult verschoben -> App muss folgen
    const fe = stripUI['ch09'].fader; fe.focus();
    fe.capElement.dispatchEvent(new PointerEvent('pointerdown', { clientY: fe.yForT(parseFloat(fe.value)), pointerId: 1, bubbles: true }));
    fe.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    __ctl.mock.surfaceChange('/ch/09/mix/fader', 0.25);
    const follow = await waitFor(() => Math.abs(parseFloat(fe.value) - 0.25) < 1e-4, 500);
    check('angeklickter Fader folgt weiter dem Pult (kein Fokus-Problem)', follow && document.activeElement === fe, 'Wert ' + fe.value);
    // während des Ziehens wird die Anzeige nicht vom Pult überschrieben
    fe.capElement.dispatchEvent(new PointerEvent('pointerdown', { clientY: fe.yForT(parseFloat(fe.value)), pointerId: 1, bubbles: true }));
    fe.value = 0.9; fe.dispatchEvent(new Event('input', { bubbles: true }));
    __ctl.mock.surfaceChange('/ch/09/mix/fader', 0.1);
    await sleep(80);
    check('beim Ziehen bleibt der Schieber unter dem Finger', Math.abs(parseFloat(fe.value) - 0.9) < 1e-4, 'Wert ' + fe.value);
    fe.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));

    // Ebenen
    setLayer('bus'); await sleep(400);
    check('Bus-Ebene: 16 Züge, Namen', Object.keys(stripUI).length === 16 && stripUI['bus03'].name.textContent === 'Mon 3', Object.keys(stripUI).length + ' / ' + stripUI['bus03'].name.textContent);
    setLayer('mtx'); await sleep(400);
    check('Matrix: 6 Züge; Main LR (2 Pegelbalken) und Mono fest im rechten Bereich', Object.keys(stripUI).length === 6 && dockUI['st'].fills.length === 2 && dockUI['mono'].fills.length === 1, Object.keys(stripUI).length + ' Züge, Dock: ' + Object.keys(dockUI).join(','));
    setLayer('dca'); await sleep(300);
    check('DCA: 8 Züge ohne Pegelbalken', Object.keys(stripUI).length === 8 && stripUI['dca1'].fills.length === 0 && stripUI['dca1'].name.textContent === 'Drums');
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
    // Kanal bearbeiten: Name, Farbe, Icon
    setLayer('ch'); await sleep(200);
    openDetail(STRIP_BY_ID['ch01']); await sleep(150);
    check('Kanal 1: Reiter EQ, Kompressor und Kanal vorhanden', proc.els.tabEq.parentElement && proc.els.tabDyn.parentElement && proc.els.tabCfg.parentElement);
    setTab('cfg');
    const cf = proc.els.cfg;
    cf.nameInput.focus(); cf.nameInput.value = 'Bühne 1 Lead-Sänger'; cf.nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    check('Name: Umlaute ersetzt, auf 12 Zeichen gekürzt, am Pult angekommen', __ctl.mock.store.get('/ch/01/config/name') === 'Buehne 1 Lea' && cf.nameInput.value === 'Buehne 1 Lea', 'Pult: ' + __ctl.mock.store.get('/ch/01/config/name'));
    check('Streifen im Hintergrund zeigt den neuen Namen sofort', stripUI['ch01'].name.textContent === 'Buehne 1 Lea');
    check('Namensschild in der Ansicht aktualisiert sich', proc.els.chip.textContent.includes('Buehne 1 Lea'));
    cf.colorBtns[4].click(); await sleep(80);
    check('Farbe Blau (4) am Pult gesetzt und im Streifen sichtbar', __ctl.mock.store.get('/ch/01/config/color') === 4 && getComputedStyle(stripUI['ch01'].icon.parentElement).backgroundColor === 'rgb(76, 124, 224)', getComputedStyle(stripUI['ch01'].icon.parentElement).backgroundColor);
    cf.colorBtns[9].click(); await sleep(80);
    check('Farbe "invers" (9) wird als Umrandung dargestellt', __ctl.mock.store.get('/ch/01/config/color') === 9 && getComputedStyle(stripUI['ch01'].icon.parentElement).backgroundColor === 'rgba(0, 0, 0, 0)');
    cf.iconBtns[8].click(); await sleep(80);
    check('Icon Hi-Hat (9) am Pult gesetzt', __ctl.mock.store.get('/ch/01/config/icon') === 9 && stripUI['ch01'].icon.innerHTML.includes('<svg'), 'Pult: ' + __ctl.mock.store.get('/ch/01/config/icon'));
    check('Auswahl im Icon-Raster markiert', cf.iconBtns[8].classList.contains('on') && cf.iconBtns.filter((b) => b.classList.contains('on')).length === 1);
    const filterEl = proc.els.cfg.page.querySelector('.cfg-filter');
    filterEl.value = 'snare'; filterEl.dispatchEvent(new Event('input', { bubbles: true }));
    check('Icon-Suche: "snare" zeigt 2 Icons', cf.iconBtns.filter((b) => !b.hidden).length === 2, cf.iconBtns.filter((b) => !b.hidden).length + ' sichtbar');
    filterEl.value = ''; filterEl.dispatchEvent(new Event('input', { bubbles: true }));
    // Name wird am Pult geändert, Feld nicht im Fokus -> Anzeige folgt
    cf.nameInput.blur();
    __ctl.mock.surfaceChange('/ch/01/config/name', 'VomPult');
    const nameSeen = await waitFor(() => cf.nameInput.value === 'VomPult' && stripUI['ch01'].name.textContent === 'VomPult', 500);
    check('Name am Pult geändert: Feld und Streifen folgen', nameSeen);
    closeDetail();
    // DCA: nur Kanal-Reiter
    setLayer('dca'); await sleep(200);
    stripUI['dca1'].wrap.querySelector('.strip-plate').click(); await sleep(150);
    check('DCA 1: öffnet Ansicht nur mit Reiter "Kanal"', proc && proc.tab === 'cfg' && !proc.els.tabEq.parentElement && !proc.els.tabDyn.parentElement && proc.els.tabCfg.parentElement);
    proc.els.cfg.nameInput.value = 'Schlagzeug'; proc.els.cfg.nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    check('DCA-Name wird an /dca/1/config/name gesendet', __ctl.mock.store.get('/dca/1/config/name') === 'Schlagzeug', __ctl.mock.store.get('/dca/1/config/name'));
    closeDetail();

    // Aux: nur EQ, kein Kompressor-Tab
    setLayer('aux'); await sleep(200);
    openDetail(STRIP_BY_ID['aux1']); await sleep(200);
    check('Aux 1: nur EQ-Tab (kein Kompressor)', proc.els.tabDyn.parentElement === null);
    closeDetail();
    // Spitzenwert-Marke und Übersteuerungs-Lampe
    setLayer('ch'); await sleep(200);
    const c1 = stripUI['ch01'], m1 = STRIP_BY_ID['ch01'].meter;
    const frame = (v) => { const f = new Float32Array(70); f[m1.idx[0]] = v; __ctl.emitMeter(m1.stream, f); };
    frame(0.5);
    check('Meter: Spitzenwert-Marke sichtbar bei -6 dB (Mitte)', c1.peakEls[0].style.opacity === '1' && Math.abs(parseFloat(c1.peakEls[0].style.top) - (100 - levelToPct(0.5))) < 1.5, c1.peakEls[0].style.top);
    check('Meter: bei normalem Pegel keine Übersteuerungs-Lampe', !c1.clipEl.classList.contains('on'));
    frame(1.0);
    check('Meter: Übersteuerung (0 dBFS) schaltet die rote Lampe an', c1.clipEl.classList.contains('on'));
    frame(0.1); frame(0.1);
    check('Meter: Lampe bleibt an, Spitzenwert-Marke bleibt kurz oben', c1.clipEl.classList.contains('on') && parseFloat(c1.peakEls[0].style.top) < 5, c1.peakEls[0].style.top);
    c1.clipEl.click();
    check('Meter: Klick auf die Lampe setzt sie zurück', !c1.clipEl.classList.contains('on') && !c1.clipped);
    check('Meter: Kanalzüge ohne Meter (DCA) haben keine Lampe', !STRIP_BY_ID['dca1'].meter);

    // Szenen: speichern, verändern, laden, rückgängig
    try { localStorage.removeItem('x32.scenes'); localStorage.removeItem('x32.scenes.backup'); } catch(e){}
    const st = __ctl.mock.store;
    document.querySelector('.layer-tab[data-layer="scenes"]').click(); await sleep(150);
    check('Szenen: Fenster öffnet sich, noch leer', !!document.getElementById('scenes-overlay') && /Noch keine Szenen/.test(document.getElementById('scenes-overlay').textContent));
    X.setWire('/ch/01/mix/fader', 'f', 0.5); X.setWire('/ch/03/mix/on', 'i', 0); X.setWire('/bus/02/mix/fader', 'f', 0.6); await sleep(300);
    const ov = document.getElementById('scenes-overlay');
    ov.querySelector('.scene-name').value = 'Soundcheck'; ov.querySelector('.scene-labels').checked = true;
    ov.querySelector('.scene-save-btn').click(); await sleep(100);
    check('Szenen: gespeichert und in der Liste mit Name und Anzahl', /Soundcheck/.test(ov.textContent) && /Kanalzüge · mit Beschriftung/.test(ov.textContent), ov.querySelector('.scene-meta') && ov.querySelector('.scene-meta').textContent);
    const saved = Scenes.list()[0];
    check('Szenen: Stand enthält Fader, Mute und Namen', saved.data.ch01.f === 0.5 && saved.data.ch03.on === 0 && saved.data.bus02.f === 0.6 && typeof saved.data.ch02.n === 'string' && saved.count > 60, JSON.stringify({ f: saved.data.ch01, count: saved.count }));
    X.setWire('/ch/01/mix/fader', 'f', 0.9); X.setWire('/ch/03/mix/on', 'i', 1); X.setWire('/ch/02/config/name', 's', 'Anders'); await sleep(300);
    ov.querySelector('.scene-actions .btn').click(); await sleep(100);
    check('Szenen: "Laden" fragt vorher nach und nennt die Zahl der Änderungen', /Werte am Pult ändern/.test(ov.querySelector('.scene-actions').textContent) && /3 Werte/.test(ov.querySelector('.scene-actions').textContent), ov.querySelector('.scene-actions').textContent);
    ov.querySelector('.scene-actions .btn').click();       // "Ja, laden"
    await waitFor(() => st.get('/ch/01/mix/fader') === 0.5 && st.get('/ch/03/mix/on') === 0 && st.get('/ch/02/config/name') === 'Kick Out', 4000);
    check('Szenen: Laden stellt Fader, Mute und Namen am (simulierten) Pult wieder her', Math.abs(st.get('/ch/01/mix/fader') - 0.5) < 0.01 && st.get('/ch/03/mix/on') === 0 && st.get('/ch/02/config/name') === 'Kick Out', st.get('/ch/01/mix/fader') + ' / ' + st.get('/ch/03/mix/on') + ' / ' + st.get('/ch/02/config/name'));
    check('Szenen: Anzeige in der App folgt', stripUI['ch01'] && Math.abs(parseFloat(stripUI['ch01'].fader.value) - 0.5) < 0.01);
    check('Szenen: "Rückgängig" wird angeboten', /Rückgängig/.test(ov.textContent) && !!Scenes.list().length);
    await sleep(100); Array.from(ov.querySelectorAll('.scene-undo button')).forEach((b) => b.click());
    await waitFor(() => Math.abs(st.get('/ch/01/mix/fader') - 0.9) < 0.01 && st.get('/ch/03/mix/on') === 1, 4000);
    check('Szenen: Rückgängig bringt den Stand vor dem Laden zurück', Math.abs(st.get('/ch/01/mix/fader') - 0.9) < 0.01 && st.get('/ch/03/mix/on') === 1 && st.get('/ch/02/config/name') === 'Anders', st.get('/ch/01/mix/fader') + ' / ' + st.get('/ch/03/mix/on') + ' / ' + st.get('/ch/02/config/name'));
    Scenes.render(); const delBtn = Array.from(ov.querySelectorAll('.scene-actions .btn')).find((b) => /Löschen/.test(b.textContent)); delBtn.click(); await sleep(50);
    Array.from(ov.querySelectorAll('.scene-actions .btn')).find((b) => /Ja, löschen/.test(b.textContent)).click(); await sleep(100);
    check('Szenen: Löschen (mit Rückfrage) entfernt die Szene', Scenes.list().length === 0);
    Scenes.close(); check('Szenen: Fenster schließt', !document.getElementById('scenes-overlay'));

    // "Neu in dieser Version"
    try { localStorage.removeItem('x32.seenVersion'); } catch(e){}
    maybeShowChangelog('2.5.0');
    const shown = !!document.getElementById('changelog-overlay') && document.querySelectorAll('.changelog-item').length >= 4;
    document.getElementById('changelog-overlay').querySelector('button').click();
    maybeShowChangelog('2.5.0');
    check('Neu-in-Version: erscheint einmal mit Liste, nach "Verstanden" nicht wieder', shown && !document.getElementById('changelog-overlay'));
    maybeShowChangelog('9.9.9');
    check('Neu-in-Version: unbekannte Version zeigt nichts', !document.getElementById('changelog-overlay'));

    // Messung: eigener Reiter neben den Ebenen, funktioniert ohne Pult-Bedienung
    const mTab = document.querySelector('.layer-tab.measure-tab');
    check('Reiter "Messung" neben den Pult-Ebenen', !!mTab && mTab.textContent === 'Messung');
    mTab.click(); await sleep(300);
    check('Messung: Pult-Fläche ausgeblendet, Messung sichtbar, Reiter markiert', document.getElementById('console').hidden && !document.getElementById('measure').hidden && mTab.classList.contains('on') && !document.querySelector('.layer-tab[data-layer="ch"]').classList.contains('on'));
    check('Messung: Zugriff verweigert -> Hinweis mit Systemeinstellungen-Knopf', /ausgeschaltet/.test(document.getElementById('m-notice').textContent) && /Systemeinstellungen/.test(document.getElementById('m-notice').textContent), document.getElementById('m-notice').textContent.slice(0, 60));
    check('Messung: REW nicht gefunden -> Hinweis und Download-Knopf', /nicht gefunden/.test(document.getElementById('m-rew-info').textContent) && document.getElementById('m-rew-open').hidden && !document.getElementById('m-rew-dl').hidden, document.getElementById('m-rew-info').textContent.slice(0, 50));
    document.querySelector('.layer-tab[data-layer="bus"]').click(); await sleep(300);
    check('zurück zum Pult: Messung ausgeblendet, Ebene "Bus" aktiv, Fader sichtbar', !document.getElementById('console').hidden && document.getElementById('measure').hidden && document.querySelector('.layer-tab[data-layer="bus"]').classList.contains('on') && !!document.querySelector('.strip'));
    out.push(fails ? ('==> ' + fails + ' FEHLER') : '==> alle Tests bestanden');
    const pre = document.getElementById('out'); pre.style.display = 'block'; pre.textContent = out.join('\n');
    return;
  }

  // ---- Ansichten für Screenshots ----
  if(view === 'diag'){ document.getElementById('status-badge').click(); await sleep(400); }
  if(view === 'nettest'){ document.getElementById('status-badge').click(); await sleep(200); document.getElementById('net-test-btn').click(); await sleep(4500); }
  if(['aux', 'bus', 'mtx', 'dca'].includes(view)) setLayer(view);
  if(view.startsWith('eq-') || view.startsWith('dyn-') || view.startsWith('cfg-')){
    const id = { 'cfg-ch1': 'ch01', 'eq-ch2': 'ch02', 'eq-bus3': 'bus03', 'eq-main': 'st', 'dyn-bus3': 'bus03', 'dyn-ch2': 'ch02' }[view];
    if(id.startsWith('bus')) setLayer('bus');
    openDetail(STRIP_BY_ID[id]);
    await sleep(500);
    if(view.startsWith('dyn-')) setTab('dyn');
    if(view === 'cfg-ch1') setTab('cfg');
  }
  await sleep(300);
})();
