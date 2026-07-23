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
SHARED_RECOGNITION_SERVICE_NAME="${RECOGNITION_WORKER_SERVICE_NAME:-lynca-recognition-worker}"
SHARED_RECOGNITION_CPU="${RECOGNITION_WORKER_CPU:-2}"
SHARED_RECOGNITION_MAX="${RECOGNITION_WORKER_SHARED_REGION_MAX_INSTANCES:-8}"
VISION_CPU="${VISION_OCR_CPU:-1}"
VISION_MIN="${VISION_OCR_MIN_INSTANCES:-0}"
VISION_MAX="${VISION_OCR_MAX_INSTANCES:-3}"
REGIONAL_CPU_QUOTA="${CLOUD_RUN_REGIONAL_CPU_QUOTA:-20}"
ROLLOUT_CPU_RESERVE="${CLOUD_RUN_ROLLOUT_CPU_RESERVE:-1}"
DEPLOY_ATTEMPTS="${VISION_OCR_DEPLOY_ATTEMPTS:-3}"
DEPLOY_RETRY_SECONDS="${VISION_OCR_DEPLOY_RETRY_SECONDS:-15}"
IMAGE_TAG="${VISION_OCR_IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)}"
IMAGE_URI="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REPOSITORY}/${SERVICE_NAME}:${IMAGE_TAG}"
CACHE_IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REPOSITORY}/${SERVICE_NAME}:build-cache"

test "$(git -C "$ROOT_DIR" status --porcelain)" = ""
test "$(git -C "$ROOT_DIR" rev-parse HEAD)" = "$(git -C "$ROOT_DIR" rev-parse origin/main)"
gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project "$GCP_PROJECT_ID" >/dev/null
gcloud secrets describe "$TOKEN_SECRET_NAME" --project "$GCP_PROJECT_ID" >/dev/null

# The recognition and lean Vision services share us-central1's 20-vCPU quota.
# Provider concurrency is two, so allowing ten 2-vCPU recognition replicas adds
# no provider throughput and can consume every regional CPU during an audit.
# Keep one CPU outside the combined service envelopes so a replacement Vision
# revision can always start without deleting the rollback revision.
REQUIRED_CPU="$((SHARED_RECOGNITION_CPU * SHARED_RECOGNITION_MAX + VISION_CPU * VISION_MAX + ROLLOUT_CPU_RESERVE))"
if [ "$REQUIRED_CPU" -gt "$REGIONAL_CPU_QUOTA" ]; then
  echo "Cloud Run capacity contract exceeds the regional CPU quota: required=${REQUIRED_CPU}, quota=${REGIONAL_CPU_QUOTA}." >&2
  exit 1
fi

if gcloud run services describe "$SHARED_RECOGNITION_SERVICE_NAME" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" >/dev/null 2>&1; then
  # --max is service-level and does not create a revision. It immediately
  # prevents sustained load from consuming the rollout reserve.
  gcloud run services update "$SHARED_RECOGNITION_SERVICE_NAME" \
    --project "$GCP_PROJECT_ID" \
    --region "$GCP_REGION" \
    --max "$SHARED_RECOGNITION_MAX" \
    --format='none'
fi

if gcloud run services describe "$SERVICE_NAME" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" >/dev/null 2>&1; then
  gcloud run services update "$SERVICE_NAME" \
    --project "$GCP_PROJECT_ID" \
    --region "$GCP_REGION" \
    --min "$VISION_MIN" \
    --max "$VISION_MAX" \
    --format='none'
fi

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

deploy_vision_revision() {
  gcloud run deploy "$SERVICE_NAME" \
    --image "$IMAGE_URI" \
    --project "$GCP_PROJECT_ID" \
    --region "$GCP_REGION" \
    --service-account "$SERVICE_ACCOUNT" \
    --allow-unauthenticated \
    --execution-environment gen2 \
    --cpu-boost \
    --memory 1Gi \
    --cpu "$VISION_CPU" \
    --concurrency 4 \
    --timeout 90 \
    --min "$VISION_MIN" \
    --max "$VISION_MAX" \
    --min-instances default \
    --max-instances "$VISION_MAX" \
    --set-secrets "RECOGNITION_WORKER_TOKEN=${TOKEN_SECRET_NAME}:latest" \
    --set-env-vars "RECOGNITION_ALLOWED_IMAGE_HOSTS=osrrujmpxxiefppjfgpd.supabase.co,RECOGNITION_MAX_IMAGE_BYTES=26214400,RECOGNITION_MAX_TOTAL_PIXELS=50000000,ENABLE_IMAGE_DOWNLOAD=true,OCR_BACKEND=google_vision,VISION_USE_ADC=true,VISION_FEATURE_TYPE=DOCUMENT_TEXT_DETECTION,VISION_TIMEOUT_SECONDS=30,RECOGNITION_REQUEST_TIMEOUT_SECONDS=30,WORKER_PROCESSES=1" \
    --format='value(status.url)'
}

rm -f /tmp/vision-ocr-service-url.txt
for attempt in $(seq 1 "$DEPLOY_ATTEMPTS"); do
  if deploy_vision_revision | tee /tmp/vision-ocr-service-url.txt; then
    break
  fi
  rm -f /tmp/vision-ocr-service-url.txt
  if [ "$attempt" -eq "$DEPLOY_ATTEMPTS" ]; then
    echo "Vision OCR deployment exhausted ${DEPLOY_ATTEMPTS} bounded attempts." >&2
    exit 1
  fi
  echo "Vision OCR rollout capacity is still draining; retrying in ${DEPLOY_RETRY_SECONDS}s (${attempt}/${DEPLOY_ATTEMPTS})." >&2
  sleep "$DEPLOY_RETRY_SECONDS"
done

test -s /tmp/vision-ocr-service-url.txt
