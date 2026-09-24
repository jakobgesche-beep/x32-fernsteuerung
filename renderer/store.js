// Spiegel des Pult-Zwischenspeichers in der Oberfläche.
// Werte werden als Pult-Rohwerte gehalten (Pfad -> Zahl/Text). Änderungen vom Pult kommen
// gebündelt aus dem Hauptprozess; eigene Änderungen werden sofort lokal gesetzt (ohne auf
// das Pult zu warten) und gleichzeitig zum Hauptprozess geschickt.
const X = (function () {
  const V = X32V;
  const api = window.x32API;
  const values = new Map();
  const subs = new Set();
  const statusFns = [];
  const meterFns = [];
  const hotGroups = new Map();
  let status = { state: "idle", progress: 1 };

  function notify(paths) {
    if (!paths.length) return;
    for (const s of subs) {
      const hit = s.prefix ? paths.filter((p) => p.startsWith(s.prefix)) : paths;
      if (hit.length) s.fn(hit);
    }
  }
  function apply(entries) {
    const changed = [];
    for (const [path, value] of entries) {
      if (values.get(path) !== value) { values.set(path, value); changed.push(path); }
    }
    notify(changed);
  }

  api.onBatch(apply);
  api.onStatus((s) => { status = s; statusFns.forEach((fn) => fn(s)); });
  api.onMeter((id, floats) => meterFns.forEach((fn) => fn(id, floats)));

  return {
    get: (path) => values.get(path),
    // Wert in echten Einheiten (dB, Hz, ms, ...); Aufzählungen/Zahlen/Texte unverändert
    actual(path) {
      const w = values.get(path);
      return w === undefined ? undefined : V.fromWire(path, w);
    },
    status: () => status,

    // eigene Änderung in echten Einheiten
    set(path, actual) {
      const w = V.toWire(path, actual);
      values.set(path, w.value);
      api.set(path, w.type, w.value);
      notify([path]);
    },
    setMany(pairs) {
      const changed = [];
      for (const [path, actual] of pairs) {
        const w = V.toWire(path, actual);
        values.set(path, w.value);
        api.set(path, w.type, w.value);
        changed.push(path);
      }
      notify(changed);
    },
    // eigene Änderung als Pult-Rohwert (z. B. Fader-Schieber 0..1)
    setWire(path, type, value) {
      values.set(path, value);
      api.set(path, type, value);
      notify([path]);
    },

    subscribe(prefix, fn) {
      const s = { prefix, fn };
      subs.add(s);
      return () => subs.delete(s);
    },
    onStatus(fn) { statusFns.push(fn); },
    onMeter(fn) { meterFns.push(fn); },

    want: (paths) => api.want(paths),
    refresh: (paths, urgent) => api.refresh(paths, urgent),
    setMeters: (streams) => api.setMeters(streams),
    setSubs: (specs) => api.setSubs(specs),
    // Werte, die alle paar Sekunden erneut gelesen werden (Nachgleich)
    setHotGroup(name, paths) {
      hotGroups.set(name, paths);
      api.setHot([].concat(...hotGroups.values()));
    },
    async loadSnapshot() { apply(await api.snapshot()); },
    apply,
  };
})();
