# Listing Copilot launch closure and feasible recognition route

Date: 2026-07-30
Audience: Fei, Claude, Codex, and future maintainers
Scope: the latest all-cloud launch-closure work, the preceding nine-hour
architecture exploration, and the highest-confidence route that survives the
measurements
Production decision: **`NO_GO`**
Holdout consumed by this work: **false**

## 1. Decision first

The attractive claim is that enough Prompt, Queue, or concurrency work can make
the existing full-Provider path return every first-time card in two to three
seconds. The evidence rejects that claim. The full Provider alone has measured
p50/p95 `10.925 / 26.958 s`; it cannot fit a universal three-second
writer-visible deadline after upload, persistence, and delivery are added.
Increasing Provider concurrency changes throughput, not one-card service time,
and does not create information that the image or Catalog does not contain.

The route with the highest confidence is therefore:

```text
progressive immutable upload
        |
decode once; bind tenant + generation + side + content hash
        |
        +------------------------------------+
        |                                    |
one-shot role-bound literal OCR       open-set product-mark sensor
(one request / one annotate batch)    (query support only)
        |                                    |
        +------------------+-----------------+
                           |
        versioned in-memory Catalog Constraint Pack
                    VALUE / EMPTY / UNKNOWN
                           |
          Retrieval -> Selection -> Safe Application
                           |
                Identity Resolver (sole owner)
                           |
             deterministic <=80-char Renderer
                           |
            exact answer | review | abstain
                           |
       targeted model assist for named UNKNOWN fields only
                           |
           full Provider only as bounded final fallback
```

This architecture is not production-ready today. The fast sensor path is
physically plausible and the ownership contracts are now much stronger, but
the legal end-to-end joint accuracy gate has not run. The latest executable
cold exact-anchor numerator is `0/93`, and the current SIFT emblem sensor failed
its untouched Validation. Shipping it now would exchange a slow answer for an
unproven or wrong one.

## 2. Facts, inference, and judgement

### Facts

- Current full-Provider telemetry: p50/p95 `10.925 / 26.958 s`.
- The final Task A minimal-output candidate cut Provider p50 roughly in half,
  but regressed familiar token recall `0.787071 -> 0.717980` and unseen recall
  `0.482937 -> 0.405556`.
- Apple Vision read both verified sides of `142/142` Development cards at
  p50/p95 `205.624 / 293.798 ms` and surfaced `293/345 = 84.93%` of confirmed
  evidence fields.
- Raw OCR title-token recall in that same diagnostic averaged `76.59%`.
- Directly rendering OCR/Catalog output was catastrophic: the two contaminated
  diagnostic variants produced only `1/142` and `4/142` semantic-plus-deadline
  proxy passes, with `22` and `20` catastrophic titles.
- The Catalog Constraint Pack contains `55,968` product/set rows. It parses in `42.91 ms`,
  builds its immutable index in `327.97 ms`, and answers the measured local
  product/set queries at p50/p95 `0.303 / 0.355 ms`. The index adds about
  `38.2 MB` of heap and the benchmark process reached `125.4 MB` RSS;
  product-level queries returned `244 / 641` candidates at p50/p95, while
  set-narrowed queries returned `1 / 2`.
- The same Catalog Constraint Pack has no card-code entries: `0/55,968` rows have populated
  card arrays. It proves local constraint speed, not exact-card coverage.
- The independent exact-identity denominator is 148 identity groups:
  Development `118`, Validation `30`.
- Of those, 95 joined a qualifying cold trace and 93 executed exact-anchor
  shadow. Eligible fast finals were `0/93`; 90 had no lookup anchor and 3 lacked
  sufficient direct context.
- The current SIFT Product-mark sensor scored `15/21 = 71.43%` joint Product
  accuracy on untouched Validation, but only `1/4 = 25%` precision when it
  emitted a supported Product. It is `NO_GO`.
- Unseen-10 missing fields after the deployed baseline were: card number `10`,
  Product `9`, Year `5`, Set/Insert `4`, Subject `1`, Manufacturer `1`.
- The gap-queue audit accounts for 3,022 of 3,090 rows without granting any
  mutation authority: 985 retrieval diagnostics, 762 reviewed-internal Product
  confirmations, 73 set-as-product review candidates, 273 manual taxonomy
  reviews, and 929 conflict retraces. Another 68 rows remain unaccounted and
  fail closed.
- Production has 2,684 FINALIZED assets backed by 5,530 canonical-original
  verification rows. Every FINALIZED asset has a source-complete current
  generation; 21 have one original and 2,663 have two. No invalid or missing
  durability clock source was found in the read-only audit.
- GCP billing account `01836C-EC055E-6FDAF1` is closed. Cloud Run writes fail,
  the OCR service is unavailable, the Vector index is frozen, and a true Google
  Vision release canary cannot legally run.
- The live release is not source-aligned: `main` is
  `b27d6775a5335ad004b099d3969e01e5ada87e09`, while production reports
  `9be84ea45a79eb9377ca63d0a3d6dc64896a465d` on deployment
  `dpl_8TnKviaxQdWEf6yhi6kY2vxbf8gC`. This is an unconditional release-gate
  failure, independent of algorithm quality.
- The validator for a unified, exact-byte, attested launch packet exists, but
  its named aggregate producer workflow (`launch-release-packet.yml`) and
  accuracy producer (`launch-sem-accuracy.yml`) do not. Therefore a real packet
  cannot currently be produced and the release evidence is `INCONCLUSIVE`;
  passing unit fixtures do not change that fact.
