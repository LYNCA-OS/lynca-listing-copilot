# Recognition Worker Model Cache

No model weights are committed here.

Rules:

- Do not commit PaddleOCR, Unlimited-OCR, SigLIP, DINO, SuperPoint, LightGlue, or LoFTR weights.
- Record exact model name, revision, license, preprocessing version, and embedding dimensions before enabling a model.
- Models with unclear commercial terms must remain experimental and disabled by default.
- Production images should download or mount approved model artifacts through a controlled deployment process.

## Enabled Visual Embedding Model

- Purpose: visual candidate recall only, not final card identity resolution.
- Model: `google/siglip2-base-patch16-384`
- Revision: `f775b65a79762255128c981547af89addcfe0f88` by default. Production must use this pinned revision or another explicitly reviewed immutable revision, never `main`.
- Preprocessing version: `card-rectification-v1`
- Dimensions: 768
- Normalization: L2-normalized image vectors before pgvector storage.
- Runtime: dedicated Recognition Worker container. Do not load this model inside Vercel serverless functions.
- License/commercial review: verify the Hugging Face model card and Google SigLIP license terms before marking vectors as production approved.
