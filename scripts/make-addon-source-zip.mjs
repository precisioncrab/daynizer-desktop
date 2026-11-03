// Makes the two files uploaded to addons.thunderbird.net (ATN), the way ATN's
// reviewers will rebuild them:
//   daynizer-addon-listed-source.zip  the human-readable source + build steps
//   daynizer-addon-listed.xpi         built FROM that source, in a clean folder
//
// Why a separate package list: the desktop app's package.json carries Electron,
// electron-builder and the built-in server's packages. ATN scans the submitted
// lock file for known vulnerabilities and the reviewer runs `npm ci` on it, so
// the source zip gets its own package.json + package-lock.json with only what
// the add-on build uses (0.9.0 was rejected over desktop-only packages, 2026-11).
// They live in thunderbird-addon/build-deps/ (the add-on's private repo) and are
// regenerated here every run: the version and ranges come from the desktop
// package.json, so there is one place to bump.
//
// Steps:
//   1. write thunderbird-addon/build-deps/package.json, refresh its lock file
//   2. copy the source into addon-release/ (gitignored) and zip exactly that
//   3. `npm ci` + build in addon-release/, copy the .xpi to the repo root
//   4. `npm audit` there, so a vulnerable package shows before ATN sees it
// `--zip-only` stops after step 2.
import { ZipArchive } from "archiver";
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const depsDir = resolve(root, "thunderbird-addon", "build-deps");
const stage = resolve(root, "addon-release");
const zipPath = resolve(root, "daynizer-addon-listed-source.zip");
const xpiPath = resolve(root, "daynizer-addon-listed.xpi");
const zipOnly = process.argv.includes("--zip-only");

const desktop = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = desktop.version;

// Everything the add-on bundle imports (src/ + thunderbird-addon/), and the
// build tools. Ranges are copied from the desktop package.json.
const ADDON_DEPS = ["@event-calendar/core", "ical.js", "nanoid", "qrcode", "react", "react-dom", "rrule", "sql.js", "tsdav"];
const ADDON_BUILD_DEPS = ["@vitejs/plugin-react", "archiver", "vite"];

function pick(names) {
  const out = {};
  for (const n of names) {
    const range = desktop.dependencies?.[n] ?? desktop.devDependencies?.[n];
    if (!range) throw new Error(`${n} is not in package.json; update ADDON_DEPS in ${import.meta.filename}`);
    out[n] = range;
  }
  return out;
}

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit" });

// ---- 1. the add-on's own package.json + lock ----
const addonPkg = {
  name: "daynizer-thunderbird-addon",
  version,
  description: "Daynizer for Thunderbird: build of the add-on submitted to addons.thunderbird.net.",
  license: desktop.license,
  author: desktop.author,
  private: true,
  type: "module",
  scripts: {
    "build:addon:listed": "vite build --config thunderbird-addon/vite.config.ts --mode listed",
    "package:addon:listed": "npm run build:addon:listed && node scripts/package-addon-xpi.mjs --listed"
  },
  dependencies: pick(ADDON_DEPS),
  devDependencies: pick(ADDON_BUILD_DEPS)
};
mkdirSync(depsDir, { recursive: true });
writeFileSync(resolve(depsDir, "package.json"), JSON.stringify(addonPkg, null, 2) + "\n");
console.log("Refreshing thunderbird-addon/build-deps/package-lock.json ...");
run("npm install --package-lock-only --ignore-scripts --no-audit --no-fund", depsDir);

// The upload must match committed code. Shared UI and scripts are in this repo;
// thunderbird-addon/ (incl. build-deps/) is its own repo (tasks-thunderbird-addon).
try {
  const dirty = execSync("git status --porcelain -- src package.json package-lock.json scripts", { cwd: root }).toString().trim();
  if (dirty) {
    console.warn("\nWARNING: uncommitted changes will be included in the source zip:\n" + dirty);
    console.warn("For a real ATN submission, commit them first (and sync + commit thunderbird-addon/ in its own repo).\n");
  }
} catch {
  /* not a git checkout; nothing to check */
}

// ---- 2. stage the source and zip exactly that ----
const BUILD_MD = `# Daynizer for Thunderbird ${version}: build instructions

This archive is the complete source of the Daynizer add-on submitted to
addons.thunderbird.net. The submitted .xpi is produced by Vite (Rolldown +
Oxc minification) from the TypeScript/React source below, using exactly these
steps in a clean copy of this archive. Nothing is obfuscated.

## Requirements

- Node.js 24 or newer (built with v${process.versions.node})
- npm 11

## Build

    npm ci
    npm run package:addon:listed

Output: \`daynizer-addon-listed.xpi\` (and the unpacked build in
\`dist-addon-listed/\`).

## Layout

- \`package.json\`, \`package-lock.json\`: the add-on build's packages only
  (the desktop app shares the UI code but is built separately).
- \`thunderbird-addon/\`: add-on specific code. \`background/\` is the background
  script (storage via sql.js, CalDAV/CardDAV sync over https only, freemium
  entitlement), \`tab/\` hosts the UI, \`manifest.json\` is the base manifest (the
  build sets the version from package.json and the listed add-on id),
  \`vite.config.ts\` is the build config (\`--mode listed\`).
- \`src/\`: the React UI shared with the Daynizer desktop app.
- \`scripts/package-addon-xpi.mjs\`: zips the build output into the .xpi.
`;

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(resolve(depsDir, "package.json"), resolve(stage, "package.json"));
cpSync(resolve(depsDir, "package-lock.json"), resolve(stage, "package-lock.json"));
for (const f of ["tsconfig.json", "scripts/package-addon-xpi.mjs", "LICENSE"]) {
  cpSync(resolve(root, f), resolve(stage, f));
}
cpSync(resolve(root, "src"), resolve(stage, "src"), { recursive: true });
const skip = ["experiments", "build-deps", "node_modules"].map((d) => resolve(root, "thunderbird-addon", d));
cpSync(resolve(root, "thunderbird-addon"), resolve(stage, "thunderbird-addon"), {
  recursive: true,
  filter: (src) => !skip.some((d) => src === d || src.startsWith(d + "\\") || src.startsWith(d + "/"))
});
writeFileSync(resolve(stage, "BUILD.md"), BUILD_MD);

if (existsSync(zipPath)) unlinkSync(zipPath);
await new Promise((done, fail) => {
  const output = createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  output.on("close", () => {
    console.log(`daynizer-addon-listed-source.zip written (${archive.pointer()} bytes)`);
    done();
  });
  archive.on("error", fail);
  archive.pipe(output);
  archive.directory(stage, false);
  archive.finalize();
});
if (zipOnly) process.exit(0);

// ---- 3. build the .xpi from that source, as the reviewer will ----
console.log("\nBuilding the .xpi from the staged source (npm ci, then package:addon:listed) ...");
run("npm ci --no-audit --no-fund", stage);
run("npm run package:addon:listed", stage);
cpSync(resolve(stage, "daynizer-addon-listed.xpi"), xpiPath);
console.log(`daynizer-addon-listed.xpi copied to the repo root (version ${version}).`);

// ---- 4. known vulnerabilities in the add-on's packages (high and critical) ----
console.log("\nnpm audit of the add-on's packages:");
try {
  run("npm audit --audit-level=high", stage);
} catch {
  console.warn("\nWARNING: npm audit found high or critical issues above. ATN will reject them; fix before uploading.");
  process.exitCode = 1;
}