- An adversarial audit proved that the earlier formal accuracy contract could
  accept 45 rows that confirmed only `language`, count duplicate or
  case-colliding identities, and ignore an arbitrary fabricated final title.
  Those paths are now rejected or made `INCONCLUSIVE`; no historical score was
  silently reclassified as a valid launch result.
- An OWNER/admin Writer Journey `EDIT` previously entered the same
  highest-priority writer-final replay path as a real writer correction. That
  could make the Journey's deliberately distinct test title suppress future
  recognition for the same image. The new migration fail-closes the trigger so
  only explicit inner `OBSERVE_ONLY` feedback can write that replay; admin,
  missing, and unknown dispositions cannot create or overwrite it.

### Inference

- Fast visual sensing is not the physical bottleneck: sub-300 ms two-side OCR
  is observed on a local sensor. The unsolved problem is converting evidence
  into a defensible identity without bypassing Candidate Application and the
  Resolver.
- A card-level global Catalog cannot be the only day-one route. Exact identity
  coverage is far below the required addressability, and newly released cards
  can precede a complete checklist mirror.
- A compact, versioned vocabulary/constraint pack remains useful because its
  lookup cost is effectively negligible and it can rule in/out Product and Set
  combinations without pretending to supply an exact identity.
- The Provider is still useful as a teacher, fallback, and targeted visual
  instrument. It is not useful as the mandatory first-answer clock.
- Upload and recognition should overlap. The writer clock is minimized by
  progressively finalizing immutable evidence, not by waiting for all files and
  then starting the Queue.

### Judgement

- Build and prove the one-shot OCR + replacement open-set emblem sensor route.
- Keep the full Provider auxiliary and bounded.
- Keep Resolver ownership and the <=80-character Renderer unchanged.
- Prefer an honest partial result or abstention to a fabricated proper noun.
- Do not run another fixed 20, N30, pressure test, or paid OCR experiment until
  the corresponding offline and external gates are legally open.

## 3. The theoretical optimum

### 3.1 Writer-visible first-time card

Independent work should overlap. The stage called `evidence_upload` in the
executable envelope already combines admission/durable intent with one
fetch/decode, so it must not be added a second time outside the parallel
branch:

```text
T_writer_after_click
  = max(
      T_remaining_original_upload,
      (T_admission + T_evidence_fetch_decode)
        + max(T_one_shot_ocr, T_product_mark)
    )
    + T_local_retrieval
    + T_selection_application
    + T_resolver_renderer
    + T_commit_and_delivery
```

This is a scheduling equation, not permission to combine marginal p50s as if
they were one observed joint distribution. The route needs per-card paired
timings before any planning envelope becomes an SLO.

The current evidence-grounded planning envelope after the writer click,
including admission intent, is:

| First-time addressable path | p50 | p95 | Status |
| --- | ---: | ---: | --- |
| One-shot OCR proxy + local decision | `1.89–2.64 s` | `4.27–5.62 s` | proxy, not observed card-level batch |
| Stretch design budget | `1.55–2.29 s` | `3.00–4.34 s` | requires OCR packet <=`1.0/1.85 s` |
| Existing capacity-one three-crop graph | `3.18–3.92 s` | `6.34–7.68 s` | model, not tail upper bound |

The nearest defensible planning target after the writer click is therefore p50
<=`2.7 s`, p95 <=`5.7 s`. The stretch target is p50 <=`2.3 s`, p95 <=`4.4 s`,
but has no status until a real one-card Google Vision packet observes p50/p95
<=`1.0/1.85 s`.

Those numbers apply only to an addressable fast-route card. At the deadline, a
card without sufficient evidence must publish a safe `REVIEW`/`ABSTAIN` state,
not a guessed complete identity. A targeted assist or full Provider may then
continue as a separately timed, bounded asynchronous fallback. Its later result
must not be counted inside the fast-route SLO or silently rewrite the initial
scoreboard. This plan therefore does not claim that every first-day card can be
fully named within `2.7/5.7 s`.

The complete first-time-card component budget is below. A range marked
`budget` or `model` is not production evidence, and component quantiles are not
an observed joint percentile.

| First-time stage | p50 | p95 | Evidence class and boundary |
| --- | ---: | ---: | --- |
| Commit admission intent + verify generation | `150–300 ms` | `300–600 ms` | design budget |
| Fetch/decode immutable evidence once | `100–250 ms` | `200–450 ms` | design budget |
| One-shot focused OCR packet | `1,343 ms` | `3,123 ms` | model from retained crop marginals; not a card-level batch observation |
| Product-mark branch | `130–180 ms` | `340–400 ms` | design budget from retrospective sensor; the current SIFT model is rejected and cannot satisfy this stage |
| Resident compiled lookup | `0.3–0.5 ms` | `0.4–1 ms` | measured on the 55,968-row Catalog Constraint Pack |
| Candidate control | `100–240 ms` | `250–490 ms` | design budget |
| Resolver + <=80-character Renderer | `50–150 ms` | `100–300 ms` | design budget |
| Idempotent commit + status delivery | `150–350 ms` | `300–650 ms` | design budget |
| **Componentwise critical path** | **`1.89–2.64 s`** | **`4.27–5.62 s`** | mixed planning envelope; not an observed SLO |

The resident lookup number excludes Catalog Constraint Pack startup: JSON parse plus
immutable index build measured `42.91 + 327.97 = 370.88 ms` once. A serverless
cold start or preload that reaches the writer must be included in the eventual
observed p95; prewarming cannot be used to erase it from the writer clock.

### 3.2 The upload floor

For data size `M` megabytes and uplink `B` megabits/second:

```text
T_bytes = 8 * M / B
```

