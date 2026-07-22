import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const deploy = await readFile("scripts/deploy-recognition-worker-cloud-run.sh", "utf8");
const build = await readFile("services/recognition-worker/cloudbuild-ocr.yaml", "utf8");
const dockerfile = await readFile("services/recognition-worker/Dockerfile", "utf8");

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

console.log("recognition worker deploy tests passed");
