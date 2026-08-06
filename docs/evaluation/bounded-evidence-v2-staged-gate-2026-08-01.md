# Bounded evidence v2 staged gate — 2026-08-01

## Decision and opposing view

The tempting view is that the old 50-card set can still validate the resolver
because it was originally called a holdout. It cannot: results from that set
have already selected the product-extension hypothesis. The analyzer now calls
it `screen50`, marks it `development_screen`, and can only emit a development
decision. Neither `screen50`, `audited100`, nor `development150` can advance a
confirmatory gate.

The minimum-cost sequence is now:

1. `mechanism6`: six treatment calls on six preidentified product-token misses.
   This checks only where the fixed target tokens survive; it does **not**
   estimate F1.
2. If any target is present only in the bounded canonical `product`, run six
   same-card canonical-high controls. If every target has an exact evidence
   channel, iterate the resolver by zero-cost replay instead.
3. `confirmatory50`: 50 treatment calls on a fixed set outside the entire
   canonical development 150. Run the offline resolver and both manual audits.
4. Only when that treatment says `ADVANCE_TO_STAGE_B_LIVE_CONTROL`, make 50
   canonical-high calls on the exact same images.
5. A passing control comparison says
   `CONFIRMATORY_PASS_FINAL_VALIDATION_REQUIRED`; it is not production approval.

This spends six calls before testing the mechanism and at most 112 calls before
the separate final-validation contract. Every paid stage uses the direct local
thin evaluator. There is no Cloud Run, retrieval, generic OCR, web lookup, or
automatic second model call.

## Authority boundary

The model still returns canonical CSM/embedded-SEM fields. The addition is an
append-only `evidence_spans` ledger, capped at eight. `advisory_role` is a
suggestion, never semantic authority. The resolver may only write an evaluation
overlay; `production_promoted` must remain `false` on every accepted row.

- Exact source-anchored current-copy serial text may replace the renderer
  overlay only. Leading zeroes remain exact; conflicting serials are blocked.
- Exact `1st` and `Jersey` may enter the evaluation overlay only.
- `year` promotion is permanently forbidden.
- `print_finish` promotion is currently forbidden; the development holdout
  produced two clear false positives.
- `product` is not globally forbidden. It is legal only as an evaluation
  overlay when the exact span comes from `printed_text`, `stamped_text`, or
  `slab_label_text`, has `uncertainty: "none"`, and has an explicitly
  product-like advisory role. A nonempty canonical product must be a contiguous
  ordered subsequence of the longer exact phrase. With an empty canonical
  product, the phrase needs at least two alphabetic product tokens plus the
  stronger attributable audit described below.
- Any `false` or `critical_wrong` promotion stops the gate. No verdict changes a
  production field.
- The deterministic Composer remains the only title renderer and keeps the
  80-character contract.

This code remains evaluation-only and is not imported by the production thin
route.

## Immutable cohort contract

Regenerate and verify the v2 manifest before a run:

```sh
node scripts/build-bounded-evidence-v2-cohorts.mjs \
  --out-dir artifacts/bounded-evidence-v2/cohorts
```

`cohort-manifest.json` binds all five exact ID files and roles:

| Cohort | n | `selection_role` | Permitted conclusion |
|---|---:|---|---|
| `mechanism6` | 6 | `mechanism_probe_known_wins` | mechanism only |
| `screen50` | 50 | `development_screen` | development screen only |
| `audited100` | 100 | `audited_development` | development extension only |
| `development150` | 150 | `development_population` | development population only |
| `confirmatory50` | 50 | `confirmatory_validation` | confirmatory gate |

The loader verifies every file hash and count, `screen50 ∪ audited100 =
development150`, `mechanism6 ⊂ development150`, and `confirmatory50 ∩
development150 = ∅`. It also verifies the disjoint reserve55 so the two files
partition all 105 cards outside canonical150. The confirmatory 50 is fixed by a
public salted-SHA-256 order, without labels and before any v2 outcome; the same
salt is bound into both confirmatory and reserve entries.

The old files named `holdout-50` and `evidence-150` are not referenced by the
v2 manifest and are not accepted by the analyzer.

## Two independent manual audits

The analyzer requires two JSONL files even when one is empty:

1. `promotion-labels.jsonl`, keyed by `asset_id + exact_text + target`;
2. `helpful-evidence-labels.jsonl`, keyed by `asset_id + exact_text` and with no
   `target` field.

Both accept exactly `true`, `false`, or `critical_wrong`. `true` in the second
file means a reviewer confirmed that the literal card-visible evidence is
reference-novel relative to the same-response canonical control. The analyzer
rejects duplicate, extra, missing, or unknown verdicts rather than producing a
soft review state.

Example promotion label:

```json
{"asset_id":"...","exact_text":"Topps Chrome UFC","target":"product","verdict":"true"}
```

When canonical `fields.product` is empty, that label must additionally carry
`"empty_base_product_tokens_verified": true` and a nonempty `"reviewer"`.

Example helpful-evidence label:

```json
{"asset_id":"...","exact_text":"Topps Chrome UFC","verdict":"true"}
```

