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
- Multi-card detection emits `multi_card_detection` as a routing risk signal. Two-card/small-contour results remain unconfirmed; an exact count is admitted only when at least three independent, card-sized rectangles are visible in one image.
- Visual embeddings use a real SigLIP2 backend when `ENABLE_VISUAL_EMBEDDINGS=true`.
  The worker emits versioned, L2-normalized 768-dimensional image vectors for
  Supabase pgvector candidate recall. If the model backend cannot load, it
  returns explicit `UNAVAILABLE` rather than fabricated vectors.
- Candidate-verification paths return explicit `UNAVAILABLE` or `DISABLED`
  placeholders until a verifier backend is enabled.
- PaddleOCR is implemented as an optional field-level OCR verifier endpoint and is not enabled by default.
  It reads local hard-text crops such as serial, collector number, checklist code, slab label, TCG code, product text, and player name.
  It returns EvidencePatch-style text evidence only; it does not generate titles or override resolved identity fields.
- Unlimited-OCR is documented as an experimental future adapter and is not included in this image.

## Endpoints

- `GET /healthz`
- `GET /readyz`
- `POST /v1/analyze-card-images`
- `POST /v1/ocr-field`

## Required Environment

- `RECOGNITION_WORKER_TOKEN`
- `RECOGNITION_ALLOWED_IMAGE_HOSTS`

Optional:

- `OCR_BACKEND=paddle|deepseek|google_vision|hybrid` (production defaults to the measured Google Vision winner)
- `VISION_API_KEY=` (production deploy stores this in Secret Manager; it is never written as a literal Cloud Run variable)
- `VISION_API_KEY_SECRET_NAME=lynca-google-vision-api-key`
- `VISION_FEATURE_TYPE=DOCUMENT_TEXT_DETECTION`
- `VISION_TIMEOUT_SECONDS=30`
- `ENABLE_PADDLEOCR=false`
- `PADDLEOCR_PRELOAD=false`
- `PADDLEOCR_WORKER_PROCESSES=1`
- `PADDLE_PDX_CACHE_HOME=` (optional model cache directory; use a mounted volume in production)
- `ENABLE_TESSERACT_OCR=false`
- `TESSERACT_LANGUAGE=eng`
- `TESSERACT_PSM=11`
- `TESSERACT_TIMEOUT_SECONDS=20`
- `TESSERACT_IMAGE_CONCURRENCY=2` (hard-capped at 2; one image remains serial)
- `ENABLE_IMAGE_DOWNLOAD=false`
- `ENABLE_OPENCV_RECTIFICATION=false`
- `ENABLE_VISUAL_EMBEDDINGS=false`
- `VISUAL_EMBEDDING_PRELOAD=false` (set `true` on the dedicated vector service)
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

The R2 tests use synthetic images and do not call external services, eBay, legacy vision provider, Brave, or paid APIs.

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
Do not colocate production OCR and embedding traffic: use
`scripts/deploy-vector-worker-cloud-run.sh` for a preloaded, single-process
SigLIP service and point `VECTOR_WORKER_URL` at its URL. The readiness API only
marks request-level vector assist ready when the pinned model preload succeeds.
For PaddleOCR throughput, prefer multiple single-process worker instances or
container replicas and configure the Node app with `PADDLE_OCR_WORKER_URLS`.
That keeps Paddle predictors isolated while still letting the orchestrator
round-robin field verification requests.

Production OCR deploys use `scripts/deploy-recognition-worker-cloud-run.sh`.
The deploy contract fails closed when Google Vision is selected without a
configured Secret Manager key. Existing keys are reused by secret name, so a
new rollout cannot silently fall back to Paddle or erase the Vision setting.
The script builds an immutable image through `cloudbuild-ocr.yaml` before it
touches Cloud Run traffic. PP-OCRv5 mobile weights are baked into the image,
the prior image is used as a Docker layer cache, and the explicit build budget
is 45 minutes (`RECOGNITION_WORKER_BUILD_TIMEOUT` can override it). If the
build or model download fails, the currently serving revision remains intact.
