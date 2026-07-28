# CSM Rebuild Engineering Blueprint

Status: implementation blueprint; no production behavior change  
Authority: Linear `60 CSM Rebuild Contract`, COS-23, COS-24  
Machine SEM baseline: `linear-cos-10-23-v25`

## Decision

Rebuild around four immutable layers, each with one owner and one persisted contract:

```text
RAW_EVIDENCE
  -> BRACKET_CANDIDATES
  -> RESOLVED_CANONICAL_IDENTITY
  -> MARKETPLACE_OUTPUT
```

The Recognition Worker may create the first two layers. Identity Resolution alone
creates the third. Marketplace Composer alone creates the fourth. `empty` is a
valid resolved bracket value. The 80-character eBay title is a projection and
never replaces the complete canonical identity.

This is a staged convergence, not a second recognition stack. Existing asset,
queue, feedback, renderer, and storage behavior remains active until the new
contracts are shadow-written, replayable, and proven equivalent or better.

## 1. Module and service boundaries

| Owner | Owns | Must not own |
| --- | --- | --- |
| Listing app | pending asset, direct controlled upload, batch/review UI, accept/edit/reject submission | evidence interpretation, semantic resolution, title composition rules |
| Supabase | durable originals, lifecycle, run inputs, all four output layers, versions, feedback, access control | inference or semantic decisions |
| Recognition Worker | image/OCR observations, TCG or Non-TCG grammar hypothesis, bracket candidates with provenance | final bracket values, canonical identity, marketplace title |
| Registry | versioned field definitions, aliases, relationships, grammar rules, evidence preferences, normalization and composition rules | per-card observations or final identity |
| Identity Resolution | one supported value or `empty` per bracket, alternates, rationale, confidence, conflict policy | OCR/provider invocation or marketplace trimming |
| Marketplace Composer | deterministic marketplace projection from resolved fields only | recovery from raw provider text, candidate selection, canonical mutation |

The desired repository boundary is:

```text
lib/listing/csm/contracts/       # data-only versioned contracts
lib/listing/recognition/         # evidence and candidate production
lib/identity-resolution/         # sole canonical resolver
lib/listing/marketplace/         # deterministic projections
lib/listing/registry/            # compiled registry reader and versions
lib/listing/v4/orchestration/     # stage sequencing only
```

`native-recognition-core.mjs` remains an orchestrator during migration, but all
cross-layer mutation must move behind these owner APIs. It must not normalize,
select, patch resolved fields, or repair a title directly after convergence.

## 2. Asset lifecycle and status model

Keep the current durable image-generation contract. Add run-stage state without
changing upload semantics:

```text
LOCAL
-> ASSET_CREATED
-> ORIGINALS_UPLOADING
-> ORIGINALS_VERIFIED
-> IMAGE_SET_READY
-> ENQUEUE_READY
-> QUEUED
-> RUNNING
   -> RECOGNITION_COMPLETE
   -> RESOLUTION_COMPLETE
   -> COMPOSITION_COMPLETE
-> L2_READY
-> WRITER_REVIEWED
```

Rules:

- A run references one immutable verified `image_generation_id`.
- Re-upload creates a new generation; it never mutates prior run inputs.
- Each stage commits its output before the next stage becomes claimable.
- Retry resumes from the last committed compatible stage, keyed by the pipeline
  fingerprint and Registry version.
- Failure records `failed_stage`, stable `reason_code`, retryability, and input
  version. No stage silently falls back to a later layer.
- Writer review updates feedback/replay authority, not the original canonical run.

## 3. Supabase system of record

### Storage paths

```text
listing-originals/{tenant_id}/{asset_id}/{image_generation_id}/front/{sha256}.{ext}
listing-originals/{tenant_id}/{asset_id}/{image_generation_id}/back/{sha256}.{ext}
listing-derived/{tenant_id}/{asset_id}/{image_generation_id}/{transform_version}/{crop_id}.{ext}
```

Originals are immutable and checksum-verified. Derived crops always record their
source object, transform/crop policy version, and checksum.

### Relational contracts

Retain the current asset/job/session tables and add normalized, append-only layer
tables. JSON snapshots remain as compatibility projections until cutover.

| Table | Required identity and payload |
| --- | --- |
| `csm_recognition_runs` | run, tenant, asset, image generation, grammar, model/OCR/prompt/pipeline/registry versions, stage status |
| `csm_evidence_observations` | observation id, run, bracket, raw/normalized value, modality, image side/region, confidence, provenance, normalization reason |
| `csm_bracket_candidates` | candidate id, run, bracket, value or `empty`, supporting/contradicting evidence ids, confidence, source trust, rank |
| `csm_identity_resolutions` | immutable resolution revision, run, resolver/rule versions, grammar, status, rationale |
| `csm_resolved_brackets` | resolution revision, bracket, selected candidate or `empty`, canonical value, confidence, alternates, conflict trace |
| `csm_marketplace_outputs` | resolution revision, marketplace/profile/language, composer and rule versions, title, structured output, trim trace |
| `csm_registry_releases` | immutable registry version, content hash, effective time, promotion metadata |

