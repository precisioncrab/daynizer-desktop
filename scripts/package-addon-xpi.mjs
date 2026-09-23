// Zips dist-addon/ into daynizer-addon.xpi at the repo root, or, with
// `--listed`, dist-addon-listed/ into daynizer-addon-listed.xpi (the
// Experiment-free ATN build from `vite --mode listed`).
//
// Replaces a prior PowerShell `Compress-Archive` step: that produced a zip
// that generic tools (Python's zipfile, Info-ZIP) read as perfectly valid,
// but Thunderbird's own jar reader failed to resolve files inside it
// (NS_ERROR_FILE_NOT_FOUND loading experiments/caldavNet/schema.json),
// making the .xpi uninstallable -- confirmed 2026-09-16 by rebuilding with
// Python's zipfile instead, which installed fine. `archiver` (already a
// transitive dep via electron-builder) produces a standard zip the same way.
import archiver from "archiver";
import { createWriteStream, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const listed = process.argv.includes("--listed");
const srcDir = resolve(root, listed ? "dist-addon-listed" : "dist-addon");
const outName = listed ? "daynizer-addon-listed.xpi" : "daynizer-addon.xpi";
const outPath = resolve(root, outName);

if (existsSync(outPath)) unlinkSync(outPath);

const output = createWriteStream(outPath);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  console.log(`${outName} written (${archive.pointer()} bytes)`);
});
archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(srcDir, false);
await archive.finalize();
