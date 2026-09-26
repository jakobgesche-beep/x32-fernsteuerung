// Verbindungshilfe: sagt in einfachen Worten, warum keine Verbindung zum Pult zustande kommt und was zu tun ist.
// - Wartebanner über dem Pult, solange verbunden wird (mit Sekundenanzeige, nach ein paar Sekunden: "Keine Antwort")
// - Fenster "Verbindungshilfe": Ursachensuche (Ping, Netz, Freigaben, Antwort des Pults), Schritte, Knöpfe, Prüfpunkte, Protokoll
const ConnectHelp = (function () {
  const api = () => window.x32API;
  const PLAT = window.X32PLAT || { isMac: true, pc: 'Mac', fileManager: 'Finder' };
  const SHORT = {
    subnet: PLAT.pc + ' und Pult scheinen in verschiedenen Netzen zu sein.',
    unreachable: 'Das Pult ist im Netz nicht erreichbar (aus? Kabel? andere Adresse?).',
    'no-network': 'Der ' + PLAT.pc + ' ist mit keinem Netzwerk verbunden.',
    'blocked-error': 'macOS lässt die App nicht ins lokale Netzwerk.',
    'maybe-blocked': 'Das Gerät ist erreichbar, aber es kommt nichts zurück. Wahrscheinlich blockiert ' + (PLAT.isMac ? 'macOS' : 'die Windows-Firewall') + ' die App.',
    'app-blocked': 'macOS blockiert diese App im lokalen Netzwerk.',
    'silent-osc': 'Unter dieser Adresse ist ein Gerät, aber es antwortet nicht wie ein X32.',
    'bad-ip': 'Die IP-Adresse stimmt nicht.',
    'no-reply': 'Es kommt keine Antwort. Die Hilfe zeigt, woran es liegt.',
    ok: 'Das Pult antwortet. Bitte noch einmal auf „Verbinden“ drücken.',
  };
  let overlay = null, busy = false, lastRes = null, lastIp = '';

  // ---------- Wartebanner (über dem Pult, während verbunden wird) ----------
  function updateBanner(s) {
    const box = document.getElementById('connect-progress'), consoleEl = document.getElementById('console');
    if (!box) return;
    const waiting = (s.state === 'connecting') || (s.state === 'lost' && (s.waitMs || 0) > 4000);
    consoleEl.classList.toggle('waiting', !!waiting);
    if (!waiting) return;
    const secs = Math.floor((s.waitMs || 0) / 1000), target = s.target || '';
    const title = s.state === 'lost' ? 'Verbindung verloren – suche wieder …' : s.noReply ? 'Keine Antwort vom Pult' : 'Verbinde mit ' + target + ' …';
    const text = s.noReply ? (s.diag && SHORT[s.diag] ? SHORT[s.diag] : 'Seit ' + secs + ' Sekunden antwortet das Pult (' + target + ') nicht. Die Hilfe zeigt, woran es liegt.') : s.state === 'lost' ? 'Seit ' + secs + ' Sekunden keine Antwort.' : 'Das dauert normalerweise weniger als eine Sekunde' + (secs >= 2 ? ' (' + secs + ' s)' : '') + '.';
    document.getElementById('cp-title').textContent = title;
    document.getElementById('cp-text').textContent = text;
    box.classList.toggle('bad', !!s.noReply);
    document.getElementById('cp-help').className = 'btn' + (s.noReply ? '' : ' secondary');
  }

  // ---------- Fenster ----------
  function row(k, v) { return '<div class="diag-k">' + esc(k) + '</div><div class="diag-v">' + esc(v) + '</div>'; }
  const LEVEL = { ok: 'OK', fail: 'FEHLT', warn: 'ACHTUNG', info: 'unklar' };

  function render(res) {
    if (!res || !res.verdict) { setBusy(false); toast('Die Prüfung hat kein Ergebnis geliefert.', true); return; }
    lastRes = res;
    const v = res.verdict, body = overlay.querySelector('.help-body');
    const cls = v.level === 'ok' ? 'good' : v.level === 'warn' ? 'mid' : 'bad';
    body.innerHTML =
      '<div class="net-verdict ' + cls + '"><b>' + esc(v.title) + '</b><br>' + esc(v.text) + '</div>' +
      (v.steps.length ? '<div class="section-title" style="margin-top:6px">Das kannst du tun</div><ol class="help-steps">' + v.steps.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol>' : '') +
      '<div class="cp-actions" id="help-actions"></div><div id="help-extra"></div>' +
      '<details class="help-det"><summary>Prüfpunkte im Einzelnen</summary><div class="diag-grid" style="margin-top:8px">' + res.checks.map((c) => row((LEVEL[c.level] || c.level) + ' · ' + c.title, c.detail)).join('') + '</div></details>' +
      '<details class="help-det" id="help-logbox"><summary>Protokoll (für Fehlersuche)</summary><pre class="help-log" id="help-log">Wird geladen …</pre><div class="cp-actions"><button class="btn small secondary" id="help-copy-log">Protokoll kopieren</button><button class="btn small secondary" id="help-open-log">Im ' + PLAT.fileManager + ' zeigen</button></div></details>';
    const actions = body.querySelector('#help-actions');
    v.actions.forEach((a, i) => {
      const b = el('<button class="btn small' + (i === 0 ? '' : ' secondary') + '" data-a="' + a.id + '">' + esc(a.label) + '</button>');
      b.addEventListener('click', () => act(a.id));
      actions.appendChild(b);
    });
    body.querySelector('#help-copy-log').addEventListener('click', async () => { try { await navigator.clipboard.writeText(await api().getLog()); toast('Protokoll kopiert.'); } catch (e) { toast('Kopieren nicht möglich.', true); } });
    body.querySelector('#help-open-log').addEventListener('click', () => api().openLog());
    body.querySelector('#help-logbox').addEventListener('toggle', async (e) => { if (e.target.open) { const t = await api().getLog(); const pre = body.querySelector('#help-log'); pre.textContent = t || '(leer)'; pre.scrollTop = pre.scrollHeight; } });
  }

  async function act(id) {
    if (busy) return;
    const ip = overlay.querySelector('#help-ip').value.trim();
    if (id === 'retry') { close(); connectTo(ip); return; }
    if (id === 'open-privacy') { api().openPrivacy(); return; }
    if (id === 'open-firewall') { api().openFirewall(); return; }
    if (id === 'scan') { close(); scanBtn.click(); return; }
    if (id === 'copy-command') {
      const cmd = lastRes && lastRes.info && lastRes.info.command;
      if (!cmd) return;
      const extra = overlay.querySelector('#help-extra');
      extra.innerHTML = '<div class="section-title">Notlösung: Netz für alle Programme freigeben</div>' +
        '<p class="hint" style="text-align:left">Das geht ohne die App-Freigabe. Terminal öffnen, den kopierten Befehl einfügen (Cmd+V), Enter drücken, das Mac-Passwort eingeben, danach den <b>Mac neu starten</b>. Alle Programme dürfen dann auf Geräte in diesem Netz zugreifen.</p><pre class="help-log">' + esc(cmd) + '</pre>';
      try { await Promise.race([navigator.clipboard.writeText(cmd), new Promise((_, rej) => setTimeout(() => rej(new Error('Zeit')), 1500))]); toast('Befehl kopiert.'); } catch (e) { toast('Kopieren nicht möglich. Den Befehl unten markieren und mit Cmd+C kopieren.', true); }
      return;
    }
    if (id === 'terminal-test') {
      setBusy(true, 'Ein Terminal-Fenster öffnet sich kurz. Bitte warten (bis zu 30 Sekunden) …');
      const t = await api().terminalTest(ip);
      if (!t.ok) { setBusy(false); toast(t.error || 'Test nicht möglich.', true); return; }
      await run(ip, { terminal: { replied: t.replied } });
    }
  }

  function setBusy(on, text) {
    busy = on;
    const st = overlay && overlay.querySelector('#help-run');
    if (!st) return;
    st.hidden = !on; st.textContent = text || '';
    overlay.querySelectorAll('button[data-a], #help-check').forEach((b) => { b.disabled = on; });
  }
  async function run(ip, opts) {
    lastIp = ip;
    setBusy(true, 'Prüfe Netzwerk, Pult und ' + (PLAT.isMac ? 'Freigaben' : 'Firewall') + ' … (etwa 4 Sekunden)');
    let res;
    try { res = await api().diagnose(ip, opts || {}); } catch (e) { setBusy(false); toast('Prüfung fehlgeschlagen: ' + e.message, true); return; }
    if (!overlay) return;
    render(res);
    setBusy(false);
  }

  function open(ip) {
    if (overlay) return;
    overlay = el('<div class="overlay" id="help-overlay"></div>');
    const box = el('<div class="detail-card" style="max-width:660px;"><div class="detail-header"><div class="detail-title">Verbindungshilfe</div></div>' +
      '<div class="help-target"><label class="hint" style="margin:0;text-align:left">IP-Adresse des Pults</label><div class="row"><input id="help-ip" type="text" placeholder="z. B. 192.168.1.50"><button class="btn small" id="help-check">Prüfen</button></div></div>' +
      '<p class="hint" id="help-run" hidden style="text-align:left"></p><div class="help-body"></div></div>');
    const closeBtn = el('<button class="close-btn">&times;</button>');
    closeBtn.addEventListener('click', close);
    box.querySelector('.detail-header').appendChild(closeBtn);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    const input = box.querySelector('#help-ip');
    input.value = ip || '';
    const check = () => run(input.value.trim());
    box.querySelector('#help-check').addEventListener('click', check);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    check();
  }
  function close() { if (overlay) { overlay.remove(); overlay = null; } busy = false; }

  return { open, close, updateBanner, SHORT, isOpen: () => !!overlay };
})();
