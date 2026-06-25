# Phase 31: Visual Vector Candidate Retrieval

## Goal

Add visual embeddings as a candidate card identity recall layer. This layer does not decide final identity, does not override OCR/slab/registry evidence, and does not publish fields by itself.

## Flow

```text
card images
  -> recognition worker visual_features
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

## Model Defaults

- `VISUAL_EMBEDDING_MODEL_ID=google/siglip2-base-patch16-384`
- `VISUAL_EMBEDDING_MODEL_REVISION=main`
- `VISUAL_EMBEDDING_PREPROCESSING_VERSION=card-rectification-v1`
- `VISUAL_EMBEDDING_DIMENSIONS=768`

The recognition worker keeps the output contract stable but returns `embedding_backend_not_installed` until a production embedding backend is installed.

## Retrieval Policy

- `VISUAL_VECTOR` uses trust tier `6`.
- It is reference-only in candidate verification.
- It can improve candidate recall and ranking.
- It cannot become ground truth for year, serial, grade, exact parallel, or player identity without independent evidence.
- Embedding queries are never written to the text retrieval cache.

## Env

```text
ENABLE_VISUAL_VECTOR_RETRIEVAL=false
VISUAL_VECTOR_MODEL_ID=google/siglip2-base-patch16-384
VISUAL_VECTOR_MODEL_REVISION=main
VISUAL_VECTOR_PREPROCESSING_VERSION=card-rectification-v1
VISUAL_VECTOR_DIMENSIONS=768
VISUAL_VECTOR_MATCH_COUNT=10
VISUAL_VECTOR_MATCH_THRESHOLD=0
VISUAL_VECTOR_RETRIEVAL_TIMEOUT_MS=3000
```
