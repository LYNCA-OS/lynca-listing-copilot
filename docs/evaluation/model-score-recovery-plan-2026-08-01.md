# Luna model-score recovery plan — 2026-08-01

## Decision boundary

The objective is not to maximize recognition at any cost. It is to maximize

`expected semantic quality − model cost − latency cost − long-term maintenance cost`

subject to four hard constraints:

1. one authoritative CSM / embedded SEM contract;
2. no Cloud Run, vector database, generic OCR sidecar, web search, or second model in the default path;
3. model output may express observations freely, but only evidence-supported values enter canonical brackets;
4. every candidate change must beat the current path on a paired holdout or be removed.

## Accuracy ratchet: open evidence first, canonical authority last

“Remove constraints” must apply to the model's **evidence bandwidth**, not to
production authority.  The contrary design—allowing free observations to write
CSM fields immediately—can raise recall while making the experiment impossible
to audit: a correct token and a wrong semantic role become indistinguishable.
The higher-confidence design is a one-way ratchet with four separately scored
boundaries:

1. **Expression:** Luna may return exact text or an explicitly labeled
   world-knowledge hypothesis plus image, region, source, uncertainty, and a
   broad advisory kind. The expression response has no canonical fields and
   the advisory kind is not authoritative.
2. **Permissive evaluation projection:** an isolated candidate title may use a
   proposed value so that recall/F1 can be measured.  It is explicitly not a
   production CSM object.
3. **Offline resolution:** replay the same paid response while deterministic
   rules learn which evidence/role combinations are useful.  No second model
   call is needed for each resolver iteration.
4. **Canonical admission:** only a rule that wins on a later paired cohort,
   introduces no critical false promotion, and stays inside the marketplace
   contract may acquire production field authority.

This keeps two kinds of value distinct.  A response format can be a positive
**learning asset** when it retains useful evidence even before title F1 moves;
it becomes a positive **runtime asset** only after the end-to-end candidate
beats the current canonical path after cost, latency, and critical errors.  A
Stage-A result with useful new evidence but no current resolver gain therefore
means `RESOLVER_WORK_REQUIRED`, not “the model saw nothing” and not automatic
production promotion.

Some constraints remain from the first experiment: exact-copy provenance,
bounded output/cost, uncertainty, checkpoint isolation, and zero production
mutation.  Field legality is tightened later; experimental integrity is never
deferred.

## Durable local paid-eval path

Use `scripts/run-thin-path-eval.sh` for paired quality experiments and
`scripts/run-local-csm-concurrency-eval.sh` for node-isolated concurrency
screens. The ignored `.env.local` file is the single credential source and contains
`OPENAI_API_KEY`, `SUPABASE_URL`, and the modern `SUPABASE_SECRET_KEY`.
Both wrappers use the same 255-card blind asset manifest. They sign the stored
source images in Supabase and, when the selected mode requires it, call OpenAI
Responses directly; Cloud Run, vector retrieval, and OCR are not part of this
execution graph.

Keep each experiment in its own `--out-dir`. A checkpoint may only be resumed
when its dataset, labels, model, effort, prompt/schema, image detail, and arm
configuration match. The quality harness now persists hashes of the dataset,
labels, prompts/schemas and relevant source modules and fails closed on a
fingerprint mismatch. A partial checkpoint may only extend its requested limit;
it may not silently shrink or change the experiment.

The opposing design — add more prompt rules and validators — is cheaper to type,
but it has repeatedly converted recall errors into silent information loss. The
higher-confidence design is a permissive observation boundary followed by a
small, deterministic CSM admission/composition boundary.

## What the stored 150-card experiment actually proves

This is a zero-provider-cost counterfactual over existing Luna outputs, not a
new model run.

| Comparison | F1 | Paired outcome | Interpretation |
|---|---:|---:|---|
| free title | 0.731708 | — | high recall, low precision |
| free title → current CSM parser/composer | 0.761687 | 88 win / 53 loss / 9 tie, p=0.00403 | filtering free expression is useful |
| current canonical, recomposed | 0.774611 | — | fair current baseline |
| canonical + admitted free evidence | 0.778908 | 34 / 28 / 88, p=0.526 | +0.004297 is not yet distinguishable from noise |

