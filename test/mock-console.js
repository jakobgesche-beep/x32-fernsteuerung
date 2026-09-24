// Simuliertes X32 für Tests (nur Entwicklung, wird nicht in die App gepackt).
// Verhält sich wie das echte Pult: beantwortet Abfragen, meldet Änderungen "vom Pult selbst"
// nur an angemeldete /xremote-Clients, meldet eigene Änderungen des Clients NICHT zurück,
// sendet Meter-Ströme, kann Pakete verlieren oder ausfallen.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../shared/osc"), require("../shared/values"));
  else root.MockX32 = factory(root.X32OSC, root.X32V);
})(typeof self !== "undefined" ? self : this, function (OSC, V) {
  const METER_SIZES = { "0": 70, "1": 96, "2": 49 };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class MockX32 {
    // opts.profile (WLAN/Pult-Modell): base = feste Laufzeit je Richtung (ms), jitterMean = mittlere
    // zufällige Zusatzverzögerung (exponential), spikeProb/spikeMs = gelegentliche Ausreißer, loss =
    // Paketverlust je Richtung, capacity = wie viele Nachrichten pro Sekunde das Pult verarbeiten kann.
    constructor(opts) {
      this.deliver = opts.deliver;          // (u8) -> Client
      this.profile = Object.assign({ base: opts.latency == null ? 2 : opts.latency, jitterMean: 0, spikeProb: 0, spikeMs: 0, loss: opts.loss || 0, capacity: 5000 }, opts.profile || {});
      this.rng = mulberry32(opts.seed == null ? 20260924 : opts.seed);
      this.busyUntil = 0;
      this.online = true;
      this.store = new Map();               // Pfad -> Pult-Wert
      this.xremoteUntil = 0;
      this.meterUntil = new Map();
      this.log = { sets: new Map(), gets: 0, xremote: 0, xinfo: 0, meters: 0, received: 0 };
      this.dropNextSetOf = null;
      this.maxOutstanding = 0;
      this.initDefaults();
      this.subs = new Map();                // Alias -> {pattern,i0,i1,tf,until,next}
      this.subFormatBroken = !!opts.subFormatBroken;   // Test: Pult liefert unbrauchbare Schnappschüsse
      this.meterTimer = setInterval(() => this.pushMeters(), 50);
      this.subTimer = setInterval(() => this.pushSubs(), 25);
    }

    shutdown() { clearInterval(this.meterTimer); clearInterval(this.subTimer); }

    initDefaults() {
      const put = (path, actual) => { const w = V.toWire(path, actual); this.store.set(path, w.value); };
      V.buildStrips().forEach((s) => {
        const b = s.base;
        this.store.set(b + "/config/name", s.label);
        this.store.set(b + "/config/color", (s.n % 7) + 1);
        this.store.set(b + "/config/icon", ((s.n * 3) % 73) + 1);
        this.store.set(b + "/" + s.faderLeaf, 0.75);
        this.store.set(b + "/" + s.onLeaf, 1);
        if (s.eqBands) {
          this.store.set(b + "/eq/on", 1);
          const fs = s.eqBands === 6 ? [40, 200, 500, 2000, 6000, 14000] : [100, 400, 2000, 8000];
          for (let i = 1; i <= s.eqBands; i++) {
            this.store.set(b + "/eq/" + i + "/type", i === 1 ? 1 : i === s.eqBands ? 4 : 2);
            put(b + "/eq/" + i + "/f", fs[i - 1]);
            put(b + "/eq/" + i + "/g", 0);
            put(b + "/eq/" + i + "/q", 1);
          }
        }
        if (s.dyn) {
          this.store.set(b + "/dyn/on", 0); this.store.set(b + "/dyn/mode", 0); this.store.set(b + "/dyn/det", 0); this.store.set(b + "/dyn/env", 1);
          put(b + "/dyn/thr", -20); this.store.set(b + "/dyn/ratio", 5); put(b + "/dyn/knee", 1); put(b + "/dyn/mgain", 0);
          put(b + "/dyn/attack", 10); put(b + "/dyn/hold", 10); put(b + "/dyn/release", 150); put(b + "/dyn/mix", 100);
          this.store.set(b + "/dyn/auto", 0); this.store.set(b + "/dyn/keysrc", 0);
          this.store.set(b + "/dyn/filter/on", 0); this.store.set(b + "/dyn/filter/type", 0); put(b + "/dyn/filter/f", 1000);
        }
        if (s.gate) {
          this.store.set(b + "/gate/on", 0); this.store.set(b + "/gate/mode", 0); this.store.set(b + "/gate/keysrc", 0);
          put(b + "/gate/thr", -40); put(b + "/gate/range", 30); put(b + "/gate/attack", 5); put(b + "/gate/hold", 50); put(b + "/gate/release", 200);
          this.store.set(b + "/gate/filter/on", 0); this.store.set(b + "/gate/filter/type", 0); put(b + "/gate/filter/f", 1000);
        }
        if (s.hpf) { this.store.set(b + "/preamp/hpon", 0); this.store.set(b + "/preamp/hpslope", 1); put(b + "/preamp/hpf", 80); }
      });
    }

    // ---------- Netzwerk ----------
    delay() {
      const p = this.profile;
      let d = p.base;
      if (p.jitterMean) d += -Math.log(1 - this.rng()) * p.jitterMean;
      if (p.spikeProb && this.rng() < p.spikeProb) d += p.spikeMs * (0.5 + this.rng());
      return d;
    }
    lost() { return this.profile.loss > 0 && this.rng() < this.profile.loss; }
    receive(u8) {                                    // Client -> Pult (Netz, dann Warteschlange im Pult)
      if (!this.online || this.lost()) return;
      setTimeout(() => {
        const arrive = performance.now();
        const start = Math.max(arrive, this.busyUntil);
        this.busyUntil = start + 1000 / this.profile.capacity;   // Pult arbeitet Nachrichten nacheinander ab
        setTimeout(() => this.handle(u8), Math.max(0, this.busyUntil - arrive));
      }, this.delay());
    }
    reply(address, args) {                           // Pult -> Client
      if (!this.online || this.lost()) return;
      const bytes = OSC.encodeMessage(address, args);
      setTimeout(() => { if (this.online) this.deliver(bytes); }, this.delay());
    }
    typeOf(path) { const s = V.specOf(path); return s && (s.kind === "enum" || s.kind === "int") ? "i" : s && s.kind === "string" ? "s" : "f"; }

    handle(u8) {
      this.log.received++;
      const m = OSC.decodeMessage(u8);
      const a = m.address;
      if (a === "/xinfo") { this.log.xinfo++; this.reply("/xinfo", ["192.168.1.62", "X32-MOCK", "X32C", "4.06"].map((v) => ({ type: "s", value: v }))); return; }
      if (a === "/xremote") { this.log.xremote++; this.xremoteUntil = Date.now() + 10000; return; }
      if (a === "/formatsubscribe") {                // ,ssiii alias pattern i0 i1 tf
        const [alias, pattern, i0, i1, tf] = m.args.map((x) => x.value);
        this.log.formatsubscribe = (this.log.formatsubscribe || 0) + 1;
        this.subs.set(alias, { pattern, i0, i1, tf: tf || 0, until: Date.now() + 10000, next: 0 });
        return;
      }
      if (a === "/renew") {
        const alias = m.args[0] && m.args[0].value;
        const s = this.subs.get(alias);
        this.log.renew = (this.log.renew || 0) + 1;
        if (s) s.until = Date.now() + 10000;
        return;
      }
      if (a === "/meters") {
        this.log.meters++;
        const id = m.args[0].value.replace("/meters/", "");
        this.meterUntil.set(id, Date.now() + 10000);
        return;
      }
      if (m.args.length === 0) {                     // Abfrage
        this.log.gets++;
        if (this.store.has(a)) this.reply(a, [{ type: this.typeOf(a), value: this.store.get(a) }]);
        return;
      }
      // Schreiben: kein Echo an den Absender
      if (this.dropNextSetOf === a) { this.dropNextSetOf = null; return; }
      const value = m.args[0].value;
      this.store.set(a, value);
      const rec = this.log.sets.get(a) || { count: 0, last: null };
      rec.count++; rec.last = value; rec.at = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (this.log.applied) this.log.applied.push([rec.at, a, value]);
      this.log.sets.set(a, rec);
    }

    // Änderung am Pult selbst (Fader bewegt, Taste gedrückt) -> an xremote-Clients
    surfaceChange(path, value) {
      this.store.set(path, value);
      if (Date.now() < this.xremoteUntil) this.reply(path, [{ type: this.typeOf(path), value }]);
    }

    // Periodische Schnappschüsse für /formatsubscribe: Blob aus <int32 LE Länge in Bytes><Werte>, Werte je nach Typ Int oder Float (little endian)
    pushSubs() {
      if (!this.online) return;
      const now = Date.now();
      for (const [alias, s] of this.subs) {
        if (now > s.until) { this.subs.delete(alias); continue; }
        if (now < s.next) continue;
        s.next = now + Math.max(1, s.tf) * 50;
        const stars = (s.pattern.match(/\*+/) || ["*"])[0].length;
        const paths = [];
        for (let i = s.i0; i <= s.i1; i++) paths.push(s.pattern.replace(/\*+/, String(i).padStart(stars, "0")));
        const isFloat = this.typeOf(paths[0]) === "f";
        const bytes = new Uint8Array(4 + paths.length * 4);
        const dv = new DataView(bytes.buffer);
        dv.setInt32(0, bytes.length, true);
        paths.forEach((p, k) => {
          let v = this.store.get(p);
          if (v === undefined) v = 0;
          if (this.subFormatBroken) v = 123456;          // absichtlich unbrauchbar
          if (isFloat) dv.setFloat32(4 + k * 4, v, true); else dv.setInt32(4 + k * 4, v, true);
        });
        this.reply(alias, [{ type: "b", value: bytes }]);
      }
    }

    pushMeters() {
      if (!this.online) return;
      const now = Date.now();
      for (const [id, until] of this.meterUntil) {
        if (now > until) { this.meterUntil.delete(id); continue; }
        const n = METER_SIZES[id] || 4;
        const floats = new Float32Array(n);
        for (let i = 0; i < n; i++) floats[i] = 0.05 + 0.04 * (1 + Math.sin(now / 300 + i));
        // Gain-Reduction-Werte sind Verstärkungsfaktoren: 1.0 = keine Reduktion
        if (id === "1") for (let i = 32; i < 96; i++) floats[i] = i >= 64 ? 0.7 + 0.25 * Math.abs(Math.sin(now / 900 + i)) : 1;
        if (id === "2") for (let i = 25; i < 49; i++) floats[i] = 0.7 + 0.25 * Math.abs(Math.sin(now / 900 + i));
        this.reply("/meters/" + id, [{ type: "b", value: OSC.buildMeterBlob(floats) }]);
      }
    }
  }
  return MockX32;
});