Every row is tenant-scoped except immutable shared Registry releases. Child rows
inherit tenant and run identity in database functions; callers cannot override
them. Authenticated clients may create/read their scoped assets and use signed
upload permissions. Only service-role workers write evidence, candidates,
resolutions, or outputs. Writers append feedback; they cannot mutate run facts.

Required per-run versions:

```text
csm_contract_version
registry_version + registry_content_sha256
grammar_classifier_version
provider_model_version + prompt_version
ocr_provider_version + ocr_model_version
image_preprocess_version + crop_policy_version
evidence_schema_version + normalization_version
candidate_schema_version
resolver_version + conflict_policy_version
composer_version + marketplace_profile_version
recognition_pipeline_fingerprint
```

## 4. Typed stage contracts

The contracts are JSON-schema validated at persistence and TypeScript/JSDoc
validated at module boundaries. IDs reference immutable rows rather than copying
natural-language responses.

```ts
type Grammar = "TCG" | "NON_TCG";
type BracketValue = { kind: "VALUE"; canonical: unknown }
  | { kind: "EMPTY"; reason: "ABSENT" | "INSUFFICIENT_EVIDENCE" };

type EvidenceObservation = {
  id: string;
  bracket: CsmBracket;
  rawValue: unknown;
  normalizedValue: unknown | null;
  modality: "WHOLE_CARD_VISUAL" | "CARD_TEXT_OCR" | "SLAB_LABEL" | "REGISTRY";
  sourceRef: { imageSide?: "FRONT" | "BACK"; region?: string; objectSha256?: string };
  confidence: number;
  normalization: { version: string; outcome: "KEPT" | "DROPPED"; reasonCode: string };
};

type BracketCandidate = {
  id: string;
  bracket: CsmBracket;
  value: BracketValue;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  sourceTrust: string;
  confidence: number;
};

type RecognitionPacket = {
  contractVersion: string;
  runId: string;
  grammar: Grammar;
  grammarConfidence: number;
  registryVersion: string;
  evidence: EvidenceObservation[];
  candidates: BracketCandidate[];
};

type ResolutionPacket = {
  contractVersion: string;
  runId: string;
  grammar: Grammar;
  registryVersion: string;
  resolverVersion: string;
  fields: Record<CsmBracket, {
    selected: BracketValue;
    selectedCandidateId: string | null;
    alternates: string[];
    rationaleCodes: string[];
    confidence: number;
  }>;
};

type MarketplacePacket = {
  contractVersion: string;
  resolutionRevisionId: string;
  marketplace: "EBAY";
  title: string; // <= 80 characters
  structuredOutput: Record<string, unknown>;
  includedBrackets: CsmBracket[];
  dropped: Array<{ bracket: CsmBracket; reasonCode: string }>;
};
```

Graded is an evidence overlay in either grammar. It must never produce a third
grammar category.

## 5. GPT-5 and OCR invocation

Recognition receives only verified image references, the effective Registry
slice, and a bounded output schema. Google Vision OCR and focused crops produce
independent observations; GPT-5 may interpret visual structure and propose
candidates, but neither source writes canonical fields.

Persist:

- provider request identity, model/prompt versions, start/end/attempt;
- image/crop references and hashes, never expiring signed URLs;
- structured observation fields and bracket candidates;
- raw and normalized values, keep/drop reason, evidence links, confidence;
- bounded token/latency/error metadata.

Do not persist the complete natural-language model response. The Registry holds
evidence preferences, not a second expanding prompt.

## 6. Resolution and composition rules

Identity Resolution processes each bracket independently, then validates
cross-bracket consistency. It may select exactly one candidate or `empty`.
Conflict priority is frozen as:

1. validated historical learning and calibrated CSM rules;
2. grading label;
3. whole-card visual evidence;
4. card text/OCR.

The selected value, losing alternatives, conflicts, and reason codes are always
persisted. Retrieval/catalog data can support a candidate but cannot bypass the
resolver.

Marketplace Composer accepts only `ResolutionPacket`. It selects TCG or Non-TCG
composition, orders fields deterministically, deduplicates/contains/abbreviates,
and trims by commercial priority to 80 characters. It cannot inspect provider
output, OCR text, retrieval candidates, or reference titles.

## 7. Evaluation and observability

