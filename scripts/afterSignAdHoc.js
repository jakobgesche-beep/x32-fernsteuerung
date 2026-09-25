const { execFileSync } = require("child_process");
const MachoUuid = require("./macho-uuid");

// Wird nach dem Packen aufgerufen: (1) jedem Programm der App eine eigene UUID geben (macOS verwechselt sonst Apps mit gleicher UUID, z. B. bei
// der Freigabe für das lokale Netzwerk), (2) danach ad-hoc signieren (die Signatur muss nach dem Ändern der Datei neu gemacht werden).
module.exports = async function (context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  const results = MachoUuid.patchApp(appPath, context.packager.appInfo.id);
  const main = results.find((r) => r.file.endsWith("/MacOS/" + context.packager.appInfo.productFilename));
  console.log("Eigene UUID vergeben: " + results.filter((r) => r.patched).length + " Programme, Hauptprogramm " + (main ? main.before[0] + " -> " + main.after[0] : "?"));
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  console.log("Ad-hoc signed: " + appPath);
};
