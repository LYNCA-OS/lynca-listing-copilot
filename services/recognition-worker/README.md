# LYNCA Recognition Worker

This service is the container boundary for computer-vision and OCR work. The Vercel/Node app must not import PaddleOCR, OpenCV, PyTorch, SigLIP, DINO, or LightGlue directly.

## Current Status

- FastAPI contract skeleton is implemented.
- Internal bearer-token auth is required.
- URL security only allows configured image hosts and HTTPS.
- R2 offline image geometry, glare, quality, and region-proposal functions are implemented as CPU-safe NumPy baselines.
- The HTTP endpoint can download signed image bytes when `ENABLE_IMAGE_DOWNLOAD=true`; otherwise geometry and quality return explicit `UNAVAILABLE`.
- OCR model execution still returns explicit `UNAVAILABLE` until a backend is enabled, but OCR text fusion now parses real OCR line items into field candidates, resolved fields, conflicts, and trace metadata.
- Embedding and candidate-verification paths return explicit `UNAVAILABLE` or `DISABLED` placeholders rather than fabricated facts.
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
- `ENABLE_IMAGE_DOWNLOAD=false`
- `ENABLE_OPENCV_RECTIFICATION=false`
- `ENABLE_VISUAL_EMBEDDINGS=false`
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
  lynca-recognition-worker
```
