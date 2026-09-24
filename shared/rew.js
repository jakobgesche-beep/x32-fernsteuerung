// Sucht die lokal installierte Messsoftware REW (Room EQ Wizard) auf dem Mac.
// Ohne Node-Abhängigkeiten: Dateizugriffe kommen von außen (env), damit die Suche testbar ist.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.X32REW = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const NAME_RE = /^(rew|room ?eq ?wizard)\b.*\.app$/i;   // REW.app, REW 5.31.app, Room EQ Wizard.app ...
  const KNOWN = ["/Applications/REW.app", "/Applications/REW/REW.app", "/Applications/Room EQ Wizard.app"];

  // env: { saved, home, exists(path) -> bool, list(dir) -> [Namen] (leer, wenn es das Verzeichnis nicht gibt) }
  // Ergebnis: { path, source: "saved" | "known" | "scan" } oder null
  function findRew(env) {
    if (env.saved && env.exists(env.saved)) return { path: env.saved, source: "saved" };
    const known = KNOWN.concat(env.home ? [env.home + "/Applications/REW.app"] : []);
    for (const p of known) if (env.exists(p)) return { path: p, source: "known" };
    const dirs = ["/Applications"].concat(env.home ? [env.home + "/Applications"] : []);
    for (const dir of dirs) {
      const names = env.list(dir);
      for (const n of names) if (NAME_RE.test(n)) return { path: dir + "/" + n, source: "scan" };
      for (const n of names) {                                   // eine Ebene tiefer, z. B. /Applications/REW/REW.app
        if (!/rew|room ?eq/i.test(n) || /\.app$/i.test(n)) continue;
        for (const m of env.list(dir + "/" + n)) if (NAME_RE.test(m)) return { path: dir + "/" + n + "/" + m, source: "scan" };
      }
    }
    return null;
  }

  return { findRew, NAME_RE };
});
