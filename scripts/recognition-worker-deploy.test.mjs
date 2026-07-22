import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const deploy = await readFile("scripts/deploy-recognition-worker-cloud-run.sh", "utf8");
const build = await readFile("services/recognition-worker/cloudbuild-ocr.yaml", "utf8");
const dockerfile = await readFile("services/recognition-worker/Dockerfile", "utf8");
const visionDeploy = await readFile("scripts/deploy-vision-ocr-worker-cloud-run.sh", "utf8");
const visionBootstrap = await readFile("scripts/bootstrap-vision-ocr-gcp.sh", "utf8");
const visionDockerfile = await readFile("services/recognition-worker/Dockerfile.vision", "utf8");
const visionRequirements = await readFile("services/recognition-worker/requirements-vision.txt", "utf8");

assert.doesNotMatch(deploy, /gcloud run deploy[\s\S]{0,200}--source/, "OCR deploys must not hide model builds inside Cloud Run source deploys");
assert.match(deploy, /gcloud builds submit/);
assert.match(deploy, /--timeout "\$BUILD_TIMEOUT"/);
assert.match(deploy, /--image "\$IMAGE_URI"/);
assert.match(deploy, /ENABLE_TESSERACT_OCR=\$\{ENABLE_TESSERACT_OCR\}/);
assert.match(deploy, /TESSERACT_IMAGE_CONCURRENCY=\$\{TESSERACT_IMAGE_CONCURRENCY\}/);
assert.match(deploy, /VISION_SECRET_NAME="\$\{VISION_API_KEY_SECRET_NAME:-lynca-google-vision-api-key\}"/);
assert.match(deploy, /OCR_BACKEND="\$\{OCR_BACKEND:-google_vision\}"/);
assert.match(deploy, /VISION_API_KEY=\$\{VISION_SECRET_NAME\}:latest/);
assert.match(deploy, /OCR_BACKEND=\$\{OCR_BACKEND\}/);
assert.match(build, /timeout: 2700s/);
assert.match(build, /--cache-from/);
assert.match(build, /_CACHE_IMAGE/);
assert.match(dockerfile, /PADDLE_PDX_CACHE_HOME=\/opt\/paddlex/);
assert.match(dockerfile, /preload_paddleocr_engine/);
assert.match(dockerfile, /_get_paddleocr_engine\(\)\.predict/);

assert.match(visionDeploy, /git -C "\$ROOT_DIR" rev-parse HEAD/);
assert.match(visionDeploy, /git -C "\$ROOT_DIR" rev-parse origin\/main/);
assert.match(visionDeploy, /--service-account "\$SERVICE_ACCOUNT"/);
assert.match(visionDeploy, /VISION_USE_ADC=true/);
assert.doesNotMatch(visionDeploy, /VISION_API_KEY/);
assert.doesNotMatch(visionDeploy, /services enable|add-iam-policy-binding|service-accounts create/, "release deploys must not mutate bootstrap IAM");
assert.match(visionBootstrap, /workload-identity-pools providers create-oidc/);
assert.match(visionBootstrap, /assertion\.repository/);
assert.match(visionBootstrap, /roles\/iam\.workloadIdentityUser/);
assert.match(visionDeploy, /gcloud auth configure-docker/);
assert.match(visionDeploy, /docker build/);
assert.match(visionDeploy, /docker push "\$IMAGE_URI"/);
assert.doesNotMatch(visionDeploy, /gcloud builds submit|cloudbuild-vision/);
assert.match(visionDockerfile, /app\.vision_main:app/);
assert.match(visionDockerfile, /requirements-vision\.txt/);
assert.doesNotMatch(visionDockerfile, /paddle|tesseract|opencv/i);
assert.match(visionRequirements, /google-cloud-vision==3\.15\.0/);
assert.doesNotMatch(visionRequirements, /paddle|tesseract|opencv/i);

console.log("recognition worker deploy tests passed");