If manually confirmed reference-novel evidence exists but the deterministic
resolver does not produce positive mean paired F1 with more wins than losses,
the decision is `RESOLVER_WORK_REQUIRED`. That authorizes only zero-cost replay
of the stored response; it does not authorize the live-control stage.

## Step 1 — six-call mechanism probe

```sh
scripts/run-thin-path-eval.sh \
  --arms thin_canonical_bounded_evidence_v2_high \
  --selection-role mechanism_probe_known_wins \
  --concurrency 120 \
  --limit 6 \
  --asset-ids-file artifacts/bounded-evidence-v2/cohorts/product-mechanism-6.asset-ids.json \
  --out-dir artifacts/bounded-evidence-v2/mechanism6

node scripts/analyze-bounded-evidence-v2-gate.mjs \
  --evidence artifacts/bounded-evidence-v2/mechanism6/thin-path-gpt-5.6-luna.jsonl \
  --evidence-manifest artifacts/bounded-evidence-v2/mechanism6/thin-path-gpt-5.6-luna.manifest.json \
  --cohort-manifest artifacts/bounded-evidence-v2/cohorts/cohort-manifest.json \
  --cohort-name mechanism6 \
  --promotion-labels artifacts/bounded-evidence-v2/mechanism6/promotion-labels.jsonl \
  --helpful-evidence-labels artifacts/bounded-evidence-v2/mechanism6/helpful-evidence-labels.jsonl \
  --out artifacts/bounded-evidence-v2/mechanism6/gate.json
```

The mechanism contract binds the baseline-missing, reference-supported target
tokens for the six known cases:

- `Metal` → target `Draft`
- `Topps Chrome` → target `VeeFriends`
- empty → target `MJx`
- `Topps Chrome` → target `VeeFriends`
- `Chrome Black` → targets `Star` + `Wars`
- `Chrome` → target `UFC`

For each fixed asset, all target tokens must occur either in the bounded
response's canonical `fields.product`, or in one exact, anchored, product-like
evidence span. Subject, set, title, or reference occurrence does not count. The
report emits `canonical_only`, `evidence_only`, `both`, or `missing` per card.
Any `missing` stops. Any `canonical_only` returns
`MECHANISM_CANONICAL_CONTROL_REQUIRED`; only when all six have an evidence
channel (`evidence_only` or `both`) does it return
`MECHANISM_EVIDENCE_CONFIRMED` for zero-cost resolver replay.

For the canonical-only branch, run the exact six controls before considering
the external 50:

```sh
scripts/run-thin-path-eval.sh \
  --arms thin_canonical_high \
  --selection-role mechanism_probe_known_wins \
  --concurrency 120 \
  --limit 6 \
  --asset-ids-file artifacts/bounded-evidence-v2/cohorts/product-mechanism-6.asset-ids.json \
  --out-dir artifacts/bounded-evidence-v2/mechanism6-live-control
```

Re-run the analyzer with that checkpoint and its manifest as `--live-control`
and `--live-control-manifest`. The result is
`MECHANISM_CANONICAL_CONTROL_COMPLETE` with both target-capture counts; it is a
mechanism diagnostic, not an F1 or production verdict.

The report may display F1 as a diagnostic, but the mechanism decision ignores
it. Six selected wins cannot estimate population quality.

## Step 2 — confirmatory treatment 50

Use a fresh output directory and the exact external cohort:

```sh
scripts/run-thin-path-eval.sh \
  --arms thin_canonical_bounded_evidence_v2_high \
  --selection-role confirmatory_validation \
  --concurrency 120 \
  --limit 50 \
  --asset-ids-file artifacts/bounded-evidence-v2/cohorts/confirmatory-50.asset-ids.json \
  --out-dir artifacts/bounded-evidence-v2/confirmatory50-treatment

node scripts/analyze-bounded-evidence-v2-gate.mjs \
  --evidence artifacts/bounded-evidence-v2/confirmatory50-treatment/thin-path-gpt-5.6-luna.jsonl \
  --evidence-manifest artifacts/bounded-evidence-v2/confirmatory50-treatment/thin-path-gpt-5.6-luna.manifest.json \
  --cohort-manifest artifacts/bounded-evidence-v2/cohorts/cohort-manifest.json \
  --cohort-name confirmatory50 \
  --promotion-labels artifacts/bounded-evidence-v2/confirmatory50-treatment/promotion-labels.jsonl \
  --helpful-evidence-labels artifacts/bounded-evidence-v2/confirmatory50-treatment/helpful-evidence-labels.jsonl \
  --out artifacts/bounded-evidence-v2/confirmatory50-treatment/gate.json
```

The CLI fails closed unless the v2 run manifest is a single
`thin_canonical_bounded_evidence_v2_high` arm using `gpt-5.6-luna`, effort
`none`, detail `high`, and the exact cohort hash. It recomputes the manifest
fingerprint, provider-request behavior templates, separate finisher receipt,
completed checkpoint hash, and the normalized request hash for each one- or two-image request;
it also validates every row's arm, run fingerprint, model, served effort,
reference shape, image-set hash, raw response, v2 versions, and exact asset set.
Manifest v2 also binds concurrency, timeout, attempts, and retry policy; these
commands request concurrency 120, naturally capped by the 6- or 50-card cohort.

