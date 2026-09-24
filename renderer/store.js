// Spiegel des Pult-Zwischenspeichers in der Oberfläche.
// Werte werden als Pult-Rohwerte gehalten (Pfad -> Zahl/Text). Änderungen vom Pult kommen
// gebündelt aus dem Hauptprozess; eigene Änderungen werden sofort lokal gesetzt (ohne auf
// das Pult zu warten) und gleichzeitig zum Hauptprozess geschickt.
//
// Offline-Modus: dieselbe Oberfläche ohne Pult. Werte kommen aus Startwerten (X32V.defaultWire), jede Änderung
// wird nur lokal gemerkt (im lokalen Speicher, damit sie einen Neustart überlebt) und kann später aufs Pult übertragen werden.
const X = (function () {
  const V = X32V;
  const api = window.x32API;
  const OFFLINE_KEY = 'x32.offline';
  const values = new Map();
  const subs = new Set();
  const statusFns = [];
  const meterFns = [];
  const hotGroups = new Map();
  let status = { state: "idle", progress: 1 };

  // ---- Offline-Modus ----
  let offline = false;
  const offlineChanged = new Map();          // Pfad -> Rohwert, nur was vom Startwert abweicht
  let saveTimer = null;
  try {
    const o = JSON.parse(localStorage.getItem(OFFLINE_KEY));
    if (o && o.v === 1 && o.changed) for (const [p, v] of Object.entries(o.changed)) offlineChanged.set(p, v);
  } catch (e) {}
  function persistOffline() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(OFFLINE_KEY, JSON.stringify({ v: 1, changed: Object.fromEntries(offlineChanged) })); } catch (e) {} }, 300);
  }
  function recordOffline(path, value) {
    if (V.defaultWire(path) === value) offlineChanged.delete(path); else offlineChanged.set(path, value);
    persistOffline();
  }
  // fehlende Werte mit dem gespeicherten Offline-Stand bzw. den Startwerten füllen
  function seed(paths) {
    const entries = [];
    for (const p of paths) {
      if (values.has(p)) continue;
      const v = offlineChanged.has(p) ? offlineChanged.get(p) : V.defaultWire(p);
      if (v !== undefined) entries.push([p, v]);
    }
    if (entries.length) apply(entries);
  }
  function setStatus(s) { status = s; statusFns.forEach((fn) => fn(s)); }
  // ein Wert geht zum Pult (online) oder wird nur als Offline-Änderung gemerkt
  function send(path, type, value) {
    if (offline) recordOffline(path, value); else api.set(path, type, value);
  }

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

  api.onBatch((entries) => { if (!offline) apply(entries); });
  api.onStatus((s) => { if (!offline) setStatus(s); });
  api.onMeter((id, floats) => { if (!offline) meterFns.forEach((fn) => fn(id, floats)); });

  return {
    get: (path) => values.get(path),
    // Wert in echten Einheiten (dB, Hz, ms, ...); Aufzählungen/Zahlen/Texte unverändert
    actual(path) {
      const w = values.get(path);
      return w === undefined ? undefined : V.fromWire(path, w);
    },
    status: () => status,
    isOffline: () => offline,
    // Pult verbunden oder Offline-Modus: Werte lassen sich lesen und ändern
    isLive: () => offline || status.state === 'online',

    // eigene Änderung in echten Einheiten
    set(path, actual) {
      const w = V.toWire(path, actual);
      values.set(path, w.value);
      send(path, w.type, w.value);
      notify([path]);
    },
    setMany(pairs) {
      const changed = [];
      for (const [path, actual] of pairs) {
        const w = V.toWire(path, actual);
        values.set(path, w.value);
        send(path, w.type, w.value);
        changed.push(path);
      }
      notify(changed);
    },
    // eigene Änderung als Pult-Rohwert (z. B. Fader-Schieber 0..1)
    setWire(path, type, value) {
      values.set(path, value);
      send(path, type, value);
      notify([path]);
    },

    subscribe(prefix, fn) {
      const s = { prefix, fn };
      subs.add(s);
      return () => subs.delete(s);
    },
    onStatus(fn) { statusFns.push(fn); },
    onMeter(fn) { meterFns.push(fn); },

    want: (paths) => (offline ? seed(paths) : api.want(paths)),
    refresh: (paths, urgent) => { if (!offline) api.refresh(paths, urgent); },
    setMeters: (streams) => { if (!offline) api.setMeters(streams); },
    setSubs: (specs) => { if (!offline) api.setSubs(specs); },
    // Werte, die alle paar Sekunden erneut gelesen werden (Nachgleich)
    setHotGroup(name, paths) {
      hotGroups.set(name, paths);
      if (!offline) api.setHot([].concat(...hotGroups.values()));
    },
    async loadSnapshot() { apply(await api.snapshot()); },
    apply,

    // ---- Offline-Modus ----
    enterOffline() {
      offline = true;
      values.clear();
      setStatus({ state: 'offline', progress: 1 });
    },
    leaveOffline() {
      offline = false;
      values.clear();
      setStatus({ state: 'idle', progress: 1 });
    },
    offlineChanges: () => offlineChanged.size,
    // was aufs Pult übertragen würde: [[Pfad, Typ, Rohwert], ...]
    offlineWrites: () => Array.from(offlineChanged, ([p, v]) => [p, V.wireType(p), v]).filter((w) => w[1]),
    clearOffline() {
      offlineChanged.clear(); persistOffline();
      if (offline) values.clear();      // Aufrufer lädt die Ansicht neu
    },
  };
})();
