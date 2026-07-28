import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const repoRoot = new URL("../", import.meta.url);
const vendorRoot = new URL("../lib/vendor/exceljs-browser/", import.meta.url);
const bundleUrl = new URL("exceljs.min.js", vendorRoot);
const licenseUrl = new URL("LICENSE", vendorRoot);
const manifest = JSON.parse(await readFile(new URL("manifest.json", vendorRoot), "utf8"));
const sbom = JSON.parse(await readFile(new URL("sbom.spdx.json", vendorRoot), "utf8"));
const vendorPackage = JSON.parse(await readFile(new URL("package.json", vendorRoot), "utf8"));
const rootPackage = JSON.parse(await readFile(new URL("package.json", repoRoot), "utf8"));
const packageLock = JSON.parse(await readFile(new URL("package-lock.json", repoRoot), "utf8"));

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const bundle = await readFile(bundleUrl);
const license = await readFile(licenseUrl);
const bundleArtifact = manifest.artifacts.find((artifact) => artifact.path === "exceljs.min.js");
const licenseArtifact = manifest.artifacts.find((artifact) => artifact.path === "LICENSE");

assert.equal(manifest.schema_version, "lynca-vendored-artifact-v1");
assert.equal(manifest.component.name, "exceljs");
assert.equal(manifest.component.version, "4.4.0");
assert.equal(manifest.component.license, "MIT");
assert.equal(manifest.source.commit, "ac96f9a61e9799c7776bd940f05c4a51d7200209");
assert.equal(bundle.byteLength, bundleArtifact.size_bytes);
assert.equal(sha256(bundle), bundleArtifact.sha256);
assert.equal(license.byteLength, licenseArtifact.size_bytes);
assert.equal(sha256(license), licenseArtifact.sha256);
assert.equal(vendorPackage.type, "commonjs");
assert.equal(vendorPackage.version, manifest.component.version);
assert.equal(vendorPackage.license, "MIT");
assert.equal(vendorPackage.dependencies, undefined);

assert.equal(rootPackage.dependencies?.exceljs, undefined, "the full ExcelJS npm package must stay out of production dependencies");
assert.equal(packageLock.packages?.[""]?.dependencies?.exceljs, undefined);
for (const packageName of ["exceljs", "archiver", "archiver-utils", "readdir-glob", "zip-stream"]) {
  assert.equal(
    packageLock.packages?.[`node_modules/${packageName}`],
    undefined,
    `${packageName} must not re-enter the vendored browser runtime dependency chain`
  );
}

assert.equal(sbom.spdxVersion, "SPDX-2.3");
const sbomPackage = sbom.packages.find((entry) => entry.SPDXID === "SPDXRef-Package-exceljs-browser");
const sbomBundle = sbom.files.find((entry) => entry.SPDXID === "SPDXRef-File-exceljs-min-js");
const sbomLicense = sbom.files.find((entry) => entry.SPDXID === "SPDXRef-File-license");
assert.equal(sbomPackage.versionInfo, manifest.component.version);
assert.equal(sbomPackage.licenseDeclared, "MIT");
assert.equal(sbomBundle.checksums[0].checksumValue, bundleArtifact.sha256);
assert.equal(sbomLicense.checksums[0].checksumValue, licenseArtifact.sha256);

const exportModuleUrl = new URL("../lib/listing/v4/export/writer-batch-export.mjs", import.meta.url);
const exportSource = await readFile(exportModuleUrl, "utf8");
assert.match(exportSource, /from "\.\.\/\.\.\/\.\.\/vendor\/exceljs-browser\/exceljs\.min\.js"/);
assert.doesNotMatch(exportSource, /from ["']exceljs(?:\/|["'])/);

const require = createRequire(import.meta.url);
const loadedBefore = new Set(Object.keys(require.cache));
const { buildWriterExportWorkbook } = await import(exportModuleUrl);
const newlyLoadedModules = Object.keys(require.cache).filter((modulePath) => !loadedBefore.has(modulePath));
assert.equal(
  newlyLoadedModules.some((modulePath) => /node_modules\/(?:exceljs|archiver|archiver-utils|readdir-glob|zip-stream)(?:\/|$)/.test(modulePath)),
  false,
  "Writer Export must load only the fixed local browser artifact"
);

const pngBytes = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082",
  "hex"
);
const pngDataUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;
const rows = Array.from({ length: 250 }, (_, index) => ({
  asset_id: `asset-${index + 1}`,
  asset_index: index + 1,
  recognition_session_id: `session-${index + 1}`,
  final_title: `2026 LYNCA Vendor Regression Card ${index + 1}`,
  images: [
    { id: `front-${index + 1}`, name: "front.png", embedDataUrl: pngDataUrl },
    { id: `back-${index + 1}`, name: "back.png", embedDataUrl: pngDataUrl }
  ]
}));

const generated = await buildWriterExportWorkbook({ rows, env: {} });
assert.equal(generated.rows.length, 250);
assert.equal(generated.buffer.subarray(0, 2).toString("utf8"), "PK");

const ExcelJS = (await import(bundleUrl)).default;
const readback = new ExcelJS.Workbook();
await readback.xlsx.load(generated.buffer);
const sheet = readback.getWorksheet("Writer Export");
assert.equal(sheet.rowCount, 251);
assert.equal(sheet.getCell("A251").value, "Asset 250");
assert.equal(sheet.getCell("D251").value, "2026 LYNCA Vendor Regression Card 250");
assert.equal(sheet.getImages().length, 500);

console.log(JSON.stringify({
  status: "passed",
  exceljs_version: manifest.component.version,
  bundle_sha256: bundleArtifact.sha256,
  workbook_rows: generated.rows.length,
  worksheet_rows: sheet.rowCount,
  embedded_images: sheet.getImages().length,
  workbook_bytes: generated.buffer.byteLength
}, null, 2));
