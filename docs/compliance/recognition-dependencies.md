# Recognition Dependency Compliance

Status: dependency policy for the Recognition Worker container. The Vercel/Node app must not import heavy CV/OCR/GPU libraries directly.

## Production Boundary

The worker image may contain computer-vision dependencies. The Node app talks to the worker over a versioned HTTP contract and validates every request and response.

No OCR, embedding, or model dependency may become a default production path until:

- license is reviewed
- version is pinned
- model weights are excluded from git
- local and container smoke tests pass
- ablation shows field-level gain
- latency and memory fit the deployment target
- security review covers remote code, model downloads, and image URL handling

## Current Pinned Dependencies

| Dependency | Version | Role | Default Enabled | Compliance Status |
| --- | --- | --- | --- | --- |
| FastAPI | `0.115.6` | Worker HTTP API | Yes | Acceptable for service shell |
| Uvicorn | `0.34.0` | Worker ASGI server | Yes | Acceptable for service shell |
| Pydantic | `2.10.4` | Worker validation support | Yes | Acceptable for service shell |
| NumPy | `2.2.1` | CV array operations | Yes | Acceptable for worker |
| OpenCV headless | `4.10.0.84` | Rectification, crop, image quality | Not active in placeholder pipeline | Worker only |
| Pillow | `11.1.0` | Image loading and preprocessing | Not active in placeholder pipeline | Worker only |
| Pytest | `8.3.4` | Worker test runner | No production path | Test dependency only |
| PaddleOCR | `3.0.3` | Optional OCR adapter | No | Evaluation only until ablation and license review |

R2 note: the worker includes a CPU-safe NumPy geometry/quality baseline for local deterministic tests. The OpenCV contour/homography adapter is implemented as a lazy optional path and remains disabled by default through `ENABLE_OPENCV_RECTIFICATION=false` until container smoke tests prove import, latency, and output quality.

## Unlimited-OCR

Decision: experimental future adapter only, not included in the default worker image and not enabled in production.

Known current facts from upstream pages reviewed on 2026-06-23:

- GitHub repository: https://github.com/baidu/Unlimited-OCR
- Hugging Face model: https://huggingface.co/baidu/Unlimited-OCR
- license shown by GitHub and Hugging Face: MIT
- Hugging Face tags include custom code and Safetensors
- Hugging Face model size is shown as 3B params with BF16 tensors
- upstream examples use `trust_remote_code=True`
- GitHub shows no published releases at review time
- upstream README positions the model for one-shot long-horizon parsing and document/PDF style workflows

Use conditions if evaluated later:

- run only inside the Recognition Worker or a separate GPU worker
- pin exact git commit or Hugging Face revision
- disable network model downloads at runtime
- mirror approved weights into controlled storage
- never use `trust_remote_code=True` against a floating revision
- keep output as `OCR_ONLY` or low-weight evidence
- never override slab, printed card text, official checklist, registry, or identity resolver constraints
- require ablation on owner-reviewed card images before any production path

## Model And Weight Storage

Do not commit model weights under this repository.

Local cache directories:

- `services/recognition-worker/models/`
- external Docker layer cache
- controlled artifact storage for production

Allowed committed files in model dirs:

- README
- manifest template
- checksum manifest
- license notices

Disallowed committed files:

- `.safetensors`
- `.bin`
- `.pt`
- `.onnx`
- `.pdmodel`
- `.pdiparams`
- downloaded PaddleOCR or Unlimited-OCR weights

## Security Requirements

Worker requests must:

- require bearer token auth
- accept only HTTPS signed URLs
- allow only configured image hosts
- redact signed URL query strings from logs and errors
- reject embedded URL credentials
- avoid following arbitrary redirects
- enforce image byte and pixel caps before heavy processing

## Attribution And Notices

Before shipping any OCR adapter, add license notice entries for the dependency and any model weights. The dependency list here is not a substitute for final legal review.

## Sources

- PaddleOCR repository: https://github.com/PaddlePaddle/PaddleOCR
- Unlimited-OCR repository: https://github.com/baidu/Unlimited-OCR
- Unlimited-OCR model card: https://huggingface.co/baidu/Unlimited-OCR