Two 6 MB originals at 20 Mbps have a byte-only floor of `4.8 s`, excluding TLS,
URL signing, PUT verification, retry, and scheduling. Therefore universal
two-to-three seconds from initial file selection is physically impossible for
that input. With OCR overlapped under upload, the optimistic lower envelope is
p50 <=`5.6 s`, p95 <=`6.3 s` for that specific file-size/uplink assumption.
The correct product contract must expose or control input size before promising
a network-independent SLO.

### 3.3 Repeat immutable image

There are two distinct authorities. A globally reusable, sanitized AI terminal
result may deduplicate the same immutable image across tenants under the current
product policy, but it remains non-truth, idempotent content. A writer-final
correction is tenant-scoped authority and must never cross a tenant boundary.
When the applicable authority, immutable image identity, and complete
recognition pipeline fingerprint all match, the image must make zero paid
sensor calls. The architecture target is:

| Repeat path | p50 | p95 |
| --- | ---: | ---: |
| Writer-final / approved-memory / terminal-L2 exact replay | `0.19–0.53 s` | `0.40–1.05 s` |

That repeat-card envelope contains only these stages:

| Repeat stage | Must run | p50 target | p95 target |
| --- | --- | ---: | ---: |
| Verify already-computed generation hash | yes | `50–150 ms` | `100–300 ms` |
| Writer-final / approved-memory / AI-terminal authority lookup | parallel fixed authority | `20–80 ms` | `50–150 ms` |
| Hydrate immutable Resolver snapshot | yes | `20–50 ms` | `50–100 ms` |
| Idempotent status publication | yes | `100–250 ms` | `200–500 ms` |
| **Repeat route after verified image** | | **`190–530 ms`** | **`400–1,050 ms`** |

These repeat numbers are architecture targets, not observed percentiles. This
route must run no OCR, GPT, Catalog selection, or new Renderer decision.

The authority order remains:

```text
WRITER_FINAL_REPLAY
  -> APPROVED_IDENTITY_MEMORY
  -> AI_TERMINAL_L2_IDEMPOTENT_REPLAY
  -> FULL_RECOGNITION
```

An AI terminal replay is idempotence, not identity truth. It stays ineligible
for training and Catalog promotion. Within the writer's tenant, writer-final
must override the older AI replay. One tenant's edit must not globally tombstone
a sanitized AI replay unless a separate reviewed-global invalidation owner
authorizes that change.

### 3.4 Intermediate addressability gate required for 85%

The deadline-and-precision equation is:

```text
joint_success
  = addressable_coverage
    * P(correct | addressable)
    * P(deadline | addressable and correct)

required_addressable_coverage
  = 0.85 / (0.99 * 0.95)
  = 0.903775
```

On the independent 148-card identity denominator this means at least `134/148`
addressable groups, with split gates of `107/118` Development and `28/30`
Validation. The current executable numerator is `0/93`; even an illegal
truth-fed core-compatible union of 29 cards would leave 119 of 148 groups
unaddressable and remain 105 groups short of the required 134. This is why
micro-weight tuning cannot close the launch gap.

This `134/148` calculation is an intermediate viability gate for the proposed
fast route, not the executable launch accuracy contract. Final activation still
requires one sealed holdout of at least 45 cards with SEM card-exact accuracy
`>=0.87` (excellent at `>=0.90`), reviewed field truth, and leakage validation.

### 3.5 Throughput and the 100-card writer case

The writer's target of at least six cards per minute is a flow target, not a
reason to increase the full-Provider limit. By Little's Law, for target arrival
rate `lambda = 6/60 = 0.1 cards/s` and average occupied service time `W`:

```text
required_concurrency >= lambda * W
```

At a `2.7 s` addressable fast-route service target, the theoretical occupied
capacity is only `0.27`, so one continuously utilized fast lane can exceed six
cards/minute. A second lane is useful as redundancy/tail absorption, not because
the math demands more GPT slots. Conversely, a mandatory `10.925 s` Provider
needs at least `1.0925` continuously occupied slots before Queue gaps, retries,
or tails; two slots are only just enough in the ideal median case and cannot
remove the `26.958 s` p95. Provider concurrency remains frozen at two until the
route changes; the speed win comes from lowering the fraction of cards that
need those slots.

For a 100-card upload, the browser must not hold all work behind the last file:

```text
commit immutable 100-position intent
  -> progressively upload/finalize each card
  -> enqueue each finalized card immediately
  -> keep at most 8 writer-visible cards in the active review window
  -> accepting/editing one removes it and promotes the next ready card
```

Clicking “generate recognition” authorizes the whole committed batch. The first
ready card may enter recognition while later uploads continue; later cards join
the same durable Queue as they become valid. UI copy should say only that the
cards are in recognition. The intake ledger, not an in-memory File list, owns
the durable denominator and restart state. This avoids both a 100-file barrier
and the false impression that the writer must wait for all uploads before useful
work begins.

## 4. What the experiments actually taught us

### 4.1 Full Provider and Prompt compression

The full Provider cannot be the universal fast path. Task A nevertheless tested
the strongest compression hypothesis legally with paired, interleaved arms.

| Final Task A cohort | Baseline recall | Minimal contract | Delta | Baseline Provider p50 | Candidate p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Familiar 10 | `0.787071` | `0.717980` | `-0.069091` | `8,847.5 ms` | `4,265 ms` |
| Unseen 10 | `0.482937` | `0.405556` | `-0.077381` | `5,908.5 ms` | `3,648.5 ms` |

