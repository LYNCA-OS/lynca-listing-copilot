#!/usr/bin/env bash
set -euo pipefail

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required.}"

GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-LYNCA-OS/lynca-listing-copilot}"
GCP_REGION="${VISION_OCR_REGION:-us-central1}"
ARTIFACT_REPOSITORY="${VISION_OCR_ARTIFACT_REPOSITORY:-cloud-run-source-deploy}"
RUNTIME_ACCOUNT_NAME="${VISION_OCR_SERVICE_ACCOUNT_NAME:-lynca-vision-ocr-worker}"
DEPLOY_ACCOUNT_NAME="${VISION_OCR_DEPLOY_SERVICE_ACCOUNT_NAME:-lynca-vision-ocr-deploy}"
TOKEN_SECRET_NAME="${RECOGNITION_WORKER_TOKEN_SECRET_NAME:-lynca-recognition-worker-token}"
POOL_ID="${GITHUB_WIF_POOL_ID:-github-actions}"
PROVIDER_ID="${GITHUB_WIF_PROVIDER_ID:-lynca-listing-copilot}"
RUNTIME_ACCOUNT="${RUNTIME_ACCOUNT_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_ACCOUNT="${DEPLOY_ACCOUNT_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"

retry_command() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if "$@"; then
      return 0
    fi
    if test "$attempt" -lt 6; then
      sleep 5
    fi
  done
  return 1
}

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  sts.googleapis.com \
  vision.googleapis.com \
  --project "$GCP_PROJECT_ID" >/dev/null

if ! gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" --location "$GCP_REGION" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" \
    --repository-format docker \
    --location "$GCP_REGION" \
    --project "$GCP_PROJECT_ID" >/dev/null
fi

for account_name in "$RUNTIME_ACCOUNT_NAME" "$DEPLOY_ACCOUNT_NAME"; do
  account="${account_name}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
  if ! gcloud iam service-accounts describe "$account" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$account_name" --project "$GCP_PROJECT_ID" >/dev/null
  fi
done

retry_command gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member "serviceAccount:${RUNTIME_ACCOUNT}" \
  --role roles/serviceusage.serviceUsageConsumer \
  --condition=None >/dev/null
retry_command gcloud secrets add-iam-policy-binding "$TOKEN_SECRET_NAME" \
  --member "serviceAccount:${RUNTIME_ACCOUNT}" \
  --role roles/secretmanager.secretAccessor \
  --project "$GCP_PROJECT_ID" >/dev/null
retry_command gcloud secrets add-iam-policy-binding "$TOKEN_SECRET_NAME" \
  --member "serviceAccount:${DEPLOY_ACCOUNT}" \
  --role roles/secretmanager.viewer \
  --project "$GCP_PROJECT_ID" >/dev/null

for role in roles/run.admin roles/cloudbuild.builds.editor roles/serviceusage.serviceUsageConsumer; do
  retry_command gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member "serviceAccount:${DEPLOY_ACCOUNT}" \
    --role "$role" \
    --condition=None >/dev/null
done
if ! gcloud storage buckets describe "gs://${GCP_PROJECT_ID}_cloudbuild" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${GCP_PROJECT_ID}_cloudbuild" \
    --location US \
    --project "$GCP_PROJECT_ID" >/dev/null
fi
retry_command gcloud storage buckets add-iam-policy-binding "gs://${GCP_PROJECT_ID}_cloudbuild" \
  --member "serviceAccount:${DEPLOY_ACCOUNT}" \
  --role roles/storage.objectAdmin >/dev/null
retry_command gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_ACCOUNT" \
  --member "serviceAccount:${DEPLOY_ACCOUNT}" \
  --role roles/iam.serviceAccountUser \
  --project "$GCP_PROJECT_ID" >/dev/null

if ! gcloud iam workload-identity-pools describe "$POOL_ID" --location global --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --location global \
    --project "$GCP_PROJECT_ID" \
    --display-name "GitHub Actions" >/dev/null
fi
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" --workload-identity-pool "$POOL_ID" --location global --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --workload-identity-pool "$POOL_ID" \
    --location global \
    --project "$GCP_PROJECT_ID" \
    --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping 'google.subject=assertion.sub,attribute.repository=assertion.repository' \
    --attribute-condition "assertion.repository=='${GITHUB_REPOSITORY}'" >/dev/null
fi

retry_command gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_ACCOUNT" \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPOSITORY}" \
  --role roles/iam.workloadIdentityUser \
  --project "$GCP_PROJECT_ID" >/dev/null

printf '%s\n' "GCP_PROJECT_ID=${GCP_PROJECT_ID}"
printf '%s\n' "GCP_DEPLOY_SERVICE_ACCOUNT=${DEPLOY_ACCOUNT}"
printf '%s\n' "GCP_WORKLOAD_IDENTITY_PROVIDER=projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"
