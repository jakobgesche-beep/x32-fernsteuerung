// Rechenfunktionen für EQ-Kurve und Kompressor-Kennlinie (ohne DOM). Gemeinsam genutzt von der EQ-/Kompressor-Seite
// (processing.js) und den Mini-Anzeigen über den Fadern (minis.js).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./values"));
  else root.X32EQ = factory(root.X32V);
})(typeof self !== "undefined" ? self : this, function (V) {
  const EQ_TYPES = V.EQ_TYPES_EXT;
  const DYN_RATIOS = V.DYN_RATIOS;
  const HP_SLOPES = V.HP_SLOPES;
  const SAMPLE_RATE = 48000;
  const KNEE_DB_PER_STEP = 2;

function biquadCoeffs(typeName, f, gainDb, Q){
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * f / SAMPLE_RATE;
  const cosw0 = Math.cos(w0), sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if(typeName === 'PEQ' || typeName === 'VEQ'){
    b0 = 1 + alpha * A; b1 = -2 * cosw0; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cosw0; a2 = 1 - alpha / A;
  } else if(typeName === 'LShv'){
    const sq = Math.sqrt(A);
    b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * sq * alpha);
    b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
    b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * sq * alpha);
    a0 = (A + 1) + (A - 1) * cosw0 + 2 * sq * alpha;
    a1 = -2 * ((A - 1) + (A + 1) * cosw0);
    a2 = (A + 1) + (A - 1) * cosw0 - 2 * sq * alpha;
  } else if(typeName === 'HShv'){
    const sq = Math.sqrt(A);
    b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * sq * alpha);
    b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
    b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * sq * alpha);
    a0 = (A + 1) - (A - 1) * cosw0 + 2 * sq * alpha;
    a1 = 2 * ((A - 1) - (A + 1) * cosw0);
    a2 = (A + 1) - (A - 1) * cosw0 - 2 * sq * alpha;
  } else if(typeName === 'LCut'){
    b0 = (1 + cosw0) / 2; b1 = -(1 + cosw0); b2 = (1 + cosw0) / 2;
    a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
  } else if(typeName === 'HCut'){
    b0 = (1 - cosw0) / 2; b1 = 1 - cosw0; b2 = (1 - cosw0) / 2;
    a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
  } else {
    b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
function magnitudeDb(c, f){
  const w = 2 * Math.PI * f / SAMPLE_RATE;
  const cos1 = Math.cos(w), sin1 = -Math.sin(w), cos2 = Math.cos(2 * w), sin2 = -Math.sin(2 * w);
  const nRe = c.b0 + c.b1 * cos1 + c.b2 * cos2, nIm = c.b1 * sin1 + c.b2 * sin2;
  const dRe = 1 + c.a1 * cos1 + c.a2 * cos2, dIm = c.a1 * sin1 + c.a2 * sin2;
  return 20 * Math.log10(Math.sqrt(nRe * nRe + nIm * nIm) / Math.sqrt(dRe * dRe + dIm * dIm));
}
function hpfDb(fc, slopeDbPerOct, f){
  const n = slopeDbPerOct / 6;
  return -10 * Math.log10(1 + Math.pow(fc / f, 2 * n));
}
// Typen 6..13 (nur Bus/Matrix/Main, Band 1 und 6): BU6 BU12 BS12 LR12 BU18 BU24 BS24 LR24.
// Butterworth exakt, Bessel als Butterworth genähert, Linkwitz-Riley als zwei kaskadierte Butterworth.
function extendedCutDb(type, isLowCut, fc, f){
  const r = isLowCut ? fc / f : f / fc;
  const bu = (n) => -10 * Math.log10(1 + Math.pow(r, 2 * n));
  switch(type){
    case 6: return bu(1);
    case 7: case 8: return bu(2);
    case 9: return 2 * bu(1);
    case 10: return bu(3);
    case 11: case 12: return bu(4);
    case 13: return 2 * bu(2);
  }
  return 0;
}
function bandIsCut(b){ return b.type === 0 || b.type === 5 || b.type >= 6; }
function eqResponseDb(f, eq, misc){
  let total = 0;
  if(misc.hpOn && misc.hpf) total += hpfDb(misc.hpf, HP_SLOPES[misc.hpSlope] || 18, f);
  if(misc.eqOn !== 0){
    eq.forEach((b, i) => {
      if(b.type === undefined || b.f === undefined || b.g === undefined || b.q === undefined) return;
      if(b.type >= 6) total += extendedCutDb(b.type, i < eq.length / 2, b.f, f);
      else total += magnitudeDb(biquadCoeffs(EQ_TYPES[b.type], b.f, b.g, bandIsCut(b) ? Math.SQRT1_2 : b.q), f);
    });
  }
  return total;
}
function transferOut(x, d){
  const T = d.thr !== undefined ? d.thr : -20;
  const R = DYN_RATIOS[d.ratio !== undefined ? d.ratio : 5] || 3;
  const G = d.mgain || 0;
  const W = Math.round(d.knee || 0) * KNEE_DB_PER_STEP;
  let y;
  if(d.mode === 1) y = x >= T ? x : T + (x - T) * R;
  else if(W > 0 && x > T - W / 2 && x < T + W / 2) y = x + (1 / R - 1) * Math.pow(x - T + W / 2, 2) / (2 * W);
  else y = x < T ? x : T + (x - T) / R;
  return y + G;
}
function sidechainDb(f, d){
  const fc = d['filter/f'] || 1000, t = d['filter/type'] || 0, r = f / fc;
  let p;
  if(t === 0) p = r * r / (1 + r * r);
  else if(t === 1) p = 1 / (1 + Math.pow(1 / r, 4));
  else if(t === 2) p = 1 / (1 + r * r);
  else if(t === 3) p = 1 / (1 + Math.pow(r, 4));
  else { const Q = [1, 2, 3, 5, 10][t - 4] || 1; p = 1 / (1 + Q * Q * Math.pow(r - 1 / r, 2)); }
  return 10 * Math.log10(Math.max(p, 1e-9));
}
function grFromFactor(v){ return v > 0 && v < 1 ? -20 * Math.log10(v) : 0; }

  return { biquadCoeffs, magnitudeDb, hpfDb, extendedCutDb, bandIsCut, eqResponseDb, transferOut, sidechainDb, grFromFactor, SAMPLE_RATE, KNEE_DB_PER_STEP };
});