Therefore “expression augmentation is positive” is too broad. The supported
claim is narrower: projection improves an unconstrained title, but merging all
free evidence into an already canonical result has not passed the asset gate.

## All 53 negative rows: earliest loss boundary

| Earliest boundary | Cards | Helpful token occurrences | Meaning |
|---|---:|---:|---|
| parser | 31 | 50 | the model said it, but v1 assigned no SEM meaning |
| admission filter | 13 | 15 | SEM proposed it, but evidence anchoring rejected it |
| marketplace profile | 13 | 17 | team/search terms were deliberately suppressed |
| 80-character drop | 1 | 2 | `Blue Refractor` lost at the budget boundary |
| composer normalization | 2 | 3 | TCG number formatting removed `063/089/242` forms |

Rows can lose tokens at more than one boundary, so card counts are not
additive. The full row-level records are emitted by
`scripts/measure-free-title-csm-projection.mjs`.

The lossless parser v2 preserves all 50 parser-lost occurrences in an evidence
ledger with source offsets. It promotes zero of them to canonical fields. This
is a real information-retention improvement, but it has zero measured F1 gain
until a resolver safely assigns those spans.

## Cheapest model-side recovery order

### Gate A — no additional provider cost

1. **Observation-first response schema.** Let Luna return quoted evidence spans
   with an open label plus its canonical proposals. Unknown spans remain
   evidence-only. This targets incomplete product/set names, `lotx3`, RC/Auto,
   and other content the model already saw but the closed schema discarded.
2. **Prompt subtraction ablation.** Remove one redundant instruction group at a
   time. Keep only changes that improve paired CSM/SEM score without raising
   critical hallucinations. Do not assume a shorter prompt is automatically
   better.
3. **Resolver for high-support spans only.** Start with exact anchored product
   extensions. Keep serial syntax (`9/10`, `027/150`, `/499`) append-only until
   it has independent visual corroboration; two copies of the same reading in
   one model response are not independent. Never infer a value merely because
   a token exists.

These changes preserve one Luna call at reasoning `none` and image detail
`high`. They are the first experiments because their marginal runtime cost is
approximately zero.

#### Measured six-card bounded-evidence mechanism result

The first `bounded-evidence-v2` mechanism probe stopped after six paid calls.
All six completed on their first attempt, but the resolver produced no title
gain (0 wins / 0 losses / 6 ties), only three of six pre-registered product
targets reached the canonical product channel, and one stamped-number overlay
was critically wrong: the original-resolution image reads `07/10`, while the
response asserted `1/10`. The response did place one additional `VeeFriends`
target in the legal canonical `set` field, which is useful diagnostic evidence
but does not justify changing a pre-registered product-channel gate after the
result.

This result rejects v2 as a 50-card treatment, not the expression-first
strategy. Its append-only ledger remained copy-only and was explicitly framed
as small, exceptional, and "empty is better than noise", so it still compressed
semantic hypotheses such as `VeeFriends` and `Leaf Metal Draft`. The next
mechanism arm should return a standalone bounded open-set candidate channel,
not another canonical object with a residual ledger. It retains the proposed
phrase, visible or model-knowledge basis, image provenance, and uncertainty,
and gets no CSM/SEM or renderer authority during the capture test.
See `docs/evaluation/bounded-evidence-v2-mechanism6-result-2026-08-01.md`.

The standalone candidate-first v3 then recovered 5/6 mechanism identity
targets, including Common Sense Cow's visible `VeeFriends`, while preserving
zero canonical or production authority. It still missed `Draft`, emitted zero
model-knowledge candidates, and filled 88 slots with substantial company,
slogan, game-statistic, and duplicate noise. It therefore also stopped before
the confirmatory cohort. V3 used 26.1% fewer total tokens than v2 despite 51.5%
more output tokens, so future cost gates bind total tokens/cost rather than
output tokens alone. The next isolated mechanism is a small visible ledger
followed by an explicit identity-synthesis ledger; finish and serial remain
separate hypotheses. See
`docs/evaluation/candidate-expression-v3-mechanism6-result-2026-08-01.md`.

