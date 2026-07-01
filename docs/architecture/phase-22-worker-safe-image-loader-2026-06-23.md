# Phase 22 Worker Safe Image Loader

Date: 2026-06-23
Branch: `v2_pai`

## Goal

Allow the Recognition Worker to inspect real uploaded card images without moving heavy vision dependencies into Vercel.

This is needed before OCR, geometry, glare, and quality signals can reliably become low-cost evidence ahead of legacy vision provider.

## What Changed

The worker now has a safe signed-image loader:

- HTTPS only
- allowlisted image hosts only
- no embedded URL credentials
- no redirects
- bounded `Content-Length`
- bounded actual bytes read
- bounded decoded pixel count
- Pillow decode into RGB NumPy array
- redacted URL metadata in processing trace

The endpoint uses the loader only when `ENABLE_IMAGE_DOWNLOAD=true`.

When enabled and image load succeeds, the worker now runs:

1. card rectification
2. glare detection
3. image quality measurement
4. region proposal against the rectified size

When disabled or image load fails, it returns explicit `UNAVAILABLE` reasons and does not fabricate quality or geometry facts.

## Runtime Position

The intended low-cost path becomes:

1. Supabase verified storage image
2. signed read URL
3. Recognition Worker safe image loader
4. local quality, glare, rectification, region proposal
5. OCR adapter
6. OCR text fusion
7. Identity Resolution Gate
8. legacy vision provider only when local evidence cannot resolve identity

## Safety Notes

The loader does not:

- follow redirects
- accept non-image content types
- accept unbounded image bytes
- accept unbounded decoded pixels
- expose signed tokens in output metadata
- mutate or repair image pixels with generative methods

## Remaining Work

Next steps:

1. Enable a real OCR adapter behind the existing loader.
2. Run end-to-end recognition eval on the Supabase image-backed dataset.
3. Add per-field latency/cost accounting for worker preflight.
4. Add product/player/parallel candidate verification against internal registry and official checklist evidence.
