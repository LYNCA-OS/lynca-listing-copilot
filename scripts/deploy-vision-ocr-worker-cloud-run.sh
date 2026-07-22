#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/services/recognition-worker"

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required.}"

GCP_REGION="${VISION_OCR_REGION:-us-central1}"
SERVICE_NAME="${VISION_OCR_SERVICE_NAME:-lynca-vision-ocr-worker}"
SERVICE_ACCOUNT_NAME="${VISION_OCR_SERVICE_ACCOUNT_NAME:-lynca-vision-ocr-worker}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
ARTIFACT_REPOSITORY="${VISION_OCR_ARTIFACT_REPOSITORY:-cloud-run-source-deploy}"
TOKEN_SECRET_NAME="${RECOGNITION_WORKER_TOKEN_SECRET_NAME:-lynca-recognition-worker-token}"
IMAGE_TAG="${VISION_OCR_IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)}"
IMAGE_URI="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REPOSITORY}/${SERVICE_NAME}:${IMAGE_TAG}"
CACHE_IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REPOSITORY}/${SERVICE_NAME}:build-cache"

test "$(git -C "$ROOT_DIR" status --porcelain)" = ""
test "$(git -C "$ROOT_DIR" rev-parse HEAD)" = "$(git -C "$ROOT_DIR" rev-parse origin/main)"
gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project "$GCP_PROJECT_ID" >/dev/null
gcloud secrets describe "$TOKEN_SECRET_NAME" --project "$GCP_PROJECT_ID" >/dev/null

gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
docker pull "$CACHE_IMAGE" || true
docker build \
  --cache-from "$CACHE_IMAGE" \
  --tag "$IMAGE_URI" \
  --tag "$CACHE_IMAGE" \
  --file "$SERVICE_DIR/Dockerfile.vision" \
  "$SERVICE_DIR"
docker push "$IMAGE_URI"
docker push "$CACHE_IMAGE"

gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE_URI" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --service-account "$SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --execution-environment gen2 \
  --cpu-boost \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 4 \
  --timeout 90 \
  --min 2 \
  --max 10 \
  --set-secrets "RECOGNITION_WORKER_TOKEN=${TOKEN_SECRET_NAME}:latest" \
  --set-env-vars "RECOGNITION_ALLOWED_IMAGE_HOSTS=osrrujmpxxiefppjfgpd.supabase.co,RECOGNITION_MAX_IMAGE_BYTES=26214400,RECOGNITION_MAX_TOTAL_PIXELS=50000000,ENABLE_IMAGE_DOWNLOAD=true,OCR_BACKEND=google_vision,VISION_USE_ADC=true,VISION_FEATURE_TYPE=DOCUMENT_TEXT_DETECTION,VISION_TIMEOUT_SECONDS=30,RECOGNITION_REQUEST_TIMEOUT_SECONDS=30,WORKER_PROCESSES=1" \
  --format='value(status.url)' | tee /tmp/vision-ocr-service-url.txt
