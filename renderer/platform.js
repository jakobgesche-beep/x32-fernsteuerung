// Betriebssystem der Oberfläche (Mac oder Windows): Wörter und Hilfen, die davon abhängen. Kommt zuerst; alle anderen Dateien lesen X32PLAT.
// Zum Testen: ?plat=win32 in der Adresse der Testseite erzwingt Windows.
const X32PLAT = (function () {
  let forced = null;
  try { forced = new URLSearchParams(location.search).get('plat'); } catch (e) {}
  const name = forced || (window.x32API && window.x32API.platform) || 'darwin', isMac = name === 'darwin', isWin = name === 'win32';
  return {
    name, isMac, isWin,
    pc: isMac ? 'Mac' : 'Computer',                          // "Der Mac ist mit keinem Netzwerk verbunden" / "Der Computer ..."
    settings: isMac ? 'Systemeinstellungen' : 'Einstellungen',
    fileManager: isMac ? 'Finder' : 'Explorer',
  };
})();
window.X32PLAT = X32PLAT;                                     // (const im Skript ist kein Fenster-Eintrag: hier für Dateien, die window.X32PLAT lesen)
