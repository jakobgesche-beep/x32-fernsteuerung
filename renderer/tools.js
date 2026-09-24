// Werkzeuge: kleine Rechner für den Alltag der Technik-AG (Rechnung in shared/calc.js).
const Tools = (function () {
  const C = X32Calc;
  let built = false;

  // beschriftetes Zahlenfeld
  function field(label, value, unit, opts) {
    opts = opts || {};
    const wrap = el('<label class="t-field"><span>' + esc(label) + '</span><div class="t-input"><input type="number" step="any"' + (opts.min !== undefined ? ' min="' + opts.min + '"' : '') + (opts.max !== undefined ? ' max="' + opts.max + '"' : '') + '><em>' + esc(unit || '') + '</em></div></label>');
    const input = wrap.querySelector('input');
    input.value = value;
    wrap.get = () => { const v = parseFloat(input.value); return isFinite(v) ? v : NaN; };
    wrap.input = input;
    return wrap;
  }
  const num = (v, d) => (isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: d === undefined ? 1 : d, minimumFractionDigits: 0 }) : '–');
  function card(title, help) {
    const c = el('<section class="t-card"><div class="t-title">' + esc(title) + '</div>' + (help ? '<p class="t-help">' + esc(help) + '</p>' : '') + '<div class="t-body"></div></section>');
    return { root: c, body: c.querySelector('.t-body') };
  }
  function bind(fields, update) { fields.forEach((f) => f.input.addEventListener('input', update)); update(); }
  const result = () => el('<div class="t-result"></div>');
  const row = (...kids) => { const r = el('<div class="t-row"></div>'); r.append(...kids); return r; };

  function delayCard() {
    const c = card('Laufzeit / Delay', 'Eine Box weiter hinten (Delay-Lautsprecher) braucht eine Verzögerung, damit ihr Schall zeitgleich mit der Bühne ankommt.');
    const dist = field('Entfernung Bühne → Box', 20, 'm', { min: 0 }), temp = field('Temperatur', 20, '°C', { min: -30, max: 50 });
    const res = result();
    const ms = field('oder Delay-Zeit', 58.3, 'ms', { min: 0 });
    const back = result();
    c.body.append(row(dist, temp), res, el('<div class="t-sep"></div>'), row(ms), back);
    bind([dist, temp], () => {
      const t = temp.get(), d = dist.get();
      res.innerHTML = '<b>' + num(C.distanceToMs(d, t), 1) + ' ms</b><small>Schall braucht ' + num(C.speedOfSound(t), 1) + ' m/s · ' + num(C.distanceToMs(d, t) * 48, 0) + ' Samples bei 48 kHz</small>';
    });
    bind([ms, temp], () => { back.innerHTML = '<b>' + num(C.msToDistance(ms.get(), temp.get()), 1) + ' m</b><small>entspricht dieser Delay-Zeit</small>'; });
    return c.root;
  }

  function bpmCard() {
    const c = card('Echo-Zeiten nach Tempo', 'Delay- und Hall-Zeiten, die zum Song passen. „Tippen" im Takt des Songs stellt das Tempo ein.');
    const bpm = field('Tempo', 120, 'BPM', { min: 20, max: 300 });
    const tap = el('<button class="btn secondary small t-tap">Tippen</button>');
    const table = el('<div class="t-table"></div>');
    c.body.append(row(bpm, tap), table);
    bind([bpm], () => {
      const v = bpm.get();
      table.innerHTML = isFinite(v) && v > 0 ? C.bpmTimes(v).map((r) => '<div class="t-tr"><span>' + esc(r.name) + '</span><b>' + num(r.ms, 1) + ' ms</b><em>' + num(r.hz, 2) + ' Hz</em></div>').join('') : '';
    });
    let taps = [];
    tap.addEventListener('click', () => {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
      taps.push(now); taps = taps.slice(-8);
      if (taps.length >= 2) { bpm.input.value = (60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1))).toFixed(1); bpm.input.dispatchEvent(new Event('input')); }
    });
    return c.root;
  }

  function levelCard() {
    const c = card('Pegel über Entfernung', 'Im Freien sinkt der Pegel bei doppeltem Abstand um 6 dB. In Räumen mit Hall weniger.');
    const l1 = field('Pegel', 100, 'dB'), d1 = field('gemessen in', 1, 'm', { min: 0.1 }), d2 = field('gesucht in', 20, 'm', { min: 0.1 });
    const res = result();
    const a = field('Quelle 1', 90, 'dB'), b = field('Quelle 2', 90, 'dB'), d = field('Quelle 3 (optional)', '', 'dB');
    const sum = result();
    c.body.append(row(l1, d1, d2), res, el('<div class="t-sep"></div>'), el('<div class="t-sub">Mehrere Quellen zusammen</div>'), row(a, b, d), sum);
    bind([l1, d1, d2], () => { res.innerHTML = '<b>' + num(C.levelAtDistance(l1.get(), d1.get(), d2.get()), 1) + ' dB</b><small>in ' + num(d2.get(), 1) + ' m Entfernung</small>'; });
    bind([a, b, d], () => { const ls = [a.get(), b.get(), d.get()].filter(isFinite); sum.innerHTML = '<b>' + num(C.sumLevels(ls), 1) + ' dB</b><small>' + (ls.length > 1 ? 'zwei gleich laute Quellen: +3 dB, zehn: +10 dB' : 'mindestens zwei Quellen eintragen') + '</small>'; });
    return c.root;
  }

  function freqCard() {
    const c = card('Frequenz, Wellenlänge, Ton', 'Wie lang ist eine Schallwelle, und welcher Ton ist das? Hilfreich z. B. bei Rückkopplung oder Bassfallen.');
    const f = field('Frequenz', 440, 'Hz', { min: 1 }), t = field('Temperatur', 20, '°C', { min: -30, max: 50 });
    const res = result();
    c.body.append(row(f, t), res);
    bind([f, t], () => {
      const hz = f.get(), lam = C.wavelength(hz, t.get()), n = C.noteOf(hz);
      res.innerHTML = '<b>' + (lam >= 1 ? num(lam, 2) + ' m' : num(lam * 100, 1) + ' cm') + '</b><small>Wellenlänge · Periode ' + num(C.periodMs(hz), 2) + ' ms · Ton ' + esc(n.name) + ' (' + (n.cents >= 0 ? '+' : '') + num(n.cents, 0) + ' Cent zu ' + num(n.exactHz, 1) + ' Hz)</small>';
    });
    return c.root;
  }

  function dbCard() {
    const c = card('dB umrechnen');
    const db = field('Pegeländerung', 6, 'dB');
    const res = result();
    c.body.append(row(db), res);
    bind([db], () => { const v = db.get(); res.innerHTML = '<b>×' + num(C.dbToVoltageRatio(v), 2) + ' Spannung</b><small>×' + num(C.dbToPowerRatio(v), 2) + ' Leistung · +6 dB ist doppelte Spannung, +3 dB doppelte Leistung, +10 dB fühlt sich etwa doppelt so laut an</small>'; });
    return c.root;
  }

  function init(root) {
    if (built) return;
    built = true;
    root.innerHTML = '';
    const grid = el('<div class="t-grid"></div>');
    [delayCard, bpmCard, levelCard, freqCard, dbCard].forEach((make) => grid.appendChild(make()));
    root.appendChild(grid);
  }
  return { init };
})();
