# LYNCA Recognition Worker

This service is the container boundary for computer-vision and OCR work. The Vercel/Node app must not import PaddleOCR, OpenCV, PyTorch, SigLIP, DINO, or LightGlue directly.

## Current Status

- FastAPI contract skeleton is implemented.
- Internal bearer-token auth is required.
- URL security only allows configured image hosts and HTTPS.
- R2 offline image geometry, glare, quality, multi-card risk detection, and region-proposal functions are implemented as CPU-safe NumPy baselines.
- The HTTP endpoint can download signed image bytes when `ENABLE_IMAGE_DOWNLOAD=true`; otherwise geometry and quality return explicit `UNAVAILABLE`.
- OCR model execution still returns explicit `UNAVAILABLE` until a backend is enabled. A local Tesseract CLI adapter can be enabled with `ENABLE_TESSERACT_OCR=true`; OCR text fusion parses real OCR line items into field candidates, resolved fields, conflicts, and trace metadata.
- When Tesseract is enabled, the worker also runs deterministic upscaled focused crops for requested serial, collector number, checklist code, and grade-label fields. These crops improve small printed-text evidence; they do not infer visual color or parallel.
- Multi-card detection emits `multi_card_detection` as a routing risk signal. It is used to abstain or split lot workflows, not to auto-generate a single-card identity from a lot photo.
- Visual embeddings use a real SigLIP2 backend when `ENABLE_VISUAL_EMBEDDINGS=true`.
  The worker emits versioned, L2-normalized 768-dimensional image vectors for
  Supabase pgvector candidate recall. If the model backend cannot load, it
  returns explicit `UNAVAILABLE` rather than fabricated vectors.
- Candidate-verification paths return explicit `UNAVAILABLE` or `DISABLED`
  placeholders until a verifier backend is enabled.
- PaddleOCR is listed as an optional adapter dependency but is not enabled by default.
- Unlimited-OCR is documented as an experimental future adapter and is not included in this image.

## Endpoints

- `GET /healthz`
- `GET /readyz`
- `POST /v1/analyze-card-images`

## Required Environment

- `RECOGNITION_WORKER_TOKEN`
- `RECOGNITION_ALLOWED_IMAGE_HOSTS`

Optional:

- `ENABLE_PADDLEOCR=false`
- `ENABLE_TESSERACT_OCR=false`
- `TESSERACT_LANGUAGE=eng`
- `TESSERACT_PSM=11`
- `TESSERACT_TIMEOUT_SECONDS=20`
- `ENABLE_IMAGE_DOWNLOAD=false`
- `ENABLE_OPENCV_RECTIFICATION=false`
- `ENABLE_VISUAL_EMBEDDINGS=false`
- `VISUAL_EMBEDDING_MODEL_ID=google/siglip2-base-patch16-384`
- `VISUAL_EMBEDDING_MODEL_REVISION=f775b65a79762255128c981547af89addcfe0f88`
- `VISUAL_EMBEDDING_PREPROCESSING_VERSION=card-rectification-v1`
- `VISUAL_EMBEDDING_DIMENSIONS=768`
- `VISUAL_EMBEDDING_DEVICE=` (optional; defaults to CUDA, then MPS, then CPU)
- `ENABLE_CANDIDATE_VERIFICATION=false`
- `RECOGNITION_MAX_IMAGE_BYTES=26214400`
- `RECOGNITION_MAX_TOTAL_PIXELS=50000000`
- `RECOGNITION_REQUEST_TIMEOUT_SECONDS=30`

## Local Tests

```bash
cd services/recognition-worker
PYTHONPATH=. python3 -m unittest discover -s tests
PYTHONPATH=. python3 -m app.eval --input fixtures/worker-eval-sample.json
```

The R2 tests use synthetic images and do not call external services, eBay, Agnes, Brave, or paid APIs.

## Docker

```bash
docker build -t lynca-recognition-worker .
docker run --rm -p 8080:8080 \
  -e RECOGNITION_WORKER_TOKEN=dev-token \
  -e RECOGNITION_ALLOWED_IMAGE_HOSTS=example.supabase.co \
  -e ENABLE_IMAGE_DOWNLOAD=true \
  -e ENABLE_TESSERACT_OCR=true \
  -e ENABLE_VISUAL_EMBEDDINGS=true \
  lynca-recognition-worker
```

For production, run this worker as a dedicated cloud service with enough memory
for SigLIP2 model weights. Keep the Vercel listing API as the orchestration
layer; do not load PyTorch/Transformers inside Vercel serverless functions.
