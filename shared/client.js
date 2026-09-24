// X32-Verbindungsschicht nach dem Muster von Mixing Station & Co.:
//  - lokaler Zwischenspeicher aller Werte (Pfad -> Pult-Wert)
//  - Handshake über /xinfo, Herzschlag /xremote, Verbindungsüberwachung mit Auto-Reconnect
//  - Anfragen in einem Fenster (max. 20 gleichzeitig offen, Timeout + Wiederholung)
//  - Änderungen vom Pult kommen per /xremote und werden gesammelt an die Oberfläche gemeldet
//  - eigene Änderungen: sofort lokal, schnell (bis ca. 80/s) und gebündelt zum Pult,
//    danach ein Kontroll-Lesen (UDP kann Pakete verlieren, das Pult meldet eigene Änderungen nicht zurück)
//  - regelmäßiger Nachgleich im Hintergrund
// Unabhängig vom Netzwerk: Senden und Zeit werden von außen übergeben (testbar).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./osc"));
  else root.X32Client = factory(root.X32OSC);
})(typeof self !== "undefined" ? self : this, function (OSC) {
  const WINDOW = 20;              // gleichzeitig offene Anfragen
  const REQUEST_TIMEOUT = 500;    // ms bis zur Wiederholung
  const MAX_TRIES = 3;
  const TICK_MS = 5;
  const WRITE_INTERVAL = 12;      // ms zwischen zwei Schreibzugriffen auf denselben Parameter (~80/s)
  const VERIFY_DELAY = 300;       // ms nach dem letzten Schreiben bis zum Kontroll-Lesen
  const VERIFY_GIVEUP = 1500;
  const HANDSHAKE_EVERY = 500;
  const HEARTBEAT_EVERY = 2000;   // /xremote (Pult braucht spätestens alle 10 s)
  const METER_RENEW_EVERY = 4000; // Meter-Abo läuft nach 10 s ab
  const DEAD_AFTER = 4500;        // keine Antwort -> Verbindung verloren
  const HOT_EVERY = 5000;         // Nachgleich der sichtbaren Werte
  const ALL_EVERY = 60000;        // Nachgleich aller bekannten Werte
  const BATCH_EVERY = 16;         // Änderungen gebündelt an die Oberfläche
  const MAX_HOT_QUEUE = 300;
  const FAILED_RETRY_EVERY = 2000;
  const MAX_FAIL_ROUNDS = 6;
  const LOST_TOLERANCE = 0.02;   // Abweichung (normiert), ab der eine Änderung als verloren gilt

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

      this.values = new Map();
      this.known = new Set();
      this.hot = new Set();
      this.queue = [];
      this.queued = new Set();
      this.inflight = new Map();
      this.tries = new Map();
      this.failed = new Set();
      this.failCount = new Map();
      this.dead = new Set();
      this.pending = new Map();
      this.changed = new Map();
      this.meterStreams = new Set(["0", "2"]);

      this.state = "idle"; // idle | connecting | online | lost
      this.info = null;
      this.rtt = null;
      this.lastRx = 0;
      this.pingSentAt = 0;
      this.timerHandle = null;
      this.lastHandshake = 0; this.lastHeartbeat = 0; this.lastMeterRenew = 0;
      this.lastHot = 0; this.lastAll = 0; this.lastBatch = 0; this.lastStatus = 0; this.lastFailedRetry = 0;
      this.syncTotal = 0;
      this.stats = { sent: 0, received: 0, retries: 0, failed: 0, writes: 0, resends: 0 };
    }

    // ---------- Lebenszyklus ----------
    start() {
      if (this.timerHandle) return;
      const t = this.now();
      this.lastRx = t;
      this.setState("connecting");
      this.timerHandle = this.setInterval(() => this.tick(), TICK_MS);
    }
    stop() {
      if (this.timerHandle) { this.clearInterval(this.timerHandle); this.timerHandle = null; }
      this.inflight.clear(); this.tries.clear();
      this.setState("idle");
    }
    setState(state) {
      if (this.state === state) return;
      this.state = state;
      this.emitStatus(true);
    }
    emitStatus(force) {
      const t = this.now();
      if (!force && t - this.lastStatus < 250) return;
      this.lastStatus = t;
      const open = this.queue.length + this.inflight.size;
      const progress = this.syncTotal > 0 ? Math.max(0, Math.min(1, 1 - open / this.syncTotal)) : 1;
      this.onStatus({ state: this.state, info: this.info, rtt: this.rtt, open, progress, stats: this.stats });
    }
    log(msg) { this.onLog(msg); }

    // ---------- Empfang ----------
    receive(u8) {
      this.lastRx = this.now();
      this.stats.received++;
      let msg;
      try { msg = OSC.decodeMessage(u8); } catch (e) { return; }
      const address = msg.address, args = msg.args;
      if (address.startsWith("/meters/")) {
        const blob = args.find((a) => a.type === "b");
        if (blob) this.onMeter(address.slice(8), OSC.parseMeterBlob(blob.value));
        return;
      }
      if (address === "/xinfo") { this.onXinfo(args); return; }
      if (!args.length || args[0].type === "b") return;
      this.applyIncoming(address, args[0].value);
    }

    onXinfo(args) {
      const t = this.now();
      if (this.pingSentAt) {
        const d = t - this.pingSentAt;
        this.rtt = this.rtt == null ? d : this.rtt * 0.7 + d * 0.3;
        this.pingSentAt = 0;
      }
      this.info = { ip: args[0] && args[0].value, name: args[1] && args[1].value, model: args[2] && args[2].value, version: args[3] && args[3].value };
      if (this.state === "connecting" || this.state === "lost") {
        this.dead.clear(); this.failCount.clear(); this.failed.clear();
        this.setState("online");
        this.lastHeartbeat = t; this.lastMeterRenew = t; this.lastHot = t; this.lastAll = t;
        this.transmit("/xremote");
        this.renewMeters();
        this.refreshAll();
      } else this.emitStatus(false);
    }

    applyIncoming(path, v) {
      if (this.inflight.has(path)) { this.inflight.delete(path); this.tries.delete(path); this.failCount.delete(path); }
      const w = this.pending.get(path);
      if (w && !w.verifying) return;          // veraltetes Echo während wir noch schreiben
      if (w && w.verifying) {
        // Kontroll-Lesen: stimmt der Wert am Pult nicht (Paket verloren), einmal erneut senden
        const lost = w.type === "f" ? Math.abs(v - w.value) > LOST_TOLERANCE : v !== w.value;
        if (lost && w.retries < 2) {
          w.retries++; w.verifying = false; w.dirty = true; w.lastWrite = this.now();
          this.stats.resends++;
          return;
        }
        this.pending.delete(path);
      }
      const old = this.values.get(path);
      if (old === v || (typeof old === "number" && typeof v === "number" && Math.abs(old - v) < 1e-7)) return;
      this.values.set(path, v);
      this.changed.set(path, v);
    }

    // ---------- Anfragen ----------
    get(path) { return this.values.get(path); }

    request(path, urgent) {
      if (this.dead.has(path) || this.queued.has(path) || this.inflight.has(path)) return;
      this.queued.add(path);
      if (urgent) this.queue.unshift(path); else this.queue.push(path);
    }
    // Werte bereitstellen: fehlende werden geholt, alle werden künftig beim Nachgleich berücksichtigt
    want(paths) {
      const before = this.queue.length + this.inflight.size;
      for (const p of paths) {
        this.known.add(p);
        if (!this.values.has(p)) this.request(p, false);
      }
      const after = this.queue.length + this.inflight.size;
      this.syncTotal = before === 0 ? after : Math.max(this.syncTotal, after);
      this.emitStatus(false);
    }
    // sichtbare/aktive Werte, die alle paar Sekunden erneut gelesen werden
    setHot(paths) { this.hot = new Set(paths); }
    refresh(paths, urgent) { for (const p of paths) this.request(p, !!urgent); }
    refreshAll() {
      this.dead.clear(); this.failCount.clear();   // aufgegebene Pfade bekommen beim Voll-Abgleich eine neue Chance
      for (const p of this.known) this.request(p, false);
      this.syncTotal = this.queue.length + this.inflight.size;
      this.emitStatus(true);
    }
    snapshot() { return Array.from(this.values); }

    // ---------- Senden ----------
    transmit(address, args) {
      this.stats.sent++;
      this.send(OSC.encodeMessage(address, args));
    }

    // Parameter setzen: lokal sofort, zum Pult schnell + gebündelt, danach Kontroll-Lesen
    set(path, type, value) {
      if (this.state !== "online") {
        const old = this.values.get(path);
        if (old !== undefined) this.changed.set(path, old); // Oberfläche zurücksetzen
        return false;
      }
      const t = this.now();
      let w = this.pending.get(path);
      if (!w && this.values.get(path) === value) return true;
      this.values.set(path, value);
      if (!w) { w = { type, value, lastSent: 0, dirty: true, lastWrite: t, verifying: false, verifyAt: 0, retries: 0 }; this.pending.set(path, w); }
      else { w.type = type; w.value = value; w.dirty = true; w.lastWrite = t; w.verifying = false; w.retries = 0; }
      this.flushWrite(path, w, t);
      return true;
    }
    flushWrite(path, w, t) {
      if (!w.dirty || t - w.lastSent < WRITE_INTERVAL) return;
      w.dirty = false; w.lastSent = t;
      this.stats.writes++;
      this.transmit(path, [{ type: w.type, value: w.value }]);
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
        this.flushBatch(t);
        return;
      }
      // Schreiben & Kontroll-Lesen
      for (const [path, w] of this.pending) {
        if (w.dirty) this.flushWrite(path, w, t);
        else if (!w.verifying && t - w.lastWrite >= VERIFY_DELAY) { w.verifying = true; w.verifyAt = t; this.request(path, true); }
        else if (w.verifying && t - w.verifyAt > VERIFY_GIVEUP) this.pending.delete(path);
      }
      // Anfragen: Timeouts, dann Fenster auffüllen
      for (const [path, inf] of this.inflight) {
        if (t - inf.sentAt > REQUEST_TIMEOUT) {
          this.inflight.delete(path);
          const n = this.tries.get(path) || 1;
          if (n < MAX_TRIES) { this.stats.retries++; this.queued.add(path); this.queue.unshift(path); }
          else {
            this.stats.failed++; this.tries.delete(path);
            const rounds = (this.failCount.get(path) || 0) + 1;
            this.failCount.set(path, rounds);
            if (rounds >= MAX_FAIL_ROUNDS) this.dead.add(path);   // Pult antwortet nie: nicht ständig weiter fragen
            else this.failed.add(path);
          }
        }
      }
      while (this.inflight.size < WINDOW && this.queue.length) {
        const path = this.queue.shift();
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
        this.transmit("/xinfo");
      }
      if (t - this.lastMeterRenew >= METER_RENEW_EVERY) { this.lastMeterRenew = t; this.renewMeters(); }
      if (t - this.lastHot >= HOT_EVERY) {
        this.lastHot = t;
        if (this.queue.length < MAX_HOT_QUEUE) for (const p of this.hot) this.request(p, false);
      }
      if (t - this.lastAll >= ALL_EVERY) { this.lastAll = t; this.refreshAll(); }
      // Verbindungsüberwachung
      if (t - this.lastRx > DEAD_AFTER) {
        this.log("Keine Antwort vom Pult – versuche neu zu verbinden");
        this.inflight.clear(); this.tries.clear(); this.failed.clear();
        this.queue.length = 0; this.queued.clear();
        this.lastHandshake = 0;
        this.setState("lost");
        return;
      }
      this.flushBatch(t);
      if (this.queue.length || this.inflight.size) this.emitStatus(false);
    }

    flushBatch(t) {
      if (!this.changed.size || t - this.lastBatch < BATCH_EVERY) return;
      this.lastBatch = t;
      const entries = Array.from(this.changed);
      this.changed.clear();
      this.onBatch(entries);
    }
  }

  X32Client.constants = { WINDOW, REQUEST_TIMEOUT, MAX_TRIES, WRITE_INTERVAL, VERIFY_DELAY, DEAD_AFTER };
  return X32Client;
});
