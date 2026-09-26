// Sucht die lokal installierte Messsoftware REW (Room EQ Wizard) auf dem Mac (REW.app) oder unter Windows (REW.exe, Startmenü-Verknüpfung).
// Ohne Node-Abhängigkeiten: Dateizugriffe kommen von außen (env), damit die Suche testbar ist.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.X32REW = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const NAME_RE = /^(rew|room ?eq ?wizard)\b.*\.app$/i;   // REW.app, REW 5.31.app, Room EQ Wizard.app ...
  const KNOWN = ["/Applications/REW.app", "/Applications/REW/REW.app", "/Applications/Room EQ Wizard.app"];

  // Windows: REW liegt meist in C:\Program Files\REW\ (REW.exe); der Name des Programms kann je Version abweichen, deshalb wird gesucht
  const WIN_DIR_RE = /^(rew($|[\s._\-\d])|room ?eq ?wizard)/i;             // nicht "Rewind" o. ä.
  const WIN_FILE_RE = /^(rew|room ?eq ?wizard)([\s._\-\d][^\\/]*)?\.(exe|lnk)$/i;
  const WIN_SKIP_RE = /unins|uninstall|deinstall|setup|update/i;
  function findRewWin(env) {
    const j = env.join || ((a, b) => a + "\\" + b), pick = (dir) => env.list(dir).find((n) => WIN_FILE_RE.test(n) && !WIN_SKIP_RE.test(n));
    if (env.saved && env.exists(env.saved)) return { path: env.saved, source: "saved" };
    for (const base of env.programDirs || []) {                 // Program Files, Program Files (x86), %LOCALAPPDATA%\Programs
      for (const n of env.list(base)) {
        if (!WIN_DIR_RE.test(n)) continue;
        const dir = j(base, n), bin = j(dir, "bin"), f = pick(dir), g = f ? null : pick(bin);
        if (f) return { path: j(dir, f), source: "scan" };
        if (g) return { path: j(bin, g), source: "scan" };
      }
    }
    for (const base of env.startMenuDirs || []) {               // Verknüpfung im Startmenü (Ordner "REW" oder direkt)
      const f = pick(base);
      if (f) return { path: j(base, f), source: "scan" };
      for (const n of env.list(base)) { if (!WIN_DIR_RE.test(n) || /\.lnk$/i.test(n)) continue; const g = pick(j(base, n)); if (g) return { path: j(j(base, n), g), source: "scan" }; }
    }
    return null;
  }

  // env: { saved, home, platform, exists(path) -> bool, list(dir) -> [Namen] (leer, wenn es das Verzeichnis nicht gibt),
  //        nur Windows: programDirs [Ordner], startMenuDirs [Ordner], join(a, b) }
  // Ergebnis: { path, source: "saved" | "known" | "scan" } oder null
  function findRew(env) {
    if (env.platform === "win32") return findRewWin(env);
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