The long request checklist was not mere waste. Removing fields caused values
that remained in the schema to disappear: surface color 12 more times,
manufacturer 9, set 8, and card name mismatched 11. The request-side sparse
Prompt family is permanently `NO_GO`; do not retry it with wording patches.

The retained value from Task A is structural only: true-only booleans,
multi-card-count validation, explicit VALUE/EMPTY/UNKNOWN transport, and
deterministic forward-enumeration provenance. Those improve ownership without
changing the production Prompt.

### 4.2 World knowledge

Mixing model memory into the only visual-observation call was rejected. In the
hosted unseen experiment, the mixed Prompt produced no independently admissible
knowledge evidence and created a catastrophic identity regression:
on one deciding card, `2024 Panini Phoenix Rookies Caleb Williams #151` became
`2020 Prizm Caleb Williams RC Chicago Bears`.

World knowledge is now physically separate and may only propose
query-expansion candidates for typed UNKNOWN Product/Team fields. It has no
image, Resolver, title, or truth authority. Its paid executor remains off. This
does not prove model knowledge is universally harmful; it proves unchecked
model memory cannot be identity evidence and cannot perturb the visual sensor.

### 4.3 OCR

The local Apple Vision result proves the reading stage can be fast. It does not
prove that Google Vision has the same distribution or that the result can be
legally assembled into an accurate title. The required cloud experiment is one
role-bound batch per card:

- one Cloud Run request;
- one Google `images:annotate` request;
- front Subject region plus back Year/Product and Card-code regions;
- explicit request count, Vision unit count, unique download/decode count,
  provider attempt count, confirmed billable units, and unknown-billing flag;
- no whole-job retry and no hidden Provider fallback in the sensor measurement.

The cloud gate must observe p50 <=`1.35 s`, p95 <=`3.15 s`, visible-field
precision >=`99%`, card-code critical false positives `0`, role leaks `0`, and
technical errors <`1%`. The `1.0/1.85 s` line is a stretch budget, not the
baseline pass criterion.

### 4.4 Product mark

On the deciding Panini Phoenix sample, Phoenix is presented as an emblem rather
than readable text. Better OCR alone cannot recover that Product from that
sample; this does not establish that every Product mark on every card is
non-textual. The first SIFT prototype was extremely fast but failed
open-set Validation: Product emission precision `25%`. It must not support
Retrieval or title output. Do not retune it on the consumed Validation-21.

The replacement needs Development-only training/freeze, independent official
G2 images, explicit open-set rejection, and zero critical false positives. Its
output remains query support, never a title fact.

### 4.5 Catalog and local Catalog Constraint Pack

The Catalog is valuable in two different ways:

1. exact identity, when one independently attested card row exists and current
   image evidence uniquely binds it;
2. constraints/vocabulary, which are much smaller and age more slowly.

The first is a secondary lane, because the current card-level exact identity
attestation is `0/148`. The second is the main deterministic support lane because
it is fast and can express VALUE/EMPTY/UNKNOWN without inventing proper nouns.
Neither lane may render a title directly.

### 4.6 Retrieval, Selection, and Application

Earlier Oracle results showed three separate downstream losses:

- Retrieval: correct identity in Top-20 was only `13/45`;
- Selection: when present, the correct candidate was selected only `3/13`;
- Safe Application: measured correct opportunities applied `0/10`.

Those numbers are historical diagnostics and were not reused as a legal tuning
denominator. The new work fixes replay provenance and the Candidate Application
connection before any weight tuning. More candidates or a larger Top-K cannot
substitute for independent identity truth.

### 4.7 Scheduler paths tested and rejected

The scheduler evidence does not justify a Persistent Consumer or more Wake
patches. The two runs below are different cohorts and must never be summed or
treated as one experiment:

| Evidence set | What it measured | Result | Decision |
| --- | --- | --- | --- |
| Sealed 2026-07-24 production cold-20, Actions run `30087244187`, artifact `reviewed-cold-20-report`, source `01841fb`, deployment `dpl_5x3zV25Ap9NxyrCJmGvMhBXFimTv` | `20/20` L2; raw Provider idle `184.301 s`; confirmed runnable-backlog Wake gap `73.576 s`; upstream pre-Provider `82.281 s`; release-unconfirmed `21.840 s` | Six cards/minute required `75.897 s` recovery, so confirmed Wake time missed by `2.321 s` | Persistent Consumer `NOT_PROVEN`; do not build it or pay for another run to reconstruct missing lease history |
| Later task-provided reviewed fixed-20 summary; referenced evidence archive is not present in this checkout | `20/20` L2 at `3.236 cards/min`; Provider slot held before Provider about `123.457 s`, p95 `19.410 s`; total slot idle `479.509 s`, including retry/prior-attempt `240.737 s`; reaching six cards/minute required about `170.860 s` recovery | Late binding alone and Wake consumption alone were both insufficient; retry/prior-attempt was the largest attributed class | Context only until its immutable artifact is recovered; do not use it as release evidence or merge it with the sealed run |

The frozen engineering conclusion is narrow: Provider concurrency stays `2`;
do not build a Persistent Consumer; do not add another Wake path. A Late
Provider Lease Binding canary becomes eligible only when versioned telemetry
shows enough recoverable held-before-Provider time and the canary has no
accuracy, duplicate-execution, or reliability regression. Stage-level retry
checkpoints remain higher ROI than replaying a whole card after a downstream
persistence failure.

## 5. Structural work completed in this launch-closure branch

### Launch evidence and SEM safety boundary

The formal accuracy source contract was hardened after an adversarial audit
proved that `44/45` could previously pass while one confirmed Product was
wrong. The source now enforces all of the following before an accuracy artifact
can be launch-eligible:

- numerical rarity preserves the numerator (`2/3 != #/3`);
- a nonempty critical prediction against `UNKNOWN` or `NOT_APPLICABLE` is an
  overclaim and a fabrication;
- a wrong or missing `CONFIRMED` critical identity field makes that card
  catastrophic; a nonempty conflicting value is a fabrication;
- all overclaim, fabrication, and catastrophic counts must be present and zero;
- only a `release-set-v1` `CORE_HOLDOUT` can carry launch authority; legacy
  `golden-sem-partition-v1` remains diagnostic even if its score is perfect;
- the release set uses a canonical full-content digest that binds split, truth
  policy, images/content hashes, field values/statuses, evidence source IDs and
  hashes, reviewer, and review time;
- every formal row must explicitly classify all 15 launch SEM fields, prove
  `subject + (product or manufacturer) + (year or card number)` coverage, and
  carry a canonically unique independent `identity_group_id`; the minimum 45
  denominator is measured in independent identities rather than rows;
- canonical item IDs must be unique after whitespace/case normalization, and
  prediction rows must form an exact one-to-one set with the frozen dataset;
- the prediction artifact binds its canonical digest, exact deployment SHA,
  recognition pipeline fingerprint, Catalog revision, and every row to the same
  versions; its schema is exactly `golden-sem-prediction-run-v1`;
- every prediction includes frozen `listing-renderer-replay-v1` input. The
  existing deterministic Renderer is rerun offline, its version and <=80-char
  output must match exactly, and title-critical fields are checked against the
  reviewed field truth rather than inferred from the reference title;
- the health endpoint exposes the server-owned active recognition pipeline
  fingerprint and database-owned active Catalog revision. The assessor binds
  both, plus deployment SHA, to verified live `main`/production provenance;
  missing live values are `INCONCLUSIVE` and mismatches are `FAIL`;
- report status, launch eligibility, counts, denominator, and six-decimal rate
  must agree rather than being caller assertions.

These are source and fixture proofs, not a production Accuracy PASS. The
independent `launch-sem-accuracy` producer and upstream source attestation do
not exist yet, so the real dimension remains `INCONCLUSIVE`. Familiar/unseen
minimums, maximum abstention, and first-time/exact-replay latency thresholds
also remain unfrozen contracts; no value was invented for them in this branch.

### B1 — Same-card stability contract

The N30 runner now enforces cache bypass, one Provider HTTP per item, no replay,
no whole-job retry, exact deployed SHA, and byte-identical final-title
comparison. Its paid authorization is a two-lock protocol:

1. a permanent exact-SHA consumption tag;
2. a one-attempt tag bound to `github.run_id + github.run_attempt`.

An attempt-1 artifact or tag cannot authorize attempt 2. If the authorization
consumer fails without issuing the current-attempt tag, N30 exits immediately
and fail-closed instead of polling for an hour. Official GitHub Actions are
pinned by full commit SHA. The workflow was not executed in this branch; paid
evidence remains `NOT_RUN`.

The current read-only GitHub control-plane snapshot supports the source
boundary but is not run evidence: `main` requires strict `offline-tests`, branch
protection applies to administrators, linear history and resolved conversations
are required, and force-push/deletion are forbidden. Ruleset `20036840` is
ACTIVE for immutable `eval-same-asset-n30-*` tags with no update, delete, or
bypass path. The `launch-attestation` environment exists, is restricted to
`main`, and currently contains no secrets.

### B4 — Unseen SEM attribution

The deployed unseen baseline remains `0.4829366`; the rejected Task A candidate
is not the baseline. Thirty correct fields were absent from both Provider
evidence and standard Retrieval, dominated by Card Number and Product. The
current source replay carries Resolver `ABSTAIN` and writer `DEEP_REVIEW` on
`10/10`, repairing the older source-level serialization defect without claiming
production deployment proof.

### B6 — Gap disposition

The 3,090-row gap population is no longer treated as one automatic Catalog
backfill. The checked-in builder emits a deterministic review/replay packet and
hard-codes zero Catalog writes, zero automatic closes, zero identity truth, zero
training eligibility, and zero holdout consumption. Newly generated candidate
conflicts now carry bounded field/reason detail; historical conflicts still
require version-matched replay.

### B7 — Derived evidence and RegionEvidence

Forward enumeration now preserves typed VALUE/EMPTY/UNKNOWN evidence and emits
versioned provenance. RegionEvidence carries side, crop, source image, tenant,
generation, and content binding. It is Shadow/evaluation by default. Consumer
mode requires verified current-generation lineage and cannot accept a stale or
cross-tenant path, a self-labelled model observation, or terminal output as its
own proof.

Replay no longer treats post-application terminal fields as current-image
observation. A versioned pre-application Provider/OCR snapshot is required;
when absent, the result is UNKNOWN and fails closed.

Five independently reproduced side doors were then closed in source. This tree
has not been deployed, so no observed production result changed; Selection and
Product Correction are output-affecting when reachable and can suppress unsafe
application, so merge requires exact replay and pipeline-fingerprint validation:

1. a Forward packet can no longer certify itself by changing a VALUE and
   recomputing its public SHA; the adapter re-derives the packet from its
   original claim/model under module-private out-of-band authority;
2. Decision Trace uses a path/schema-aware typed projector, so long natural
   language cannot hide in `metadata.reason`, `metadata.value`, `unresolved`,
   or similarly named generic JSON fields;
3. the candidate snapshot has a content digest, exact current-image binding,
   and a process-private `WeakMap` capability. A co-persisted JSON manifest is
   audit data, not authority. Missing process authority forces every candidate
   to Shadow and makes Selection/Application fail closed;
