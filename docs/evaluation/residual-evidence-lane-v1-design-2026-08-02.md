# Residual evidence lane v1: fresh150 design and zero-cost gate

Date: 2026-08-02  
Status: **EVALUATION-ONLY / DEFAULT OFF / BENEFIT NOT YET MEASURED**  
Provider calls made by this work: **0**  
Production files changed: **0**

## Decision first

The strongest contrary view is to add no lane at all: the already-paid open-expression v4 call filled a median 10 facts per card, yet it recovered only 13 of the 255 earliest-boundary token occurrences, and an intentionally unsafe direct-concatenation replay is `10 wins / 140 losses / 0 ties`, `-0.132817` macro F1. More expression without a hard authority boundary is a large negative asset.

The higher-confidence action is therefore narrower than “turn exhaustive back on” and more useful than “do nothing”:

1. keep one Luna call;
2. add at most four three-column residual candidates to the same response;
3. let the model label literal, visual, visible-combination, and model-knowledge bases honestly;
4. grant every row **zero automatic CSM and zero automatic renderer authority**;
5. retain only strict, independently replayable candidates;
6. measure the treatment on a paired paid 150 before any production consideration.

Executable evaluation-only code now exists. It is not imported by the default request path, its feature flag defaults false, and old checkpoints without `residual_evidence` parse cleanly as “not observed.”

## Inputs and identity

| Input | SHA-256 |
|---|---|
| `docs/evaluation/fresh150-loss-ledger-255-109-63-2026-08-02.json` | `5d1719d32752ccfd6039769488aba3d34afda39fb0d4d14994d2148a9cff682a` |
| canonical/free 150 checkpoint | `2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5` |
| candidate-expression-v4 merged 150 | `39fbbaeef1c9bd2d01d74aaf36c3a1380e9901d26b76dac502756a91811d5819` |
| exhaustive high 150 | `96f71ae0956e1c7defde2579ad7448d955c0f7c33b69c908207855052faad1f9` |
| read-only production `canonical-fields.mjs` | `173ccdb000ba0b7328e602abf84f77e376efc8fc8220fdf249f78e208d4d89b8` |

Production source inspected read-only:

`/Users/paidaxin/lynca-thin-production-main/lib/listing/thin/canonical-fields.mjs`

The 255 count is the earliest waterfall boundary “reference token absent from exhaustive observation.” It is not 255 visually proven model misses. Seven tokens already have a canonical-field shadow, and the remaining routing is structural rather than image truth.

## Exact decomposition of the 255

| Primary route | Occurrences | Cards | Included families | What it means |
|---|---:|---:|---|---|
| Already canonical; downstream issue | 7 | 7 | colour 3, finish 3, subject 1 | A residual lane cannot help. Composer/normalization owns these. |
| Surface-form / grammar review | 12 | 10 | lot notation 8, token boundary/spelling 4 | Handle outside the residual model lane. Some are scorer/reference conventions, so “deterministic fix” is not assumed. |
| Direct text/symbol/stamp attention | 79 | 63 | serial 35, attributes/components 25, product/set/IP 14, subject 5 | Best prompt-expression target, but serial remains candidate-only unless independently compatible. |
| Visual or catalog semantics | 96 | 69 | finish 73, rarity 17, colour 6 | 90/96 occur on cards with no parsed grade value. Most need visual interpretation or catalog attestation, not another generic “read everything” sentence. |
| Identity or world resolution | 37 | 29 | other identity 23, year/season 11, team 3 | Needs phrase completion and/or temporal world knowledge. Team is excluded from v1 because broad team restoration was strongly negative. |
| Ambiguous numeric context | 24 | 23 | bare number/ordinal 24 | Cannot be admitted from shape alone; “26”, “2”, “99” can be season suffixes, design names, counts, grades, or codes. |
| **Total** | **255** |  |  |  |

This routing answers the first-principles question:

- prompt/expression is structurally relevant to the 79 direct-text occurrences and can carry candidates for the other families;
- visual/catalog interpretation is primary for 96 occurrences;
- world/identity resolution is primary for 37;
- 24 numeric occurrences require role context;
- 19 occurrences (7 downstream + 12 form/grammar review) should not spend residual-lane budget.