## Zero-cost resolver replay

After `RESOLVER_WORK_REQUIRED`, replay the stored provider payload through the
current deterministic finisher:

```sh
node scripts/replay-bounded-evidence-v2-checkpoint.mjs \
  --input artifacts/bounded-evidence-v2/confirmatory50-treatment/thin-path-gpt-5.6-luna.jsonl \
  --run-manifest artifacts/bounded-evidence-v2/confirmatory50-treatment/thin-path-gpt-5.6-luna.manifest.json \
  --out artifacts/bounded-evidence-v2/confirmatory50-treatment/replay.jsonl
```

Analyze replay rows only with their receipt and original input:

```sh
node scripts/analyze-bounded-evidence-v2-gate.mjs \
  --evidence artifacts/bounded-evidence-v2/confirmatory50-treatment/replay.jsonl \
  --evidence-manifest artifacts/bounded-evidence-v2/confirmatory50-treatment/thin-path-gpt-5.6-luna.manifest.json \
  --evidence-replay-manifest artifacts/bounded-evidence-v2/confirmatory50-treatment/replay.jsonl.replay-manifest.json \
  --evidence-replay-input artifacts/bounded-evidence-v2/confirmatory50-treatment/thin-path-gpt-5.6-luna.jsonl \
  --cohort-manifest artifacts/bounded-evidence-v2/cohorts/cohort-manifest.json \
  --cohort-name confirmatory50 \
  --promotion-labels artifacts/bounded-evidence-v2/confirmatory50-treatment/replay-promotion-labels.jsonl \
  --helpful-evidence-labels artifacts/bounded-evidence-v2/confirmatory50-treatment/replay-helpful-evidence-labels.jsonl
```

The replay receipt binds the parent run manifest bytes, input checkpoint bytes,
output bytes, current finisher/scorer sources, every original provider field,
and every replay row. Rows with replay provenance fields but no valid receipt
are rejected.

## Step 3 — same-card live canonical control

Only after `ADVANCE_TO_STAGE_B_LIVE_CONTROL`:

```sh
scripts/run-thin-path-eval.sh \
  --arms thin_canonical_high \
  --selection-role confirmatory_validation \
  --concurrency 120 \
  --limit 50 \
  --asset-ids-file artifacts/bounded-evidence-v2/cohorts/confirmatory-50.asset-ids.json \
  --out-dir artifacts/bounded-evidence-v2/confirmatory50-live-control

node scripts/analyze-bounded-evidence-v2-gate.mjs \
  --evidence artifacts/bounded-evidence-v2/confirmatory50-treatment/thin-path-gpt-5.6-luna.jsonl \
  --evidence-manifest artifacts/bounded-evidence-v2/confirmatory50-treatment/thin-path-gpt-5.6-luna.manifest.json \
  --live-control artifacts/bounded-evidence-v2/confirmatory50-live-control/thin-path-gpt-5.6-luna.jsonl \
  --live-control-manifest artifacts/bounded-evidence-v2/confirmatory50-live-control/thin-path-gpt-5.6-luna.manifest.json \
  --cohort-manifest artifacts/bounded-evidence-v2/cohorts/cohort-manifest.json \
  --cohort-name confirmatory50 \
  --promotion-labels artifacts/bounded-evidence-v2/confirmatory50-treatment/promotion-labels.jsonl \
  --helpful-evidence-labels artifacts/bounded-evidence-v2/confirmatory50-treatment/helpful-evidence-labels.jsonl \
  --out artifacts/bounded-evidence-v2/confirmatory50-live-control/gate.json
```

The live run must itself be a single `thin_canonical_high` arm with an exact
manifest and cohort. Each pair must have byte-identical reference text,
image-set hash, and image count. Shared dataset, sealed-label, request-source,
model, effort, and detail contracts must match. The schema-interference screen
keeps its preregistered `-0.005` margin, requires positive live-to-final F1 with
more wins than losses, and stops on any reference-supported `year` or `product`
field regression.

## Development 100/150 and final validation

If the already-audited 100 are run for a development extension, they must be
analyzed separately with `--cohort-name audited100` and complete promotion plus
helpful-evidence labels before any merge. Their only passing decision is
`DEVELOPMENT_EXTENSION_PASS`; the run itself must bind
`--selection-role audited_development`. This closes the earlier hole where two thirds of
the 150 could be merged without manual review.

Likewise, `screen50` can only return `DEVELOPMENT_SCREEN_PASS`, and
`development150` can only return `DEVELOPMENT_POPULATION_PASS`. None can
produce a confirmatory advancement, regardless of F1.

`CONFIRMATORY_PASS_FINAL_VALIDATION_REQUIRED` establishes a confirmatory
evaluation candidate. The separately preregistered final validation and real
TCG/non-TCG trace workflow remain required before production promotion. Cost is
reported in currency only when the caller supplies current, nonnegative input
and output prices; otherwise the report states token usage only.