4. derived crops require exact crop role/region, front-or-back side, transform
   version, source dimensions, normalized bounds, and matching pixel bounds;
5. Product correction now consumes only decision-eligible, conflict-free
   candidates that can support evidence; an Official candidate with direct
   Manufacturer/Product conflicts remains visible in trace but cannot overwrite
   Resolver fields.

### B8 — Second-look targeted observation

The planner and executor are connected only under evaluation authorization.
The route is current-image and field-specific, allows at most one paid call,
has no internal retry, uses a local semaphore that fails if busy, and records a
complete typed ledger. It does not alter production titles. Trace persistence
uses an allowlist and strips arbitrary natural-language response content.

### B9 — Writer intent and two clocks

The writer can commit a batch denominator atomically before all files finish
uploading. The durable ledger predeclares every position, supports progressive
asset/Queue reconciliation, distinguishes writer-ready from asset-durable, and
keeps all operational rows ineligible for identity truth, training, and Catalog
promotion.

Canonical owners remain:

- `listing_assets` owns immutable image-generation durability;
- `v4_recognition_jobs` owns Queue admission and L2 readiness;
- `v4_recognition_sessions` plus feedback event own writer completion;
- the intake ledger is a projection and never manufactures those states.

Queue reconciliation requires exact tenant/operator/asset identity, exact
intake batch/item tags, a final-assisted-title job, and a job clock no earlier
than the committed intake. One canonical job/session can bind only one intake
item. A canonical tagged job wins a cancellation race; a cancelled projection
cannot erase paid work that already committed. Browser crashes have explicit
resume/abandon semantics rather than silently replacing the active pointer.

The final independent Writer Intake review reproduced and closed seven concrete
failure modes:

1. an orphaned `ASSET_ADMITTED` position can reach `CANCELLED` after a
   zero-accepted/permanent Queue failure while retaining its canonical asset
   provenance;
2. browser `idempotency_key` values are stripped and cannot fork the
   server-deterministic job identity;
3. `clientTiming` / `client_timing` are telemetry and are excluded from the
   immutable Queue identity, so a response-loss replay does not conflict merely
   because its local duration changed;
4. pair slots are grouped before file-format filtering, so one unsupported file
   cancels its original card position instead of shifting every later side;
5. asset-mode radios are disabled and resynchronised to server/UI state while a
   destructive transition is locked;
6. public `priority`, `not_before`, `max_attempts`, attempt, and retry controls
   are stripped and default to priority `100`; only authenticated internal or
   evaluation paths may retain them, while a separately verified manual retry
   can receive its server-owned priority;
7. before Queue persistence, one CAS reserves the exact deterministic final job
   and predecessor. The reservation remains until canonical projection clears
   it, closing zero-accepted, response-loss, input-rebind, and alternate-job
   fork races.

The migration backfills existing FINALIZED clocks only from the maximum
verification time of the complete current canonical-original set and fails
closed if any row lacks that proof. It was exercised on native PostgreSQL 17.10
with one- and two-image histories, transition immutability, a 100-item
atomic batch, idempotence, and truth-boundary assertions. The positive schema
checker passed, all 14 tamper variants were rejected, and a real orphan row was
observed moving from `ASSET_ADMITTED` to `CANCELLED` with
`OPERATOR_ABANDONED_INPUT` while its asset ID remained intact. Production
migration, PostgREST reload, and the real Writer Journey remain unexecuted
release gates.

The Writer Journey now performs a real, distinct admin `EDIT`, then reads the
session back and requires a server-side persistence proof. Its database
boundary is separate from normal writer authority:

- migration `20260730120000_admin_test_writer_final_replay_isolation_v1.sql`
  tombstones only an active replay row that is still sourced by an
  `ADMIN_TEST_ONLY` feedback event; a later legitimate correction is preserved;
- the replacement trigger writes writer-final replay only for an explicit
  inner `OBSERVE_ONLY` dataset disposition;
- a bounded service-role-only proof RPC verifies the feedback, learning,
  session, generation hash, and no-active-admin-replay invariants;
- the production schema checker attests the migration checksum/history,
  function owner, `SECURITY DEFINER`, fixed search path, ACL, fail-closed body
  ordering, exact trigger, remediation index, and zero active admin-test replay
  rows in one repeatable-read, read-only transaction;
- deployment remains blocked both before and after application if this exact
  schema contract is absent. The migration has passed PostgreSQL 17.10 and
  simulated CI external-service tests, but has not been applied to production.

The last hidden client-side Provider selector was also removed. Writer
submission now depends only on explicit server workflow readiness, and Queue
concurrency comes from server `execution_control` with a safe fallback of one.
This restores the existing rule that `writer-assisted-v1` is server-owned and
an algorithm/provider choice cannot silently gate transport in the browser.

## 6. Boundaries that this work freezes

1. Resolver is the final field owner. No OCR, Catalog, cache, world-knowledge,
   or exact-anchor component may create a title directly.
2. Renderer stays deterministic and capped at 80 characters.
3. Strategy and transport remain separate: a strategy experiment cannot change
   Asset, Queue, Storage, UI, or Renderer contracts.
4. Cold Algorithm, Exact Replay, and Production Workload are different profiles
   and cannot share scoreboards.
5. A shadow/evaluation-only owner version does not invalidate production cache;
   an output-affecting owner version must enter the unique pipeline fingerprint.
6. EMPTY and UNKNOWN never collapse. Missing coverage is not negative evidence.
7. Current-image evidence must bind tenant, generation, image/crop lineage, and
   content hash. A natural-language snippet alone is not provenance.