The lane target space covers 233/255 structural occurrences. That is only an addressable ceiling, not an expected recovery rate.

## Why the cap is four

After excluding the 7 downstream shadows, 12 form/grammar items, and 3 team items, there are 233 structurally eligible token occurrences on 115 cards.

| Max rows/card | Token-occurrence ceiling covered | Share | Left |
|---:|---:|---:|---:|
| 1 | 115 | 49.36% | 118 |
| 2 | 182 | 78.11% | 51 |
| 3 | 214 | 91.85% | 19 |
| **4** | **229** | **98.28%** | **4** |
| 5 | 233 | 100% | 0 |

The four apparent fifth occurrences are on four cards whose missing tokens collapse into at most four phrases (`Gold Sapphire`, `SWSH Lost Origin`, `Trainer Gallery`, `First Year Fresh`, etc.). Five therefore has no evidenced phrase-level gain, while prior max-8/max-10 experiments encouraged the model to fill capacity with noise. Four is the measured knee.

## What another prompt already proved

Candidate-expression-v4 is a separate paid call, not this proposed same-call lane. It is useful only as a prompt-sensitivity proxy:

- 13/255 occurrences appeared under the alternative prompt, on 11 cards;
- 4 came from visible facts and 9 only from hypotheses;
- 3/13 were already canonical shadows;
- only 10/255 were truly absent from canonical fields;
- route mix of those 13: 6 direct-text, 3 visual/catalog, 1 ambiguous numeric, 3 already downstream;
- the existing stored safe bundle recovered only 3 stage-one occurrences (`Refractor`, `Trainer Gallery`) and cannot establish residual-v1 recall.

The old v4 output is also the strongest admission warning. Projecting up to four old v4 rows after subtracting canonical-field text, then **incorrectly concatenating them directly to the title**, gives:

| Metric | Baseline | Unsafe candidate | Delta |
|---|---:|---:|---:|
| Macro token F1 | 0.766927 | 0.634110 | **-0.132817** |
| Card signs |  | 10 wins / 140 losses / 0 ties |  |
| New reference-helpful tokens |  | 118 |  |
| New unhelpful tokens |  | 990 |  |
| Unhelpful numeric tokens |  | 150 |  |
| Titles over 80 in this intentionally unsafe proxy |  | 144/150 |  |

Token additions by suggested target:

| Target | Helpful | Unhelpful |
|---|---:|---:|
| identity | 73 | 451 |
| marker | 18 | 184 |
| card number | 2 | 118 |
| card name | 7 | 101 |
| year | 7 | 73 |
| subject | 5 | 27 |
| finish | 2 | 29 |
| serial | 4 | 7 |

This is deliberately not called a candidate-title result. It proves that expression and authority must be separate modules.

## Minimal same-call contract

The only new response property is:

```json
{
  "residual_evidence": [
    {
      "text": "SWSH Lost Origin",
      "target": "identity",
      "anchor": "back_text"
    }
  ]
}
```

Bounds and vocabularies:

- array: max 4;
- row: exactly `text`, `target`, `anchor`, no extra properties;
- text: 1–64 characters;
- target: `identity | subject | card_name | marker | year | card_number | serial | finish`;
- anchor: `slab_text | front_text | back_text | front_symbol | stamped_number | visual | visible_combination | model_knowledge`.

Three columns are the minimum sufficient statistic:

- `text` preserves what may be useful;
- `target` prevents one phrase from silently changing semantic roles;
- `anchor` separates literal evidence from visual interpretation and world knowledge.

Removing `target` recreates the 12 wrong-role schema losses. Removing `anchor` lets model knowledge masquerade as printed text. Separate image/region/source/uncertainty columns reproduce bounded-evidence-v2's cost without demonstrated gain.

### Exact request delta

Measured against the read-only production canonical module:

| Component | Control bytes | Treatment bytes | Delta |
|---|---:|---:|---:|
| Prompt | 2,420 | 3,031 | **+611** |
| Strict JSON schema | 6,117 | 6,620 | **+503** |
| Prompt + schema | 8,537 | 9,651 | **+1,114** |

