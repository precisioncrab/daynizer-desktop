const { execFileSync } = require("node:child_process");

/**
 * electron-builder's own ad-hoc signing (when no Developer ID identity is available)
 * doesn't reseal Contents/Resources after extraResources are copied in, so macOS's
 * code-signature check fails at launch ("code has no resources but signature
 * indicates they must be present") and the app is silently killed within ~1s with
 * zero output. A `codesign --force --deep --sign -` pass after packaging reseals
 * everything and fixes it. Skipped when a real identity signs the build (CSC_LINK
 * set) since that path already signs correctly.
 */
module.exports = async function afterSign(context) {
  if (process.platform !== "darwin") return;
  if (process.env.CSC_LINK) return;

  const { appOutDir, packager } = context;
  const appPath = `${appOutDir}/${packager.appInfo.productFilename}.app`;
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
};
