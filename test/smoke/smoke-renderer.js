(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), $ = (s) => document.querySelector(s), R = {};
  R.platform = window.x32API.platform; R.pcName = window.X32PLAT && X32PLAT.pc; R.hintText = (document.querySelector('#connect-hint p') || {}).textContent || '';
  R.mic = await window.x32API.micStatus(); R.rew = await window.x32API.rewStatus(); R.version = await window.x32API.getVersion();
  // 0) Netzwerkzugriff beim Start: Ergebnis der Prüfung und Warnung im Startbildschirm
  await sleep(2500);
  R.netAccess = await window.x32API.netAccess(true); await sleep(300);
  R.warnHidden = document.getElementById('net-warning').hidden;
  // 1) Verbinden mit der Pult-Attrappe (Eingabe mit Leerzeichen)
  $('#ip-input').value = ' 127.0.0.1 ';
  $('#connect-btn').click();
  let t0 = Date.now();
  while (Date.now() - t0 < 8000 && X.status().state !== 'online') await sleep(50);
  R.online = X.status().state === 'online'; R.onlineMs = Date.now() - t0; R.info = X.status().info; R.statusText = $('#status-text').textContent;
  R.storedIp = localStorage.getItem('x32-ip'); R.okIp = localStorage.getItem('x32-ip-ok');
  await sleep(1500);
  R.faders = document.querySelectorAll('.fader').length;
  await window.x32API.disconnect(); await sleep(400);
  // 2) Adresse in einem anderen Netz: nach der Frist "Keine Antwort", Ursache selbst gefunden
  $('#ip-input').value = '10.255.255.1'; $('#connect-btn').click();
  await sleep(1500); R.waitText = $('#status-text').textContent; R.waitTitle = $('#cp-title').textContent;
  await sleep(9500);
  R.noReplyText = $('#status-text').textContent; R.bannerTitle = $('#cp-title').textContent; R.bannerText = $('#cp-text').textContent; R.waiting = $('#console').classList.contains('waiting'); R.badgeBad = $('#status-badge').classList.contains('bad');
  // 3) Verbindungshilfe mit echter Ursachensuche
  ConnectHelp.open('10.255.255.1');
  t0 = Date.now(); while (Date.now() - t0 < 15000 && !$('.net-verdict')) await sleep(100);
  R.helpMs = Date.now() - t0;
  R.verdict = ($('.net-verdict') || {}).textContent || null;
  R.steps = Array.from(document.querySelectorAll('.help-steps li')).map((x) => x.textContent);
  R.actions = Array.from(document.querySelectorAll('#help-actions button')).map((x) => x.textContent);
  R.checks = Array.from(document.querySelectorAll('.help-det')[0] ? document.querySelectorAll('.help-det')[0].querySelectorAll('.diag-k') : []).map((e) => e.textContent + ' = ' + e.nextElementSibling.textContent);
  ConnectHelp.close(); await window.x32API.disconnect();
  // 4) Suche im echten Netz (alle Netze, Einzelanfragen + Rundruf)
  t0 = Date.now(); R.scan = await window.x32API.scan(); R.scanMs = Date.now() - t0;
  // 4b) Hilfe für ein erreichbares Gerät im eigenen Netz (der Router): Ping klappt, aber es ist kein Pult. Zeigt, ob macOS die App ins lokale Netz lässt.
  ConnectHelp.open('__GATEWAY__');
  t0 = Date.now(); while (Date.now() - t0 < 15000 && !$('.net-verdict')) await sleep(100);
  R.gwVerdict = ($('.net-verdict') || {}).textContent || null;
  R.gwChecks = Array.from(document.querySelectorAll('.help-det')[0] ? document.querySelectorAll('.help-det')[0].querySelectorAll('.diag-k') : []).map((e) => e.textContent + ' = ' + e.nextElementSibling.textContent);
  ConnectHelp.close();
  // 5) Suche findet die Attrappe (127.0.0.1 ist kein Netz des Macs: hier nur Formatprüfung), Ungültige Eingabe
  R.bad = await window.x32API.connect('abc');
  R.empty = await window.x32API.connect('');
  R.log = await window.x32API.getLog();
  return R;
})()
