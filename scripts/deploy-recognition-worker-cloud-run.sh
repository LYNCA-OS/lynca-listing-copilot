#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/services/recognition-worker"

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required.}"

GCP_REGION="${RECOGNITION_WORKER_REGION:-${GCP_REGION:-us-central1}}"
BUILD_REGION="${RECOGNITION_WORKER_BUILD_REGION:-global}"
SERVICE_NAME="${RECOGNITION_WORKER_SERVICE_NAME:-lynca-recognition-worker}"
MEMORY="${RECOGNITION_WORKER_MEMORY:-4Gi}"
CPU="${RECOGNITION_WORKER_CPU:-2}"
CONCURRENCY="${RECOGNITION_WORKER_CONCURRENCY:-1}"
TIMEOUT="${RECOGNITION_WORKER_TIMEOUT_SECONDS:-300}"
MIN_INSTANCES="${RECOGNITION_WORKER_MIN_INSTANCES:-8}"
MAX_INSTANCES="${RECOGNITION_WORKER_MAX_INSTANCES:-10}"
ROLLOUT_MIN_INSTANCES="${RECOGNITION_WORKER_ROLLOUT_MIN_INSTANCES:-5}"
STARTUP_PROBE_TIMEOUT_SECONDS="${RECOGNITION_WORKER_STARTUP_PROBE_TIMEOUT_SECONDS:-240}"
STARTUP_PROBE_PERIOD_SECONDS="${RECOGNITION_WORKER_STARTUP_PROBE_PERIOD_SECONDS:-240}"
STARTUP_PROBE_FAILURE_THRESHOLD="${RECOGNITION_WORKER_STARTUP_PROBE_FAILURE_THRESHOLD:-2}"
# Paddle predictors are serialized inside each process. Cloud Run concurrency
# therefore stays at one while replicas provide parallelism. Deploy with five
# warm replicas first so the old and new revisions fit the 20-vCPU regional
# quota during a zero-downtime rollout. Once traffic has moved and the old
# revision releases capacity, raise the service-level floor to eight. The
# revision-level minimum is removed so it cannot deadlock a rollout; the
# revision-level maximum remains aligned with the service cap because Cloud Run
# may otherwise restore a lower platform default.
# Model preload can
# occasionally cross one 240-second probe window, so require two failed probes
# before rejecting a healthy-but-slow revision. Set both service-level and
# revision-level scaling: a stale service cap silently overrides a larger cap.
ALLOWED_HOSTS="${RECOGNITION_ALLOWED_IMAGE_HOSTS:-osrrujmpxxiefppjfgpd.supabase.co}"
TOKEN_SECRET_NAME="${RECOGNITION_WORKER_TOKEN_SECRET_NAME:-lynca-recognition-worker-token}"
ENABLE_PADDLEOCR="${ENABLE_PADDLEOCR:-true}"
ENABLE_TESSERACT_OCR="${ENABLE_TESSERACT_OCR:-true}"
TESSERACT_IMAGE_CONCURRENCY="${TESSERACT_IMAGE_CONCURRENCY:-2}"
PADDLEOCR_PRELOAD="${PADDLEOCR_PRELOAD:-true}"
PADDLEOCR_WORKER_PROCESSES="${PADDLEOCR_WORKER_PROCESSES:-1}"
PADDLEOCR_MODEL_ID="${PADDLEOCR_MODEL_ID:-paddleocr}"
PADDLEOCR_MODEL_REVISION="${PADDLEOCR_MODEL_REVISION:-ppocr-v5}"
BUILD_TIMEOUT="${RECOGNITION_WORKER_BUILD_TIMEOUT:-2700s}"
IMAGE_TAG="${RECOGNITION_WORKER_IMAGE_TAG:-$(date -u +%Y%m%d%H%M%S)}"
ARTIFACT_REPOSITORY="${RECOGNITION_WORKER_ARTIFACT_REPOSITORY:-cloud-run-source-deploy}"
IMAGE_URI="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REPOSITORY}/${SERVICE_NAME}:${IMAGE_TAG}"
CACHE_IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REPOSITORY}/${SERVICE_NAME}:build-cache"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required. Install and authenticate with: gcloud auth login" >&2
  exit 1
fi

if [ ! -f "$SERVICE_DIR/Dockerfile" ]; then
  echo "Recognition worker Dockerfile not found at $SERVICE_DIR/Dockerfile" >&2
  exit 1
fi

if [ "$ROLLOUT_MIN_INSTANCES" -gt "$MIN_INSTANCES" ]; then
  echo "RECOGNITION_WORKER_ROLLOUT_MIN_INSTANCES cannot exceed RECOGNITION_WORKER_MIN_INSTANCES." >&2
  exit 1
fi

gcloud config set project "$GCP_PROJECT_ID" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project "$GCP_PROJECT_ID" >/dev/null

if ! gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" \
  --project "$GCP_PROJECT_ID" \
  --location "$GCP_REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" \
    --project "$GCP_PROJECT_ID" \
    --location "$GCP_REGION" \
    --repository-format docker \
    --description "LYNCA worker images" >/dev/null
fi