The empty lane serializes to 24 bytes. Four worst-case 64-character rows serialize to 543 bytes, roughly 136 output tokens at a conservative four-bytes/token approximation. `max_output_tokens` remains 4096. There is no second call and no serial remote stage.

## Parser, admission, and persistence boundaries

`lib/listing/thin/residual-evidence-lane-v1.mjs` implements the contract without touching the default builder.

### Request boundary

- `withResidualEvidenceLaneV1(request)` returns an isolated unchanged clone by default;
- the schema/prompt change requires explicit `{ enabled: true }`;
- `LYNCA_EVAL_RESIDUAL_EVIDENCE_V1` defaults false;
- request count, image count, detail, reasoning effort, and `max_output_tokens` stay unchanged.

### Strict parsing

- invalid JSON, non-array payloads, missing/extra row properties, bad enums, control characters, overflow, and overlong text are fail-closed defects;
- duplicates and values already present in canonical fields are dropped;
- legal/copyright and statistics/biography text is rejected;
- an old checkpoint with no field is valid but marked `source_present: false`.

### Admission

Every retained row has:

```json
{
  "automatic_csm_admission": false,
  "automatic_renderer_admission": false
}
```

`replay_eligible` means only “an offline resolver is allowed to examine it.” It never means apply.

| Candidate | Replay boundary |
|---|---|
| visual / visible combination / model knowledge | Candidate only; external attestation or role resolution required. |
| identity | Literal span may enter identity resolver; cannot choose Product/Set/IP by itself. |
| subject / card name | Literal span is replayable only into an empty field; conflict remains candidate-only. |
| marker | Only bounded literal `RC`, `Rookie Card`, `Rated Rookie`, `SP`, `SSP`, `1st Bowman`, `1st Edition` enters replay. Physical Auto/Patch/Relic/Jersey still needs visual proof. |
| year | Only exact slab year/season can enter replay; back/copyright years cannot self-establish release year. |
| card number | Must pass CSM's number boundary, including the TCG slash-code exception. |
| serial | Only a stamped fraction numerically identical to the canonical serial can be a same-value formatting candidate. Absent or conflicting serials cannot self-verify. |
| finish | Literal slab finish may enter a vocabulary-attested replay; visual or model finish stays candidate-only. |

The parser always returns `field_updates: {}` and `canonical_fields_unchanged: true`.

### Persistence-safe mapping

`toResidualEvidenceCandidateTraceV1` emits bounded deterministic JSONB rows with a content-derived id, provenance, candidate brackets, disposition, and explicit candidate-only authority. The envelope deliberately has no `canonical_value`, `selected_candidate_id`, `permission=can_apply`, renderer permission, or field-update shape. It can later be stored inside a trace JSON object without contaminating current CSM evidence/candidate tables.

## Token and latency budget

Stored 150-card context:

| Arm | Output p50 / p95 | Latency p50 / p95 |
|---|---:|---:|
| canonical high | 107 / 121 tokens | 5.139 / 6.881 s |
| full exhaustive high | 1,323 / 2,432 tokens | 18.083 / 26.732 s |
| candidate-v4 merged | 397 / 438 tokens | 65.233 / 327.823 s* |

`*` The merged v4 wall times include interrupted/concurrency-contaminated runs and are a negative envelope, not a forecast.

Paid-v1 budgets are preregistered as:

- input-token delta: p50 no more than 320 tokens and 6% of paired control;
- output-token delta: p50 no more than 48, p95 no more than 112; hard maximum remains 4096;
- latency: treatment/control p50 no more than 1.15, p95 no more than 1.20;
- timeouts, provider retries, and malformed strict-schema rows: no increase over control;
- exactly one model call per card.

## Paid 150 preregistration

Do not run residual-v1 alone just because code exists. Add it to the next 5–8-mechanism paid batch. Before the first request, freeze:

