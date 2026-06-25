#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/services/recognition-worker"

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required.}"
: "${RECOGNITION_WORKER_TOKEN:?RECOGNITION_WORKER_TOKEN is required. Generate it locally; do not commit it.}"

GCP_REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${RECOGNITION_WORKER_SERVICE_NAME:-lynca-recognition-worker}"
MEMORY="${RECOGNITION_WORKER_MEMORY:-4Gi}"
CPU="${RECOGNITION_WORKER_CPU:-2}"
TIMEOUT="${RECOGNITION_WORKER_TIMEOUT_SECONDS:-120}"
MIN_INSTANCES="${RECOGNITION_WORKER_MIN_INSTANCES:-0}"
MAX_INSTANCES="${RECOGNITION_WORKER_MAX_INSTANCES:-5}"
ALLOWED_HOSTS="${RECOGNITION_ALLOWED_IMAGE_HOSTS:-osrrujmpxxiefppjfgpd.supabase.co}"
TOKEN_SECRET_NAME="${RECOGNITION_WORKER_TOKEN_SECRET_NAME:-lynca-recognition-worker-token}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required. Install and authenticate with: gcloud auth login" >&2
  exit 1
fi

if [ ! -f "$SERVICE_DIR/Dockerfile" ]; then
  echo "Recognition worker Dockerfile not found at $SERVICE_DIR/Dockerfile" >&2
  exit 1
fi

gcloud config set project "$GCP_PROJECT_ID" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com --project "$GCP_PROJECT_ID" >/dev/null

if gcloud secrets describe "$TOKEN_SECRET_NAME" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  printf "%s" "$RECOGNITION_WORKER_TOKEN" \
    | gcloud secrets versions add "$TOKEN_SECRET_NAME" --data-file=- --project "$GCP_PROJECT_ID" >/dev/null
else
  printf "%s" "$RECOGNITION_WORKER_TOKEN" \
    | gcloud secrets create "$TOKEN_SECRET_NAME" --data-file=- --replication-policy=automatic --project "$GCP_PROJECT_ID" >/dev/null
fi

PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding "$TOKEN_SECRET_NAME" \
  --member "serviceAccount:${COMPUTE_SA}" \
  --role roles/secretmanager.secretAccessor \
  --project "$GCP_PROJECT_ID" >/dev/null

gcloud run deploy "$SERVICE_NAME" \
  --source "$SERVICE_DIR" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --allow-unauthenticated \
  --memory "$MEMORY" \
  --cpu "$CPU" \
  --timeout "$TIMEOUT" \
  --min-instances "$MIN_INSTANCES" \
  --max-instances "$MAX_INSTANCES" \
  --set-secrets "RECOGNITION_WORKER_TOKEN=${TOKEN_SECRET_NAME}:latest" \
  --set-env-vars "RECOGNITION_ALLOWED_IMAGE_HOSTS=${ALLOWED_HOSTS},ENABLE_IMAGE_DOWNLOAD=true,ENABLE_TESSERACT_OCR=false,ENABLE_OPENCV_RECTIFICATION=true,ENABLE_VISUAL_EMBEDDINGS=true,VISUAL_EMBEDDING_MODEL_ID=google/siglip2-base-patch16-384,VISUAL_EMBEDDING_MODEL_REVISION=main,VISUAL_EMBEDDING_PREPROCESSING_VERSION=card-rectification-v1,VISUAL_EMBEDDING_DIMENSIONS=768,VISUAL_EMBEDDING_DEVICE=cpu,ENABLE_CANDIDATE_VERIFICATION=false,RECOGNITION_REQUEST_TIMEOUT_SECONDS=${TIMEOUT}" \
  --format='value(status.url)'