if [ -n "${RECOGNITION_WORKER_TOKEN:-}" ]; then
  if gcloud secrets describe "$TOKEN_SECRET_NAME" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    printf "%s" "$RECOGNITION_WORKER_TOKEN" \
      | gcloud secrets versions add "$TOKEN_SECRET_NAME" --data-file=- --project "$GCP_PROJECT_ID" >/dev/null
  else
    printf "%s" "$RECOGNITION_WORKER_TOKEN" \
      | gcloud secrets create "$TOKEN_SECRET_NAME" --data-file=- --replication-policy=automatic --project "$GCP_PROJECT_ID" >/dev/null
  fi
elif gcloud secrets describe "$TOKEN_SECRET_NAME" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  echo "Reusing existing Secret Manager secret: ${TOKEN_SECRET_NAME}" >&2
else
  echo "RECOGNITION_WORKER_TOKEN is required because Secret Manager secret ${TOKEN_SECRET_NAME} does not exist." >&2
  exit 1
fi

PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding "$TOKEN_SECRET_NAME" \
  --member "serviceAccount:${COMPUTE_SA}" \
  --role roles/secretmanager.secretAccessor \
  --project "$GCP_PROJECT_ID" >/dev/null

# Cloud Build capacity is independent from the Cloud Run serving region. Use
# the global pool by default because regional E2 quotas can reject an otherwise
# healthy rollout before a build even starts. Operators can still pin a build
# region explicitly when a dedicated regional pool is available.
if [ "$BUILD_REGION" = "global" ]; then
  gcloud builds submit "$SERVICE_DIR" \
    --project "$GCP_PROJECT_ID" \
    --config "$SERVICE_DIR/cloudbuild-ocr.yaml" \
    --timeout "$BUILD_TIMEOUT" \
    --substitutions "_IMAGE_URI=${IMAGE_URI},_CACHE_IMAGE=${CACHE_IMAGE}"
else
  gcloud builds submit "$SERVICE_DIR" \
    --project "$GCP_PROJECT_ID" \
    --region "$BUILD_REGION" \
    --config "$SERVICE_DIR/cloudbuild-ocr.yaml" \
    --timeout "$BUILD_TIMEOUT" \
    --substitutions "_IMAGE_URI=${IMAGE_URI},_CACHE_IMAGE=${CACHE_IMAGE}"
fi

# Deployment only starts after a complete image exists. A build/download
# failure therefore leaves the serving revision and its traffic untouched.
DEPLOYED_URL="$(gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE_URI" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --allow-unauthenticated \
  --execution-environment gen2 \
  --cpu-boost \
  --memory "$MEMORY" \
  --cpu "$CPU" \
  --concurrency "$CONCURRENCY" \
  --timeout "$TIMEOUT" \
  --startup-probe "tcpSocket.port=8080,initialDelaySeconds=0,timeoutSeconds=${STARTUP_PROBE_TIMEOUT_SECONDS},periodSeconds=${STARTUP_PROBE_PERIOD_SECONDS},failureThreshold=${STARTUP_PROBE_FAILURE_THRESHOLD}" \
  --min "$ROLLOUT_MIN_INSTANCES" \
  --max "$MAX_INSTANCES" \
  --min-instances default \
  --max-instances "$MAX_INSTANCES" \
  --set-secrets "RECOGNITION_WORKER_TOKEN=${TOKEN_SECRET_NAME}:latest" \
  --set-env-vars "RECOGNITION_ALLOWED_IMAGE_HOSTS=${ALLOWED_HOSTS},RECOGNITION_MAX_IMAGE_BYTES=26214400,RECOGNITION_MAX_TOTAL_PIXELS=50000000,ENABLE_IMAGE_DOWNLOAD=true,ENABLE_TESSERACT_OCR=${ENABLE_TESSERACT_OCR},TESSERACT_IMAGE_CONCURRENCY=${TESSERACT_IMAGE_CONCURRENCY},ENABLE_OPENCV_RECTIFICATION=true,ENABLE_VISUAL_EMBEDDINGS=false,VISUAL_EMBEDDING_PRELOAD=false,VISUAL_EMBEDDING_MODEL_ID=google/siglip2-base-patch16-384,VISUAL_EMBEDDING_MODEL_REVISION=f775b65a79762255128c981547af89addcfe0f88,VISUAL_EMBEDDING_PREPROCESSING_VERSION=card-rectification-v1,VISUAL_EMBEDDING_DIMENSIONS=768,ENABLE_CANDIDATE_VERIFICATION=false,ENABLE_PADDLEOCR=${ENABLE_PADDLEOCR},PADDLEOCR_PRELOAD=${PADDLEOCR_PRELOAD},PADDLEOCR_WORKER_PROCESSES=${PADDLEOCR_WORKER_PROCESSES},WORKER_PROCESSES=${PADDLEOCR_WORKER_PROCESSES},PADDLEOCR_MODEL_ID=${PADDLEOCR_MODEL_ID},PADDLEOCR_MODEL_REVISION=${PADDLEOCR_MODEL_REVISION},RECOGNITION_REQUEST_TIMEOUT_SECONDS=${TIMEOUT}" \
  --format='value(status.url)')"

gcloud run services update "$SERVICE_NAME" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --min "$MIN_INSTANCES" \
  --max "$MAX_INSTANCES" \
  --format='none'

printf '%s\n' "$DEPLOYED_URL"
