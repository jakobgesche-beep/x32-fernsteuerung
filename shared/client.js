// X32-Verbindungsschicht nach dem Muster von Mixing Station & Co.
//
// Ziele: (1) Änderungen am Pult sofort in der App, (2) Ziehen in der App sofort am Pult,
// (3) robust gegen verlorene UDP-Pakete (WLAN).
//
//  - lokaler Zwischenspeicher aller Werte (Pfad -> Pult-Wert)
//  - Handshake über /xinfo, Herzschlag /xremote alle 1,5 s, Verbindungsüberwachung, Auto-Reconnect
//  - Änderungen vom Pult kommen per /xremote und gehen SOFORT (ohne Wartezeit) an die Oberfläche
//  - periodische Schnappschüsse per /formatsubscribe (alle 100 ms alle Mute-/Fader-Werte der sichtbaren
//    Ebene in einem Paket): fällt ein Unterschied zum Zwischenspeicher auf, wird der echte Wert sofort
//    einzeln geholt. Ein verlorenes Paket korrigiert sich so nach ~100 ms. Nur ein Hinweis, nie direkt
//    angezeigt (falsche Format-Annahmen können keine falschen Werte anzeigen); wird abgeschaltet, wenn er nichts taugt.
//  - schnelles Nachfragen als Sicherheitsnetz: Mute alle 0,5 s, Fader alle 1 s (sichtbare Kanäle),
//    verlorene Pult-Meldungen fallen so spätestens nach ~0,5 s auf. Meldet das Pult von selbst
//    nichts (nur Nachfragen findet Änderungen), wird doppelt so schnell nachgefragt.
//  - eigene Änderungen: sofort lokal, sofort zum Pult (danach höchstens ~100 Pakete/s je Parameter,
//    immer mit dem neuesten Wert), Vorrang vor allen Hintergrundanfragen, danach ein Kontroll-Lesen;
//    stimmt der Wert am Pult nicht (Paket verloren), wird er automatisch erneut gesendet
//  - Anfragen in einem Fenster (max. 20 gleichzeitig offen, Timeout + Wiederholung)
// Unabhängig vom Netzwerk: Senden und Zeit werden von außen übergeben (testbar).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./osc"));
  else root.X32Client = factory(root.X32OSC);
})(typeof self !== "undefined" ? self : this, function (OSC) {
  const WINDOW = 20;              // gleichzeitig offene Anfragen
  const REQUEST_TIMEOUT = 500;    // ms bis zur Wiederholung
  const MAX_TRIES = 3;
  const TICK_MS = 5;
  const WRITE_INTERVAL = 10;      // ms zwischen zwei Schreibzugriffen auf denselben Parameter (~100/s)
  const WRITE_QUIET = 400;        // so lange nach dem letzten Schreiben ruhen Hintergrundanfragen
  const VERIFY_DELAY = 300;       // ms nach dem letzten Schreiben bis zum Kontroll-Lesen
  const VERIFY_GIVEUP = 1500;
  const HANDSHAKE_EVERY = 500;
  const HEARTBEAT_EVERY = 1500;   // /xremote + Ping (Pult braucht spätestens alle 10 s)
  const METER_RENEW_EVERY = 4000; // Meter-Abo läuft nach 10 s ab
  const DEAD_AFTER = 3000;        // keine Antwort -> Verbindung verloren
  const POLL_MUTE = 500;          // Nachfragen (Sicherheitsnetz) für sichtbare Werte, ms je Durchlauf
  const POLL_FADER = 1000;
  const POLL_OTHER = 2000;
  const MAX_POLL_QUEUE = 120;
  const ALL_EVERY = 60000;        // Nachgleich aller bekannten Werte
  const BATCH_GAP = 4;            // frühestens alle 4 ms eine Meldung an die Oberfläche (sonst sofort)
  const FAILED_RETRY_EVERY = 2000;
  const MAX_FAIL_ROUNDS = 6;
  const LOST_TOLERANCE = 0.02;    // Abweichung (normiert), ab der eine Änderung als verloren gilt
  const RTT_KEEP = 40;
  const SUB_TF = 2;               // Schnappschuss alle 50 ms * tf = 100 ms
  const SUB_RENEW_EVERY = 3000;   // Abo läuft am Pult nach 10 s ab
  const HINT_TOLERANCE = 5e-4;

  const isMute = (p) => /\/mix\/on$/.test(p) || /^\/dca\/\d\/on$/.test(p);
  const isFader = (p) => /\/mix\/fader$/.test(p) || /^\/dca\/\d\/fader$/.test(p);
  const pad2 = (n) => String(n).padStart(2, "0");

  class X32Client {
    constructor(opts) {
      this.send = opts.send;
      this.onBatch = opts.onBatch || (() => {});
      this.onMeter = opts.onMeter || (() => {});
      this.onStatus = opts.onStatus || (() => {});
      this.onLog = opts.onLog || (() => {});
      const t = opts.timers || {};
      this.now = t.now || (() => Date.now());
      this.setInterval = t.setInterval || ((f, ms) => setInterval(f, ms));
      this.clearInterval = t.clearInterval || ((h) => clearInterval(h));
      this.setTimeout = t.setTimeout || ((f, ms) => setTimeout(f, ms));
      this.clearTimeout = t.clearTimeout || ((h) => clearTimeout(h));

      this.values = new Map();
      this.known = new Set();
      this.hotGroups = {
        mute: { list: [], period: POLL_MUTE, credit: 0, i: 0 },
        fader: { list: [], period: POLL_FADER, credit: 0, i: 0 },
        other: { list: [], period: POLL_OTHER, credit: 0, i: 0 },
      };
      this.hotSet = new Set();
      this.qUrgent = [];
      this.qNormal = [];
      this.queued = new Set();
      this.inflight = new Map();
      this.tries = new Map();
      this.failed = new Set();
      this.failCount = new Map();
      this.dead = new Set();
      this.pending = new Map();
      this.changed = new Map();
      this.batchTimer = null;
      this.meterStreams = new Set(["0", "2"]);
      this.subs = new Map();
      this.hint = { pending: new Map(), ok: 0, bad: 0, badFormat: 0, disabled: false, lastBlobAt: 0 };
      this.lastSubRenew = 0;

      this.state = "idle"; // idle | connecting | online | lost
      this.info = null;
      this.rtt = null;
      this.rttSamples = [];
      this.pingHistory = [];
      this.lastRx = 0;
      this.pingSentAt = 0;
      this.timerHandle = null;
      this.lastHandshake = 0; this.lastHeartbeat = 0; this.lastMeterRenew = 0; this.lastPoll = 0;
      this.lastAll = 0; this.lastBatch = 0; this.lastStatus = 0; this.lastFailedRetry = 0;
      this.syncTotal = 0;
      this.pushHits = []; this.pollHits = []; this.pushBroken = false;
      this.netTest = null;
      this.ipcLat = []; this.paceLat = [];
      this.stats = { sent: 0, received: 0, retries: 0, failed: 0, writes: 0, resends: 0, pushChanges: 0, pollChanges: 0, hintFound: 0 };
    }

    // ---------- Lebenszyklus ----------
    start() {
      if (this.timerHandle) return;
      const t = this.now();
      this.lastRx = t; this.lastPoll = t;
      this.setState("connecting");
      this.timerHandle = this.setInterval(() => this.tick(), TICK_MS);
    }
    stop() {
      if (this.timerHandle) { this.clearInterval(this.timerHandle); this.timerHandle = null; }
      if (this.batchTimer) { this.clearTimeout(this.batchTimer); this.batchTimer = null; }
      for (const w of this.pending.values()) if (w.timer) this.clearTimeout(w.timer);
      this.pending.clear();
      this.inflight.clear(); this.tries.clear();
      this.setState("idle");
    }
    setState(state) {
      if (this.state === state) return;
      this.state = state;
      this.emitStatus(true);
    }
    rttStats() {
      const s = this.rttSamples;
      if (!s.length) return null;
      const sorted = s.slice().sort((a, b) => a - b);
      const avg = s.reduce((a, b) => a + b, 0) / s.length;
      return { min: sorted[0], avg, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], max: sorted[sorted.length - 1] };
    }
    pingLossPct() {
      const t = this.now();
      const relevant = this.pingHistory.filter((p) => p.ok || t - p.t > 1200);
      if (relevant.length < 5) return null;
      return (relevant.filter((p) => !p.ok).length / relevant.length) * 100;
    }
    emitStatus(force) {
      const t = this.now();
      if (!force && t - this.lastStatus < 250) return;
      this.lastStatus = t;
      const open = this.qUrgent.length + this.qNormal.length + this.inflight.size;
      const progress = this.syncTotal > 0 ? Math.max(0, Math.min(1, 1 - open / this.syncTotal)) : 1;
      this.onStatus({
        state: this.state, info: this.info, rtt: this.rtt, rttStats: this.rttStats(), loss: this.pingLossPct(),
        open, progress, stats: this.stats, known: this.known.size, cached: this.values.size,
        dead: Array.from(this.dead).slice(0, 40), pushBroken: this.pushBroken, appLatency: this.appLatencyStats(),
        hints: { active: this.subs.size > 0 && !this.hint.disabled, disabled: this.hint.disabled, found: this.stats.hintFound, ok: this.hint.ok, bad: this.hint.bad },
      });
    }
    log(msg) { this.onLog(msg); }

    // Eigene App-Verzögerung (gemessen auf diesem Rechner): Übergabe Oberfläche -> Netzwerkschicht und Wartezeit im Sendetakt
    noteAppLatency(ms) { this.ipcLat.push(Math.max(0, Math.min(1000, ms))); if (this.ipcLat.length > 200) this.ipcLat.shift(); }
    appLatencyStats() {
      const stat = (a) => (a.length ? { avg: a.reduce((x, y) => x + y, 0) / a.length, max: Math.max(...a) } : null);
      const i = stat(this.ipcLat), p = stat(this.paceLat);
      return i || p ? { ipc: i, pace: p, n: this.ipcLat.length } : null;
    }

    // ---------- Empfang ----------
    receive(u8) {
      const t = this.now();
      this.lastRx = t;
      this.stats.received++;
      let msg;
      try { msg = OSC.decodeMessage(u8); } catch (e) { return; }
      const address = msg.address, args = msg.args;
      if (address.startsWith("/meters/")) {
        const blob = args.find((a) => a.type === "b");
        if (blob) this.onMeter(address.slice(8), OSC.parseMeterBlob(blob.value));
        return;
      }
      if (address === "/xinfo") { this.onXinfo(args, t); return; }
      const spec = this.subs.get(address);
      if (spec) { const blob = args.find((a) => a.type === "b"); if (blob) this.onSubBlob(spec, blob.value, t); return; }
      if (!args.length || args[0].type === "b") return;
      if (this.netTest && this.netTest.sent.has(address)) { this.netTestReply(address, t); return; }
      this.applyIncoming(address, args[0].value, this.inflight.has(address), t);
    }

    onXinfo(args, t) {
      if (this.pingSentAt) {
        const d = t - this.pingSentAt;
        this.rtt = this.rtt == null ? d : this.rtt * 0.7 + d * 0.3;
        this.rttSamples.push(d);
        if (this.rttSamples.length > RTT_KEEP) this.rttSamples.shift();
        this.pingSentAt = 0;
      }
      const open = this.pingHistory.find((p) => !p.ok);
      if (open) open.ok = true;
      this.info = { ip: args[0] && args[0].value, name: args[1] && args[1].value, model: args[2] && args[2].value, version: args[3] && args[3].value };
      if (this.state === "connecting" || this.state === "lost") {
        this.dead.clear(); this.failCount.clear(); this.failed.clear();
        this.setState("online");
        this.lastHeartbeat = t; this.lastMeterRenew = t; this.lastAll = t; this.lastPoll = t;
        this.transmit("/xremote");
        this.renewMeters();
        this.sendSubs();
        this.lastSubRenew = t;
        this.refreshAll();
      } else this.emitStatus(false);
    }

    // Wert vom Pult (Antwort auf eine Anfrage oder eigene Meldung des Pults per /xremote)
    applyIncoming(path, v, isReply, t) {
      if (this.inflight.has(path)) { this.inflight.delete(path); this.tries.delete(path); this.failCount.delete(path); }
      if (this.hint.pending.has(path)) {           // Antwort auf eine durch einen Schnappschuss ausgelöste Anfrage
        const hv = this.hint.pending.get(path);
        this.hint.pending.delete(path);
        if (Math.abs(v - hv) <= HINT_TOLERANCE) { this.hint.ok++; if (this.values.get(path) !== v) this.stats.hintFound++; } else this.hint.bad++;
        this.checkHintHealth();
      }
      const w = this.pending.get(path);
      let fromVerify = false;
      if (w && !w.verifying) return;          // veraltetes Echo, solange wir noch schreiben
      if (w && w.verifying) {
        // Kontroll-Lesen: stimmt der Wert am Pult nicht (Paket verloren), einmal erneut senden
        const lost = w.type === "f" ? Math.abs(v - w.value) > LOST_TOLERANCE
          : w.type === "s" ? String(v).trimEnd() !== String(w.value).trimEnd() : v !== w.value;
        if (lost && w.retries < 2) {
          w.retries++; w.verifying = false; w.dirty = true; w.lastWrite = this.now();
          this.stats.resends++;
          return;
        }
        this.pending.delete(path);
        fromVerify = true;
      }
      const old = this.values.get(path);
      if (old === v || (typeof old === "number" && typeof v === "number" && Math.abs(old - v) < 1e-7)) return;
      this.values.set(path, v);
      this.changed.set(path, v);
      if (old !== undefined && !fromVerify) {   // echte Änderung (nicht nur Erst-Laden oder Kontroll-Lesen)
        (isReply ? this.pollHits : this.pushHits).push(t || this.now());
        if (isReply) this.stats.pollChanges++; else this.stats.pushChanges++;
      }
      this.scheduleBatch();
    }

    // Änderungen sofort an die Oberfläche; nur bei Dauerfeuer (>125/s) etwas gebündelt
    scheduleBatch() {
      if (this.batchTimer) return;
      const wait = BATCH_GAP - (this.now() - this.lastBatch);
      if (wait <= 0) this.flushBatch();
      else this.batchTimer = this.setTimeout(() => { this.batchTimer = null; this.flushBatch(); }, wait);
    }
    flushBatch() {
      if (!this.changed.size) return;
      this.lastBatch = this.now();
      const entries = Array.from(this.changed);
      this.changed.clear();
      this.onBatch(entries);
    }

    // ---------- Schnappschuss-Abos (/formatsubscribe) ----------
    // spec: { alias, pattern: "/ch/**/mix/on", i0, i1, kind: "int"|"float", tf }
    setSubs(specs) {
      this.subs = new Map(specs.map((s) => [s.alias, s]));
      if (this.state === "online") { this.sendSubs(); this.lastSubRenew = this.now(); }
    }
    sendSubs() {
      if (this.hint.disabled) return;
      for (const s of this.subs.values()) {
        this.transmit("/formatsubscribe", [
          { type: "s", value: s.alias }, { type: "s", value: s.pattern },
          { type: "i", value: s.i0 }, { type: "i", value: s.i1 }, { type: "i", value: s.tf == null ? SUB_TF : s.tf },
        ]);
      }
    }
    renewSubs() {
      if (this.hint.disabled) return;
      for (const alias of this.subs.keys()) this.transmit("/renew", [{ type: "s", value: alias }]);
    }
    subPath(spec, i) { return spec.pattern.replace(/\*+/, (m) => String(i).padStart(m.length, "0")); }
    onSubBlob(spec, blob, t) {
      if (this.hint.disabled) return;
      const count = spec.i1 - spec.i0 + 1;
      // Nutzlast: <int32 LE Länge in Bytes (inkl. sich selbst)><Werte>; Format prüfen, sonst ignorieren
      if (blob.byteLength < 8) return this.hintFormatBad();
      const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
      if (dv.getInt32(0, true) !== blob.byteLength || blob.byteLength / 4 - 1 !== count) return this.hintFormatBad();
      const vals = [];
      for (let k = 0; k < count; k++) {
        const v = spec.kind === "float" ? dv.getFloat32(4 + k * 4, true) : dv.getInt32(4 + k * 4, true);
        if (spec.kind === "float" ? !(v >= 0 && v <= 1) : (v !== 0 && v !== 1)) return this.hintFormatBad();
        vals.push(v);
      }
      this.hint.lastBlobAt = t;
      for (let k = 0; k < count; k++) this.onHint(this.subPath(spec, spec.i0 + k), vals[k], spec.kind);
    }
    onHint(path, v, kind) {
      if (this.pending.has(path)) return;                       // eigene Schreibvorgänge nicht stören
      const cur = this.values.get(path);
      if (cur === undefined) return;                            // noch nicht geladen: normales Laden kümmert sich
      const differs = kind === "float" ? Math.abs(cur - v) > HINT_TOLERANCE : cur !== v;
      if (!differs || this.hint.pending.has(path) || this.inflight.has(path) || this.queued.has(path)) return;
      this.hint.pending.set(path, v);
      this.request(path, true);                                 // den echten Wert sofort einzeln holen
    }
    hintFormatBad() {
      this.hint.badFormat++;
      this.checkHintHealth();
    }
    checkHintHealth() {
      const h = this.hint;
      if (h.disabled) return;
      if ((h.badFormat >= 5 && h.ok === 0) || (h.bad >= 12 && h.bad > 2 * h.ok)) {
        h.disabled = true;
        this.log("Schnappschuss-Abos abgeschaltet (Format passt nicht) – es wird nur nachgefragt");
      }
    }
    hintsHealthy(t) { return !this.hint.disabled && this.subs.size > 0 && t - this.hint.lastBlobAt < 1500; }

    // ---------- Anfragen ----------
    get(path) { return this.values.get(path); }

    request(path, urgent) {
      if (this.dead.has(path) || this.queued.has(path) || this.inflight.has(path)) return;
      this.queued.add(path);
      if (urgent) this.qUrgent.push(path); else this.qNormal.push(path);
    }
    openRequests() { return this.qUrgent.length + this.qNormal.length + this.inflight.size; }
    // Werte bereitstellen: fehlende werden geholt, alle werden künftig beim Nachgleich berücksichtigt
    want(paths) {
      const before = this.openRequests();
      for (const p of paths) {
        this.known.add(p);
        if (!this.values.has(p)) this.request(p, false);
      }
      const after = this.openRequests();
      this.syncTotal = before === 0 ? after : Math.max(this.syncTotal, after);
      this.emitStatus(false);
    }
    // sichtbare/aktive Werte: werden laufend nachgefragt (Sicherheitsnetz gegen verlorene Pult-Meldungen)
    setHot(paths) {
      const groups = { mute: [], fader: [], other: [] };
      for (const p of paths) (isMute(p) ? groups.mute : isFader(p) ? groups.fader : groups.other).push(p);
      for (const k of Object.keys(groups)) { this.hotGroups[k].list = groups[k]; this.hotGroups[k].i = 0; }
      this.hotSet = new Set(paths);
    }
    refresh(paths, urgent) { for (const p of paths) this.request(p, !!urgent); }
    refreshAll() {
      this.dead.clear(); this.failCount.clear();   // aufgegebene Pfade bekommen beim Voll-Abgleich eine neue Chance
      for (const p of this.known) this.request(p, false);
      this.syncTotal = this.openRequests();
      this.emitStatus(true);
    }
    snapshot() { return Array.from(this.values); }

    // ---------- Senden ----------
    transmit(address, args) {
      this.stats.sent++;
      this.send(OSC.encodeMessage(address, args));
    }

    // Parameter setzen: lokal sofort, zum Pult sofort (danach höchstens ~60/s), danach Kontroll-Lesen
    set(path, type, value) {
      if (this.state !== "online") {
        const old = this.values.get(path);
        if (old !== undefined) { this.changed.set(path, old); this.scheduleBatch(); } // Oberfläche zurücksetzen
        return false;
      }
      const t = this.now();
      let w = this.pending.get(path);
      if (!w && this.values.get(path) === value) return true;
      this.values.set(path, value);
      if (!w) { w = { type, value, lastSent: 0, dirty: true, dirtySince: t, lastWrite: t, verifying: false, verifyAt: 0, retries: 0, timer: null }; this.pending.set(path, w); }
      else { w.type = type; w.value = value; if (!w.dirty) w.dirtySince = t; w.dirty = true; w.lastWrite = t; w.verifying = false; w.retries = 0; }
      this.flushWrite(path, w, t);
      return true;
    }
    flushWrite(path, w, t) {
      if (!w.dirty) return;
      const wait = WRITE_INTERVAL - (t - w.lastSent);
      if (wait > 0) {                                  // zu früh: genau zur richtigen Zeit mit dem NEUESTEN Wert senden
        if (!w.timer) w.timer = this.setTimeout(() => { w.timer = null; if (this.pending.get(path) === w) this.flushWrite(path, w, this.now()); }, wait);
        return;
      }
      w.dirty = false; w.lastSent = t;
      if (w.dirtySince) { this.paceLat.push(t - w.dirtySince); if (this.paceLat.length > 200) this.paceLat.shift(); }
      this.stats.writes++;
      this.transmit(path, [{ type: w.type, value: w.value }]);
    }
    // Läuft gerade eine eigene Änderung? Dann haben Hintergrundanfragen Pause.
    writeActive(t) {
      for (const w of this.pending.values()) if (w.dirty || t - w.lastWrite < WRITE_QUIET) return true;
      return false;
    }

    // ---------- Meter ----------
    setMeters(streams) {
      this.meterStreams = new Set(streams);
      if (this.state === "online") this.renewMeters();
    }
    renewMeters() {
      for (const id of this.meterStreams) {
        if (id.includes(":")) { const parts = id.split(":"); this.transmit("/meters", [{ type: "s", value: "/meters/" + parts[0] }, { type: "i", value: parseInt(parts[1], 10) }]); }
        else this.transmit("/meters", [{ type: "s", value: "/meters/" + id }]);
      }
    }

    // ---------- Netzwerk-Test (nur lesend, ändert nichts am Pult) ----------
    // 32 Einzelanfragen im Abstand von 30 ms (Laufzeit, Schwankung, Verlust), danach 32 auf einmal (Ansturm)
    runNetworkTest(done) {
      if (this.state !== "online" || this.netTest) { if (done) done(null); return false; }
      const test = { sent: new Map(), rtts: [], burstGot: 0, burstFirst: 0, burstLast: 0, burstStart: 0, done };
      this.netTest = test;
      const seqAddr = (k) => "/ch/" + pad2(k + 1) + "/config/name";
      const burstAddr = (k) => "/ch/" + pad2(k + 1) + "/config/color";
      for (let k = 0; k < 32; k++) {
        this.setTimeout(() => { test.sent.set(seqAddr(k), { t: this.now(), burst: false }); this.transmit(seqAddr(k)); }, k * 30);
      }
      const burstAt = 32 * 30 + 900;
      this.setTimeout(() => {
        test.burstStart = this.now();
        for (let k = 0; k < 32; k++) { test.sent.set(burstAddr(k), { t: test.burstStart, burst: true }); this.transmit(burstAddr(k)); }
      }, burstAt);
      this.setTimeout(() => this.finishNetworkTest(), burstAt + 1200);
      return true;
    }
    netTestReply(address, t) {
      const test = this.netTest, s = test.sent.get(address);
      if (!s || s.got) return;
      s.got = true;
      if (s.burst) { test.burstGot++; if (!test.burstFirst) test.burstFirst = t; test.burstLast = t; }
      else test.rtts.push(t - s.t);
    }
    finishNetworkTest() {
      const test = this.netTest; this.netTest = null;
      if (!test) return;
      const r = test.rtts.slice().sort((a, b) => a - b);
      const avg = r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
      let jitter = null;
      if (test.rtts.length > 1) { let s = 0; for (let i = 1; i < test.rtts.length; i++) s += Math.abs(test.rtts[i] - test.rtts[i - 1]); jitter = s / (test.rtts.length - 1); }
      const result = {
        seq: { sent: 32, got: r.length, lossPct: (1 - r.length / 32) * 100, min: r[0], avg, p95: r.length ? r[Math.min(r.length - 1, Math.floor(r.length * 0.95))] : null, max: r[r.length - 1], jitter },
        burst: { sent: 32, got: test.burstGot, lossPct: (1 - test.burstGot / 32) * 100, spanMs: test.burstLast ? test.burstLast - test.burstStart : null },
      };
      if (test.done) test.done(result);
    }

    // ---------- Takt ----------
    tick() {
      const t = this.now();
      if (this.state === "connecting" || this.state === "lost") {
        if (t - this.lastHandshake >= HANDSHAKE_EVERY) {
          this.lastHandshake = t;
          this.pingSentAt = t;
          this.transmit("/xinfo");
          this.transmit("/xremote");
        }
        return;
      }
      // Schreiben & Kontroll-Lesen
      for (const [path, w] of this.pending) {
        if (w.dirty) this.flushWrite(path, w, t);
        else if (!w.verifying && t - w.lastWrite >= VERIFY_DELAY) { w.verifying = true; w.verifyAt = t; this.request(path, true); }
        else if (w.verifying && t - w.verifyAt > VERIFY_GIVEUP) this.pending.delete(path);
      }
      // Anfragen: Timeouts, dann Fenster auffüllen (dringende zuerst; Hintergrund pausiert bei eigenen Änderungen)
      for (const [path, inf] of this.inflight) {
        if (t - inf.sentAt > REQUEST_TIMEOUT) {
          this.inflight.delete(path);
          const n = this.tries.get(path) || 1;
          if (n < MAX_TRIES) { this.stats.retries++; this.queued.add(path); this.qUrgent.unshift(path); }
          else {
            this.stats.failed++; this.tries.delete(path);
            const rounds = (this.failCount.get(path) || 0) + 1;
            this.failCount.set(path, rounds);
            if (rounds >= MAX_FAIL_ROUNDS) this.dead.add(path);   // Pult antwortet nie: nicht ständig weiter fragen
            else this.failed.add(path);
          }
        }
      }
      const writing = this.writeActive(t);
      while (this.inflight.size < WINDOW) {
        let path = null;
        if (this.qUrgent.length) path = this.qUrgent.shift();
        else if (!writing && this.qNormal.length) path = this.qNormal.shift();
        if (path === null) break;
        this.queued.delete(path);
        this.inflight.set(path, { sentAt: t });
        this.tries.set(path, (this.tries.get(path) || 0) + 1);
        this.transmit(path);
      }
      // aufgegebene Anfragen später erneut versuchen (Sync soll am Ende immer vollständig werden)
      if (this.failed.size && t - this.lastFailedRetry >= FAILED_RETRY_EVERY) {
        this.lastFailedRetry = t;
        for (const p of this.failed) this.request(p, false);
        this.failed.clear();
      }
      // Herzschlag, Ping, Meter-Abo, Nachgleich
      if (t - this.lastHeartbeat >= HEARTBEAT_EVERY) {
        this.lastHeartbeat = t;
        this.transmit("/xremote");
        this.pingSentAt = t;
        this.pingHistory.push({ t, ok: false });
        if (this.pingHistory.length > 30) this.pingHistory.shift();
        this.transmit("/xinfo");
      }
      if (t - this.lastMeterRenew >= METER_RENEW_EVERY) { this.lastMeterRenew = t; this.renewMeters(); }
      if (t - this.lastSubRenew >= SUB_RENEW_EVERY) { this.lastSubRenew = t; this.renewSubs(); }
      this.pollTick(t, writing);
      if (t - this.lastAll >= ALL_EVERY) { this.lastAll = t; this.refreshAll(); }
      // Verbindungsüberwachung
      if (t - this.lastRx > DEAD_AFTER) {
        this.log("Keine Antwort vom Pult – versuche neu zu verbinden");
        this.inflight.clear(); this.tries.clear(); this.failed.clear();
        this.qUrgent.length = 0; this.qNormal.length = 0; this.queued.clear();
        this.lastHandshake = 0;
        this.setState("lost");
        return;
      }
      if (this.openRequests()) this.emitStatus(false);
    }

    // Sicherheitsnetz: sichtbare Werte gleichmäßig verteilt nachfragen (Mute schnell, Fader etwas langsamer)
    pollTick(t, writing) {
      const dt = t - this.lastPoll;
      this.lastPoll = t;
      if (dt <= 0 || dt > 1000 || writing) return;
      // Meldet das Pult Änderungen nicht selbst (nur Nachfragen findet welche)? Dann doppelt so schnell nachfragen.
      const cut = t - 30000;
      while (this.pushHits.length && this.pushHits[0] < cut) this.pushHits.shift();
      while (this.pollHits.length && this.pollHits[0] < cut) this.pollHits.shift();
      this.pushBroken = this.pollHits.length >= 3 && this.pushHits.length === 0;
      if (this.qNormal.length + this.qUrgent.length > MAX_POLL_QUEUE) return;
      // Laufen die Schnappschüsse gesund, reicht seltenes Nachfragen; meldet das Pult nichts selbst, häufiger
      const speed = this.pushBroken ? (this.hintsHealthy(t) ? 1 : 2) : (this.hintsHealthy(t) ? 0.3 : 1);
      for (const g of Object.values(this.hotGroups)) {
        const n = g.list.length;
        if (!n) continue;
        g.credit = Math.min(g.credit + (dt * n * speed) / g.period, 6);
        while (g.credit >= 1) {
          g.credit -= 1;
          const p = g.list[g.i++ % n];
          if (!this.pending.has(p)) this.request(p, false);
        }
      }
    }
  }

  X32Client.constants = { WINDOW, REQUEST_TIMEOUT, MAX_TRIES, WRITE_INTERVAL, VERIFY_DELAY, DEAD_AFTER, POLL_MUTE, POLL_FADER };
  return X32Client;
});
