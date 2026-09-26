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
  if(params.get('view') === 'ipmig'){
    const v = document.getElementById('ip-input').value;
    check('Gespeicherte Adresse (' + params.get('seedip') + (params.get('seedok') ? ', hat schon funktioniert' : '') + ') -> Feld zeigt "' + v + '"', v === (params.get('want') || ''), 'Feld: "' + v + '"');
    check('Platzhalter im Feld ist keine erfundene Adresse mehr (kein 192.168.0.64), sondern ein Hinweis', !/192\.168\.0\.64/.test(document.getElementById('ip-input').placeholder) && /IP des Pults/.test(document.getElementById('ip-input').placeholder));
    const pre = document.getElementById('out'); pre.style.display = 'block'; pre.textContent = out.join('\n') + '\n' + (fails ? '==> ' + fails + ' FEHLER' : '==> alle Tests bestanden');
    return;
  }
  if(params.get('view') === 'winhelp'){
    // Windows: Wörter ("Computer" statt "Mac"), keine macOS-Hilfen, Firewall-Knopf (?plat=win32 erzwingt Windows in den Attrappen)
    const $ = (s) => document.querySelector(s), $$ = (s) => Array.from(document.querySelectorAll(s)), C = window.__calls;
    check('Betriebssystem Windows erkannt (X32PLAT), Wörter "Computer" und "Einstellungen"', X32PLAT.isWin === true && X32PLAT.isMac === false && X32PLAT.pc === 'Computer' && X32PLAT.settings === 'Einstellungen');
    check('Startbildschirm: "Computer und X32 müssen im selben Netzwerk sein" (nicht "Mac"), macOS-Warnung versteckt', /^Computer und X32 müssen im selben Netzwerk sein/.test($('#connect-hint p').textContent) && $('#net-warning').hidden === true, $('#connect-hint p').textContent.slice(0, 60));
    check('Kurztexte der Verbindungshilfe nennen den Computer und die Windows-Firewall, kein macOS', ConnectHelp.SHORT.subnet.startsWith('Computer und Pult') && ConnectHelp.SHORT['no-network'] === 'Der Computer ist mit keinem Netzwerk verbunden.' && /Windows-Firewall/.test(ConnectHelp.SHORT['maybe-blocked']) && !/Mac/.test(ConnectHelp.SHORT.subnet + ConnectHelp.SHORT['no-network']));
    window.__diagResult = { checks: [{ id: 'net', level: 'ok', title: 'Netzwerk des Computers', detail: '192.168.178.44 (Netz 192.168.178.0/24, Ethernet)' }],
      verdict: { id: 'maybe-blocked', level: 'warn', title: 'Das Gerät ist erreichbar, aber es kommt nichts zurück', text: 'Sehr wahrscheinlich blockiert die Windows-Firewall die Antworten.', steps: ['Beim ersten Start fragt Windows …', 'Windows-Sicherheit → Firewall …'], actions: [{ id: 'open-firewall', label: 'Firewall-Einstellungen öffnen' }, { id: 'scan', label: 'Pult im Netz suchen' }] }, info: { command: null } };
    document.getElementById('ip-input').value = '192.168.178.60'; $('#cp-help').click(); await sleep(150);
    check('Verbindungshilfe unter Windows: Urteil, Knopf "Firewall-Einstellungen öffnen" (kein "Systemeinstellungen", kein Terminal-Test)', /Windows-Firewall/.test($('.net-verdict').textContent) && $$('#help-actions button').map((b) => b.textContent).join('|') === 'Firewall-Einstellungen öffnen|Pult im Netz suchen');
    $$('#help-actions button')[0].click(); await sleep(30);
    check('Knopf "Firewall-Einstellungen öffnen" ruft das Hauptprogramm (openFirewall), nicht die macOS-Einstellungen', C.openFirewall === 1 && C.openPrivacy === 0 && !!$('#help-overlay'));
    check('Protokoll-Knopf heißt "Im Explorer zeigen"', /Im Explorer zeigen/.test($('#help-open-log').textContent), $('#help-open-log').textContent);
    $('.close-btn').click();
    const pre = document.getElementById('out'); pre.style.display = 'block'; pre.textContent = out.join('\n') + '\n' + (fails ? '==> ' + fails + ' FEHLER' : '==> alle Tests bestanden');
    return;
  }
  if(params.get('view') === 'connhelp'){
    const $ = (s) => document.querySelector(s), $$ = (s) => Array.from(document.querySelectorAll(s));
    const C = window.__calls, ipIn = $('#ip-input'), toastText = () => $$('.toast').map((t) => t.textContent).join(' | ');
    const clearToasts = () => $$('.toast').forEach((t) => t.remove());
    const verdicts = {
      subnet: { checks: [{ id: 'net', level: 'ok', title: 'Netzwerk des Macs', detail: '192.168.178.81 (Netz 192.168.178.0/24, en0)' }, { id: 'subnet', level: 'fail', title: 'Gleiches Netz wie der Mac', detail: 'nein' }],
        verdict: { id: 'subnet', level: 'fail', title: 'Pult und Mac sind in verschiedenen Netzen', text: 'Der Mac hängt im Netz 192.168.178.0/24. Die Pult-Adresse 10.0.0.5 liegt nicht in diesem Netz.', steps: ['Mac und Pult an denselben Router.', 'Am Pult SETUP → NETWORK ansehen.'], actions: [{ id: 'scan', label: 'Pult im Netz suchen' }, { id: 'retry', label: 'Nochmal prüfen' }] }, info: { command: 'sudo defaults write x', gateway: '192.168.178.1', ifaces: [] } },
      maybe: { checks: [], verdict: { id: 'maybe-blocked', level: 'warn', title: 'Das Gerät ist erreichbar, aber es kommt nichts zurück', text: 'Wahrscheinlich blockiert macOS.', steps: ['Systemeinstellungen öffnen.'], actions: [{ id: 'open-privacy', label: 'Systemeinstellungen öffnen' }, { id: 'terminal-test', label: 'Vergleichstest über Terminal' }, { id: 'copy-command', label: 'Notlösung: Befehl kopieren' }] }, info: { command: 'sudo defaults write com.apple.network.local-network AllowedWiFiLocalNetworkAddresses -array "10.0.0.0/24"', gateway: '10.0.0.1', ifaces: [] } },
      blocked: { checks: [], verdict: { id: 'app-blocked', level: 'fail', title: 'macOS blockiert diese App', text: 'Das Pult antwortet dem Terminal, aber nicht dieser App.', steps: [], actions: [{ id: 'open-privacy', label: 'Systemeinstellungen öffnen' }] }, info: { command: 'sudo x', ifaces: [] } },
    };
    const st = (o) => Object.assign({ state: 'connecting', progress: 1, target: '10.0.0.5', waitMs: 0, noReply: false, stats: {} }, o);

    // --- Eingabe ---
    window.__diagResult = { checks: [], verdict: { id: 'bad-ip', level: 'fail', title: 'Die IP-Adresse stimmt nicht', text: 'Es ist noch keine IP-Adresse eingetragen.', steps: [], actions: [] }, info: {} };
    ipIn.value = ''; $('#connect-btn').click(); await sleep(150);
    check('Leeres Feld + "Verbinden": nichts wird geraten (kein connect), stattdessen Hinweis und Suche im Netz; findet die Suche nichts, öffnet die Hilfe', C.connect.length === 0 && C.scan === 1 && /Keine IP-Adresse eingetragen/.test(toastText()) && !!$('#help-overlay') && /noch keine IP-Adresse/.test($('.net-verdict').textContent), 'connect=' + C.connect.length + ' scan=' + C.scan + ' ' + toastText());
    $('.close-btn').click(); clearToasts(); window.__connectResult = { ok: false, error: 'Die Adresse „abc“ ist keine gültige IP-Adresse.' };
    ipIn.value = 'abc'; $('#connect-btn').click(); await sleep(80);
    check('Ungültige Adresse: Meldung des Programms erscheint als Hinweis, Anzeige bleibt "nicht verbunden"', /keine gültige IP/.test(toastText()) && document.getElementById('status-text').textContent === 'nicht verbunden' && C.connect[C.connect.length - 1] === 'abc', toastText());
    window.__connectResult = null;

    // --- Warnung: macOS blockiert das lokale Netzwerk ---
    check('Ohne Sperre ist die Warnung im Startbildschirm versteckt', $('#net-warning').hidden === true);
    window.__netAccess = { blocked: true, error: 'EHOSTUNREACH' }; await recheckNetAccess(true);
    check('Bei Sperre: Warnung mit Klartext und zwei Knöpfen sichtbar', !$('#net-warning').hidden && /macOS blockiert diese App im lokalen Netzwerk/.test($('#net-warning').textContent) && getComputedStyle($('#net-warning')).display !== 'none');
    $('#nw-open').click(); await sleep(20);
    check('Knopf „Systemeinstellungen öffnen“ öffnet Datenschutz → Lokales Netzwerk', C.openPrivacy === 1);
    $('#nw-help').click(); await sleep(150);
    check('Knopf „Was tun?“ öffnet die Verbindungshilfe', !!$('#help-overlay')); $('.close-btn').click();
    const n0 = C.netAccess; window.__netAccess = { blocked: false }; window.dispatchEvent(new Event('focus')); await sleep(60);
    check('Kommt der Nutzer aus den Systemeinstellungen zurück (Fenster bekommt den Fokus), wird neu geprüft und die Warnung verschwindet', C.netAccess === n0 + 1 && $('#net-warning').hidden === true);
    window.__netAccessCb({ blocked: true }); await sleep(20);
    check('Meldet das Hauptprogramm beim Start eine Sperre, erscheint die Warnung von selbst', $('#net-warning').hidden === false);
    window.__netAccessCb({ blocked: false }); await sleep(20);
    C.openPrivacy = 0;

    // --- Wartebanner und Statuszeile ---
    updateStatus(st({ waitMs: 1000 })); await sleep(20);
    check('Verbinden: Banner über dem Pult "Verbinde mit 10.0.0.5 …", Statuszeile gelb', $('#console').classList.contains('waiting') && $('#cp-title').textContent === 'Verbinde mit 10.0.0.5 …' && $('#status-text').textContent === 'Verbinde mit 10.0.0.5 …' && $('#status-badge').classList.contains('warn') && getComputedStyle($('#connect-progress')).display !== 'none');
    updateStatus(st({ waitMs: 3200 }));
    check('Nach 3 Sekunden zeigt die Statuszeile die Wartezeit', /Verbinde mit 10\.0\.0\.5 … 3 s/.test($('#status-text').textContent), $('#status-text').textContent);
    updateStatus(st({ waitMs: 7000, noReply: true, diag: 'subnet' }));
    check('Nach der Frist: "Keine Antwort vom Pult" in Banner und Statuszeile (rot), Ursache in einem Satz, Knopf "Hilfe" hervorgehoben', $('#cp-title').textContent === 'Keine Antwort vom Pult' && $('#status-text').textContent === 'Keine Antwort vom Pult' && $('#status-badge').classList.contains('bad') && $('#cp-text').textContent === ConnectHelp.SHORT.subnet && !$('#cp-help').classList.contains('secondary') && $('#connect-progress').classList.contains('bad'));
    updateStatus({ state: 'lost', progress: 1, target: '10.0.0.5', waitMs: 2000, stats: {} });
    check('Verbindung kurz weg (unter 4 s): kein Banner, nur die Statuszeile', !$('#console').classList.contains('waiting') && /verloren/.test($('#status-text').textContent));
    updateStatus({ state: 'lost', progress: 1, target: '10.0.0.5', waitMs: 6000, stats: {} });
    check('Verbindung länger als 4 s weg: Banner "Verbindung verloren – suche wieder …"', $('#console').classList.contains('waiting') && /suche wieder/.test($('#cp-title').textContent));
    updateStatus({ state: 'online', progress: 1, target: '10.0.0.5', info: { model: 'X32C' }, stats: {}, rtt: 5 });
    check('Online: Banner verschwindet; die Adresse wird als "hat funktioniert" gemerkt', !$('#console').classList.contains('waiting') && localStorage.getItem('x32-ip-ok') === '10.0.0.5');
    updateStatus({ state: 'idle', progress: 1 });

    // --- Hilfe-Fenster ---
    window.__diagResult = verdicts.subnet;
    updateStatus(st({ waitMs: 7000, noReply: true, diag: 'subnet' })); ipIn.value = '10.0.0.5';
    const d0 = C.diagnose.length;
    $('#cp-help').click(); await sleep(120);
    check('Hilfe öffnet, Adresse aus dem Feld ist eingetragen, die Ursachensuche läuft sofort', !!$('#help-overlay') && $('#help-ip').value === '10.0.0.5' && C.diagnose.length === d0 + 1 && C.diagnose[d0][0] === '10.0.0.5');
    check('Urteil in Klartext (rot): Titel, Erklärung, nummerierte Schritte', /verschiedenen Netzen/.test($('.net-verdict').textContent) && $('.net-verdict').classList.contains('bad') && $$('.help-steps li').length === 2);
    check('Knöpfe passend zur Ursache: "Pult im Netz suchen" hervorgehoben, "Nochmal prüfen"', $$('#help-actions button').map((b) => b.textContent).join('|') === 'Pult im Netz suchen|Nochmal prüfen' && !$$('#help-actions button')[0].classList.contains('secondary'));
    check('Prüfpunkte im Einzelnen sind aufklappbar und benennen jeden Punkt mit Stufe (OK/FEHLT)', $$('.help-det')[0].textContent.includes('OK · Netzwerk des Macs') && $$('.help-det')[0].textContent.includes('FEHLT · Gleiches Netz wie der Mac'));
    $('#help-ip').value = '192.168.178.60'; $('#help-check').click(); await sleep(80);
    check('Adresse ändern und "Prüfen": neue Ursachensuche mit der neuen Adresse', C.diagnose.length === d0 + 2 && C.diagnose[d0 + 1][0] === '192.168.178.60');
    window.__scanResult = { results: [{ ip: '10.0.0.5', model: 'X32C', name: 'A' }, { ip: '10.0.0.6', model: 'X32', name: 'B' }], ifaces: [] };
    const scanBefore = C.scan; $$('#help-actions button')[0].click(); await sleep(120);
    check('Knopf "Pult im Netz suchen": Fenster zu, Suche gestartet (Auswahlliste der gefundenen Pulte)', !$('#help-overlay') && C.scan === scanBefore + 1 && $$('.scan-row').length === 2);
    $$('.overlay').forEach((o) => o.remove()); clearToasts(); C.connect.length = 0;
    $('#cp-help').click(); await sleep(100); window.__connectResult = { ok: true, ip: '10.0.0.5' }; $$('#help-actions button')[1].click(); await sleep(60);
    check('Knopf "Nochmal prüfen": Fenster zu, Verbinden mit der Adresse im Fenster', !$('#help-overlay') && C.connect.length === 1 && C.connect[0] === '10.0.0.5', JSON.stringify(C.connect));
    window.__connectResult = null;

    window.__diagResult = (ip, opts) => (opts && opts.terminal && opts.terminal.replied ? verdicts.blocked : verdicts.maybe);
    $('#cp-help').click(); await sleep(100);
    check('Stumme Sperre: gelb, Knöpfe Einstellungen / Vergleichstest / Notlösung', $('.net-verdict').classList.contains('mid') && $$('#help-actions button').map((b) => b.textContent).join('|') === 'Systemeinstellungen öffnen|Vergleichstest über Terminal|Notlösung: Befehl kopieren');
    $$('#help-actions button')[0].click(); await sleep(30);
    check('Knopf "Systemeinstellungen öffnen": öffnet Datenschutz → Lokales Netzwerk, Fenster bleibt offen', C.openPrivacy === 1 && !!$('#help-overlay'));
    $$('#help-actions button')[2].click(); await sleep(60);
    check('Knopf "Notlösung: Befehl kopieren": Befehl mit Netz und Erklärung (Terminal, Passwort, Neustart) steht im Fenster', /AllowedWiFiLocalNetworkAddresses -array "10\.0\.0\.0\/24"/.test($('#help-extra').textContent) && /Mac neu starten/.test($('#help-extra').textContent));
    $$('#help-actions button')[1].click(); await sleep(200);
    check('Vergleichstest über Terminal: Test läuft, danach neue Ursachensuche MIT dem Ergebnis, Urteil "macOS blockiert diese App"', C.terminal.length === 1 && C.diagnose[C.diagnose.length - 1][1].terminal.replied === true && /macOS blockiert diese App/.test($('.net-verdict').textContent) && $('.net-verdict').classList.contains('bad'), JSON.stringify(C.diagnose[C.diagnose.length - 1][1]));
    const logBox = $('#help-logbox'); logBox.open = true; await sleep(150);
    check('Protokoll aufklappen: zeigt das Protokoll aus dem Hauptprogramm', /Zeile 1: Verbinden mit 10\.0\.0\.5/.test($('#help-log').textContent));
    $('#help-open-log').click(); await sleep(20);
    check('"Im Finder zeigen" öffnet den Protokoll-Ordner', C.openLog === 1);
    $('.close-btn').click();
    check('Fenster schließt', !$('#help-overlay'));

    // --- Suche ---
    updateStatus({ state: 'idle', progress: 1 }); clearToasts(); ipIn.value = '10.0.0.9'; window.__diagResult = verdicts.subnet;
    window.__scanResult = { results: [], ifaces: [{ name: 'en0', network: '192.168.178.0', prefix: 24 }, { name: 'en7', network: '10.0.0.0', prefix: 24 }] };
    $('#scan-btn').click(); await sleep(200);
    check('Suche ohne Ergebnis: Hinweis nennt die durchsuchten Netze, Hilfe-Fenster öffnet von selbst mit der eingetragenen Adresse', /Durchsucht: 192\.168\.178\.0\/24 \(en0\), 10\.0\.0\.0\/24 \(en7\)/.test(toastText()) && !!$('#help-overlay') && $('#help-ip').value === '10.0.0.9', toastText());
    $('.close-btn').click(); clearToasts();
    window.__scanResult = { results: [], ifaces: [] }; $('#scan-btn').click(); await sleep(120); $('.close-btn') && $('.close-btn').click();
    check('Suche ohne Netzwerk: klare Meldung "mit keinem Netzwerk verbunden"', /mit keinem Netzwerk verbunden/.test(toastText()), toastText());
    clearToasts(); window.__connectResult = { ok: true, ip: '10.0.0.5' }; C.connect.length = 0;
    window.__scanResult = { results: [{ ip: '10.0.0.5', model: 'X32C', name: 'Bühne', version: '4.06' }], ifaces: [] }; $('#scan-btn').click(); await sleep(150);
    check('Suche findet genau ein Pult: verbindet selbst und sagt es', C.connect[0] === '10.0.0.5' && /Pult gefunden: X32C bei 10\.0\.0\.5/.test(toastText()), JSON.stringify(C.connect) + toastText());
    window.__scanResult = { results: [{ ip: '10.0.0.5', model: 'X32C', name: 'Bühne' }, { ip: '10.0.0.6', model: 'X32', name: 'FOH' }], ifaces: [] }; $('#scan-btn').click(); await sleep(150);
    check('Suche findet mehrere Pulte: Auswahlliste mit Adresse, Name und Modell', $$('.scan-row').length === 2 && /10\.0\.0\.6/.test($$('.scan-row')[1].textContent));
    $$('.overlay').forEach((o) => o.remove());

    const pre = document.getElementById('out'); pre.style.display = 'block'; pre.textContent = out.join('\n') + '\n' + (fails ? '==> ' + fails + ' FEHLER' : '==> alle Tests bestanden');
    return;
  }
  const wasOffline = document.getElementById('console').classList.contains('offline');
  const autoResults = [];
  if(params.get('test')){
    // Automatisch verbinden: aus / nichts gefunden / mehrere / genau eins
    const box = document.getElementById('auto-connect') || (() => { const c = document.createElement('input'); c.type = 'checkbox'; c.id = 'auto-connect'; document.body.appendChild(c); return c; })();
    autoResults.push(['aus', box.checked = false, await autoConnect()]);
    box.checked = true;
    window.x32API.scan = async () => ({ results: [], ifaces: [] });
    autoResults.push(['leer', null, await autoConnect()]);
    window.x32API.scan = async () => ({ results: [{ ip: '10.0.0.5', model: 'X32C', name: 'Bühne' }, { ip: '10.0.0.6', model: 'X32', name: 'FOH' }], ifaces: [] });
    autoResults.push(['mehrere', null, await autoConnect()]);
    const pickerShown = !!document.querySelector('.scan-row');
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    check('Auto-Verbinden: aus = nichts tun, kein Pult = Hinweis, mehrere = Auswahl', autoResults[0][2] === 'aus' && autoResults[1][2] === 'nichts gefunden' && autoResults[2][2] === 'auswahl' && pickerShown, JSON.stringify(autoResults.map((r) => r[2])));
    window.x32API.scan = async () => ({ results: [{ ip: '10.0.0.5', model: 'X32C', name: 'Bühne' }], ifaces: [] });
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
    check('Kanal 2: Name, Icon, Farbe aus dem Pult', u2 && u2.name.textContent === 'Kick Out' && u2.icon.innerHTML.includes('<svg') && u2.strip && u2.wrap.style.getPropertyValue('--cap-line') !== '', u2 && u2.name.textContent);
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
    check('Farbe Blau (4) am Pult gesetzt und im Streifen sichtbar', __ctl.mock.store.get('/ch/01/config/color') === 4 && stripUI['ch01'].wrap.style.getPropertyValue('--cap-line').toUpperCase() === '#4C7CE0', stripUI['ch01'].wrap.style.getPropertyValue('--cap-line'));
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
    check('Meter: Klick auf die Lampe setzt sie zurück', !c1.clipEl.classList.contains('on') && !CLIPPED.has('ch01'));
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
    maybeShowChangelog('2.9.0');
    const shown = !!document.getElementById('changelog-overlay') && document.querySelectorAll('.changelog-item').length >= 3;
    document.getElementById('changelog-overlay').querySelector('button').click();
    maybeShowChangelog('2.9.0');
    check('Neu-in-Version: erscheint einmal mit Liste, nach "Verstanden" nicht wieder', shown && !document.getElementById('changelog-overlay'));
    maybeShowChangelog('9.9.9');
    check('Neu-in-Version: unbekannte Version zeigt nichts', !document.getElementById('changelog-overlay'));

    // Werkzeuge
    const toolsTab = document.querySelector('.layer-tab[data-layer="tools"]');
    toolsTab.click(); await sleep(200);
    const tv = document.getElementById('tools');
    check('Werkzeuge: Reiter zeigt vier Rechner, Pult-Fläche ausgeblendet', !tv.hidden && document.getElementById('console').hidden && tv.querySelectorAll('.t-card').length === 4 && toolsTab.classList.contains('on'));
    const results = () => Array.from(tv.querySelectorAll('.t-result b')).map((b) => b.textContent);
    check('Werkzeuge: 20 m bei 20 °C = 58,3 ms Delay, 58,3 ms = 20 m', /^58,3 ms/.test(results()[0]) && /^20 m|^20,0 m/.test(results()[1]), results().slice(0, 2).join(' | '));
    const first = tv.querySelector('.t-card input'); first.value = '34.32'; first.dispatchEvent(new Event('input', { bubbles: true }));
    check('Werkzeuge: Eingabe ändert das Ergebnis sofort (34,32 m = 100 ms)', /^100 ms/.test(results()[0]), results()[0]);
    check('Werkzeuge: Tempo-Tabelle mit 12 Zeilen, 120 BPM: Viertel 500 ms', tv.querySelectorAll('.t-tr').length === 12 && /500 ms/.test(tv.querySelector('.t-table').textContent));
    check('Werkzeuge: Pegel 100 dB in 1 m -> 74 dB in 20 m; 90+90 = 93 dB; 440 Hz = A4', /^74 dB/.test(results()[2]) && /^93 dB/.test(results()[3]) && /A4/.test(tv.textContent), results().join(' | '));
    document.querySelector('.layer-tab[data-layer="bus"]').click(); await sleep(150);
    check('Werkzeuge: zurück zum Pult blendet sie aus', tv.hidden && !document.getElementById('console').hidden);

    // Übersicht über den Fadern
    const ovEl = document.getElementById('overview');
    check('Übersicht: sichtbar in der Pult-Ansicht mit Live-Pegel, Main LR und "Auf einen Blick"', !ovEl.hidden && !!document.getElementById('m-start') && !!ovEl.querySelector('.ov-main') && !!ovEl.querySelector('.ov-glance'));
    check('Übersicht: kein Messung-Reiter mehr, dB-Rechner entfernt', !document.querySelector('.layer-tab[data-layer="measure"]') && !/dB umrechnen/.test(document.getElementById('tools').textContent));
    setLayer('ch'); await sleep(150);
    const fs2 = new Float32Array(70); fs2[22] = 0.5; fs2[23] = 0.25;
    __ctl.emitMeter('2', fs2); Overview.tick();
    check('Main-Pegel: L -6,0 / R -12,0 dBFS, Balken folgt', ovEl.querySelectorAll('.ov-mrow b')[0].textContent === '-6.0' && ovEl.querySelectorAll('.ov-mrow b')[1].textContent === '-12.0' && parseFloat(ovEl.querySelector('.ov-mbar').style.getPropertyValue('--lvl')) > 50, ovEl.querySelectorAll('.ov-mrow b')[0].textContent + ' / ' + ovEl.querySelectorAll('.ov-mrow b')[1].textContent);
    await sleep(700);
    check('Auf einen Blick: Kanäle mit Signal "x / 32", stumme Kanäle mit Namen', /^\d+ \/ 32$/.test(document.getElementById('ov-signal').textContent) && parseInt(document.getElementById('ov-muted').textContent, 10) >= 1 && /Rack Tom/.test(document.getElementById('ov-mutedlist').textContent), document.getElementById('ov-signal').textContent + ' | ' + document.getElementById('ov-mutedlist').textContent);
    const m2 = STRIP_BY_ID['ch02'].meter, ff = new Float32Array(70); ff[m2.idx[0]] = 1.0; __ctl.emitMeter(m2.stream, ff); await sleep(50);
    const n2 = X.get('/ch/02/config/name');
    check('Übersteuert: Kanal erscheint als Chip in der Übersicht', document.getElementById('ov-clips').textContent.includes(n2), document.getElementById('ov-clips').textContent);
    setLayer('bus'); await sleep(200);
    check('Übersteuert: bleibt beim Ebenenwechsel gemerkt (Chip da)', document.getElementById('ov-clips').textContent.includes(n2) && CLIPPED.has('ch02'));
    setLayer('ch'); await sleep(200);
    check('Übersteuert: Lampe am Kanalzug leuchtet nach der Rückkehr noch', stripUI['ch02'].clipEl.classList.contains('on'));
    document.querySelector('#ov-clips .ov-chip.clip').click(); await sleep(50);
    check('Übersteuert: Klick auf den Chip setzt Kanal zurück (Lampe aus, Chip weg)', !stripUI['ch02'].clipEl.classList.contains('on') && !CLIPPED.has('ch02') && /keine/.test(document.getElementById('ov-clips').textContent));
    const mainF = new Float32Array(70); mainF[22] = 1.0; __ctl.emitMeter('2', mainF); await sleep(50);
    check('Main LR: Übersteuerung schaltet die Lampe in der Übersicht und im Dock', ovEl.querySelector('.ov-clip').classList.contains('on') && dockUI['st'].clipEl.classList.contains('on'));
    ovEl.querySelector('.ov-clip').click(); await sleep(30);
    check('Main LR: Klick setzt beide Lampen zurück', !ovEl.querySelector('.ov-clip').classList.contains('on') && !dockUI['st'].clipEl.classList.contains('on'));
    ovEl.querySelector('.ov-toggle').click(); await sleep(50);
    check('Übersicht: einklappen blendet den Inhalt aus, ausklappen bringt ihn zurück', ovEl.classList.contains('collapsed') && getComputedStyle(ovEl.querySelector('.ov-grid')).display === 'none');
    ovEl.querySelector('.ov-toggle').click(); await sleep(50);
    check('Übersicht: wieder ausgeklappt', !ovEl.classList.contains('collapsed') && getComputedStyle(ovEl.querySelector('.ov-grid')).display !== 'none');
    document.getElementById('m-start').click(); await sleep(300);
    check('Live-Pegel: Start ohne Mikrofon-Freigabe -> Hinweis mit Systemeinstellungen-Knopf', /ausgeschaltet/.test(document.getElementById('m-notice').textContent) && /Systemeinstellungen/.test(document.getElementById('m-notice').textContent), document.getElementById('m-notice').textContent.slice(0, 50));
    document.getElementById('m-gear').click(); await sleep(50);
    check('Live-Pegel: Zahnrad öffnet Kalibrierung, Grenzwert und REW-Programm', !document.getElementById('m-settings').hidden && !!document.getElementById('m-cal') && !!document.getElementById('m-limit') && /nicht gefunden/.test(document.getElementById('m-rew-info').textContent));
    document.getElementById('m-gear').click();
    document.getElementById('rew-btn').click(); await sleep(300);
    check('REW-Knopf in der Kopfzeile: nicht gefunden -> Auswahl-Fenster mit Programm wählen / herunterladen', !!document.getElementById('rew-missing') && /Programm wählen/.test(document.getElementById('rew-missing').textContent) && /herunterladen/.test(document.getElementById('rew-missing').textContent));
    document.querySelector('#rew-missing [data-a="x"]').click(); await sleep(50);
    check('REW-Auswahl-Fenster lässt sich schließen', !document.getElementById('rew-missing'));
    document.querySelector('.layer-tab[data-layer="tools"]').click(); await sleep(150);
    check('Werkzeuge: Übersicht ausgeblendet', ovEl.hidden);
    document.querySelector('.layer-tab[data-layer="bus"]').click(); await sleep(150);
    check('zurück zum Pult: Übersicht und Fader wieder da', !ovEl.hidden && !document.getElementById('console').hidden && document.querySelector('.layer-tab[data-layer="bus"]').classList.contains('on') && !!document.querySelector('.strip'));
    // Mini-Anzeigen über dem Fader
    setLayer('ch'); await sleep(900);
    const cu = stripUI['ch02'];
    check('Mini: Kanäle haben EQ-Kurve, Kompressor-Kennlinie mit Gain-Reduction und Pegel; Aux nur EQ; DCA nichts', !!(cu.mini && cu.mini.eq && cu.mini.tf && cu.mini.grFill && cu.mini.peak) && (() => { setLayer('aux'); const a1 = stripUI['aux1']; const ok = a1.mini && a1.mini.eq && !a1.mini.tf; setLayer('dca'); const okDca = !stripUI['dca1'].mini; setLayer('ch'); return ok && okDca; })());
    await sleep(700);
    const chartRgb = (() => { const c = getComputedStyle(document.body).getPropertyValue('--chart').trim(); const m = /#(..)(..)(..)/.exec(c); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [61, 199, 232]; })();
    const curveY = (canvas, x) => { const g = canvas.getContext('2d'), d = g.getImageData(x * (canvas.width / canvas.clientWidth), 0, 1, canvas.height).data; let best = null; for(let y = 0; y < canvas.height; y++){ const i = y * 4; if(d[i + 3] > 180 && Math.abs(d[i] - chartRgb[0]) + Math.abs(d[i + 1] - chartRgb[1]) + Math.abs(d[i + 2] - chartRgb[2]) < 90){ best = y; break; } } return best; };
    const u2eq = stripUI['ch02'].mini.eq;
    const bandsOk = [1, 2, 3, 4].every((i) => ['type', 'f', 'g', 'q'].every((k) => X.get('/ch/02/eq/' + i + '/' + k) !== undefined));
    check('Mini: EQ-Werte aller vier Bänder von Kanal 2 wurden fürs Mini geladen', bandsOk);
    const eqBands = [1, 2, 3, 4].map((i) => ({ type: X.get('/ch/02/eq/' + i + '/type'), f: X.actual('/ch/02/eq/' + i + '/f'), g: X.actual('/ch/02/eq/' + i + '/g'), q: X.actual('/ch/02/eq/' + i + '/q') }));
    const misc02 = { eqOn: X.get('/ch/02/eq/on'), hpOn: X.get('/ch/02/preamp/hpon'), hpSlope: X.get('/ch/02/preamp/hpslope'), hpf: X.actual('/ch/02/preamp/hpf') };
    const W2 = u2eq.clientWidth, H2 = u2eq.clientHeight;
    let worst = 0, checked = 0;
    for(const f of [60, 200, 1000, 4000, 12000]){
      const x = Math.round(W2 * Math.log(f / 20) / Math.log(1000)), db = Math.max(-15, Math.min(15, X32EQ.eqResponseDb(f, eqBands, misc02)));
      const want = H2 / 2 - db * ((H2 / 2 - 2) / 15), got = curveY(u2eq, x);
      if(got !== null){ worst = Math.max(worst, Math.abs(got - want)); checked++; }
    }
    check('Mini: EQ-Kurve von Kanal 2 liegt an den richtigen Stellen (max. 2,5 px Abweichung)', checked >= 4 && worst <= 2.5, checked + ' Punkte, max ' + worst.toFixed(1) + ' px');
    const bset = (x) => { setLayer('bus'); return stripUI[x]; };
    const b3 = bset('bus03'); await sleep(1100);
    const d3 = {}; ['on', 'mode', 'thr', 'ratio', 'knee', 'mgain'].forEach((k) => { d3[k] = X.actual('/bus/03/dyn/' + k); });
    const tf = b3.mini.tf, TW = tf.clientWidth, TH = tf.clientHeight;
    const X_ = (db) => 2 + (db + 60) / 60 * (TW - 4), Y_ = (db) => TH - 2 - (db + 60) / 60 * (TH - 4);
    const yTop = curveY(tf, Math.round(X_(-3))), yThr = curveY(tf, Math.round(X_(-40)));
    const outAt0 = Math.max(-60, Math.min(0, X32EQ.transferOut(-3, d3)));
    check('Mini: Kompressor-Kennlinie von Bus 3 (Schwelle -24 dB, 4:1): bei -3 dB Eingang tiefer als 1:1, wie berechnet', yTop !== null && Math.abs(yTop - Y_(outAt0)) <= 2.5 && yTop > Y_(-3) + 3, 'y ' + yTop + ' erwartet ' + Y_(outAt0).toFixed(1) + ' (1:1 wäre ' + Y_(-3).toFixed(1) + ')');
    check('Mini: unter der Schwelle (-40 dB) läuft die Kurve 1:1', yThr !== null && Math.abs(yThr - Y_(-40)) <= 2.5, 'y ' + yThr + ' erwartet ' + Y_(-40).toFixed(1));
    setLayer('ch'); await sleep(200);
    const cg = stripUI['ch01'];
    const grF = new Float32Array(96); grF[64] = 0.5; __ctl.emitMeter('1', grF);
    check('Mini: Gain Reduction von Kanal 1 (Faktor 0,5 = 6 dB): Balken 30 % und "GR 6.0"', cg.mini.grv.textContent === 'GR 6.0' && Math.abs(parseFloat(cg.mini.grFill.style.height) - 30) <= 1, cg.mini.grv.textContent + ' / ' + cg.mini.grFill.style.height);
    grF[64] = 1; __ctl.emitMeter('1', grF);
    check('Mini: ohne Regelung "GR 0" und leerer Balken', cg.mini.grv.textContent === 'GR 0' && parseFloat(cg.mini.grFill.style.height) === 0);
    const pkF = new Float32Array(70); pkF[STRIP_BY_ID['ch01'].meter.idx[0]] = 0.5; __ctl.emitMeter('0', pkF);
    check('Mini: Spitzenpegel als Zahl (0,5 = -6,0 dBFS), nicht rot', cg.mini.peak.textContent === '-6.0' && !cg.mini.peak.classList.contains('hot'), cg.mini.peak.textContent);
    pkF[STRIP_BY_ID['ch01'].meter.idx[0]] = 0.9; __ctl.emitMeter('0', pkF);
    check('Mini: ab -3 dBFS wird der Pegel rot (-0,9 dBFS)', cg.mini.peak.textContent === '-0.9' && cg.mini.peak.classList.contains('hot'));
    check('Mini: Meter-Strom 1 (Gain Reduction der Kanäle) wird angefordert', __ctl.mock.meterUntil.has('1'));
    cg.mini.eq.click(); await sleep(250);
    const openedEq = !!document.querySelector('.proc-card') && proc && proc.strip.id === 'ch01' && proc.tab === 'eq';
    closeDetail();
    cg.mini.tf.click(); await sleep(250);
    check('Mini: Klick auf EQ öffnet die EQ-Seite, Klick auf Kompressor die Kompressor-Seite', openedEq && proc && proc.tab === 'dyn', proc && proc.tab);
    closeDetail(); await sleep(100);

    // Meine Seite
    try { localStorage.removeItem('x32.userpage'); } catch(e){}
    UserPage.clear();
    const upTab = document.querySelector('.layer-tab[data-layer="user"]');
    check('Meine Seite: Reiter vorhanden', !!upTab && /Meine Seite/.test(upTab.textContent));
    upTab.click(); await sleep(150);
    check('Meine Seite: leer zeigt Hinweis und "Bearbeiten"', /Noch leer/.test(app.textContent) && !!app.querySelector('.user-head button') && Object.keys(stripUI).length === 0 && upTab.classList.contains('on'));
    setLayer('ch'); await sleep(200);
    stripUI['ch03'].pinEl.click(); stripUI['ch01'].pinEl.click(); UserPage.add('bus03'); await sleep(100);
    check('Meine Seite: Stern am Kanalzug nimmt ihn auf (★), Reihenfolge = Reihenfolge des Hinzufügens', stripUI['ch03'].pinEl.textContent === '★' && stripUI['ch02'].pinEl.textContent === '☆' && UserPage.ids().join() === 'ch03,ch01,bus03', UserPage.ids().join());
    upTab.click(); await sleep(1300);
    check('Meine Seite: zeigt genau diese drei Kanalzüge in dieser Reihenfolge (Kanäle und Bus gemischt)', Object.keys(stripUI).join() === 'ch03,ch01,bus03' && Array.from(app.querySelectorAll('.strip-num')).map((n) => n.textContent).join('|') === 'Ch 03|Ch 01|Bus 03', Array.from(app.querySelectorAll('.strip-num')).map((n) => n.textContent).join('|'));
    check('Meine Seite: Werte kommen vom Pult (Namen, EQ des Busses für die Mini-Anzeige)', stripUI['ch03'].name.textContent === 'Snare Top' && X.get('/bus/03/eq/1/f') !== undefined && stripUI['bus03'].mini.eq.width > 0);
    X.setWire('/ch/01/mix/fader', 'f', 0.35); await sleep(150);
    check('Meine Seite: Fader dort bedienbar (geht ans Pult)', Math.abs(__ctl.mock.store.get('/ch/01/mix/fader') - 0.35) < 0.001 && Math.abs(parseFloat(stripUI['ch01'].fader.value) - 0.35) < 0.001);
    UserPage.move('bus03', -1); await sleep(400);
    check('Meine Seite: Reihenfolge ändern baut die Seite neu auf (ch03, bus03, ch01)', Object.keys(stripUI).join() === 'ch03,bus03,ch01');
    check('Meine Seite: Auswahl und letzte Ebene sind gespeichert', JSON.parse(localStorage.getItem('x32.userpage')).join() === 'ch03,bus03,ch01' && localStorage.getItem('x32-layer') === 'user');
    app.querySelector('.user-head button').click(); await sleep(150);
    const ed = document.getElementById('userpage-editor');
    check('Meine Seite bearbeiten: Fenster mit Auswahlliste aller Ebenen und den drei gewählten rechts', !!ed && ed.querySelectorAll('.up-avail .up-item').length >= 70 && ed.querySelectorAll('.up-mine .up-row').length === 3 && ed.querySelectorAll('.up-avail .up-item.on').length === 3, ed && ed.querySelectorAll('.up-avail .up-item').length);
    Array.from(ed.querySelectorAll('.up-avail .up-item')).find((b) => /Ch 02/.test(b.textContent)).click(); await sleep(400);
    check('Meine Seite bearbeiten: Klick in der Liste fügt hinzu (Kick Out), Seite dahinter aktualisiert sich', UserPage.ids().join() === 'ch03,bus03,ch01,ch02' && ed.querySelectorAll('.up-mine .up-row').length === 4 && !!stripUI['ch02']);
    ed.querySelector('.up-search').value = 'Snare'; ed.querySelector('.up-search').dispatchEvent(new Event('input'));
    check('Meine Seite bearbeiten: Suche "Snare" zeigt nur Snare-Kanäle', ed.querySelectorAll('.up-avail .up-item').length === 2 && /Snare/.test(ed.querySelector('.up-avail').textContent), ed.querySelectorAll('.up-avail .up-item').length);
    ed.querySelector('.up-search').value = ''; ed.querySelector('.up-search').dispatchEvent(new Event('input'));
    ed.querySelectorAll('.up-mine .up-row')[3].querySelector('.up-mv[data-d="-1"]').click(); await sleep(400);
    check('Meine Seite bearbeiten: ▲ schiebt nach vorn', UserPage.ids().join() === 'ch03,bus03,ch02,ch01');
    ed.querySelectorAll('.up-mine .up-row')[0].querySelector('.up-rm').click(); await sleep(400);
    check('Meine Seite bearbeiten: ✕ entfernt (Kanal 3 weg)', UserPage.ids().join() === 'bus03,ch02,ch01' && !stripUI['ch03']);
    stripUI['bus03'].pinEl.click(); await sleep(400);
    check('Meine Seite: Stern (★) auf der Seite entfernt den Kanalzug wieder', UserPage.ids().join() === 'ch02,ch01' && !stripUI['bus03']);
    ed.querySelector('.up-clear').click(); await sleep(400);
    check('Meine Seite bearbeiten: "Alle entfernen" leert die Seite', UserPage.ids().length === 0 && /Noch leer/.test(app.textContent));
    UserPage.closeEditor();
    check('Meine Seite: Fenster schließt', !document.getElementById('userpage-editor'));
    setLayer('ch'); await sleep(300);

    // Touch-Modus
    {
    try { localStorage.removeItem('x32-touch'); localStorage.removeItem('x32.overview.collapsed'); } catch(e){}
    window.__instantScroll = true;
    setLayer('ch'); await sleep(300);
    const tb = document.getElementById('touch-btn');
    const tp = (type, target, x, y, id, extra) => target.dispatchEvent(new PointerEvent(type, Object.assign({ clientX: x, clientY: y, pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true }, extra || {})));
    const capCenter = (fd) => { const r = fd.capElement.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const travelOf = (fd) => fd.yForT(0) - fd.yForT(1);
    check('Touch: Knopf in der Kopfzeile, standardmäßig aus', !document.body.classList.contains('touch') && /aus/.test(tb.textContent));
    const normalCapW = stripUI['ch01'].fader.capElement.getBoundingClientRect().width;
    tb.click(); await sleep(400);
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    check('Touch: Modus an, Zustand gemerkt, es verschwindet nichts (Übersicht bleibt offen und sichtbar)', document.body.classList.contains('touch') && localStorage.getItem('x32-touch') === 'on' && /an/.test(tb.textContent) && !document.getElementById('overview').classList.contains('collapsed') && document.getElementById('overview').getBoundingClientRect().height > 100 && !!document.querySelector('#overview .ov-main') && document.querySelector('#overview .ov-main').getBoundingClientRect().height > 20);
    const capW = stripUI['ch01'].fader.capElement.getBoundingClientRect().width;
    check('Touch: große Ziele (Mute ≥ 48 px, Reiter ≥ 44 px, Fader-Kappe ≥ 56 px breit statt ' + Math.round(normalCapW) + ')', parseFloat(cs('.mute-btn').height) >= 48 && parseFloat(cs('.layer-tab').height) >= 44 && capW >= 56, 'Mute ' + cs('.mute-btn').height + ', Reiter ' + cs('.layer-tab').height + ', Kappe ' + Math.round(capW));
    const fh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fader-h'));
    check('Touch: Fader nutzen die Fensterhöhe (Höhe gesetzt, ≥ 210 px, Meter gleich hoch)', fh >= 210 && Math.abs(stripUI['ch01'].fader.offsetHeight - fh) < 1 && Math.abs(parseFloat(cs('.meter-track').height) - fh) < 1, fh + ' px, style=' + document.documentElement.getAttribute('style') + ', innerH=' + window.innerHeight);
    check('Touch: Bank-Tasten zum Blättern sichtbar', getComputedStyle(document.querySelector('.bank-btns')).display !== 'none');
    const row = app.querySelector('.strip-row'); row.scrollLeft = 0;
    document.querySelectorAll('.bank-btn')[1].click(); await sleep(900);
    check('Touch: Bank-Taste "›" blättert die Kanalzüge weiter, "‹" zurück', row.scrollLeft > 100, 'scrollLeft ' + Math.round(row.scrollLeft));
    document.querySelectorAll('.bank-btn')[0].click(); await sleep(900);
    check('Touch: Bank-Taste "‹" blättert zurück', row.scrollLeft < 5, 'scrollLeft ' + Math.round(row.scrollLeft));

    // zwei Finger, zwei Fader gleichzeitig
    const fa = stripUI['ch01'].fader, fb = stripUI['ch02'].fader;
    fa.value = 0.5; fb.value = 0.5;
    const ca = capCenter(fa), cb = capCenter(fb), ta = travelOf(fa), tbv = travelOf(fb);
    tp('pointerdown', fa.capElement, ca.x, ca.y, 21); tp('pointerdown', fb.capElement, cb.x, cb.y, 22);
    tp('pointermove', fa.capElement, ca.x, ca.y - 30, 21); tp('pointermove', fb.capElement, cb.x, cb.y + 40, 22);
    const bubbleShown = getComputedStyle(fa.bubbleElement).display !== 'none' && getComputedStyle(fb.bubbleElement).display !== 'none';
    const bubbleTxt = fa.bubbleElement.textContent;
    tp('pointermove', fa.capElement, ca.x, ca.y - 50, 21);
    check('Touch: zwei Finger bewegen zwei Fader gleichzeitig und unabhängig (ch01 hoch, ch02 runter)', Math.abs(parseFloat(fa.value) - (0.5 + 50 / ta)) < 0.01 && Math.abs(parseFloat(fb.value) - (0.5 - 40 / tbv)) < 0.01 && fa.isDragging() && fb.isDragging(), fa.value + ' / ' + fb.value);
    check('Touch: Wert-Blase über der Kappe zeigt die dB während des Ziehens', bubbleShown && /^-?\d+\.\d$/.test(bubbleTxt) && fa.bubbleElement.textContent === stripUI['ch01'].dbLabel.textContent, bubbleTxt + ' / ' + stripUI['ch01'].dbLabel.textContent);
    tp('pointerup', fa.capElement, ca.x, ca.y - 50, 21); tp('pointerup', fb.capElement, cb.x, cb.y + 40, 22); await sleep(200);
    check('Touch: Loslassen sendet beide Werte ans Pult, Blase weg', Math.abs(__ctl.mock.store.get('/ch/01/mix/fader') - parseFloat(fa.value)) < 0.01 && Math.abs(__ctl.mock.store.get('/ch/02/mix/fader') - parseFloat(fb.value)) < 0.01 && getComputedStyle(fa.bubbleElement).display === 'none' && !fa.isDragging());
    // ein zweiter Finger auf demselben Fader stört nicht
    fa.value = 0.5; tp('pointerdown', fa.capElement, ca.x, ca.y, 31); tp('pointerdown', fa.capElement, ca.x + 5, ca.y + 200, 32); tp('pointermove', fa.capElement, ca.x, ca.y - 50, 31);
    const pinky = parseFloat(fa.value); tp('pointermove', fa.capElement, ca.x + 5, ca.y + 300, 32); const pinky2 = parseFloat(fa.value);
    tp('pointerup', fa.capElement, ca.x, ca.y - 50, 31);
    check('Touch: zweiter Finger auf demselben Fader wird ignoriert', Math.abs(pinky - (0.5 + 50 / ta)) < 0.01 && pinky2 === pinky);

    // Feineinstellung: Finger ruhig halten, oder seitlich wegrücken
    fa.value = 0.4; const c1 = capCenter(fa);
    tp('pointerdown', fa.capElement, c1.x, c1.y, 41); await sleep(520);
    const fineOn = fa.classList.contains('fine');
    tp('pointermove', fa.capElement, c1.x, c1.y - 50, 41);
    const fineDelta = parseFloat(fa.value) - 0.4;
    tp('pointerup', fa.capElement, c1.x, c1.y - 50, 41);
    check('Touch: Finger ruhig halten = Feineinstellung (1/5 Empfindlichkeit), Kappe springt dabei nicht', fineOn && Math.abs(fineDelta - 50 / ta * 0.2) < 0.005, 'Änderung ' + fineDelta.toFixed(4) + ' erwartet ' + (50 / ta * 0.2).toFixed(4));
    fa.value = 0.4; const c2 = capCenter(fa);
    tp('pointerdown', fa.capElement, c2.x, c2.y, 42);
    tp('pointermove', fa.capElement, c2.x + 160, c2.y, 42);
    tp('pointermove', fa.capElement, c2.x + 160, c2.y - 50, 42);
    const farDelta = parseFloat(fa.value) - 0.4, farFine = fa.classList.contains('fine');
    tp('pointerup', fa.capElement, c2.x + 160, c2.y - 50, 42);
    check('Touch: beim Ziehen seitlich wegrücken = Feineinstellung', farFine && Math.abs(farDelta - 50 / ta * 0.2) < 0.005, 'Änderung ' + farDelta.toFixed(4));
    fa.value = 0.4; const c3 = capCenter(fa);
    tp('pointerdown', fa.capElement, c3.x, c3.y, 43); tp('pointermove', fa.capElement, c3.x, c3.y - 50, 43); const normDelta = parseFloat(fa.value) - 0.4; tp('pointerup', fa.capElement, c3.x, c3.y - 50, 43);
    check('Touch: normales Ziehen ist 5x so schnell wie fein', Math.abs(normDelta - 50 / ta) < 0.005 && normDelta / fineDelta > 4.5 && normDelta / fineDelta < 5.5, normDelta.toFixed(3) + ' / ' + fineDelta.toFixed(3));

    // Doppeltippen = 0 dB
    X.setWire('/ch/01/mix/fader', 'f', 0.4); await sleep(150);
    const c4 = capCenter(fa);
    tp('pointerdown', fa.capElement, c4.x, c4.y, 51); tp('pointerup', fa.capElement, c4.x, c4.y, 51);
    await sleep(120);
    tp('pointerdown', fa.capElement, c4.x + 3, c4.y + 2, 52); tp('pointerup', fa.capElement, c4.x + 3, c4.y + 2, 52);
    await sleep(250);
    check('Touch: Doppeltippen auf die Kappe = zurück auf 0 dB (auch am Pult)', Math.abs(parseFloat(fa.value) - 0.75) < 0.002 && Math.abs(__ctl.mock.store.get('/ch/01/mix/fader') - 0.75) < 0.002, fa.value);
    // Einzeltippen auf die Kappe verstellt nichts
    fa.value = 0.6; const c5 = capCenter(fa); tp('pointerdown', fa.capElement, c5.x, c5.y, 53); tp('pointerup', fa.capElement, c5.x, c5.y, 53);
    check('Touch: Einzeltippen auf die Kappe verstellt den Fader nicht', Math.abs(parseFloat(fa.value) - 0.6) < 0.001);
    const cm = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); fa.dispatchEvent(cm);
    check('Touch: langes Drücken öffnet kein Kontextmenü', cm.defaultPrevented);

    // EQ-Seite mit Touch-Leiste
    openDetail(STRIP_BY_ID['ch02']); await sleep(400);
    const tbar = document.querySelector('.eq-touchbar');
    check('Touch: EQ-Seite zeigt Güte-/Gain-Tasten und den Touch-Hinweis', !!tbar && getComputedStyle(tbar).display !== 'none' && /Antippen/.test(document.querySelector('.eq-page .hint').textContent) && getComputedStyle(document.querySelector('.hint-mouse')).display === 'none');
    proc.sel = 1;
    const q0 = X.actual('/ch/02/eq/2/q');
    Array.from(tbar.querySelectorAll('button')).find((b) => /Güte \+/.test(b.textContent)).click(); await sleep(150);
    const q1 = X.actual('/ch/02/eq/2/q');
    Array.from(tbar.querySelectorAll('button')).find((b) => /Güte −/.test(b.textContent)).click(); await sleep(150);
    Array.from(tbar.querySelectorAll('button')).find((b) => /Gain 0/.test(b.textContent)).click(); await sleep(150);
    check('Touch: EQ Güte + / − ändern die Güte des gewählten Bands, "Gain 0 dB" setzt es zurück', q1 > q0 * 1.15 && Math.abs(X.actual('/ch/02/eq/2/q') - q0) < q0 * 0.02 && Math.abs(X.actual('/ch/02/eq/2/g')) < 0.01, q0.toFixed(2) + ' -> ' + q1.toFixed(2));
    closeDetail(); await sleep(100);

    // Geteiltes Layout für breite Bildschirme: links Mischpult (halbe Breite), rechts oben Pegelanzeige, rechts unten frei
    {
      const R = (id) => document.getElementById(id).getBoundingClientRect();
      check('Touch: bei schmalem Fenster kein geteiltes Layout, Reserve-Fläche unsichtbar', !document.body.classList.contains('touch-split') && getComputedStyle(document.getElementById('reserve')).display === 'none');
      window.__splitMinWidth = 1000; fitFaders(); await sleep(400);
      const ws = R('workspace'), cn = R('console'), ov = R('overview'), rs = R('reserve');
      check('Touch geteilt: Mischpult links (halbe Breite), Pegelanzeige rechts oben, freie Fläche rechts unten', document.body.classList.contains('touch-split') && Math.abs(cn.width - (ws.width - 46) / 2) < 20 && cn.left < ov.left && ov.left >= cn.right - 2 && Math.abs(rs.left - ov.left) < 2 && rs.top >= ov.bottom - 2 && rs.top > ov.top + 100 && cn.height > ws.height - 16, 'Konsole ' + Math.round(cn.width) + 'x' + Math.round(cn.height) + ', Übersicht ' + Math.round(ov.width) + 'x' + Math.round(ov.height) + ' @' + Math.round(ov.left) + ', Reserve @' + Math.round(rs.left) + ',' + Math.round(rs.top));
      check('Touch geteilt: freie Fläche ist sichtbar und leer (nur Hinweis "Freie Fläche")', getComputedStyle(document.getElementById('reserve')).display !== 'none' && rs.height > 100 && document.getElementById('reserve').textContent.trim() === 'Freie Fläche');
      const strips = Array.from(app.querySelectorAll('.strip')).filter((st) => st.getBoundingClientRect().left < cn.right && st.getBoundingClientRect().right > cn.left);
      check('Touch geteilt: Kanalzüge bleiben in der linken Hälfte, Main/Mono-Dock daneben, alles in voller Touch-Größe', strips.length >= 2 && strips.every((st) => st.getBoundingClientRect().left >= cn.left - 1) && Math.round(getComputedStyle(document.querySelector('.strip')).flexBasis === '134px' || document.querySelector('.strip').offsetWidth >= 130) && document.querySelector('#dock .strip').getBoundingClientRect().right <= cn.right + 1);
      check('Touch geteilt: Übersicht komplett da (Live-Pegel, Main LR, Auf einen Blick) und nichts eingeklappt', !!document.getElementById('m-start') && document.querySelector('#overview .ov-main').getBoundingClientRect().height > 20 && document.querySelector('#overview .ov-glance').getBoundingClientRect().height > 20 && getComputedStyle(document.querySelector('#overview .ov-grid')).display === 'grid' && getComputedStyle(document.querySelector('#overview .ov-bar')).display === 'none');
      check('Touch geteilt: Fader nutzen die Höhe der linken Hälfte', parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fader-h')) >= 210 && app.querySelector('.strip').getBoundingClientRect().bottom <= cn.bottom + 1, getComputedStyle(document.documentElement).getPropertyValue('--fader-h'));
      // auch wenn die Übersicht vorher von Hand eingeklappt war: im geteilten Layout bleibt sie sichtbar und lebt weiter
      document.getElementById('overview').classList.add('collapsed'); fitFaders();
      const mf = new Float32Array(70); mf[22] = 0.5; __ctl.emitMeter('2', mf); Overview.tick();
      check('Touch geteilt: auch eine früher eingeklappte Übersicht bleibt sichtbar und zeigt Pegel (Main L -6,0)', document.querySelector('#overview .ov-main').getBoundingClientRect().height > 20 && document.querySelectorAll('#overview .ov-mrow b')[0].textContent === '-6.0');
      document.getElementById('overview').classList.remove('collapsed');
      // Vollbild-Knopf
      check('Touch: Vollbild-Knopf ist sichtbar', getComputedStyle(document.getElementById('full-btn')).display !== 'none');
      document.getElementById('full-btn').click(); await sleep(50);
      check('Touch: Vollbild-Knopf ruft das Hauptprogramm', window.__fullCalls === 1);
      // Ansichtswechsel: Werkzeuge nutzen die ganze Fläche
      document.querySelector('.layer-tab[data-layer="tools"]').click(); await sleep(300);
      check('Touch geteilt: Werkzeuge belegen den ganzen Bildschirm (kein Split, Reserve weg)', !document.body.classList.contains('touch-split') && document.getElementById('reserve').hidden && !document.getElementById('tools').hidden);
      document.querySelector('.layer-tab[data-layer="bus"]').click(); await sleep(400);
      check('Touch geteilt: zurück zum Pult ist wieder geteilt', document.body.classList.contains('touch-split') && !document.getElementById('reserve').hidden && document.querySelector('.layer-tab[data-layer="bus"]').classList.contains('on'));
      setLayer('ch'); await sleep(200);
      // Layout-Umschaltung mit der Fensterbreite
      window.__splitMinWidth = 5000; fitFaders(); await sleep(200);
      check('Touch: wird das Fenster zu schmal, wird wieder normal gestapelt (Übersicht über den Fadern)', !document.body.classList.contains('touch-split') && R('overview').bottom <= R('console').top + 4);
    }

    // Ausschalten und Selbst-Erkennung
    tb.click(); await sleep(300);
    check('Touch: Knopf schaltet wieder aus (normale Größen, Höhe zurück, Übersicht offen, kein geteiltes Layout)', !document.body.classList.contains('touch') && !document.body.classList.contains('touch-split') && localStorage.getItem('x32-touch') === 'off' && !document.documentElement.style.getPropertyValue('--fader-h') && !document.getElementById('overview').classList.contains('collapsed'));
    document.body.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 60, bubbles: true }));
    check('Touch: ausdrücklich ausgeschaltet bleibt aus, auch wenn getippt wird', !document.body.classList.contains('touch'));
    try { localStorage.removeItem('x32-touch'); } catch(e){}
    document.body.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', pointerId: 61, bubbles: true }));
    check('Touch: Mausklick schaltet den Touch-Modus nicht ein', !document.body.classList.contains('touch'));
    document.body.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 62, bubbles: true })); await sleep(300);
    check('Touch: erster echter Fingertipp schaltet den Touch-Modus selbst ein (mit Hinweis)', document.body.classList.contains('touch') && localStorage.getItem('x32-touch') === null);
    tb.click(); await sleep(200); try { localStorage.removeItem('x32-touch'); } catch(e){}
    document.getElementById('overview').classList.remove('collapsed');
    setLayer('ch'); await sleep(200);
    }

    // Design: Schlicht (Standard) und Klassisch umschaltbar, Wahl wird gemerkt
    const acc = () => getComputedStyle(document.body).getPropertyValue('--accent').trim().toUpperCase();
    check('Design: Standard ist "Schlicht" (ruhiges Blau, Systemschrift), Knopf zeigt es an', document.body.classList.contains('plain') && acc() === '#0A84FF' && /Schlicht/.test(document.getElementById('design-btn').textContent) && /apple-system/i.test(getComputedStyle(document.body).getPropertyValue('--font-body')), acc());
    document.getElementById('design-btn').click(); await sleep(100);
    check('Design: Klick wechselt zu "Klassisch" (Türkis), gemerkt', !document.body.classList.contains('plain') && acc() === '#3DC7E8' && /Klassisch/.test(document.getElementById('design-btn').textContent) && localStorage.getItem('x32-design') === 'classic', acc());
    document.getElementById('design-btn').click(); await sleep(100);
    check('Design: zurück zu "Schlicht"', document.body.classList.contains('plain') && acc() === '#0A84FF' && localStorage.getItem('x32-design') === 'plain');

    // Offline-Modus (ohne Pult arbeiten, später übertragen)
    try { localStorage.removeItem('x32.offline'); } catch(e){}
    X.clearOffline();
    document.getElementById('connect-btn').click();                 // "Trennen"
    await waitFor(() => X.status().state === 'idle', 3000);
    check('Offline: Start ohne Pult zeigt den Knopf "Offline arbeiten" im Hinweis', getComputedStyle(document.getElementById('connect-hint')).display !== 'none' && !!document.getElementById('hint-offline-btn'));
    document.getElementById('hint-offline-btn').click();
    await waitFor(() => X.status().state === 'offline', 3000); await sleep(200);
    const pill = document.getElementById('status-badge');
    check('Offline: Status "Offline-Modus" (lila), Pult-Fläche nicht gedimmt, Hinweisleiste da', /Offline-Modus/.test(document.getElementById('status-text').textContent) && pill.classList.contains('offline-mode') && !document.getElementById('console').classList.contains('offline') && !document.getElementById('offline-bar').hidden && /Offline-Modus/.test(document.getElementById('offline-bar').textContent) && document.getElementById('offline-btn').textContent === 'Offline beenden');
    setLayer('ch'); await sleep(200);
    const o1 = stripUI['ch01'];
    check('Offline: alle 32 Kanalzüge da, Fader auf 0,0 dB, nicht stumm', Object.keys(stripUI).length === 32 && o1.dbLabel.textContent === '0.0' && Math.abs(parseFloat(o1.fader.value) - 0.75) < 0.001 && !o1.wrap.classList.contains('muted'));
    const sentBefore = __ctl.mock ? __ctl.mock.log.received : 0;
    X.setWire('/ch/01/mix/fader', 'f', 0.3); X.setWire('/ch/03/mix/on', 'i', 0); await sleep(150);
    check('Offline: Fader und Mute lassen sich bedienen, Anzeige folgt, nichts geht ans Pult', Math.abs(parseFloat(o1.fader.value) - 0.3) < 0.001 && stripUI['ch03'].wrap.classList.contains('muted') && X.offlineChanges() === 2 && (!__ctl.mock || __ctl.mock.log.received === sentBefore), 'Änderungen ' + X.offlineChanges());
    openDetail(STRIP_BY_ID['ch01']); await sleep(300);
    check('Offline: EQ-Seite öffnet mit Startwerten (Band 1: 100 Hz)', !!document.querySelector('.proc-card') && Math.abs(X.actual('/ch/01/eq/1/f') - 100) < 0.01 && X.get('/ch/01/dyn/on') === 0);
    X.set('/ch/01/eq/2/g', 5); closeDetail(); await sleep(100);
    check('Offline: EQ-Änderung wird gemerkt (3 Änderungen)', X.offlineChanges() === 3);
    Scenes.open(); await sleep(150);
    const sb = document.querySelector('#scenes-overlay .scene-save-btn');
    check('Offline: Szenen lassen sich speichern (Knopf aktiv)', sb && !sb.disabled);
    document.querySelector('#scenes-overlay .scene-name').value = 'Offline A'; sb.click(); await sleep(100);
    check('Offline: Szene gespeichert, Mute von Kanal 3 darin', Scenes.list().some((x) => x.name === 'Offline A' && x.data.ch03.on === 0 && x.data.ch01.f === 0.3));
    Scenes.close();
    await sleep(700);
    check('Offline: Übersicht zählt stumme Kanäle', parseInt(document.getElementById('ov-muted').textContent, 10) === 1 && document.getElementById('ov-signal').textContent === '–');
    // verbinden: Offline-Stand wartet auf die Übertragung
    document.getElementById('ip-input').value = '10.0.0.5'; document.getElementById('connect-btn').click();
    await waitFor(() => X.status().state === 'online' && X.status().progress >= 1, 10000); await sleep(300);
    const ob = document.getElementById('offline-bar');
    check('Verbunden: Werte kommen vom Pult (Offline-Werte weg), Hinweis "Offline vorbereitet: 3"', !X.isOffline() && Math.abs(parseFloat(stripUI['ch01'].fader.value) - 0.3) > 0.01 && !ob.hidden && /Offline vorbereitet: 3 Einstellungen/.test(ob.textContent), ob.textContent.slice(0, 60));
    ob.querySelector('.btn').click(); await sleep(100);
    check('Übertragen: Rückfrage nennt die Anzahl und warnt vor springenden Fadern', !!document.getElementById('offline-dialog') && /3 Werte/.test(document.getElementById('offline-dialog').textContent) && /springen/.test(document.getElementById('offline-dialog').textContent));
    Array.from(document.querySelectorAll('#offline-dialog .btn')).find((b) => /Ja, übertragen/.test(b.textContent)).click();
    await waitFor(() => /Fertig/.test((document.getElementById('offline-dialog') || {}).textContent || ''), 5000);
    const ms = __ctl.mock.store;
    check('Übertragen: Fader, Mute und EQ-Gain stehen am (simulierten) Pult', Math.abs(ms.get('/ch/01/mix/fader') - 0.3) < 0.001 && ms.get('/ch/03/mix/on') === 0 && Math.abs(ms.get('/ch/01/eq/2/g') - (5 + 15) / 30) < 0.001, ms.get('/ch/01/mix/fader') + ' / ' + ms.get('/ch/03/mix/on') + ' / ' + ms.get('/ch/01/eq/2/g'));
    check('Übertragen: Meldung "Fertig: 3 Werte"', /Fertig: 3 Werte/.test(document.getElementById('offline-dialog').textContent));
    document.querySelector('#offline-dialog .btn').click(); await sleep(50);
    Array.from(document.querySelectorAll('#offline-bar .btn')).find((b) => /Verwerfen/.test(b.textContent)).click(); await sleep(50);
    Array.from(document.querySelectorAll('#offline-dialog .btn')).find((b) => /Ja, verwerfen/.test(b.textContent)).click(); await sleep(150);
    check('Verwerfen: Offline-Stand gelöscht, Hinweisleiste weg', X.offlineChanges() === 0 && document.getElementById('offline-bar').hidden && !document.getElementById('offline-dialog'));
    out.push(fails ? ('==> ' + fails + ' FEHLER') : '==> alle Tests bestanden');
    const pre = document.getElementById('out'); pre.style.display = 'block'; pre.textContent = out.join('\n');
    return;
  }

  // ---- Ansichten für Screenshots ----
  if(view === 'offlinemode'){ document.getElementById('connect-btn').click(); await waitFor(() => X.status().state === 'idle', 3000); await enterOffline(); X.setWire('/ch/01/mix/fader', 'f', 0.62); X.setWire('/ch/03/mix/on', 'i', 0); await sleep(700); }
  if(view === 'user'){ ['ch02', 'ch01', 'bus03', 'ch06', 'st'].forEach((i) => { if(i !== 'st') UserPage.add(i); }); setLayer('user'); await sleep(1500); }
  if(view === 'touch' || view === 'touch-eq'){ try { localStorage.removeItem('x32.overview.collapsed'); } catch(e){} document.getElementById('touch-btn').click(); await sleep(700); if(view === 'touch-eq'){ openDetail(STRIP_BY_ID['ch02']); await sleep(500); } }
  if(view === 'split'){ window.__splitMinWidth = 1000; try { localStorage.removeItem('x32.overview.collapsed'); } catch(e){} document.getElementById('touch-btn').click(); await sleep(900); }
  if(view === 'tools') showView('tools');
  if(view === 'scenes'){ try { localStorage.removeItem('x32.scenes'); } catch(e){} Scenes.saveScene('Soundcheck', true); X.setWire('/ch/01/mix/fader', 'f', 0.3); Scenes.saveScene('Band A – Bühne', false); Scenes.open(); }
  if(view === 'clip'){ const m1 = STRIP_BY_ID['ch01'].meter, f = new Float32Array(70); f[m1.idx[0]] = 1.0; __ctl.emitMeter(m1.stream, f); f[m1.idx[0]] = 0.35; __ctl.emitMeter(m1.stream, f); }
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