8. Writer-final authority beats every AI cache entry.
9. One fixed cohort is not rerun after it passes unless the chain changes
   materially. Holdout remains sealed until the final legal gate.
10. A release PASS is not an experiment PASS, and an offline PASS is not a
    production Writer Journey PASS.

## 7. What remains before launch

### External hard block

GCP billing must be restored or the all-cloud OCR service must be migrated to a
legally runnable account. No more Google Vision calls should be attempted while
the account is closed.

### Source/release gates

1. Finish independent P0/P1 review of the integrated branch.
2. Pass full offline CI, migration tests, dependency audit, and schema-contract
   checks on the exact commit.
3. Merge through the protected `main` branch; do not merge stale PR #151 or
   #152 independently after this integrated branch supersedes their useful
   changes.
4. Apply the two database migrations in a separate, exact-main,
   history-aware maintenance workflow and in exact order: writer-intake
   `20260730065921`, then admin-test replay isolation `20260730120000`. The
   preflight requires the exact pending set and checksums; the postflight must
   pass both schema attestations before the application deployment can move.
   The application deploy itself remains read-only against the database.
5. Keep the absent independently owned accuracy producer and unified
   `launch-release-packet.yml` producer fail closed. Build them in a separate PR
   only when the real source artifacts exist. The accuracy producer must read
   the registered frozen manifest, materialize and hash the actual image and
   evidence bytes, verify reviewer authority and split independence, execute
   only isolated `recognition_input`, produce the canonical prediction run
   itself, and sign the raw manifest, predictions, and report. It must never
   sign arbitrary uploaded JSON. Until then, attested release evidence is
   structurally `INCONCLUSIVE`.
6. Resolve the current `main` / production SHA mismatch. Deploy the exact
   `main` SHA only after the cloud OCR block is resolved.
7. Pass the repository-owned production Writer Journey with real login Cookie,
   real images, upload, enqueue, Queue, Worker, L2, accept/edit, and persistence.
   The source contract now requires a distinct `EDIT`, a completed Worker node,
   a session read-after-write linked to the feedback event, and explicit proof
   that the administrator test result is ineligible for training and production
   promotion. The Journey does not mutate `launch_ready`; the independent
   assessor may return true only when this Journey and every other launch
   dimension pass.
8. Freeze an executable writer-visible latency contract only after observing
   first-time cold and exact-replay distributions on the final route. The
   current throughput assessor records writer-ready p50/p95 but does not gate
   them, so it cannot yet prove an acceptable latency SLO. The planning budgets
   in this report are not launch thresholds.

The engineering Journey for the shadow/infrastructure commit is not the final
launch Journey. Any later algorithm activation changes the SHA and pipeline
fingerprint, so the activation commit must be deployed and the exact-production
Journey rerun before the <=24-hour release packet is assembled and attested.

Authenticated Playwright HAR and trace archives are intentionally not uploaded:
they can retain cookies, signed URLs, and request bodies. Failure evidence is
limited to typed stage state, correlation IDs, and a masked post-login
screenshot. This is a deliberate security deviation from the original PR3
wording; it trades raw request-level debugging detail for credential safety.

### Algorithm gates

1. Run Development one-shot OCR, then exactly one untouched Validation cohort.
2. Replace the rejected SIFT Product sensor and evaluate on independent G2.
3. Join sensor evidence through Retrieval, Selection, Application, Resolver,
   and Renderer; report both familiar and unseen scoreboards plus abstention.
4. Require addressability `>=134/148`, split `>=107/118` Development and
   `>=28/30` Validation, with the stated precision/deadline conditions. This is
   a route-viability gate, not the final launch accuracy denominator.
5. Only after the joint gate passes, run one cold paired 20 with cache bypass.
6. Use Development/Validation, cold-20, and exact-replay observations to freeze
   first-time and repeat writer-visible SLO thresholds in the fail-closed launch
   benchmark. This contract must land in the activation tree; adding it after
   deployment would change the SHA and invalidate later evidence.
7. Freeze the output-affecting activation tree, land it through protected
   `main`, deploy that exact `main` SHA, then run the sealed final holdout once
   through the independent accuracy producer: at least 45 cards, SEM card-exact
   `>=0.87`, reviewed field truth, and leakage validation. Do not tune on it.
8. After pressure testing is reopened, the exact release must pass throughput
   checkpoints `100/500/1000` at `>=6 cards/min` and availability `>=0.999`,
   plus reliability on at least 1,000 cards and three tenants with full tenant
   isolation measurement and zero lost, duplicate, missing, nonterminal, or
   isolation violations.
9. Run N30 only when its exact-SHA paid gate is authorized and the external
   Provider is available. Do not turn it into a recurring benchmark.

Pressure testing remains intentionally deferred until the recognition and
writer-intake chain is structurally mature. Throughput evidence cannot repair a
wrong or unprovable title contract.

## 8. Highest-ROI execution order

```text
P0/P1 source review
  -> local PostgreSQL 17.10 migration/schema tests
  -> full offline CI/security audit
  -> protected PR and exact-main merge
  -> production writer-intake migration + PostgREST schema reload
  -> restore/migrate cloud OCR capability
  -> milestone A: exact-main shadow/infrastructure deploy
  -> engineering Writer Journey on that exact SHA
  -> one-shot OCR Development/Validation
  -> replacement emblem sensor G2
  -> legal joint accuracy gate
  -> one cold paired 20
  -> freeze fail-closed first-time/replay latency gates from observed data
  -> freeze the output-affecting activation tree
  -> land it through protected main
  -> milestone B: deploy that exact activation SHA
  -> run the one sealed >=45-card final holdout on that exact release
  -> reopen and pass exact-release throughput/reliability gates
  -> rerun the real production Writer Journey on the activation SHA
  -> assemble and attest all <=24-hour launch dimensions
  -> N30 only if same-card instability remains an open diagnostic
```

