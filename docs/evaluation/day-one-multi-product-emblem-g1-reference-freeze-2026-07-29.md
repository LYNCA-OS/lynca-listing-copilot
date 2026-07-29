# Day-one six-product emblem G1 reference freeze

Status: **`G1_REFERENCE_FROZEN`**

This artifact completes only the reference side of the pre-registered
six-product mark experiment. No evaluation page was opened, no evaluation
image was displayed, and no evaluation descriptor or score was computed.

## Frozen lineage

- G0 commit: `71ed382b1cddf98375210e1d57f722d778f121a9`
- G0 document SHA-256:
  `77bb72ca261e90cbfc4a819cfeb35b8a6c667d91b06cf8c3f45e4946eabdaf4c`
- G1 acquisition commits: `62c76bcf`, `ecfd26d0`
- Candidate manifest SHA-256:
  `bc2b5d39fefea3389b0f477914967502d0b593ce8bfd1df5d9d7e0f226d30b12`
- Frozen reference manifest SHA-256:
  `eb61f4395ec079a3bb356dd444378adf75df91df13583b03c569eec3fd85e286`
- Reference freezer SHA-256:
  `a5823163c80dddd1ecd2fa9e05db014ce79f9a8cc5d9ed71ea9940cbaf520b08`

The candidate acquisition fetched 150 official-template candidates: the first
30 decodable DOM-order images for each of the five new products. It remained
incapable of reading an evaluation-page registry or importing OpenCV. Seven
broken preferred Prizm assets were recorded and skipped fail-closed; no lower
resolution fallback from the same tag was substituted.

## One-time selections

The fixed rule was applied before any G2 acquisition: inspect no more than the
first 30 template candidates and select the first one-card front with the full
product mark. Phoenix is the byte-for-byte reference from the earlier frozen
gate and was not selected again.

| Product | Page order | Crop `xywh` | SIFT keypoints | Crop raw-grayscale SHA-256 |
| --- | ---: | --- | ---: | --- |
| Phoenix | prior freeze | `230,525,150,140` | 201 | `5be53e3ad989847800b4fc4704ac616530a88f8deea0cd45827bad579b0bb80d` |
| Contenders | 1 | `95,1078,273,127` | 300 | `031e97be4eedf1695ce7878605f3bbaaf4f4fe7d2f0ba7e10a4ba6c2528c808e` |
| Spectra | 4 | `813,89,167,153` | 310 | `1a55c9ba73b04a177de63d59263c52a36fde4475c4c5cae2996c21447e7698b2` |
| Elite | 2 | `953,339,128,156` | 251 | `ff00ff54a45df802dd59b2bf8c3a87f6c798fce6391f5531a8c05fab847beb80` |
| Donruss Optic | 4 | `198,42,164,161` | 148 | `cf3b8054edcdf1dcc10cac4703ae8d1f820bd414ff970a0bc74925d149db3c1f` |
| Prizm | 3 | `672,68,358,139` | 450 | `e1577f8c49e7a1092ad69ff2f39992cfc76b12a1cf3855d0816fa45749dec2ce` |

All five newly selected crops include the complete visible mark and the frozen
ten-pixel visual padding. All six exceed the five-keypoint eligibility floor.
The exact official page, original asset URL, reader/content hashes,
transported and decoded hashes, dimensions, crop artifact hash, and selection
rationale are recorded in
`data/eval/product-emblem/multi-product-official-reference-v1.json`.

## Runtime and boundary

- Python `3.13.3`
- OpenCV `4.13.0`, one thread
- Pillow `12.1.1`
- macOS arm64
- SIFT `nfeatures=4000`, `contrastThreshold=0.015`, `edgeThreshold=12`

G1 is now reproducible and immutable. G2 remains unopened. The next legal
action is to commit the G2 builder, scorer, tests, source-page registry,
featured-hero exclusion, historical-overlap registry, and atomic consumption
guard before accessing any of the 18 evaluation pages.
