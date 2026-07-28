# ExcelJS browser runtime

This directory contains the exact browser bundle used by the Writer Export
runtime. It is deliberately narrower than installing the full `exceljs` npm
package.

The export path only uses the in-memory `Workbook`, image embedding,
`xlsx.writeBuffer()` and `xlsx.load()` APIs. The upstream Node package also
installs streaming/archive dependencies that this path never imports. Keeping
the upstream browser artifact here removes that unreachable dependency chain
without changing workbook behavior or applying transitive dependency
overrides.

## Provenance

- Upstream package: `exceljs@4.4.0`
- Source repository: <https://github.com/exceljs/exceljs>
- Source commit: `ac96f9a61e9799c7776bd940f05c4a51d7200209`
- npm tarball: <https://registry.npmjs.org/exceljs/-/exceljs-4.4.0.tgz>
- Upstream path: `package/dist/exceljs.min.js`
- Runtime SHA-256: `7e49da68588e250dbb8bba190d2caa8ab3787cc0284bda1d8b2f805c4df742c9`
- License: MIT; the unmodified upstream license is in `LICENSE`

`manifest.json` is the machine-readable provenance and integrity contract.
`sbom.spdx.json` is the SPDX 2.3 software bill of materials for the vendored
component and committed runtime files.

The bundle is stored with its upstream filename. The local `package.json`
marks this directory as CommonJS so Node can load the unmodified UMD artifact
from an otherwise ESM repository.

## Verification and update policy

Run:

```sh
node scripts/exceljs-vendor-integrity.test.mjs
npm audit --omit=dev
node scripts/v4-writer-export.test.mjs
```

The integrity test verifies the committed file and license hashes, provenance
metadata, package/lock boundary, sole production import and a 250-row workbook
with 500 embedded images followed by a complete readback.

Do not hand-edit the minified bundle. An update must be a dedicated dependency
change that copies the exact artifact and license from a pinned upstream
tarball, updates all hashes and the SBOM, passes the same workbook regression,
and leaves the production audit clean. Do not use npm overrides to make an
incompatible archive dependency appear fixed.
