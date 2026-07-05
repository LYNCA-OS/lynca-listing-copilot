# Phase 31: Visual Vector Candidate Retrieval

## Goal

Add visual embeddings as a candidate card identity recall layer. This layer does not decide final identity, does not override OCR/slab/registry evidence, and does not publish fields by itself.

## Flow

```text
card images
  -> recognition worker query visual_features at first receipt
  -> Supabase pgvector match_card_image_embeddings RPC
  -> VISUAL_VECTOR retrieval candidates
  -> existing candidate ranker
  -> Identity Resolver / Gate
  -> writer review
```

## Data Boundary

- `card_identities` stores canonical candidate identity fields.
- `card_reference_images` stores approved reference images or stable object paths.
- `card_image_embeddings` stores versioned embeddings with `model_id`, `model_revision`, `preprocessing_version`, `embedding_role`, and fixed dimensions.
- `match_card_image_embeddings` returns top-K candidates by cosine similarity.

Only `retrieval_enabled` identities and `approved_for_retrieval` images are searchable.
`candidate` identities are excluded by default. Development and preview
experiments may opt in with `VISUAL_VECTOR_INCLUDE_CANDIDATES=true`; production
must keep that flag false unless the candidate pool has been reviewed.

## Model Defaults

- `VISUAL_EMBEDDING_MODEL_ID=google/siglip2-base-patch16-384`
- `VISUAL_EMBEDDING_MODEL_REVISION=f775b65a79762255128c981547af89addcfe0f88`
- `VISUAL_EMBEDDING_PREPROCESSING_VERSION=card-rectification-v1`
- `VISUAL_EMBEDDING_DIMENSIONS=768`

The recognition worker now has a real SigLIP2 backend behind
`ENABLE_VISUAL_EMBEDDINGS=true`. It emits L2-normalized 768-dimensional vectors
or an explicit `UNAVAILABLE` status if the backend cannot load. This model must
run in the dedicated Recognition Worker container, not in Vercel serverless
functions.

The listing API explicitly requests `run_visual_embeddings=true` during
recognition preflight when `ENABLE_QUERY_VISUAL_VECTOR_PREFLIGHT=true` (default).
This covers newly received cards before they have approved reference embeddings.
Those query embeddings are used only for retrieval in the current request; they
are not written to the trusted retrieval index until writer approval.

## Retrieval Policy

- `VISUAL_VECTOR` uses trust tier `6`.
- It is reference-only in candidate verification.
- It can improve candidate recall and ranking.
- It cannot become ground truth for year, serial, grade, exact parallel, or player identity without independent evidence.
- Embedding queries are never written to the text retrieval cache.

## Env

```text
ENABLE_SINGLE_MODEL_FAST_PATH=false
ENABLE_EVIDENCE_COMPLETION=true
ENABLE_VISUAL_VECTOR_RETRIEVAL=true
VISUAL_VECTOR_INCLUDE_CANDIDATES=false
ENABLE_QUERY_VISUAL_VECTOR_PREFLIGHT=true
ENABLE_STORED_VISUAL_FEATURE_LOOKUP=true
VISUAL_VECTOR_MODEL_ID=google/siglip2-base-patch16-384
VISUAL_VECTOR_MODEL_REVISION=f775b65a79762255128c981547af89addcfe0f88
VISUAL_VECTOR_PREPROCESSING_VERSION=card-rectification-v1
VISUAL_VECTOR_DIMENSIONS=768
VISUAL_VECTOR_MATCH_COUNT=10
VISUAL_VECTOR_MATCH_THRESHOLD=0
VISUAL_VECTOR_RETRIEVAL_TIMEOUT_MS=3000
```

## Indexing

Use the cloud-only indexing script to populate Supabase pgvector rows:

```bash
node scripts/index-visual-vector-embeddings.mjs --schema-check-only
node scripts/index-visual-vector-embeddings.mjs \
  --limit 30 \
  --concurrency 2 \
  --retrieval-status candidate \
  --enable-candidate-retrieval
```

The script signs Supabase Storage URLs, calls the configured cloud Recognition
Worker for embeddings, and upserts identities, reference images, and embeddings.
It does not call the GPT listing vision provider. It fails if the worker returns
`UNAVAILABLE` instead of real embeddings.

## Cloud Boundary

- Vercel listing API: orchestration, provider routing, resolver, renderer.
- Supabase: private image storage plus pgvector candidate recall.
- Recognition Worker: Docker/FastAPI service for image bytes, OCR, and visual
  embeddings.

Do not load PyTorch, Transformers, or SigLIP weights inside the Vercel listing
API. The worker URL and token must be provided through
`RECOGNITION_WORKER_URL` and `RECOGNITION_WORKER_TOKEN` before cloud evaluations
can include visual vectors.
