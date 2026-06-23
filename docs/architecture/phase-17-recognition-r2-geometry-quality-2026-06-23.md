# Phase 17 - Recognition R2 Geometry And Quality

Status: R2 offline CPU-safe geometry, glare, quality, region proposal, and worker eval entry implemented.

## Scope

This phase moves the Recognition Worker beyond contract placeholders for the image-geometry layer. It still does not enable OCR, visual embeddings, geometric candidate verification, or production image downloading from signed URLs.

Implemented:

- card rectangle detection from an in-memory image array
- optional lazy OpenCV contour/homography adapter
- CPU-safe NumPy fallback for axis-aligned card detection
- glare mask summary without generative reconstruction
- blur/focus/image-quality metrics
- fixed-template key region proposals on rectified card coordinates
- worker-level field eval entry via `python3 -m app.eval`

Not implemented:

- safe signed-URL image byte loader
- MIME verification from downloaded bytes
- redirect validation during fetch
- PaddleOCR adapter
- multi-scale OCR
- visual embedding adapter
- Top-K geometric verification against retrieved candidates
- production latency benchmark

## Card Rectification

Primary production-intended adapter:

- `opencv_contour_homography_r2`
- lazy imports `cv2`
- contour detection
- quadrilateral approximation
- card aspect-ratio constraint
- ordered corner points
- perspective homography

Local test baseline:

- `numpy_luminance_bbox_r2`
- no external image downloads
- deterministic luminance mask
- bounding box candidate
- aspect and area constraints
- homography is a crop translation, not a perspective warp

The local baseline exists because the desktop Python `cv2` import was not reliable enough to make every local test depend on it. Containerized OpenCV remains pinned in `requirements.txt` and disabled by feature flag until deployment smoke tests confirm it.

## Quality Gate

`measure_image_quality_from_array()` reports:

- `blur_score`
- `focus_features.laplacian_variance`
- `focus_features.tenengrad`
- `focus_features.edge_density`
- `glare_score`
- `crop_complete`
- `perspective_score`
- `text_readability_score`
- `resolution_sufficient`
- `critical_region_occlusion`
- `image_quality_degraded`

Blur is not based on Laplacian variance alone. It combines Laplacian variance, Tenengrad, and edge density.

## Glare Detection

`detect_glare_from_array()` reports:

- binary mask summary
- positive pixel ratio
- coarse glare regions
- `generative_reconstruction_used=false`

It only detects highlight/overexposure signals. It never repairs or rewrites covered text.

## Region Proposal

`propose_regions_for_rectified_card()` maps requested fields to deterministic normalized card regions:

- `serial_number`
- `collector_number`
- `checklist_code`
- `grade_label`
- `year_product`
- `subject`
- `parallel`
- `card_type`
- `back_text`

These regions are crop proposals for later OCR. They are not identity decisions.

## Worker Eval

The worker now supports:

```bash
cd services/recognition-worker
PYTHONPATH=. python3 -m app.eval --input fixtures/worker-eval-sample.json
```

This evaluates worker field candidates only. It does not claim card-level commercial accuracy and does not use eBay, Agnes, Brave, or paid APIs.

## Current Tests

`npm run test:recognition` now covers:

- Recognition dataset validator and metrics
- Node recognition client contract
- Worker request/security contract
- Serial, checklist, collector, and grade parsers
- R2 synthetic card rectification
- R2 glare detection
- R2 quality gate
- R2 region proposal
- Worker eval field metrics

## Gate Impact

This phase improves measurable infrastructure, not commercial accuracy.

Commercial gate remains blocked until enough owner-reviewed held-out data exists and the full end-to-end eval proves:

- Overall Exact Resolution >= 95%
- Human-authored Critical Resolution <= 5%
- Accepted Critical Error <= 0.5%
- AI_COMPLETE Precision >= 99%