The most important negative instruction is equally concrete: do not add more
Prompt patches, increase Provider concurrency, expand Top-K, build a permanent
consumer, or run pressure tests to make the current route appear faster. None
of those changes the measured information or latency boundary.

## 9. Verification and exact release identity

The integrated source branch is
`codex/launch-blockers-all-cloud-20260730`. Before the final integration commit,
its committed tip was `bb55fd003154f3848a750d9d9ed59da3e87ded82` and it
contained the 15 intentional no-full-Provider/launch-closure commits above
`origin/main`. A current fetch on 2026-07-30 proved that `origin/main` remains
`b27d6775a5335ad004b099d3969e01e5ada87e09` and is an ancestor of the branch;
the branch is not a divergent reconstruction.

The live production identity was also re-read after the implementation and has
not moved: deployment `dpl_8TnKviaxQdWEf6yhi6kY2vxbf8gC` reports source
`9be84ea45a79eb9377ca63d0a3d6dc64896a465d`. It does not expose the newly
required active pipeline fingerprint or active Catalog revision. Therefore the
current release fails exact-source identity and its Accuracy dimension is
`INCONCLUSIVE`; the source tests below do not promote it.

| Stable integrated-tree verification | Result | Boundary |
| --- | --- | --- |
| `npm test` | PASS, exit 0 | full offline JavaScript/Python suite; fixture verdict branches are not production PASS evidence |
| `npm run check` | PASS, exit 0 | full static/source contract check |
| `npm run test:launch-closure` | PASS, exit 0 | no paid sensor or external evaluation |
| `npm run test:launch-benchmark` | PASS, exit 0 | includes adversarial thin-truth, ID collision, duplicate prediction, fabricated title, and live-version attacks |
| `npm run test:cloud-listing-api-eval` | PASS, exit 0 | source/evaluation contracts only |
| `npm run test:production-engineering` | PASS, exit 0 | deterministic 1,000-job state-machine model ran; this is not hosted pressure evidence |
| Writer Intake PostgreSQL test | PASS on PostgreSQL 17.10, no skip | 14/14 schema tamper cases rejected |
| Admin replay isolation PostgreSQL test | PASS on PostgreSQL 17.10, no skip | normal writer replay preserved; admin/missing/unknown denied; ACL and remediation proven |
| Admin production schema contract | PASS | 7/7 tamper cases rejected |
| Four changed GitHub workflows | `actionlint` 1.7.12 PASS | no workflow syntax finding |
| `npm audit --audit-level=high` | 0 vulnerabilities | complete dependency graph |
| `npm audit --omit=dev` | 0 vulnerabilities | production dependency graph |
| `git diff --check` | PASS | no whitespace defect |
| secret/generated-artifact scan | PASS | no real secret, `.env`, HAR, trace, archive, screenshot, coverage, or build output in the change set |

The dedicated Track C PostgreSQL Queue reliability suite remains intentionally
unrun because `TRACK_C_TEST_DATABASE_URL` is absent and pressure testing is
deferred. Its deterministic 1,000-job scheduler model did run and pass, but it
is not a substitute for the hosted database test. No production database,
Provider, Google Vision, fixed 20, N30, or deployment was touched.

The validated implementation is commit
`28b903118923a948e9a734b731e6e31e42d9a176` in Draft PR
[#154](https://github.com/LYNCA-OS/lynca-listing-copilot/pull/154), targeting
the exact `main` base above. The PR is a published review candidate, not a
production release. At creation, required `offline-tests` and `contract` CI
were still running; skipped production Writer Journey/attestation jobs were
expected because the PR is Draft and the external gates remain closed.

## 10. Evidence index

- `docs/reports/no-full-provider-feasible-speed-2026-07-30.md`
- `docs/reports/day-one-correct-route-and-latency-budget-2026-07-29.md`
- `docs/reports/no-full-provider-joint-speed-evidence-2026-07-30.json`
- `docs/reports/no-full-provider-product-mark-untouched-validation21-v1-2026-07-30.md`
- `docs/reports/cardjoin-addressability-2026-07-30.json`
- `docs/reports/card-level-release-pack-audit-2026-07-30.json`
- `docs/reports/release-pack-memory-index-benchmark-2026-07-30.json`
- `docs/reports/provider-output-contract-paired20-2026-07-29.md`
- `docs/evaluation/world-knowledge-call-isolation-2026-07-29.md`
- `docs/evaluation/world-knowledge-unseen10-2026-07-29.md`
- `docs/evaluation/provider-aux-route-shadow-2026-07-29.md`
- `docs/reports/2026-07-30-unseen10-sem-attribution.md`
- `docs/reports/2026-07-30-catalog-gap-coverage-reclassification.md`
- `docs/reports/2026-07-30-writer-intake-finalized-clock-source-audit.md`
- `docs/brief-what-blocks-launch.md`

## 11. One-sentence handoff

The correct next system is not a faster version of the mandatory full Provider;
it is a provenance-bound, one-shot visual sensor feeding a local constraint
pack and the existing Candidate/Resolver owners, with exact replay above it and
targeted/full Provider below it as explicit fallbacks—and production stays
`NO_GO` until that exact chain passes independent accuracy, migration, cloud,
and real Writer Journey gates.
