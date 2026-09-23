const { execFileSync } = require("child_process");

module.exports = async function (context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  console.log("Ad-hoc signed: " + appPath);
};