- exact 150 asset ids and row order;
- dataset, label, image-set, request, prompt, schema, model, effort, detail, and code hashes;
- isolated output directory and one-process lock;
- paired order randomization so control/treatment do not occupy systematically different rate-limit windows;
- control: current canonical high;
- treatment: byte-identical control except the +611-byte prompt suffix, +503-byte schema property, and schema name suffix.

Report these separately:

1. **Canonical interference:** control canonical fields/title versus treatment canonical fields/title with residual ignored.
2. **Candidate capture:** rows, empty-row cards, rows by target/anchor, helpful reference-token occurrences, unhelpful tokens, duplicate/noise drops.
3. **Admission replay:** accepted/rejected by field and reason; before/after title; wins/losses/ties; macro F1.
4. **Critical safety:** numeric mutations, reference-loss cards, >80 titles, wrong-role admissions, unrelated-field drift.
5. **Economics:** input/output/total tokens, latency p50/p95/max, retries, failures, and marginal cost per recovered occurrence.

### GO / STOP gates

The lane can enter a combined offline replay only if all are true:

- treatment canonical-only macro F1 delta is at least `-0.002` versus paired control;
- no increase in critical year/card-number/serial errors;
- residual rows recover at least 20 of the 248 truly absent occurrences on at least 15 cards;
- at least 60% of emitted rows contain a missing reviewed-title phrase or receive an explicit human `useful-visible-evidence` label;
- strict offline admission replay reaches at least `+0.003` macro F1, at least 8 winning cards, **0 losing cards**;
- automatic numeric conflicts = 0, reference-loss cards = 0, output titles over 80 = 0;
- token and latency budgets above pass.

Any critical numeric mutation, candidate-to-canonical leak, second provider call, or production-default activation is an immediate STOP.

## Combination verdict

The implementation can be imported into the evaluation harness now as a disabled treatment arm. It **cannot yet be merged into the existing 150-card combination replay**, because every old canonical checkpoint predates `residual_evidence`; there are zero same-call rows to replay. Claiming a gain would be fabrication.

The existing narrow bundle remains the measured baseline (`0.771494 -> 0.778394`, `+0.006900`, 13 wins / 0 losses / 137 ties). Residual-v1 becomes another mechanism only after the paired paid response exists and its strict offline replay passes the gates above.

Exact harness integration, deliberately not performed in this change:

1. In `scripts/run-thin-path-eval.mjs`, add an evaluation arm named `thin_canonical_residual_v1_high`; do not alter `thin_canonical_high`.
2. Build the ordinary canonical request first, then call `withResidualEvidenceLaneV1(request, { enabled: true })`. This preserves one input and one provider call.
3. Finish the canonical object with the existing `parseCanonicalFields`; separately call `parseResidualEvidenceLaneV1(raw, { canonicalFields: canonical.fields })`.
4. Store `residual_candidates`, `residual_replay_candidates`, `residual_dropped`, and `residual_defects` on the evaluation checkpoint. Store `toResidualEvidenceCandidateTraceV1(...)` only in the evaluation trace JSON; do not merge it into `fields`, CSM stage rows, or Composer input.
5. Bind the arm name, schema hash, prompt hash, module hash, dataset hash, image detail, model, and effort into the run fingerprint so an old checkpoint cannot resume under the new contract.
6. Add a separate zero-provider replay script after the paid checkpoint exists. Only that script may test a field update, and it must use the numeric/reference/80-character gates above.
7. Leave `lib/listing/thin/thin-listing-path.mjs`, the production request builder, API route, and persistence writer untouched until the paired 150 decision is GO.

## About a 0.1% long-tail claim

One 150-card run cannot validate a 0.1% tail probability. With zero tail events in 150, the one-sided 95% upper bound is still 1.98%. Demonstrating at most 0.1% with zero events needs at least 2,995 observations at 95% confidence, or 4,603 at 99%. The 150-card gate can reject obvious latency regressions; production telemetry or a separate no-image load study must establish the 0.1% SLO.

## Reproduction

```bash
node scripts/residual-evidence-lane-v1.test.mjs
node scripts/analyze-residual-evidence-lane-v1.test.mjs
node scripts/analyze-residual-evidence-lane-v1.mjs
```

All three are local and provider-free.