### Extreme diagnostic — remove all semantic and commercial compression

The `exhaustive_observation_high` and `exhaustive_observation_original` arms
ask Luna to enumerate every visible fact as an evidence item. Labels are
open-set and may be `unknown`; exact text, slash forms, leading zeroes, region
and confidence are retained. This arm is evaluation-only and never enters the
production route.

Pair it with `thin_canonical_high` on the same cards. The analyzer assigns each
reference-helpful token missing from the final canonical title to one earliest
operational class:

1. absent even from exhaustive output — candidate perception/expression miss;
2. present in exhaustive output but absent from canonical fields — closed
   schema compression/routing loss;
3. present in canonical fields but absent from title — downstream composition
   or budget loss.

“Absent from exhaustive output” still does not prove the model is physically
incapable of seeing the token; it proves that removing the known constraints
did not make it express the token. The paired `high` / `original` run then
tests whether input resolution changes that boundary.

#### Measured 100-card extreme result

The completed checkpoint contains exactly 100 `thin_canonical_high` rows and
100 `exhaustive_observation_high` rows with no duplicate pair. Of 296
reference-helpful missing token occurrences, the earliest observed boundary is:

| Earliest boundary | Occurrences | Affected cards | Share |
|---|---:|---:|---:|
| not expressed even by exhaustive | 170 | 77 | 57.4% |
| exhaustive expressed, canonical schema did not retain | 73 | 53 | 24.7% |
| canonical fields retained, composer did not emit | 53 | 37 | 17.9% |

Affected-card counts overlap: 16 cards hit all three boundaries and only 4
cards have no missing token at any boundary. The 170 exhaustive misses are led
by parallel/process terms (47) and product/set/IP terms (39), together 50.6%.
Serials (18), years/seasons (16), RC/Auto attributes (15), rarity (11), colors
(8), lot notation (4), and team (1) form the remaining structured recovery
pool.

These are token-level upper bounds, not 296 proven visual failures. Synonyms,
writer spelling, leading-zero normalization, and a token mentioned in the wrong
semantic role can inflate them. Exhaustive output is a candidate evidence
ledger, not a title source: it emitted 4,803 observations, 96.71% marked High,
and an average 129.82 unique tokens per card that appear in neither the
reference title nor canonical fields.

For the 53 downstream occurrences, 25 were explicit drops, 14 explicit
suppression, 4 lacked a lot-grammar bracket, and 10 were silently omitted.
Only the last 10 first require composer observability work; restoring all 53
would knowingly violate the marketplace grammar.

The full manual ledger is in
`docs/evaluation/extreme-observation-high-100-loss-audit-2026-08-01.md`.
It reduces the raw 73 schema-compression occurrences to 37 directly useful
occurrences on 29 cards; the direct-only oracle ceiling is `+0.021623` macro
F1. Nineteen more require catalog/world constraints, eight are already-covered
synonyms, and nine are wrong-role collisions. Full exhaustive output is
therefore retained as a diagnostic arm, not a runtime response format.

### Gate B — same call count, variable image-token cost

Run a paired `high` versus `original` image-detail experiment on the exact same
cards. Original detail can plausibly recover small print — years, serials, card
numbers and rarity marks — but it can also cost more and add visual noise.

Screen on 50 stratified cards; advance to the 150-card holdout only if the
direction is positive and critical hallucinations do not increase. Record
input tokens, latency, field-level wins/losses and image dimensions. Do not use
the old 10-card `high` versus `auto` result as evidence for `original`.

#### Measured 50-pair image-detail result

Stop this cohort at 50 and keep `high`. The 100 source images are all JPEG,
all have a long edge at or below 1400 px, and no image exceeds 2048 px. Every
pair used the same image set and reference; `high` and `original` consumed the
same 257,744 input tokens in total and the same 5,402 median input tokens.

| Metric | high | original | original minus high |
|---|---:|---:|---:|
| F1 | 0.785553 | 0.771224 | -0.014329 |
| Recall | 0.746874 | 0.735977 | -0.010898 |
| Precision | 0.843872 | 0.825844 | -0.018028 |
| median latency | 6,146 ms | 4,802 ms | -1,344 ms |

