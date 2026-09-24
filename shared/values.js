// Gemeinsame Wertelogik für Hauptprozess, Oberfläche und Tests:
// Umrechnung Pult-Werte <-> echte Einheiten, Parameter-Spezifikation pro OSC-Pfad,
// Definition aller Kanaltypen (Strips) des X32.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.X32V = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const V = {};
  const pad2 = (n) => String(n).padStart(2, "0");

  // ---------- Umrechnungen ----------
  // "level"-Typ (Fader): 4-stufige Pseudo-Log-Kurve
  V.faderToDb = (f) => (f >= 0.5 ? f * 40 - 30 : f >= 0.25 ? f * 80 - 50 : f >= 0.0625 ? f * 160 - 70 : f > 0 ? f * 480 - 90 : -90);
  V.dbToFader = (db) => (db <= -90 ? 0 : db >= 10 ? 1 : db >= -10 ? (db + 30) / 40 : db >= -30 ? (db + 50) / 80 : db >= -60 ? (db + 70) / 160 : (db + 90) / 480);
  V.linfToActual = (n, min, max) => min + n * (max - min);
  V.actualToLinf = (a, min, max) => (a - min) / (max - min);
  V.logfToActual = (n, min, max) => min * Math.pow(max / min, n);
  V.actualToLogf = (a, min, max) => Math.log(a / min) / Math.log(max / min);

  // ---------- Parameter-Spezifikation (nach "Blattname" des Pfads) ----------
  const en = { kind: "enum" };
  const lin = (min, max) => ({ kind: "linf", min, max });
  const log = (min, max) => ({ kind: "logf", min, max });
  const LEAF = {
    "mix/fader": { kind: "level" }, "fader": { kind: "level" },
    "mix/on": en, "on": en,
    "mix/pan": lin(-100, 100),
    "config/name": { kind: "string" }, "config/icon": { kind: "int" }, "config/color": en,
    "eq/on": en, "eq/#/type": en, "eq/#/f": log(20, 20000), "eq/#/g": lin(-15, 15), "eq/#/q": log(10, 0.3),
    "dyn/on": en, "dyn/mode": en, "dyn/det": en, "dyn/env": en, "dyn/auto": en, "dyn/keysrc": en,
    "dyn/thr": lin(-60, 0), "dyn/ratio": en, "dyn/mgain": lin(0, 24), "dyn/attack": lin(0, 120),
    "dyn/hold": log(0.02, 2000), "dyn/release": log(5, 4000), "dyn/knee": lin(0, 5), "dyn/mix": lin(0, 100),
    "dyn/filter/on": en, "dyn/filter/type": en, "dyn/filter/f": log(20, 20000),
    "gate/on": en, "gate/mode": en, "gate/keysrc": en, "gate/thr": lin(-80, 0), "gate/range": lin(3, 60),
    "gate/attack": lin(0, 120), "gate/hold": log(0.02, 2000), "gate/release": log(5, 4000),
    "gate/filter/on": en, "gate/filter/type": en, "gate/filter/f": log(20, 20000),
    "preamp/hpon": en, "preamp/hpslope": en, "preamp/hpf": log(20, 400),
  };
  function leafOf(path) {
    return path
      .replace(/^\/(?:ch|auxin|fxrtn|bus|mtx)\/\d\d\//, "")
      .replace(/^\/main\/(?:st|m)\//, "")
      .replace(/^\/dca\/\d\//, "")
      .replace(/^eq\/\d\//, "eq/#/");
  }
  V.leafOf = leafOf;
  V.specOf = (path) => LEAF[leafOf(path)] || null;

  // echte Einheit -> Pult-Wert ({type,value}); dB für Fader, Hz/dB/ms/... für die übrigen
  V.toWire = function (path, actual) {
    const s = V.specOf(path);
    if (!s) throw new Error("Unbekannter Parameter: " + path);
    if (s.kind === "level") return { type: "f", value: V.dbToFader(actual) };
    if (s.kind === "enum" || s.kind === "int") return { type: "i", value: Math.round(actual) };
    if (s.kind === "string") return { type: "s", value: String(actual) };
    const lo = Math.min(s.min, s.max), hi = Math.max(s.min, s.max);
    const a = Math.min(hi, Math.max(lo, actual));
    const n = s.kind === "linf" ? V.actualToLinf(a, s.min, s.max) : V.actualToLogf(a, s.min, s.max);
    return { type: "f", value: Math.min(1, Math.max(0, n)) };
  };
  V.fromWire = function (path, wire) {
    const s = V.specOf(path);
    if (!s || s.kind === "enum" || s.kind === "int" || s.kind === "string") return wire;
    if (s.kind === "level") return V.faderToDb(wire);
    return s.kind === "linf" ? V.linfToActual(wire, s.min, s.max) : V.logfToActual(wire, s.min, s.max);
  };

  // ---------- Aufzählungen ----------
  V.EQ_TYPES_BASIC = ["LCut", "LShv", "PEQ", "VEQ", "HShv", "HCut"];
  V.EQ_TYPES_EXT = V.EQ_TYPES_BASIC.concat(["BU6", "BU12", "BS12", "LR12", "BU18", "BU24", "BS24", "LR24"]);
  V.DYN_RATIOS = [1.1, 1.3, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.0, 10, 20, 100];
  V.FILTER_TYPES = ["LC6", "LC12", "HC6", "HC12", "1.0", "2.0", "3.0", "5.0", "10.0"];
  V.HP_SLOPES = [12, 18, 24];
  V.KEY_SOURCES = (function () {
    const list = ["Self"];
    for (let i = 1; i <= 32; i++) list.push("In " + pad2(i));
    for (let i = 1; i <= 6; i++) list.push("Aux " + i);
    list.push("USB L", "USB R");
    for (let i = 1; i <= 4; i++) list.push("Fx " + i + "L", "Fx " + i + "R");
    for (let i = 1; i <= 16; i++) list.push("Bus " + pad2(i));
    return list;
  })();
  V.ICON_NAMES = [
    "", "None", "Kick Back", "Kick Front", "Snare Top", "Snare Bottom", "High Tom", "Mid Tom", "Floor Tom", "Hi-Hat", "Ride",
    "Drum Kit", "Cowbell", "Bongos", "Congas", "Tambourine", "Vibraphone", "Electric Bass", "Acoustic Bass", "Contrabass",
    "Les Paul Guitar", "Ibanez Guitar", "Washburn Guitar", "Acoustic Guitar", "Bass Amp", "Guitar Amp", "Amp Cabinet", "Piano",
    "Organ", "Harpsichord", "Keyboard", "Synthesizer 1", "Synthesizer 2", "Synthesizer 3", "Keytar", "Trumpet", "Trombone",
    "Saxophone", "Clarinet", "Violin", "Cello", "Male Vocal", "Female Vocal", "Choir", "Hand Sign", "Talk A", "Talk B",
    "Large Diaphragm Mic", "Condenser Mic Left", "Condenser Mic Right", "Handheld Mic", "Wireless Mic", "Podium Mic",
    "Headset Mic", "XLR Jack", "TRS Plug", "TRS Plug Left", "TRS Plug Right", "RCA Plug Left", "RCA Plug Right", "Reel to Reel",
    "FX", "Computer", "Monitor Wedge", "Left Speaker", "Right Speaker", "Speaker Array", "Speaker on a Pole", "Amp Rack",
    "Controls", "Faders", "MixBus", "Matrix", "Routing", "Smiley",
  ];

  const DYN_KEYS = ["on", "mode", "det", "env", "thr", "ratio", "knee", "mgain", "attack", "hold", "release", "mix", "auto", "keysrc", "filter/on", "filter/type", "filter/f"];
  const GATE_KEYS = ["on", "mode", "thr", "range", "attack", "hold", "release", "keysrc", "filter/on", "filter/type", "filter/f"];
  V.DYN_KEYS = DYN_KEYS;
  V.GATE_KEYS = GATE_KEYS;

  // ---------- Kanaltypen (Strips) ----------
  V.LAYERS = [
    { id: "ch", label: "Kanäle" },
    { id: "aux", label: "Aux / FX" },
    { id: "bus", label: "Bus" },
    { id: "mtx", label: "Matrix / Main" },
    { id: "dca", label: "DCA" },
  ];

  V.buildStrips = function () {
    const strips = [];
    const mk = (o) => Object.assign({ eqBands: 0, dyn: false, gate: false, hpf: false, faderLeaf: "mix/fader", onLeaf: "mix/on", meter: null, gr: null, gateGr: null }, o);
    for (let n = 1; n <= 32; n++) {
      strips.push(mk({ id: "ch" + pad2(n), type: "ch", layer: "ch", n, base: "/ch/" + pad2(n), label: "Ch " + pad2(n), eqBands: 4, dyn: true, gate: true, hpf: true,
        meter: { stream: "0", idx: [n - 1] }, gr: { stream: "1", idx: 64 + n - 1 }, gateGr: { stream: "1", idx: 32 + n - 1 } }));
    }
    for (let n = 1; n <= 8; n++) strips.push(mk({ id: "aux" + n, type: "aux", layer: "aux", n, base: "/auxin/" + pad2(n), label: "Aux " + n, eqBands: 4, meter: { stream: "0", idx: [32 + n - 1] } }));
    for (let n = 1; n <= 8; n++) strips.push(mk({ id: "fx" + n, type: "fx", layer: "aux", n, base: "/fxrtn/" + pad2(n), label: "FX " + n, eqBands: 4, meter: { stream: "0", idx: [40 + n - 1] } }));
    for (let n = 1; n <= 16; n++) strips.push(mk({ id: "bus" + pad2(n), type: "bus", layer: "bus", n, base: "/bus/" + pad2(n), label: "Bus " + pad2(n), eqBands: 6, dyn: true, meter: { stream: "0", idx: [48 + n - 1] }, gr: { stream: "2", idx: 25 + n - 1 } }));
    for (let n = 1; n <= 6; n++) strips.push(mk({ id: "mtx" + n, type: "mtx", layer: "mtx", n, base: "/mtx/" + pad2(n), label: "Matrix " + n, eqBands: 6, dyn: true, meter: { stream: "0", idx: [64 + n - 1] }, gr: { stream: "2", idx: 41 + n - 1 } }));
    strips.push(mk({ id: "st", type: "main", layer: "mtx", n: 1, base: "/main/st", label: "Main LR", eqBands: 6, dyn: true, meter: { stream: "2", idx: [22, 23] }, gr: { stream: "2", idx: [47] } }));
    strips.push(mk({ id: "mono", type: "main", layer: "mtx", n: 2, base: "/main/m", label: "Mono", eqBands: 6, dyn: true, meter: { stream: "2", idx: [24] }, gr: { stream: "2", idx: [48] } }));
    for (let n = 1; n <= 8; n++) strips.push(mk({ id: "dca" + n, type: "dca", layer: "dca", n, base: "/dca/" + n, label: "DCA " + n, faderLeaf: "fader", onLeaf: "on" }));
    // gr.idx bei Kanälen ist eine Zahl, sonst Liste -> vereinheitlichen
    strips.forEach((s) => {
      if (s.gr && !Array.isArray(s.gr.idx)) s.gr.idx = [s.gr.idx];
      if (s.gateGr && !Array.isArray(s.gateGr.idx)) s.gateGr.idx = [s.gateGr.idx];
    });
    return strips;
  };

  V.stripPath = (strip, leaf) => strip.base + "/" + leaf;
  V.basicPaths = (strip) => ["config/name", "config/color", "config/icon", strip.faderLeaf, strip.onLeaf].map((l) => V.stripPath(strip, l));
  V.detailPaths = function (strip) {
    const p = [];
    const b = strip.base;
    if (strip.eqBands) {
      p.push(b + "/eq/on");
      for (let i = 1; i <= strip.eqBands; i++) ["type", "f", "g", "q"].forEach((k) => p.push(b + "/eq/" + i + "/" + k));
    }
    if (strip.dyn) DYN_KEYS.forEach((k) => p.push(b + "/dyn/" + k));
    if (strip.gate) GATE_KEYS.forEach((k) => p.push(b + "/gate/" + k));
    if (strip.hpf) ["hpon", "hpslope", "hpf"].forEach((k) => p.push(b + "/preamp/" + k));
    return p;
  };

  return V;
});
