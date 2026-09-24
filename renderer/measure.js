// Live-Pegel: dB(A) mit einem Messmikrofon am USB-Audio-Interface, Pegelverlauf, Spektrum (Terzbänder), Grenzwert-Warnung.
// Sitzt als schmales Feld über den Fadern. Die eigentliche Messung übernimmt REW: Knopf "REW öffnen" in der Kopfzeile.
// Die Rechnung steckt in shared/spl.js; hier: Eingang wählen, Aufnahme, Anzeige, Kalibrierung.
const Measure = (function () {
  'use strict';
  const api = window.x32API;
  const SPL = X32SPL;
  const SETTINGS_KEY = 'x32.measure.settings';
  const CAL_KEY = 'x32.measure.cal';
  const WARMUP_S = 1;              // Einschwingen der Filter: Maximum/Leq danach neu starten
  const CAL_SECONDS = 3;
  const FFT_SIZE = 16384;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function load(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; } catch (e) { return fallback; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  const say = (msg, isError) => { if (typeof toast === 'function') toast(msg, isError); };

  const cfg = Object.assign({ deviceId: '', deviceLabel: '', channel: 0, weighting: 'A', tc: 'fast', limitOn: false, limit: 99, ref: 94 }, load(SETTINGS_KEY, {}));
  const cals = load(CAL_KEY, {});
  cfg.weighting = 'A'; cfg.tc = 'fast';          // bewusst fest: dB(A), Fast (die Feinmessung macht REW)
  const persistCfg = () => save(SETTINGS_KEY, cfg);

  // ---------- Aufnahme (Mikrofon -> Web Audio -> Rohdaten) ----------
  // Der Audio-Thread liefert nur Rohdaten (ein Kanal, in Blöcken); die Rechnung läuft in SplMeter/Spectrum.
  const TAP_SRC = `
class X32Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channel = 0; this.nch = 0; this.buf = new Float32Array(512); this.fill = 0;
    this.port.onmessage = (e) => { if (e.data && typeof e.data.channel === 'number') this.channel = e.data.channel; };
  }
  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    if (inp.length !== this.nch) { this.nch = inp.length; this.port.postMessage({ channels: this.nch }); }
    const n = inp[0].length, sel = this.channel;
    for (let i = 0; i < n; i++) {
      let v;
      if (sel < 0) { v = 0; for (let c = 0; c < inp.length; c++) v += inp[c][i]; v /= inp.length; }
      else v = inp[Math.min(sel, inp.length - 1)][i];
      this.buf[this.fill++] = v;
      if (this.fill === this.buf.length) {
        const out = this.buf; this.buf = new Float32Array(512); this.fill = 0;
        this.port.postMessage({ pcm: out }, [out.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('x32-tap', X32Tap);`;

  async function openCapture(deviceId, handlers) {
    // Kein Echo-Filter, keine Rauschunterdrückung, keine automatische Verstärkung: sonst wäre die Messung verfälscht
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 32 } };
    if (deviceId) audio.deviceId = { exact: deviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    const track = stream.getAudioTracks()[0];
    const rate = (track.getSettings() || {}).sampleRate;
    let ctx;
    try { ctx = new AudioContext(rate ? { sampleRate: rate, latencyHint: 'interactive' } : { latencyHint: 'interactive' }); }
    catch (e) { ctx = new AudioContext({ latencyHint: 'interactive' }); }
    const cap = { stream, ctx, node: null, src: null, sink: null, fs: ctx.sampleRate, setChannel() {}, close };
    try {
      await ctx.resume();
      cap.src = ctx.createMediaStreamSource(stream);
      cap.sink = ctx.createGain(); cap.sink.gain.value = 0;   // nichts auf die Lautsprecher (sonst Rückkopplung)
      cap.sink.connect(ctx.destination);
      track.addEventListener('ended', () => handlers.onEnded && handlers.onEnded());
      let worklet = !Measure.forceScriptProcessor && !!ctx.audioWorklet;
      if (worklet) {
        const url = URL.createObjectURL(new Blob([TAP_SRC], { type: 'application/javascript' }));
        try {
          await ctx.audioWorklet.addModule(url);
          cap.node = new AudioWorkletNode(ctx, 'x32-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
          cap.node.port.onmessage = (e) => {
            if (e.data.pcm) handlers.onChunk(e.data.pcm);
            else if (e.data.channels) handlers.onChannels(e.data.channels);
          };
          cap.setChannel = (c) => cap.node.port.postMessage({ channel: c });
          cap.mode = 'worklet';
        } catch (e) { worklet = false; }
        finally { URL.revokeObjectURL(url); }
      }
      if (!worklet) {                                          // Ersatzweg, falls der AudioWorklet nicht lädt
        const nch = Math.max(1, (track.getSettings() || {}).channelCount || 1);
        let sel = 0;
        cap.node = ctx.createScriptProcessor(2048, nch, 1);
        cap.node.onaudioprocess = (e) => {
          const b = e.inputBuffer, n = b.length, out = new Float32Array(n);
          if (sel < 0) { for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / b.numberOfChannels; } }
          else out.set(b.getChannelData(Math.min(sel, b.numberOfChannels - 1)));
          handlers.onChunk(out);
        };
        cap.setChannel = (c) => { sel = c; };
        cap.mode = 'scriptprocessor';
        handlers.onChannels(nch);
      }
      cap.src.connect(cap.node);
      cap.node.connect(cap.sink);
    } catch (e) { close(); throw e; }
    function close() {
      try { if (cap.node) { cap.node.disconnect(); if (cap.node.port) cap.node.port.onmessage = null; cap.node.onaudioprocess = null; } } catch (e) {}
      try { cap.src && cap.src.disconnect(); } catch (e) {}
      try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      try { ctx.close(); } catch (e) {}
    }
    return cap;
  }

  // ---------- Zustand ----------
  const S = { running: false, starting: false, cap: null, meter: null, spectrum: null, fs: 48000, channels: 1, snap: null,
    avg: null, hold: null, levels: null, hover: -1, calibrating: null, warm: false, devices: [], perm: 'unknown', rew: null, visible: false, raf: 0 };
  let root = null, ui = null;

  const calKey = () => (cfg.deviceLabel || cfg.deviceId || 'Standard') + '#' + cfg.channel;
  const offset = () => (Object.prototype.hasOwnProperty.call(cals, calKey()) ? cals[calKey()] : null);
  const level = (dbfs) => (isFinite(dbfs) ? dbfs + (offset() || 0) : null);
  const fmt = (dbfs) => { const v = level(dbfs); return v === null ? '–' : v.toFixed(1); };
  const unit = () => (offset() === null ? 'dBFS(' + cfg.weighting + ')' : 'dB(' + cfg.weighting + ')');

  // ---------- Aufbau ----------
  const GEAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  const TEMPLATE = `
  <div class="lp">
    <div class="lp-head">
      <div class="lp-title">Live-Pegel</div>
      <button id="m-start" class="btn small">Start</button>
      <select id="m-device" class="lp-sel" aria-label="Eingang"></select>
      <select id="m-channel" class="lp-sel lp-sel-narrow" aria-label="Kanal"></select>
      <span id="m-cal-badge" class="m-badge warn">nicht kalibriert</span>
      <button id="m-gear" class="lp-gear" title="Kalibrierung, Grenzwert, REW-Programm" aria-label="Einstellungen">${GEAR}</button>
    </div>
    <div id="m-notice" class="m-notice" hidden></div>
    <div class="lp-body">
      <div class="lp-left">
        <div class="m-readout"><span id="m-value" class="m-value">–</span><span id="m-unit" class="m-unit">dB(A)</span></div>
        <div class="m-bar"><div class="m-bar-fill" id="m-bar-fill"></div><div class="m-bar-max" id="m-bar-max"></div><div class="m-bar-limit" id="m-bar-limit" hidden></div></div>
        <div class="m-bar-scale" id="m-bar-scale"></div>
        <div class="lp-stats">
          <span class="lp-stat" id="m-leq30-card">Leq 30 min <b id="m-leq30">–</b> <i id="m-leq30-s">gleitend</i></span>
          <span class="lp-stat">Max <b id="m-max">–</b></span>
          <button id="m-reset" class="lp-reset" title="Maximum zurücksetzen" aria-label="Maximum zurücksetzen">↺</button>
        </div>
      </div>
      <div class="lp-right">
        <div class="lp-chart"><div class="lp-chart-title">Pegelverlauf <span id="m-hist-read" class="m-rta-read"></span><button id="m-hist-save" class="lp-link" title="Verlauf als CSV-Datei speichern">CSV</button></div><canvas id="m-hist" class="m-hist"></canvas></div>
        <div class="lp-chart"><div class="lp-chart-title">Spektrum <span id="m-rta-read" class="m-rta-read"></span></div><canvas id="m-rta" class="m-rta"></canvas></div>
      </div>
    </div>
    <div id="m-settings" class="lp-settings" hidden>
      <section>
        <div class="m-card-title">Kalibrierung</div>
        <p class="m-help">Ohne Kalibrierung zeigt die App nur relative Werte (dBFS). Kalibrator (z. B. 94 dB bei 1 kHz) auf das Mikrofon setzen, Referenzpegel eintragen, Kalibrieren drücken. Oder ein Referenz-Messgerät gleichzeitig ablesen und dessen Wert eintragen.</p>
        <div class="m-row"><label class="m-field m-field-narrow"><span>Referenzpegel (dB)</span><input id="m-ref" type="number" step="0.1" min="30" max="140"></label>
          <button id="m-cal" class="btn secondary small">Kalibrieren (3 s)</button><button id="m-cal-reset" class="btn secondary small">Zurücksetzen</button></div>
        <p class="m-help small" id="m-cal-info"></p>
      </section>
      <section>
        <div class="m-card-title">Grenzwert-Warnung</div>
        <div class="m-row"><label class="m-check"><input id="m-limit-on" type="checkbox"> Warnung ab</label>
          <input id="m-limit" class="m-num" type="number" step="0.5" min="30" max="140"> <span class="m-unit-s">dB(A)</span></div>
        <p class="m-help small">Färbt Pegel und Leq gelb/rot, sobald der Wert nahe am Grenzwert liegt. Für Veranstaltungen ist z. B. 99 dB(A) als Mittelwert über 30 Minuten üblich (DIN 15905-5). Nur mit Kalibrierung aussagekräftig.</p>
      </section>
      <section>
        <div class="m-card-title">REW</div>
        <p class="m-help" id="m-rew-info">Suche REW…</p>
        <div class="m-row"><button id="m-rew-choose" class="btn secondary small">Programm wählen…</button><button id="m-rew-dl" class="btn secondary small">REW herunterladen</button></div>
        <p class="m-help small">Der Knopf „REW öffnen“ oben startet REW. Dort dasselbe Interface als Eingang wählen. Beim Öffnen wird die Live-Pegel-Anzeige angehalten, damit das Interface frei ist.</p>
      </section>
    </div>
  </div>`;

  function build(rootEl) {
    root = rootEl;
    root.innerHTML = TEMPLATE;
    const q = (id) => root.querySelector('#' + id);
    ui = {
      device: q('m-device'), channel: q('m-channel'), start: q('m-start'), notice: q('m-notice'), gear: q('m-gear'), settings: q('m-settings'),
      value: q('m-value'), unit: q('m-unit'),
      barFill: q('m-bar-fill'), barMax: q('m-bar-max'), barLimit: q('m-bar-limit'), barScale: q('m-bar-scale'),
      leq30: q('m-leq30'), leq30s: q('m-leq30-s'), leq30card: q('m-leq30-card'), max: q('m-max'), reset: q('m-reset'),
      canvas: q('m-rta'), rtaRead: q('m-rta-read'), hist: q('m-hist'), histRead: q('m-hist-read'), histSave: q('m-hist-save'),
      ref: q('m-ref'), cal: q('m-cal'), calReset: q('m-cal-reset'), calBadge: q('m-cal-badge'), calInfo: q('m-cal-info'),
      limitOn: q('m-limit-on'), limit: q('m-limit'),
      rewInfo: q('m-rew-info'), rewChoose: q('m-rew-choose'), rewDl: q('m-rew-dl'),
    };
    ui.ref.value = cfg.ref; ui.limitOn.checked = !!cfg.limitOn; ui.limit.value = cfg.limit;

    ui.start.addEventListener('click', () => (S.running ? stop() : start()));
    ui.gear.addEventListener('click', () => { ui.settings.hidden = !ui.settings.hidden; ui.gear.classList.toggle('on', !ui.settings.hidden); setTimeout(() => { drawRta(); drawHist(); }, 0); });
    ui.device.addEventListener('change', () => {
      const opt = ui.device.selectedOptions[0];
      cfg.deviceId = ui.device.value; cfg.deviceLabel = opt ? opt.dataset.label || '' : ''; cfg.channel = 0; persistCfg();
      if (S.running) start(); else updateCalUi();
    });
    ui.channel.addEventListener('change', () => {
      cfg.channel = parseInt(ui.channel.value, 10); persistCfg();
      if (S.cap) { S.cap.setChannel(cfg.channel); freshMeters(); }
      updateCalUi(); buildScale();
    });
    ui.reset.addEventListener('click', () => { if (S.meter) S.meter.resetHold(); if (S.hold) S.hold.fill(-Infinity); paintText(true); });
    ui.ref.addEventListener('change', () => { cfg.ref = clamp(parseFloat(ui.ref.value) || 94, 30, 140); ui.ref.value = cfg.ref; persistCfg(); });
    ui.cal.addEventListener('click', calibrate);
    ui.calReset.addEventListener('click', () => { delete cals[calKey()]; save(CAL_KEY, cals); updateCalUi(); buildScale(); paintText(true); });
    ui.limitOn.addEventListener('change', () => { cfg.limitOn = ui.limitOn.checked; persistCfg(); paintText(true); });
    ui.limit.addEventListener('change', () => { cfg.limit = clamp(parseFloat(ui.limit.value) || 99, 30, 140); ui.limit.value = cfg.limit; persistCfg(); paintText(true); });
    ui.histSave.addEventListener('click', saveProtocol);
    ui.rewChoose.addEventListener('click', chooseRew);
    ui.rewDl.addEventListener('click', () => api.rewDownload());
    ui.canvas.addEventListener('mousemove', (e) => { const r = ui.canvas.getBoundingClientRect(); S.hover = Math.floor((e.clientX - r.left - RTA.left) / ((r.width - RTA.left - RTA.right) / SPL.THIRD_OCTAVE_CENTERS.length)); drawRta(); });
    ui.canvas.addEventListener('mouseleave', () => { S.hover = -1; drawRta(); });
    if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => { drawRta(); drawHist(); }); ro.observe(ui.canvas); ro.observe(ui.hist); }
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => { if (S.visible && S.perm === 'granted') refreshDevices(); });
    updateCalUi(); buildScale(); paintText(true); drawRta();
  }

  // ---------- Hinweis-Leiste ----------
  function notice(text, actions, kind) {
    if (!text) { ui.notice.hidden = true; ui.notice.innerHTML = ''; return; }
    ui.notice.hidden = false;
    ui.notice.className = 'm-notice ' + (kind || '');
    ui.notice.innerHTML = '<span>' + esc(text) + '</span>';
    (actions || []).forEach((a) => {
      const b = document.createElement('button'); b.className = 'btn small'; b.textContent = a.label; b.addEventListener('click', a.fn); ui.notice.appendChild(b);
    });
  }

  // ---------- Geräte ----------
  // Gerätenamen gibt Chrome erst frei, wenn einmal ein Mikrofon geöffnet war. Steht der Zugriff schon (perm = granted),
  // öffnen wir es dafür kurz und schließen es sofort wieder.
  let probed = false;
  async function refreshDevices() {
    let list = [];
    const read = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    try {
      list = await read();
      if (!probed && S.perm === 'granted' && list.every((d) => !d.label)) {
        probed = true;
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        list = await read();
      }
    } catch (e) {}
    S.devices = list;
    ui.device.innerHTML = '';
    if (!list.length) { ui.device.innerHTML = '<option value="">Kein Eingang gefunden</option>'; return; }
    let selected = list.find((d) => d.deviceId === cfg.deviceId) || (cfg.deviceLabel && list.find((d) => d.label && d.label === cfg.deviceLabel));
    if (!selected) selected = list.find((d) => d.deviceId !== 'default' && d.deviceId !== 'communications') || list[0];
    list.forEach((d) => {
      const o = document.createElement('option');
      o.value = d.deviceId; o.dataset.label = d.label || '';
      o.textContent = (d.deviceId === 'default' ? 'Systemstandard' + (d.label ? ' – ' + d.label.replace(/^Default - /, '') : '') : d.label) || 'Eingang ' + (ui.device.options.length + 1);
      if (d === selected) o.selected = true;
      ui.device.appendChild(o);
    });
    cfg.deviceId = selected.deviceId; cfg.deviceLabel = selected.label || cfg.deviceLabel; persistCfg();
    updateCalUi();
  }

  function fillChannels(n) {
    S.channels = n;
    ui.channel.innerHTML = '';
    for (let i = 0; i < Math.min(n, 32); i++) { const o = document.createElement('option'); o.value = i; o.textContent = 'Kanal ' + (i + 1); ui.channel.appendChild(o); }
    if (n > 1) { const o = document.createElement('option'); o.value = -1; o.textContent = 'Alle gemittelt'; ui.channel.appendChild(o); }
    if (cfg.channel >= n) cfg.channel = 0;
    ui.channel.value = cfg.channel;
    ui.channel.disabled = n <= 1;
  }

  async function ensurePermission() {
    S.perm = await api.micRequest();
    if (S.perm === 'granted') { notice(''); return true; }
    if (S.perm === 'not-determined') notice('Für die Messung braucht die App Zugriff auf das Mikrofon bzw. das Audio-Interface.', [{ label: 'Zugriff erlauben', fn: start }], 'warn');
    else notice('Der Zugriff auf das Mikrofon ist ausgeschaltet. In den Systemeinstellungen unter Datenschutz & Sicherheit → Mikrofon „X32 Fernsteuerung“ einschalten, danach hier erneut starten.', [{ label: 'Systemeinstellungen öffnen', fn: () => api.openMicSettings() }], 'bad');
    return false;
  }

  // ---------- Start / Stop ----------
  function freshMeters() {
    S.meter = new SPL.SplMeter(S.fs); S.spectrum = new SPL.Spectrum(S.fs, FFT_SIZE);
    S.startedAt = Date.now(); histCount = -1;
    S.avg = null; S.hold = new Float64Array(SPL.THIRD_OCTAVE_CENTERS.length).fill(-Infinity); S.levels = null; S.snap = null; S.warm = false;
    S.calibrating = null;
  }

  async function start() {
    if (S.starting) return;
    S.starting = true; ui.start.disabled = true;
    try {
      stop(true);
      if (!(await ensurePermission())) return;
      await refreshDevices();
      let cap;
      try {
        cap = await openCapture(cfg.deviceId, {
          onChunk: onChunk,
          onChannels: (n) => { fillChannels(n); if (S.cap) S.cap.setChannel(cfg.channel); },
          onEnded: () => { if (S.cap === cap) { stop(); notice('Das Eingabegerät wurde getrennt. Bitte Interface prüfen und erneut starten.', [], 'bad'); } },
        });
      } catch (e) { notice(captureError(e), e && e.name === 'NotAllowedError' ? [{ label: 'Systemeinstellungen öffnen', fn: () => api.openMicSettings() }] : [], 'bad'); return; }
      S.cap = cap; S.fs = cap.fs; freshMeters();
      cap.setChannel(cfg.channel);
      S.running = true;
      await refreshDevices();                       // jetzt sind die Gerätenamen bekannt
      ui.start.textContent = 'Stopp'; ui.start.classList.add('running');
      notice('');
      updateCalUi(); buildScale(); startLoop();
    } finally { S.starting = false; ui.start.disabled = false; }
  }

  function captureError(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Zugriff auf das Mikrofon wurde nicht erlaubt. In den Systemeinstellungen unter Datenschutz & Sicherheit → Mikrofon „X32 Fernsteuerung“ einschalten.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Das gewählte Eingabegerät wurde nicht gefunden. Ist das Interface eingesteckt und eingeschaltet?';
    if (n === 'NotReadableError' || n === 'AbortError') return 'Das Eingabegerät lässt sich nicht öffnen – es wird vielleicht von einem anderen Programm benutzt.';
    return 'Die Messung konnte nicht gestartet werden: ' + ((e && e.message) || e);
  }

  function stop(silent) {
    if (S.cap) { S.cap.close(); S.cap = null; }
    S.running = false; S.calibrating = null;
    if (!ui) return;
    ui.start.textContent = 'Start'; ui.start.classList.remove('running');
    ui.cal.disabled = false; ui.cal.textContent = 'Kalibrieren (' + CAL_SECONDS + ' s)';
    if (!silent) { paintText(true); drawRta(); }
  }

  function onChunk(pcm) {
    if (!S.meter) return;
    S.meter.push(pcm); S.spectrum.push(pcm);
    if (!S.warm && S.meter.total >= S.fs * WARMUP_S) { S.warm = true; S.meter.resetHold(); }
  }

  // ---------- Kalibrierung ----------
  function calibrate() {
    if (!S.running || !S.meter) { notice('Zum Kalibrieren zuerst die Messung starten.', [], 'warn'); return; }
    if (S.calibrating) return;
    S.meter.beginCapture();
    S.calibrating = { ref: cfg.ref };
    ui.cal.disabled = true;
  }
  function calStep() {
    const c = S.calibrating;
    if (!c || !S.meter) return;
    const r = S.meter.capture('A');
    ui.cal.textContent = 'Kalibriere… ' + Math.max(0, Math.ceil(CAL_SECONDS - r.seconds)) + ' s';
    if (r.seconds < CAL_SECONDS) return;
    S.meter.endCapture(); S.calibrating = null;
    ui.cal.disabled = false; ui.cal.textContent = 'Kalibrieren (' + CAL_SECONDS + ' s)';
    if (!(r.level > -80)) { notice('Zu wenig Signal zum Kalibrieren (' + (isFinite(r.level) ? r.level.toFixed(0) + ' dBFS' : 'Stille') + '). Kalibrator eingeschaltet und am Mikrofon? Phantomspeisung (48 V) am Interface an? Eingangsverstärkung hoch genug?', [], 'bad'); return; }
    if (r.level > -3) { notice('Das Signal ist übersteuert (' + r.level.toFixed(1) + ' dBFS). Eingangsverstärkung am Interface verringern und erneut kalibrieren.', [], 'bad'); return; }
    cals[calKey()] = c.ref - r.level; save(CAL_KEY, cals);
    S.meter.resetHold(); if (S.hold) S.hold.fill(-Infinity);
    notice('Kalibriert: ' + c.ref.toFixed(1) + ' dB entsprechen ' + r.level.toFixed(1) + ' dBFS. Bei geänderter Verstärkung am Interface bitte neu kalibrieren.', [], 'good');
    updateCalUi(); buildScale(); paintText(true);
  }
  function updateCalUi() {
    const o = offset();
    ui.calBadge.textContent = o === null ? 'nicht kalibriert' : 'kalibriert'; ui.calBadge.className = 'm-badge ' + (o === null ? 'warn' : 'good');
    const dev = cfg.deviceLabel || 'Eingang';
    ui.calInfo.textContent = o === null ? 'Für „' + dev + '“, Kanal ' + (cfg.channel < 0 ? 'gemittelt' : cfg.channel + 1) + ' liegt noch keine Kalibrierung vor.' : 'Offset ' + (o >= 0 ? '+' : '') + o.toFixed(1) + ' dB, gespeichert für „' + dev + '“, Kanal ' + (cfg.channel < 0 ? 'gemittelt' : cfg.channel + 1) + '. Gilt nur bei unveränderter Interface-Verstärkung.';
    ui.calReset.disabled = o === null;
    ui.unit.textContent = unit();
  }

  // ---------- Anzeige ----------
  const range = () => (offset() === null ? [-90, 0] : [30, 130]);
  function pct(dbfs) {
    const v = level(dbfs); if (v === null) return 0;
    const [lo, hi] = range();
    return clamp((v - lo) / (hi - lo), 0, 1) * 100;
  }
  function buildScale() {
    const [lo, hi] = range(), step = offset() === null ? 15 : 20;
    ui.barScale.innerHTML = '';
    for (let v = lo; v <= hi; v += step) { const t = document.createElement('span'); t.style.left = ((v - lo) / (hi - lo) * 100) + '%'; t.textContent = v; ui.barScale.appendChild(t); }
    ui.unit.textContent = unit();
  }
  const limitState = (v) => (!cfg.limitOn || offset() === null || cfg.weighting !== 'A' || v === null ? '' : v >= cfg.limit ? 'over' : v >= cfg.limit - 3 ? 'near' : '');

  function paintBar() {
    const w = S.snap && S.snap.w[cfg.weighting];
    ui.barFill.style.left = (w ? pct(w[cfg.tc]) : 0) + '%';
    ui.barMax.style.left = (w ? pct(cfg.tc === 'fast' ? w.maxFast : w.maxSlow) : 0) + '%';
    ui.barMax.hidden = !w || !isFinite(cfg.tc === 'fast' ? w.maxFast : w.maxSlow);
    const showLimit = cfg.limitOn && offset() !== null && cfg.weighting === 'A';
    ui.barLimit.hidden = !showLimit;
    if (showLimit) { const [lo, hi] = range(); ui.barLimit.style.left = clamp((cfg.limit - lo) / (hi - lo), 0, 1) * 100 + '%'; }
  }

  function paintText(force) {
    if (S.meter) S.snap = S.meter.snapshot();
    const w = S.snap && S.snap.w[cfg.weighting];
    const val = w ? w[cfg.tc] : -Infinity;
    ui.value.textContent = w ? fmt(val) : '–';
    ui.unit.textContent = unit();
    ui.value.className = 'm-value ' + limitState(level(val));
    ui.leq30.textContent = w ? fmt(w.leq30) : '–';
    ui.leq30s.textContent = w && w.leq30Seconds > 0 ? 'über ' + (w.leq30Seconds >= 90 ? Math.round(w.leq30Seconds / 60) + ' min' : Math.round(w.leq30Seconds) + ' s') : 'gleitend';
    ui.leq30card.className = 'lp-stat ' + limitState(w ? level(w.leq30) : null);
    ui.max.textContent = w ? fmt(cfg.tc === 'fast' ? w.maxFast : w.maxSlow) : '–';
    paintBar();
    const cnt = S.meter ? S.meter.chains[0].count : 0;
    if (force || cnt !== histCount) { histCount = cnt; drawHist(); }
  }

  // Diagrammfarben folgen dem Design (Variablen --chart, --chart-hi, --chart-lo)
  function chartColors() {
    const cs = getComputedStyle(document.body), v = (n, d) => cs.getPropertyValue(n).trim() || d;
    return { main: v('--chart', '#3DC7E8'), hi: v('--chart-hi', '#8EEBFA'), lo: v('--chart-lo', '#1E93B0') };
  }

  // Spektrum
  const RTA = { left: 34, right: 8, top: 10, bottom: 22 };
  function updateSpectrum() {
    if (!S.spectrum) return;
    const p = S.spectrum.bandPowers();
    if (!p) return;
    if (!S.avg) S.avg = Float64Array.from(p);
    else for (let i = 0; i < p.length; i++) S.avg[i] += 0.4 * (p[i] - S.avg[i]);
    S.levels = Array.from(S.avg, (v) => (v > 1e-20 ? 10 * Math.log10(v) : -Infinity));
    S.levels.forEach((v, i) => { S.hold[i] = Math.max(v, S.hold[i] - 0.8); });   // Spitzenmarke fällt ca. 12 dB/s
  }
  function drawRta() {
    const c = ui && ui.canvas;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1, cw = c.clientWidth, ch = c.clientHeight;
    if (!cw || !ch) return;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const n = SPL.THIRD_OCTAVE_CENTERS.length, x0 = RTA.left, x1 = cw - RTA.right, y0 = RTA.top, y1 = ch - RTA.bottom;
    const [lo, hi] = offset() === null ? [-100, 0] : [20, 120];
    const yOf = (v) => y1 - clamp((v - lo) / (hi - lo), 0, 1) * (y1 - y0);
    g.font = '10px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
    for (let v = lo; v <= hi; v += 10) {
      g.strokeStyle = v % 20 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, Math.round(yOf(v)) + 0.5); g.lineTo(x1, Math.round(yOf(v)) + 0.5); g.stroke();
      if (v % 20 === 0) { g.fillStyle = '#7C8698'; g.textAlign = 'right'; g.fillText(v, x0 - 5, yOf(v)); }
    }
    const bw = (x1 - x0) / n;
    g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = '#7C8698';
    SPL.THIRD_OCTAVE_LABELS.forEach((l, i) => { if ([2, 5, 8, 11, 14, 17, 20, 23, 26, 29].includes(i)) g.fillText(l, x0 + (i + 0.5) * bw, y1 + 5); });
    const col = chartColors();
    if (S.levels) {
      S.levels.forEach((v, i) => {
        const lv = v + (offset() || 0);
        if (isFinite(lv) && lv > lo) {
          const top = yOf(lv);
          const grad = g.createLinearGradient(0, y1, 0, y0); grad.addColorStop(0, col.lo); grad.addColorStop(0.7, col.main); grad.addColorStop(1, col.hi);
          g.fillStyle = i === S.hover ? col.hi : grad; g.fillRect(x0 + i * bw + 1, top, Math.max(1, bw - 2), y1 - top);
        }
        const hv = S.hold[i] + (offset() || 0);
        if (isFinite(hv) && hv > lo) { g.fillStyle = 'rgba(231,235,240,0.75)'; g.fillRect(x0 + i * bw + 1, yOf(hv) - 1, Math.max(1, bw - 2), 2); }
      });
    } else {
      g.fillStyle = '#7C8698'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(S.running ? 'Sammle Daten…' : 'Messung starten, um das Spektrum zu sehen', (x0 + x1) / 2, (y0 + y1) / 2);
    }
    const hi_ = S.hover >= 0 && S.hover < n && S.levels ? S.hover : -1;
    ui.rtaRead.textContent = hi_ >= 0 ? SPL.THIRD_OCTAVE_LABELS[hi_] + ' Hz: ' + (isFinite(S.levels[hi_]) ? (S.levels[hi_] + (offset() || 0)).toFixed(1) : '–') + (offset() === null ? ' dBFS' : ' dB') : '';
  }

  // Pegelverlauf: Leq je Sekunde, links älteste, rechts jetzt
  let histCount = -1;
  function drawHist() {
    const c = ui && ui.hist;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1, cw = c.clientWidth, ch = c.clientHeight;
    if (!cw || !ch) return;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
    const H = { left: 34, right: 8, top: 8, bottom: 20 };
    const x0 = H.left, x1 = cw - H.right, y0 = H.top, y1 = ch - H.bottom;
    const [lo, hi] = range();
    const yOf = (v) => y1 - clamp((v - lo) / (hi - lo), 0, 1) * (y1 - y0);
    g.font = '10px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
    for (let v = lo; v <= hi; v += (offset() === null ? 30 : 20)) {
      g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, Math.round(yOf(v)) + 0.5); g.lineTo(x1, Math.round(yOf(v)) + 0.5); g.stroke();
      g.fillStyle = '#7C8698'; g.textAlign = 'right'; g.fillText(v, x0 - 5, yOf(v));
    }
    const h = S.meter ? S.meter.history(cfg.weighting) : { values: [], first: 0 };
    const n = h.values.length, span = Math.max(60, n);            // erste Minute: Linie wächst von links
    const xOf = (k) => x0 + (k + 0.5) / span * (x1 - x0);
    g.fillStyle = '#7C8698'; g.textBaseline = 'top'; g.textAlign = 'left';
    g.fillText(span >= 120 ? '-' + Math.round(span / 60) + ' min' : '-' + span + ' s', x0, y1 + 5);
    g.textAlign = 'right'; g.fillText('jetzt', x1, y1 + 5);
    if (cfg.limitOn && offset() !== null && cfg.weighting === 'A') {
      g.strokeStyle = 'rgba(225,96,76,0.9)'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(x0, yOf(cfg.limit)); g.lineTo(x1, yOf(cfg.limit)); g.stroke(); g.setLineDash([]);
    }
    if (n) {
      g.strokeStyle = chartColors().main; g.lineWidth = 1.8; g.lineJoin = 'round'; g.beginPath();
      let pen = false;
      h.values.forEach((v, k) => {
        const l = level(v);
        if (l === null) { pen = false; return; }
        if (pen) g.lineTo(xOf(k), yOf(l)); else { g.moveTo(xOf(k), yOf(l)); pen = true; }
      });
      g.stroke();
      const finite = h.values.filter(isFinite);
      const w = S.snap && S.snap.w[cfg.weighting];
      ui.histRead.textContent = finite.length ? 'Max ' + fmt(Math.max(...finite)) + ' · Leq ' + fmt(w ? w.leq : -Infinity) + (offset() === null ? ' dBFS' : ' dB') : '';
    } else {
      ui.histRead.textContent = '';
      g.fillStyle = '#7C8698'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(S.running ? 'Sammle Daten…' : 'Messung starten, um den Verlauf zu sehen', (x0 + x1) / 2, (y0 + y1) / 2);
    }
  }

  // Protokoll als CSV (Excel-freundlich: Semikolon, Dezimalkomma)
  const p2 = (n) => String(n).padStart(2, '0');
  const clock = (d) => p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  function buildCsv() {
    if (!S.meter) return null;
    const h = S.meter.history(cfg.weighting);
    if (!h.values.length) return null;
    const o = offset(), w = cfg.weighting, snap = S.meter.snapshot().w[w];
    const dec = (v) => (isFinite(v) ? (v + (o || 0)).toFixed(1).replace('.', ',') : '');
    const unitTxt = (o === null ? 'dBFS' : 'dB') + '(' + w + ')';
    const start = new Date(S.startedAt + (h.first + 1) * 1000);
    const finite = h.values.filter(isFinite);
    const lines = [
      'X32 Fernsteuerung - Pegelprotokoll',
      'Eingang;' + (cfg.deviceLabel || 'unbekannt'),
      'Kanal;' + (cfg.channel < 0 ? 'gemittelt' : cfg.channel + 1),
      'Bewertung;' + w + ' (Leq je Sekunde)',
      'Kalibriert;' + (o === null ? 'nein (Werte in dBFS, nicht in dB SPL)' : 'ja, Offset ' + o.toFixed(1).replace('.', ',') + ' dB'),
      'Beginn;' + p2(start.getDate()) + '.' + p2(start.getMonth() + 1) + '.' + start.getFullYear() + ' ' + clock(start),
      'Dauer;' + h.values.length + ' s',
      'Leq gesamt (' + unitTxt + ');' + dec(snap.leq),
      'Hoechster 1-s-Wert (' + unitTxt + ');' + dec(Math.max(...finite)),
      'Spitze (' + unitTxt + ');' + dec(snap.peak),
      '',
      'Uhrzeit;Sekunde;Leq 1 s (' + unitTxt + ')',
    ];
    h.values.forEach((v, k) => lines.push(clock(new Date(S.startedAt + (h.first + k + 1) * 1000)) + ';' + (h.first + k + 1) + ';' + dec(v)));
    return lines.join('\r\n') + '\r\n';
  }
  async function saveProtocol() {
    const csv = buildCsv();
    if (!csv) { say('Noch keine Messdaten – mindestens 1 Sekunde messen.', true); return; }
    const d = new Date(S.startedAt);
    const r = await api.saveTextFile('Pegelprotokoll_' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()) + '.csv', csv);
    if (r.ok) say('Protokoll gespeichert.');
    else if (!r.canceled) say('Speichern fehlgeschlagen: ' + (r.error || 'unbekannt'), true);
  }

  // Zeichenschleife: Balken jedes Bild, Zahlen ~8x pro Sekunde, Spektrum ~15x pro Sekunde
  let lastText = 0, lastRta = 0;
  function loop(now) {
    S.raf = 0;
    if (!S.visible) return;
    if (S.running) {
      if (S.meter) { S.snap = S.meter.snapshot(); paintBar(); }
      if (now - lastText >= 120) { lastText = now; paintText(); calStep(); }
      if (now - lastRta >= 66) { lastRta = now; updateSpectrum(); drawRta(); }
      S.raf = requestAnimationFrame(loop);
    }
  }
  function startLoop() { if (!S.raf && S.visible) S.raf = requestAnimationFrame(loop); }

  // ---------- REW ----------
  async function refreshRew() {
    S.rew = await api.rewStatus();
    if (!ui) return S.rew;
    ui.rewInfo.textContent = S.rew.found ? 'Gefunden: ' + S.rew.path : 'REW wurde auf diesem Mac nicht gefunden. Wenn es an einem anderen Ort liegt: „Programm wählen…“.';
    ui.rewDl.hidden = S.rew.found;
    return S.rew;
  }
  // "REW öffnen" (Knopf in der Kopfzeile): hält die Live-Anzeige an, startet REW; fehlt es, Auswahl anbieten
  async function openRew() {
    if (S.running) { stop(); say('Live-Pegel angehalten, das Interface ist frei für REW.'); }
    const r = await api.rewOpen();
    if (r.ok) say('REW wird geöffnet…');
    else if (r.notFound) { refreshRew(); rewMissingDialog(); }
    else say('REW konnte nicht gestartet werden: ' + (r.error || 'unbekannter Fehler'), true);
    return r;
  }
  function rewMissingDialog() {
    if (document.getElementById('rew-missing')) return;
    const overlay = document.createElement('div'); overlay.className = 'overlay'; overlay.id = 'rew-missing';
    const box = document.createElement('div'); box.className = 'detail-card'; box.style.maxWidth = '420px';
    box.innerHTML = '<div class="detail-header"><div class="section-title" style="margin:0;">REW nicht gefunden</div></div>' +
      '<p class="m-help">REW ist in „Programme“ nicht zu finden. Liegt es an einem anderen Ort, kannst du das Programm einmal auswählen, die App merkt es sich. Sonst hier herunterladen.</p>' +
      '<div class="m-row"><button class="btn" data-a="choose">Programm wählen…</button><button class="btn secondary" data-a="dl">REW herunterladen</button><button class="btn secondary" data-a="x">Abbrechen</button></div>';
    box.addEventListener('click', async (e) => {
      const a = e.target.dataset && e.target.dataset.a;
      if (!a) return;
      overlay.remove();
      if (a === 'choose') { const ok = await chooseRew(); if (ok) openRew(); }
      else if (a === 'dl') api.rewDownload();
    });
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }
  async function chooseRew() {
    const r = await api.rewChoose();
    if (r.ok) { say('REW-Programm gespeichert.'); refreshRew(); return true; }
    if (!r.canceled) say(r.error || 'Auswahl fehlgeschlagen.', true);
    return false;
  }

  // ---------- Öffentliche Schnittstelle ----------
  return {
    init(rootEl) { if (!root) build(rootEl); },
    async show() {
      if (!root) return;
      S.visible = true;
      refreshRew();
      S.perm = await api.micStatus();
      if (S.perm === 'granted') await refreshDevices();
      else if (!S.running) ui.device.innerHTML = '<option value="">Start drücken, dann Eingang wählen</option>';
      drawRta(); drawHist(); startLoop();
    },
    hide() { S.visible = false; if (S.running) stop(); },
    start, stop, openRew,
    forceScriptProcessor: false,
    buildCsv, drawHist, redraw() { drawRta(); drawHist(); },
    debug: () => ({ S, cfg, cals, offset: offset(), ui }),
  };
})();
