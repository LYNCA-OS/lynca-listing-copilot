# LYNCA Data Flywheel Report

Date: 2026-07-15
Scope: commercial-pilot data capture and learning-asset preparation

## Executive result

The v1 framework separates four layers that must never be collapsed:

1. immutable facts: authoritative AI result plus every writer decision;
2. derived candidates: lexical title diff, parsed SEM, and error suggestions;
3. reviewed truth: writer-verified title labels and separately validated SEM;
4. frozen/exported releases: reproducible Golden and daily learning files.

All public writer feedback defaults to `OBSERVE_ONLY`. No parser output is
training eligible. A title can be perfect writer truth while its parsed fields
remain `PENDING`; this is the central data-quality boundary.

## D1. Feedback schema

`v4_writer_feedback_events` is an append-only event log. Each committed writer
action has a unique `submission_id`; a network retry reuses that ID and is
deduplicated by `payload_sha256`, while a later action receives a new ID and
revision. The writer UI keeps the ID and original client timestamp until the
request succeeds, so a lost response does not create a second fact.

Captured identity and provenance:

- `recognition_session_id`, `tenant_id`, `user_id`, `asset_id`;
- stable content-addressed asset ID when image hashes exist, plus the original
  `client_asset_ref`;
- authoritative `ai_title`, `ai_sem`, `model_version`, `prompt_version` copied
  from the locked server session;
- `action` (`ACCEPT`, `EDIT`, `REJECT`), raw writer title, separately normalized
  title, client occurrence time, and server receipt time;
- full recognition and writer snapshots, title diff version, revision, and
  previous-event pointer.

The browser cannot supply AI truth or tenant/user identity. Queue workers retain
the originating signed principal and cannot overwrite session ownership.

## D2. Title diff

Diff version `whitespace-token-lcs-v1` preserves token order, repetition, case,
and source spans. It stores `added`, `removed`, replacement groups, and the full
operation sequence. Writer-vs-AI diff is distinct from writer-vs-CSM
normalization diff.

For `Messi Gold Auto` → `Lionel Messi Gold Refractor Auto /50 PSA10`, lexical
additions are `Lionel`, `Refractor`, `/50`, `PSA10`; removals are empty because
`Messi` remains in the final title.

## D3-D4. SEM extraction and validation

The existing title parser is wrapped by a versioned canonical SEM candidate.
The Data Flywheel projection exposes:

`year`, `manufacturer`, `product`, `set`, `subject`, `card_name`, `card_number`,
`parallel`, `numerical_rarity`, `grading`, `autograph`, and `patch`.

Every extraction stores parser/schema/SEM versions, source-title spans,
structure warnings, per-field parser confidence, and overall confidence capped
at `0.8` for title-only evidence. Validation states are exactly `PENDING`,
`VALIDATED`, and `REJECTED`; evidence slots are image, OCR, catalog, and human
confirmation. Automated extraction starts as `PENDING`, `semantic_truth=false`,
and `training_eligible=false`.

A `VALIDATED` SEM event is semantic truth, but only a Golden SEM candidate. It
becomes freeze-eligible only at the release boundary, where a reviewed identity
group and at least one image with a content SHA-256 are both required.

## D5. Golden Dataset

The source policy requires explicit `writer_verified` provenance. A live,
read-only Supabase audit on 2026-07-15 found:

- 358/358 rows with writer-verified titles;
- 255 rows with an image object reference;
- 0 rows with image content pinned by SHA-256;
- 0 field-level validated SEM rows.

Golden Title v1 therefore materializes 358 title labels at `confidence=1` and
`validation_status=VALIDATED`. Of these, 255 retain an image object reference
and 103 have no image reference. An object reference is not frozen image
content: because none of the 255 references currently carries a content
SHA-256, image benchmark eligibility is 0. The labels and references form a
reproducible title release; an image-to-title benchmark remains blocked until
the referenced bytes are backfilled and content-pinned. The rebuilt manifest
hash is
`622ba27d25ac229c1523ddb4afcea48ee806b758149bdc0249ad5a32d78a0d6c`.

Golden SEM remains empty until explicit field-level review. Parser-derived SEM
is exported beside the title labels as `PENDING`, never silently promoted.

## D6. Error Dataset

AI SEM vs writer-title SEM produces review candidates using the v1 taxonomy:

- `WRONG_PRODUCT`
- `WRONG_SUBJECT`
- `WRONG_PARALLEL`
- `MISSING_NUMBERED`
- `WRONG_CARD_NUMBER`
- `WRONG_GRADE`
- `MISSING_FIELD`

Auto classifications remain candidates (`human_verified=false`) until review.

## D7. Daily learning export

`npm run export:learning` atomically writes four JSONL datasets plus a hashed
manifest under `learning/YYYY-MM-DD/`. Output strips signed URLs, embedded image
bytes, credentials, and secrets, retaining only safe storage references. A
validation completed on a later day automatically loads its parent learning and
feedback events, so delayed human review cannot disappear from the daily SEM or
Golden projection. Supabase reads use stable, exact-count pagination and fail
closed on incomplete, overlapping, or changing result sets, so a dataset larger
than the PostgREST page limit cannot be silently truncated.

Golden Title bootstrap:

```bash
npm run golden:title:v1 -- --supabase
```

Daily export:

```bash
npm run export:learning -- --supabase --date YYYY-MM-DD
```

The export day is explicitly UTC. Omitting `--date` selects the current UTC
date; the production scheduler must preserve that boundary.

## Verification

- `npm run check`: passed in the isolated Track D worktree, including precheck
  and launch-benchmark postcheck.
- `npm test`: passed with exit code 0 in a byte-identical `/tmp` snapshot; all
  changed and newly added source files were compared back to the worktree. The
  first direct worktree run was restarted after macOS file I/O stalled while
  loading ExcelJS, before any assertion failed.
- Migration SHA-256:
  `14b2007c69630213bcc26d13a06dec279f897b353bd5d4599f288f0ac108a51c`.
  The migration and feedback RPC were executed against a clean PostgreSQL 17
  instance, including legacy backfill, idempotent success, contradictory-payload
  rollback, append-only writer learning, and non-writer update compatibility.
- Independent final review found no remaining P0/P1 findings.

## Deployment boundary

The Supabase migration is additive and least-privilege: RLS remains enabled,
public/anon/authenticated access is revoked, service-role grants are explicit,
writer facts cannot be updated/deleted, and the transaction locks the owned
session before copying identity and generation provenance. Apply it only after
this branch is merged and the normal production migration review is complete;
this report does not claim that an unmerged migration is already live.