`original` won 5 pairs, lost 11 and tied 34; the two-sided sign test is
`p=0.2101`. This does not prove `high` is statistically superior, and it is not
an equivalence result. It does show no positive quality evidence for
`original` in a cohort with no high-resolution headroom. The 11 losses include
wrong year/season, color/parallel and component changes; all 7 SP/SSP references
were missed by both arms. `original` was about 20% faster in this run, but that
is a separate latency hypothesis requiring a repeated, order-controlled test.
Reopen image-detail testing only with a targeted cohort containing genuinely
large images, especially long edge above 2048 px.

### Gate C — selective extra inference only

Only after A and B fail to close a specific field gap, allow a second Luna look
for cards whose first response explicitly marks a small-text field unreadable
or low-confidence. Send only the original/crop needed for that field. The
escalation rate, extra cost and field precision must be measured; never issue a
second call for every card.

### Gate D — more expensive models/reasoning

Test `low` reasoning, then a stronger model, only on the hard subset remaining
after A–C. A global upgrade is rejected unless its paired quality gain is worth
its full-batch cost and latency.

## Hosted capacity boundary

The local proxy screen is not a production concurrency measurement. The
isolated Vercel Preview control admitted 5,600 lightweight Luna requests across
14 parallel shards with 5,600 successes and no 429, 5xx, or network error; a
real-image input control admitted 100/100 at concurrency 100. This proves the
old browser limits of 2/6 are artificial, but it does not make 5,600 real card
calls useful.

The 50-card canonical-high arm averaged 5,262.30 total tokens and 6.19986
seconds. Under the observed 4M TPM quota, the theoretical card throughput is
about 760/minute and Little's-law in-flight population is about 79. Production
screening should therefore use real canonical calls at global targets
60/80/100/120 and select the smallest target that reaches the token-throughput
plateau without unacceptable tails or duplicate paid retries. See
`docs/evaluation/hosted-concurrency-capacity-2026-08-01.md`.

## Where the reported missing words belong

| Missing content | Cheapest plausible intervention | What will not solve it |
|---|---|---|
| serial forms (~19) | deterministic anchored span resolver; then original detail | world knowledge |
| `lotx3/lotx4` (5) | expression normalization | more image resolution |
| incomplete product/set (large share) | open evidence spans + catalog/registry candidate verification | tighter closed schema |
| parallel/process names (47) | registry/catalog candidates checked against visible evidence | player-team world graph alone |
| years/numbers (42) | original-detail paired test; temporal consistency check | generic title post-processing |
| colors (37) | high/original comparison; selective crop only if uncertain | text catalog alone |
| RC/Auto attributes (32) | open evidence spans and anchored normalization | larger world model |
| rarity marks (17) | original-detail and exact symbol/number evidence | generic web retrieval |
| team/league (5) | temporal subject-affiliation graph as contradiction detector | unconditional team injection |

These are word occurrences, not unique cards, and categories overlap. They are
experiment targets, not additive promises of recovered F1.

## World-model upgrade boundary

The world model should be a versioned temporal graph:

`subject → affiliation/team → valid interval → sport/league`, plus
`release/set → product/manufacturer → valid interval`.

Every edge needs source, confidence and version. It may enumerate candidates,
reject impossible year/team combinations, or request review. It must not
overwrite visible card text. The existing player/team snapshot is unsuitable
for promotion because values such as `rookie` and `raw` contaminate the team
field, and a prior world-knowledge experiment reduced unseen F1/recall by
0.006349 while adding 9.73% tokens and produced a critical year/product
hallucination.

## Promotion and rollback rule

For each experiment, preserve per-card and per-field deltas, critical-error
counts, provider tokens, latency and cost. Promote only when the paired holdout
passes the predeclared quality floor and no hard-error gate regresses. A
short-term negative experiment may remain as learning evidence; a runtime path
with negative long-term expected value is removed, not hidden behind a flag and
allowed to accumulate maintenance cost.
