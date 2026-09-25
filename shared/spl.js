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

  // ---------- Mikrofon-Kalibrierdatei (Frequenzgang des Mikrofons) ----------
  // Eine solche Datei sagt, wie stark das Mikrofon je Frequenz vom idealen Verlauf abweicht (dB; plus = das Mikrofon zeigt zu viel an).
  // Format wie bei REW/ARTA/miniDSP: Zeilen "Frequenz Hz  dB [Phase]", getrennt durch Leerzeichen, Tab, Semikolon oder Komma;
  // Kopfzeilen (Text oder mit * " # beginnend) werden ignoriert. Die Messung gleicht die Abweichung aus (zieht sie ab).
  const MICCAL_MAX_DEV = 40;
  function parseMicCal(text) {
    const points = [], seen = new Set();
    let sens = null, skipped = 0;
    String(text == null ? "" : text).split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t) return;
      if (/^[*"#;]/.test(t) || /^[A-Za-z]/.test(t)) { const m = /sens\s*factor\s*=\s*(-?[\d.,]+)/i.exec(t); if (m) sens = parseFloat(m[1].replace(",", ".")); return; }
      const parts = (/[\s;]/.test(t) ? t.split(/[\s;]+/) : t.split(",")).map((x) => x.replace(",", "."));
      const f = parseFloat(parts[0]), d = parseFloat(parts[1]);
      if (!isFinite(f) || !isFinite(d) || parts.length < 2) { skipped++; return; }
      if (f < 5 || f > 60000 || Math.abs(d) > MICCAL_MAX_DEV) { skipped++; return; }
      const key = f.toFixed(3);
      if (seen.has(key)) return;
      seen.add(key); points.push([f, d]);
    });
    points.sort((a, b) => a[0] - b[0]);
    if (points.length < 3) return { ok: false, error: "In der Datei stehen weniger als 3 brauchbare Zeilen. Erwartet werden Zeilen wie „1000  0,5“ (Frequenz in Hz, Abweichung in dB).", points: [], skipped };
    if (points[0][0] > 500 || points[points.length - 1][0] < 4000) return { ok: false, error: "Die Datei deckt nicht genug Frequenzen ab (mindestens von 500 Hz bis 4 kHz).", points: [], skipped };
    return { ok: true, points, sens, skipped };
  }
  // Abweichung bei f: linear zwischen den Punkten (Frequenz logarithmisch), außerhalb konstant
  function micCalDb(points, f) {
    if (!points || !points.length) return 0;
    if (f <= points[0][0]) return points[0][1];
    const last = points[points.length - 1];
    if (f >= last[0]) return last[1];
    let i = 1; while (points[i][0] < f) i++;
    const a = points[i - 1], b = points[i], t = (Math.log(f) - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]));
    return a[1] + (b[1] - a[1]) * t;
  }
  const micCalToText = (points) => points.map((p) => p[0].toFixed(p[0] < 100 ? 2 : 1) + "\t" + p[1].toFixed(2)).join("\n") + "\n";
  const micCalMax = (points) => points.reduce((m, p) => (Math.abs(p[1]) > Math.abs(m[1]) ? p : m), points[0]);

  // Peaking-Filter (RBJ) für eine Verstärkung gainDb bei f0
  function peaking(f0, gainDb, Q, fs) {
    const A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * f0 / fs, al = Math.sin(w0) / (2 * Q), c = Math.cos(w0);
    const a0 = 1 + al / A;
    return { b0: (1 + al * A) / a0, b1: -2 * c / a0, b2: (1 - al * A) / a0, a1: -2 * c / a0, a2: (1 - al / A) / a0 };
  }
  // Filterkette, die die Abweichung des Mikrofons ausgleicht: je Sechstel-Oktave ein breites Peaking-Filter (Q = 2). Die dB-Kurven der
  // hintereinander geschalteten Filter addieren sich; die Verstärkungen werden per Ausgleichsrechnung (kleinste Fehlerquadrate auf einem dichten
  // Raster, 4 Punkte je Filterabstand, also auch zwischen den Filtermitten) bestimmt und viermal nachgestellt. Die beste Runde gewinnt, jede
  // Verstärkung ist auf ±24 dB begrenzt. Ergebnis bei glatten Kurven (Mikrofone): unter 0,35 dB Abweichung von 20 Hz bis 16 kHz;
  // bei stark welligen Testkurven (±3 dB je Oktave) und Zufallskurven höchstens etwa 0,7 dB. Ganz oben (über etwa 18 kHz) bis 1 dB.
  // Die Kurve wird bei 1 kHz auf 0 dB gelegt: die Pegel-Kalibrierung (Kalibrator bei 1 kHz) bleibt gültig, wenn eine Datei später geladen oder getauscht wird.
  const MICCAL_Q = 2, MICCAL_RIDGE = 0.01, MICCAL_CLAMP = 24;
  function solveLinear(A, b) {                       // Gauß mit Spaltenwahl; A und b werden verändert
    const n = b.length;
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      const t = A[c]; A[c] = A[p]; A[p] = t; const tb = b[c]; b[c] = b[p]; b[p] = tb;
      for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; if (f) { for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; } }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let sum = b[r]; for (let k = r + 1; k < n; k++) sum -= A[r][k] * x[k]; x[r] = sum / A[r][r]; }
    return x;
  }
  function designMicCorrection(points, fs) {
    const centers = [], grid = [];
    for (let k = -38; k <= 40; k++) { const fc = 1000 * Math.pow(10, k / 20); if (fc < fs * 0.48) centers.push(fc); }   // etwas über den Messbereich hinaus, damit die Ränder stimmen
    for (let i = 0; ; i++) { const f = 20 * Math.pow(10, i / 80); if (f > fs * 0.42) break; grid.push(f); }
    const n = centers.length, m = grid.length, ref = micCalDb(points, 1000), target = grid.map((f) => -(micCalDb(points, f) - ref));
    if (target.every((x) => Math.abs(x) < 0.03)) return [];
    const build = (g) => centers.map((fc, i) => peaking(fc, g[i], MICCAL_Q, fs));
    // M[i][j]: Wirkung (dB) von Filter j mit 1 dB Verstärkung am Rasterpunkt i; N = MᵀM + Ridge (hält die Verstärkungen klein)
    const M = grid.map(() => new Array(n).fill(0));
    for (let j = 0; j < n; j++) { const sec = [peaking(centers[j], 1, MICCAL_Q, fs)]; for (let i = 0; i < m; i++) M[i][j] = 20 * Math.log10(magnitude(sec, grid[i], fs)); }
    const N = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let a = 0; a < n; a++) for (let b = a; b < n; b++) { let sum = 0; for (let i = 0; i < m; i++) sum += M[i][a] * M[i][b]; N[a][b] = N[b][a] = sum; }
    for (let a = 0; a < n; a++) N[a][a] += MICCAL_RIDGE;
    let g = new Array(n).fill(0), best = g, bestErr = Infinity;
    for (let it = 0; it <= 4; it++) {
      const sec = build(g), e = grid.map((f, i) => target[i] - 20 * Math.log10(magnitude(sec, f, fs)));
      const err = Math.sqrt(e.reduce((acc, x) => acc + x * x, 0) / m);
      if (err < bestErr) { bestErr = err; best = g; }
      if (it === 4 || !(err > 0.005)) break;
      const rhs = new Array(n).fill(0);
      for (let a = 0; a < n; a++) { let sum = -MICCAL_RIDGE * g[a]; for (let i = 0; i < m; i++) sum += M[i][a] * e[i]; rhs[a] = sum; }
      const d = solveLinear(N.map((r) => r.slice()), rhs);
      g = g.map((x, i) => Math.max(-MICCAL_CLAMP, Math.min(MICCAL_CLAMP, x + d[i])));
    }
    const chain = build(best), trim = 1 / magnitude(chain, 1000, fs);      // bei 1 kHz genau 0 dB (dort wird kalibriert)
    chain[0].b0 *= trim; chain[0].b1 *= trim; chain[0].b2 *= trim;
    return chain;
  }
  // Ausgleich je Terzband in dB (zum Addieren zum gemessenen Terzbandpegel)
  const micCalBandDb = (points) => THIRD_OCTAVE_CENTERS.map((fc) => -(micCalDb(points, fc) - micCalDb(points, 1000)));

  // ---------- Prüfung des Kalibriersignals ----------
  // Spanne (höchster minus niedrigster Wert) einer Pegelreihe in dB; unendlich, wenn nichts Messbares dabei ist
  function levelRange(levels) {
    const f = levels.filter(isFinite);
    return f.length ? Math.max.apply(null, f) - Math.min.apply(null, f) : Infinity;
  }
  // Ist das Signal ein ruhiger Einzelton (Kalibrator)? levels: Pegel (dB) während der Messung, bands: Leistung je Terzband (linear).
  // Ein Ton liegt fast vollständig in einem Terzband (plus Nachbarn, falls er zwischen zwei Bändern sitzt); Musik und Rauschen verteilen sich.
  // Ergebnis: { ok, code: "ok" | "noise" | "unstable" | "silent", share (0..1), fc (Mittenfrequenz), range (dB) }
  function checkCalTone(levels, bands) {
    const range = levelRange(levels);
    let sum = 0, best = -1, bp = 0;
    for (let i = 0; i < bands.length; i++) { sum += bands[i]; if (bands[i] > bp) { bp = bands[i]; best = i; } }
    if (best < 0 || !(sum > 0)) return { ok: false, code: "silent", share: 0, fc: 0, range };
    const share = (bp + (best > 0 ? bands[best - 1] : 0) + (best + 1 < bands.length ? bands[best + 1] : 0)) / sum, fc = THIRD_OCTAVE_CENTERS[best];
    if (share < 0.9) return { ok: false, code: "noise", share, fc, range };
    if (range > 2) return { ok: false, code: "unstable", share, fc, range };
    return { ok: true, code: "ok", share, fc, range };
  }

  // ---------- Pegelmesser ----------
  class SplMeter {
    // opts.leqWindowSec: Länge des gleitenden Leq (Standard 1800 s = 30 min); opts.micCal: Kalibrierdatei des Mikrofons ([[Hz, dB], ...])
    constructor(fs, opts) {
      opts = opts || {};
      this.fs = fs;
      this.windowSec = opts.leqWindowSec || 1800;
      this.bucketSamples = Math.max(1, Math.round(fs));
      this.aF = 1 - Math.exp(-1 / (fs * TAU_FAST));
      this.aS = 1 - Math.exp(-1 / (fs * TAU_SLOW));
      this.dcR = Math.exp(-2 * Math.PI * 5 / fs);   // Gleichspannung (unter ~5 Hz) ausblenden
      this.corr = opts.micCal && opts.micCal.length ? designMicCorrection(opts.micCal, fs) : [];       // Mikrofon-Ausgleich: einmal pro Messwert, vor den Bewertungen
      this.cz = new Float64Array(this.corr.length * 2);
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
      const aF = this.aF, aS = this.aS, R = this.dcR, bucket = this.bucketSamples, capturing = this.capturing, corrSec = this.corr, cz = this.cz;
      let dcX = this.dcX, dcY = this.dcY;
      for (let i = 0; i < chunk.length; i++) {
        const x = chunk[i];
        let xd = x - dcX + R * dcY; dcX = x; dcY = xd;
        if (corrSec.length) {
          for (let s2 = 0, zi = 0; s2 < corrSec.length; s2++, zi += 2) {
            const q = corrSec[s2], out = q.b0 * xd + cz[zi];
            cz[zi] = q.b1 * xd - q.a1 * out + cz[zi + 1];
            cz[zi + 1] = q.b2 * xd - q.a2 * out;
            xd = out;
          }
        }
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
    // Kalibrierdatei des Mikrofons ([[Hz, dB], ...]) oder null: gleicht die Terzbandpegel aus
    setMicCal(points) { this.corr = points && points.length ? micCalBandDb(points).map((d) => Math.pow(10, d / 10)) : null; }

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
        out[b] = s * sc * (this.corr ? this.corr[b] : 1);
      }
      return out;
    }
  }

  return { SplMeter, Spectrum, designWeighting, weightingDb, magnitude, parseMicCal, micCalDb, micCalToText, micCalMax, designMicCorrection, micCalBandDb, levelRange, checkCalTone, THIRD_OCTAVE_CENTERS, THIRD_OCTAVE_LABELS, TAU_FAST, TAU_SLOW, db };
});
