#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/services/recognition-worker"

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required.}"

GCP_REGION="${VECTOR_WORKER_REGION:-${GCP_REGION:-us-east1}}"
SERVICE_NAME="${VECTOR_WORKER_SERVICE_NAME:-lynca-vector-worker}"
MEMORY="${VECTOR_WORKER_MEMORY:-8Gi}"
CPU="${VECTOR_WORKER_CPU:-4}"
CONCURRENCY="${VECTOR_WORKER_CONTAINER_CONCURRENCY:-2}"
TIMEOUT="${VECTOR_WORKER_TIMEOUT_SECONDS:-300}"
# Warm instances are billed around the clock whether or not a request arrives,
# and this default was 2 at 4 vCPU / 8 GiB each: roughly 21 million vCPU-seconds
# a month against a 180,000 free tier, or 117x over, for a service measured at
# 92.7% zero candidates against an index of 587 rows last written 2026-07-06.
#
# The service itself has been deleted and vector retrieval is disabled by
# default in lib/listing/retrieval/vector-worker-client.mjs. This default is the
# remaining path back: re-running this script would silently recreate the warm
# instances. So it is 0, and raising it is an explicit, owner-authorised act.
#
# DO NOT RAISE THIS WITHOUT AN EXPLICIT INSTRUCTION FROM THE OWNER.
MIN_INSTANCES="${VECTOR_WORKER_MIN_INSTANCES:-0}"
if [ "${MIN_INSTANCES}" != "0" ] && [ "${VECTOR_WORKER_ALLOW_WARM_INSTANCES:-}" != "I_ACCEPT_ALWAYS_ON_BILLING" ]; then
  echo "refusing to deploy with min-instances=${MIN_INSTANCES}: warm instances bill 24/7." >&2
  echo "set VECTOR_WORKER_ALLOW_WARM_INSTANCES=I_ACCEPT_ALWAYS_ON_BILLING to override." >&2
  exit 1
fi
# Keep vectors in a separate region from PaddleOCR so neither model can starve
# the other of regional Cloud Run CPU. At 4 vCPU and 8 GiB per instance, five
# replicas use the full 20 vCPU / 40 GiB regional budget.
MAX_INSTANCES="${VECTOR_WORKER_MAX_INSTANCES:-5}"
# No default host: this allowlist gates which storage the worker may fetch
# from, and the old literal named a decommissioned project -- a deploy that
# took the default would have silently refused every current image.
ALLOWED_HOSTS="${RECOGNITION_ALLOWED_IMAGE_HOSTS:?set to the storage host for the target project}"
TOKEN_SECRET_NAME="${RECOGNITION_WORKER_TOKEN_SECRET_NAME:-lynca-recognition-worker-token}"
IMAGE_TAG="${VECTOR_WORKER_IMAGE_TAG:-$(date -u +%Y%m%d%H%M%S)}"
IMAGE_URI="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME}:${IMAGE_TAG}"

command -v gcloud >/dev/null 2>&1 || {
  echo "gcloud CLI is required." >&2
  exit 1
}

gcloud config set project "$GCP_PROJECT_ID" >/dev/null

if ! gcloud secrets describe "$TOKEN_SECRET_NAME" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  echo "Secret Manager secret ${TOKEN_SECRET_NAME} does not exist." >&2
  exit 1
fi

PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding "$TOKEN_SECRET_NAME" \
  --member "serviceAccount:${COMPUTE_SA}" \
  --role roles/secretmanager.secretAccessor \
  --project "$GCP_PROJECT_ID" >/dev/null

gcloud builds submit "$SERVICE_DIR" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --config "$SERVICE_DIR/cloudbuild-vector.yaml" \
  --substitutions "_IMAGE_URI=${IMAGE_URI}"

gcloud run deploy "$SERVICE_NAME" \
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
  --min-instances "$MIN_INSTANCES" \
  --max-instances "$MAX_INSTANCES" \
  --set-secrets "RECOGNITION_WORKER_TOKEN=${TOKEN_SECRET_NAME}:latest" \
  --set-env-vars "RECOGNITION_ALLOWED_IMAGE_HOSTS=${ALLOWED_HOSTS},RECOGNITION_MAX_IMAGE_BYTES=26214400,RECOGNITION_MAX_TOTAL_PIXELS=50000000,ENABLE_IMAGE_DOWNLOAD=true,ENABLE_TESSERACT_OCR=false,ENABLE_OPENCV_RECTIFICATION=true,ENABLE_VISUAL_EMBEDDINGS=true,VISUAL_EMBEDDING_PRELOAD=true,VISUAL_EMBEDDING_MODEL_ID=google/siglip2-base-patch16-384,VISUAL_EMBEDDING_MODEL_REVISION=f775b65a79762255128c981547af89addcfe0f88,VISUAL_EMBEDDING_PREPROCESSING_VERSION=card-rectification-v1,VISUAL_EMBEDDING_DIMENSIONS=768,VISUAL_EMBEDDING_DEVICE=cpu,ENABLE_CANDIDATE_VERIFICATION=false,ENABLE_PADDLEOCR=false,PADDLEOCR_PRELOAD=false,WORKER_PROCESSES=1,RECOGNITION_REQUEST_TIMEOUT_SECONDS=${TIMEOUT}" \
  --format='value(status.url)'
