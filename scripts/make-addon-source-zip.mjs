// Zips the human-readable source of the ATN-listed Thunderbird add-on into
// daynizer-addon-listed-source.zip at the repo root, for Mozilla reviewers
// (the listed .xpi is bundled/minified, so ATN asks for the source plus build
// steps; it stays private to the review team). Contents: exactly what
// `npm run package:addon:listed` reads, plus BUILD.md. The Experiment folder is
// left out because the listed build never ships it.
import archiver from "archiver";
import { createWriteStream, existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const outPath = resolve(root, "daynizer-addon-listed-source.zip");
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;

const BUILD_MD = `# Daynizer for Thunderbird ${version}: build instructions

This archive is the complete source of the Daynizer add-on submitted to
addons.thunderbird.net. The submitted .xpi is produced by Vite (Rollup +
esbuild minification) from the TypeScript/React source below. Nothing is
obfuscated.

## Requirements

- Node.js 24 (built with v${process.versions.node})
- npm 11

## Build

    npm ci --ignore-scripts
    npm run package:addon:listed

Output: \`daynizer-addon-listed.xpi\` (and the unpacked build in
\`dist-addon-listed/\`).

\`--ignore-scripts\` skips the desktop app's Electron download, which the add-on
does not use.

## Layout

- \`thunderbird-addon/\`: add-on specific code. \`background/\` is the background
  script (storage via sql.js, CalDAV/CardDAV sync, freemium entitlement),
  \`tab/\` hosts the UI, \`manifest.json\` is the base manifest (the build sets
  the version from package.json and the listed add-on id), \`vite.config.ts\` is
  the build config (\`--mode listed\`).
- \`src/\`: the React UI shared with the Daynizer desktop app.
- \`scripts/package-addon-xpi.mjs\`: zips the build output into the .xpi.
`;

// The zip (and the .xpi) are built from the working tree. A real submission
// must match a commit, so warn loudly about uncommitted shared-UI changes.
// (thunderbird-addon/ is gitignored here; check its own repo separately.)
try {
  const dirty = execSync("git status --porcelain -- src package.json package-lock.json scripts", { cwd: root })
    .toString()
    .trim();
  if (dirty) {
    console.warn("WARNING: uncommitted changes will be included in the source zip:\n" + dirty);
    console.warn("For a real ATN submission, commit or stash them and rebuild the .xpi first.\n");
  }
} catch {
  /* not a git checkout; nothing to check */
}

if (existsSync(outPath)) unlinkSync(outPath);
const output = createWriteStream(outPath);
const archive = archiver("zip", { zlib: { level: 9 } });
output.on("close", () => console.log(`daynizer-addon-listed-source.zip written (${archive.pointer()} bytes)`));
archive.on("error", (err) => {
  throw err;
});
archive.pipe(output);

for (const f of ["package.json", "package-lock.json", "tsconfig.json", "scripts/package-addon-xpi.mjs", "LICENSE"]) {
  archive.file(resolve(root, f), { name: f });
}
archive.directory(resolve(root, "src"), "src");
archive.glob("**/*", { cwd: resolve(root, "thunderbird-addon"), ignore: ["experiments/**"], dot: false }, { prefix: "thunderbird-addon" });
archive.append(BUILD_MD, { name: "BUILD.md" });
await archive.finalize();