Report the two scoreboards together:

1. field-level semantic correctness against independent reviewed truth;
2. commercial title projection quality, including token recall and critical SEM
   regressions.

Also report abstention/`empty` calibration; an unsupported guess and a correct
empty are not equivalent.

For every bracket, trace:

```text
observed -> normalized -> candidate produced -> selected/empty
-> resolver retained/dropped -> composer included/dropped
```

Minimum gates on Development/Validation before reader cutover:

- stage trace coverage >= 99%; unknown loss reason approaches zero;
- critical entity-field regression = 0;
- unsupported canonical field application = 0;
- composer reads resolved fields only, proven by dependency test;
- deterministic replay is byte-identical for the same fingerprint;
- TCG and Non-TCG fixtures pass; graded fixtures stay within either grammar;
- tenant isolation and append-only feedback invariants pass.

Holdout remains closed until the migration and strategy are frozen. Production
shadow data does not change writer titles.

## 8. Current-state gap matrix

| Contract | Current evidence | Gap / action |
| --- | --- | --- |
| Durable asset generation | `asset-lifecycle-contract.mjs` has verified generations and lifecycle states | preserve; add stage commits without changing upload contract |
| Raw evidence | `evidence-schema.mjs`, `v4_field_evidence`, pre-ingestion patches | schemas contain resolved/implementation fields; introduce observation-only contract and explicit normalization outcomes |
| Bracket candidates | candidate control-plane JSON/trace exists | normalize per-bracket candidates and evidence links; Worker must stop applying them |
| Canonical resolution | `lib/identity-resolution` and `resolved_fields` exist | make Resolver the only writer; support explicit `empty`; persist revision, alternates and rationale |
| Grammar | `semGrammarForResolved` returns `TCG` or `STANDARD` after fields exist | classify before candidates as `TCG` or `NON_TCG`; graded remains overlay |
| Registry version | SEM version exists; knowledge sources are distributed | compile one immutable effective Registry release and record content hash per run |
| Marketplace output | deterministic renderer exists and enforces title length | rename boundary to Composer; remove provider/candidate recovery paths; consume ResolutionPacket only |
| Traceability | session JSON plus candidate/quality tables | normalized append-only layers plus compatibility snapshots |
| Feedback | append-only writer feedback and validation gates are strong | preserve; link feedback to output and resolution revisions; never auto-promote to truth |
| Orchestration | `native-recognition-core.mjs` owns many cross-layer repairs | reduce to sequencing and persistence after owner APIs are proven |

## 9. Migration sequence

Each step is a separate reviewable migration/PR and must be rollback-safe.

1. **Contract freeze:** add schemas, reason-code enums, owner tests, and this
   blueprint. No runtime behavior change.
2. **Expand storage:** add normalized tables, constraints, RLS, immutable Registry
   releases, and stage version columns. Run migration preflight on a clean DB and
   production clone before promotion.
3. **Recognition shadow write:** adapt current provider/OCR output into
   `RecognitionPacket`; persist evidence/candidates while existing result remains
   authoritative.
4. **Resolver shadow write:** resolve the same packets, including explicit empty,
   and compare field-by-field with current `resolved_fields`.
5. **Composer shadow write:** render only from shadow resolution; compare title,
   trim trace, field inclusion, and critical regressions.
6. **Read cutover by owner:** first Registry/version reader, then Recognition
   packet, then Resolver, then Composer. One feature flag per boundary; never one
   flag for the whole rebuild.
7. **Production canary:** bounded tenant/cohort with automatic fallback to the
   previous reader. Do not change Provider concurrency, Queue, or upload lifecycle.
8. **Convergence:** backfill only reproducible versioned snapshots, switch feedback
   links to resolution/output revisions, then delete obsolete cross-layer write
   paths and compatibility JSON after an observation window.
9. **Final verification:** after chain freeze, run database reliability checks,
   real writer journey, and one frozen accuracy cohort. Do not tune on holdout.

## 10. Concrete decisions still required

1. **Canonical bracket storage:** use typed scalar/array JSON values behind the
   frozen COS-23 bracket names; do not add implementation fields to CSM.
2. **Validated historical priority:** only independently reviewed, versioned
   learning may enter priority tier 1. Writer acceptance alone remains commercial
   feedback.
3. **Unknown versus empty:** transport may use `UNKNOWN` only for an incomplete
   run. A completed resolver must emit `VALUE` or `EMPTY` with a reason.
4. **Registry promotion:** promotion requires review metadata and a content hash;
   production runs pin a release and never read mutable draft rows.

These decisions preserve the approved semantic model. Any proposal that changes
the frozen bracket set returns to CSM governance instead of entering an
engineering migration.
