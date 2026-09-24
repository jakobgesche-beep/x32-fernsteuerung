// Schallpegel-Messung: Bewertungsfilter A/C/Z, Zeitbewertung Fast/Slow, Leq, Spitzenwert und
// Terzband-Analyse (RTA). Reines JavaScript ohne Web-Audio-Abhängigkeiten, damit die Rechnung
// mit erzeugten Testsignalen geprüft werden kann.
//
// Alle Pegel hier sind "dB re Vollaussteuerung" (dBFS, Effektivwert; ein Sinus mit voller
// Aussteuerung = -3,01 dBFS). Die Umrechnung in dB SPL geschieht in der Oberfläche über einen
// Kalibrier-Offset (Kalibrator oder Referenzgerät).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.X32SPL = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const TAU_FAST = 0.125;
  const TAU_SLOW = 1.0;
  const WEIGHTINGS = ["A", "C", "Z"];

  const db = (ms) => (ms > 1e-20 ? 10 * Math.log10(ms) : -Infinity);

  // ---------- Bewertungsfilter (analoge Vorlage nach IEC 61672, per Bilinear-Transformation digital) ----------
  const F1 = 20.598997, F2 = 107.65265, F3 = 737.86223, F4 = 12194.217;
  const W = (f) => 2 * Math.PI * f;

  // Abschnitt zweiter Ordnung (b2 s² + b1 s + b0) / (a2 s² + a1 s + a0) -> Biquad.
  // warp: Frequenz, bei der die Bilinear-Transformation exakt stimmen soll (sonst wird die Kurve oben zu steil).
  function bilinear(b, a, fs, warp) {
    const c = warp ? W(warp) / Math.tan(Math.PI * warp / fs) : 2 * fs, c2 = c * c;
    const B0 = b[0] * c2 + b[1] * c + b[2], B1 = -2 * b[0] * c2 + 2 * b[2], B2 = b[0] * c2 - b[1] * c + b[2];
    const A0 = a[0] * c2 + a[1] * c + a[2], A1 = -2 * a[0] * c2 + 2 * a[2], A2 = a[0] * c2 - a[1] * c + a[2];
    return { b0: B0 / A0, b1: B1 / A0, b2: B2 / A0, a1: A1 / A0, a2: A2 / A0 };
  }

  // Betrag der Übertragungsfunktion einer Biquad-Kette bei f (linear)
  function magnitude(sections, f, fs) {
    const w = 2 * Math.PI * f / fs;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    let mag = 1;
    for (const s of sections) {
      const nr = s.b0 + s.b1 * c1 + s.b2 * c2, ni = -(s.b1 * s1 + s.b2 * s2);
      const dr = 1 + s.a1 * c1 + s.a2 * c2, di = -(s.a1 * s1 + s.a2 * s2);
      mag *= Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }
    return mag;
  }

  // Bewertungskurve als Biquad-Kette, bei 1 kHz auf 0 dB normiert. "Z" = keine Filterung.
  function designWeighting(type, fs) {
    if (type === "Z") return [];
    const w1 = W(F1), w2 = W(F2), w3 = W(F3), w4 = W(F4);
    const sections = [bilinear([1, 0, 0], [1, 2 * w1, w1 * w1], fs)];                 // s² / (s+w1)²
    if (type === "A") sections.push(bilinear([1, 0, 0], [1, w2 + w3, w2 * w3], fs));  // s² / ((s+w2)(s+w3))
    // der Abschnitt mit den hohen Polen wird bei 9 kHz abgeglichen: bis 8 kHz max. 0,3 dB Abweichung von der Norm
    // (ohne Abgleich 0,55 dB, bei 16 kHz 6,4 dB statt 4,7 dB)
    const warp = fs * 0.45 > 9000 ? 9000 : fs * 0.2;
    sections.push(bilinear([0, 0, 1], [1, 2 * w4, w4 * w4], fs, warp));               // 1 / (s+w4)²
    const g = 1 / magnitude(sections, 1000, fs);
    sections[0].b0 *= g; sections[0].b1 *= g; sections[0].b2 *= g;
    return sections;
  }

  // Bewertung in dB bei f (für Tests und Anzeige)
  function weightingDb(type, f, fs) {
    return 20 * Math.log10(magnitude(designWeighting(type, fs), f, fs));
  }

  // ---------- Pegelmesser ----------
  class SplMeter {
    // opts.leqWindowSec: Länge des gleitenden Leq (Standard 1800 s = 30 min)
    constructor(fs, opts) {
      opts = opts || {};
      this.fs = fs;
      this.windowSec = opts.leqWindowSec || 1800;
      this.bucketSamples = Math.max(1, Math.round(fs));
      this.aF = 1 - Math.exp(-1 / (fs * TAU_FAST));
      this.aS = 1 - Math.exp(-1 / (fs * TAU_SLOW));
      this.dcR = Math.exp(-2 * Math.PI * 5 / fs);   // Gleichspannung (unter ~5 Hz) ausblenden
      this.chains = WEIGHTINGS.map((name) => {
        const sec = designWeighting(name, fs);
        return {
        name, sec,
        z: new Float64Array(sec.length * 2),
        msF: 0, msS: 0, maxF: 0, maxS: 0, peak: 0,
        sumSq: 0, n: 0,
        cs: 0, cn: 0, bs: new Float64Array(this.windowSec), bn: new Float64Array(this.windowSec), pos: 0, totSum: 0, totN: 0,
        capSum: 0, capN: 0, count: 0,
        };
      });
      this.dcX = 0; this.dcY = 0;
      this.total = 0;
      this.capturing = false;
    }

    push(chunk) {
      const aF = this.aF, aS = this.aS, R = this.dcR, bucket = this.bucketSamples, capturing = this.capturing;
      let dcX = this.dcX, dcY = this.dcY;
      for (let i = 0; i < chunk.length; i++) {
        const x = chunk[i];
        const xd = x - dcX + R * dcY; dcX = x; dcY = xd;
        for (let c = 0; c < this.chains.length; c++) {
          const ch = this.chains[c];
          let y = xd;
          const sec = ch.sec, z = ch.z;
          for (let s = 0, zi = 0; s < sec.length; s++, zi += 2) {
            const q = sec[s];
            const out = q.b0 * y + z[zi];
            z[zi] = q.b1 * y - q.a1 * out + z[zi + 1];
            z[zi + 1] = q.b2 * y - q.a2 * out;
            y = out;
          }
          const y2 = y * y;
          ch.msF += aF * (y2 - ch.msF);
          ch.msS += aS * (y2 - ch.msS);
          if (ch.msF > ch.maxF) ch.maxF = ch.msF;
          if (ch.msS > ch.maxS) ch.maxS = ch.msS;
          const ay = y < 0 ? -y : y;
          if (ay > ch.peak) ch.peak = ay;
          ch.sumSq += y2; ch.n++;
          ch.cs += y2; ch.cn++;
          if (ch.cn >= bucket) {
            ch.totSum += ch.cs - ch.bs[ch.pos]; ch.totN += ch.cn - ch.bn[ch.pos];
            ch.bs[ch.pos] = ch.cs; ch.bn[ch.pos] = ch.cn;
            ch.pos = (ch.pos + 1) % this.windowSec;
            ch.count++;
            ch.cs = 0; ch.cn = 0;
          }
          if (capturing) { ch.capSum += y2; ch.capN++; }
        }
      }
      this.dcX = dcX; this.dcY = dcY;
      this.total += chunk.length;
    }

    // alle Werte in dBFS; -Infinity = noch nichts gemessen
    snapshot() {
      const out = { seconds: this.total / this.fs, w: {} };
      for (const ch of this.chains) {
        const sum30 = ch.totSum + ch.cs, n30 = ch.totN + ch.cn;
        out.w[ch.name] = {
          fast: db(ch.msF), slow: db(ch.msS),
          maxFast: db(ch.maxF), maxSlow: db(ch.maxS),
          leq: ch.n ? db(ch.sumSq / ch.n) : -Infinity,
          leq30: n30 ? db(sum30 / n30) : -Infinity,
          leq30Seconds: n30 / this.fs,
          peak: ch.peak > 1e-10 ? 20 * Math.log10(ch.peak) : -Infinity,
        };
      }
      return out;
    }

    // Pegelverlauf: Leq je volle Sekunde (dBFS), älteste zuerst, höchstens leqWindowSec Werte.
    // first = laufende Nummer der ersten Sekunde seit dem Start (0 = erste Sekunde).
    history(weighting) {
      const ch = this.chains.find((c) => c.name === (weighting || "A"));
      const n = Math.min(ch.count, this.windowSec), out = new Array(n);
      for (let k = 0; k < n; k++) {
        const i = (ch.pos - n + k + this.windowSec * 2) % this.windowSec;
        out[k] = ch.bn[i] ? db(ch.bs[i] / ch.bn[i]) : -Infinity;
      }
      return { values: out, first: ch.count - n };
    }

    // Leq, Maximum und Spitze neu starten (der gleitende 30-min-Leq läuft weiter)
    resetHold() {
      for (const ch of this.chains) { ch.maxF = 0; ch.maxS = 0; ch.peak = 0; ch.sumSq = 0; ch.n = 0; }
    }
    resetAll() {
      this.resetHold();
      for (const ch of this.chains) { ch.bs.fill(0); ch.bn.fill(0); ch.cs = 0; ch.cn = 0; ch.totSum = 0; ch.totN = 0; ch.pos = 0; ch.count = 0; }
    }

    // Kalibrier-Messfenster: Mittelpegel über die Zeit seit beginCapture()
    beginCapture() { this.capturing = true; for (const ch of this.chains) { ch.capSum = 0; ch.capN = 0; } }
    capture(weighting) {
      const ch = this.chains.find((c) => c.name === (weighting || "A"));
      return { seconds: ch.capN / this.fs, level: ch.capN ? db(ch.capSum / ch.capN) : -Infinity };
    }
    endCapture() { this.capturing = false; }
  }

  // ---------- Terzband-Analyse ----------
  const THIRD_OCTAVE_LABELS = ["20", "25", "31,5", "40", "50", "63", "80", "100", "125", "160", "200", "250", "315", "400", "500", "630", "800",
    "1k", "1,25k", "1,6k", "2k", "2,5k", "3,15k", "4k", "5k", "6,3k", "8k", "10k", "12,5k", "16k", "20k"];
  // exakte Mittenfrequenzen (Basis 10): 1000 * 10^(n/10), n = -17 ... 13
  const THIRD_OCTAVE_CENTERS = THIRD_OCTAVE_LABELS.map((l, i) => 1000 * Math.pow(10, (i - 17) / 10));

  function makeFFT(n) {
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
    const bits = Math.round(Math.log2(n));
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
    return function fft(re, im) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      }
      for (let size = 2; size <= n; size *= 2) {
        const half = size / 2, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half;
            const tr = re[l] * cos[k] + im[l] * sin[k];
            const ti = im[l] * cos[k] - re[l] * sin[k];
            re[l] = re[j] - tr; im[l] = im[j] - ti;
            re[j] += tr; im[j] += ti;
          }
        }
      }
    };
  }

  class Spectrum {
    // size: FFT-Länge (Potenz von 2). 16384 bei 48 kHz = 2,9 Hz je Bin, genug für die tiefen Terzbänder.
    constructor(fs, size) {
      const N = size || 16384;
      this.fs = fs; this.N = N;
      this.ring = new Float32Array(N); this.pos = 0; this.filled = 0;
      this.win = new Float64Array(N);
      let sumW2 = 0;
      for (let i = 0; i < N; i++) { const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / N)); this.win[i] = w; sumW2 += w * w; }
      this.scale = 2 / (N * sumW2);        // einseitiges Leistungsspektrum -> Effektivwert²
      this.re = new Float64Array(N); this.im = new Float64Array(N);
      this.fft = makeFFT(N);
      // Jedes Bin trägt anteilig (Überlappung) zu den Terzbändern bei, damit auch die tiefen, schmalen Bänder stimmen
      const df = fs / N, half = N / 2;
      this.bands = THIRD_OCTAVE_CENTERS.map((fc) => {
        const lo = fc * Math.pow(10, -0.05), hi = fc * Math.pow(10, 0.05);
        const k0 = Math.max(1, Math.floor(lo / df)), k1 = Math.min(half - 1, Math.ceil(hi / df));
        const idx = [], wt = [];
        for (let k = k0; k <= k1; k++) {
          const a = Math.max(lo, (k - 0.5) * df), b = Math.min(hi, (k + 0.5) * df);
          if (b > a) { idx.push(k); wt.push((b - a) / df); }
        }
        return { fc, idx, wt };
      });
    }

    push(chunk) {
      const N = this.N;
      let pos = this.pos;
      for (let i = 0; i < chunk.length; i++) { this.ring[pos] = chunk[i]; pos = pos + 1 === N ? 0 : pos + 1; }
      this.pos = pos;
      this.filled = Math.min(N, this.filled + chunk.length);
    }

    ready() { return this.filled >= this.N; }

    // Mittlere Leistung (Effektivwert², linear) je Terzband, oder null solange das Fenster noch nicht gefüllt ist
    bandPowers() {
      if (!this.ready()) return null;
      const N = this.N, re = this.re, im = this.im, win = this.win, ring = this.ring;
      let p = this.pos;                    // ältester Wert
      for (let i = 0; i < N; i++) { re[i] = ring[p] * win[i]; im[i] = 0; p = p + 1 === N ? 0 : p + 1; }
      this.fft(re, im);
      const out = new Float64Array(this.bands.length), sc = this.scale;
      for (let b = 0; b < this.bands.length; b++) {
        const { idx, wt } = this.bands[b];
        let s = 0;
        for (let j = 0; j < idx.length; j++) { const k = idx[j]; s += wt[j] * (re[k] * re[k] + im[k] * im[k]); }
        out[b] = s * sc;
      }
      return out;
    }
  }

  return { SplMeter, Spectrum, designWeighting, weightingDb, magnitude, THIRD_OCTAVE_CENTERS, THIRD_OCTAVE_LABELS, TAU_FAST, TAU_SLOW, db };
});
