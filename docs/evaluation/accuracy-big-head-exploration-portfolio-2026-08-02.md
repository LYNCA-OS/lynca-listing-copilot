# Accuracy big-head exploration portfolio — 2026-08-02

## Decision

The opposing case is to keep accumulating individually lossless replay rules.
They are cheap and the retained bundle is positive, so they remain frozen as a
fallback. They are not the main research program: the current combined
candidate is `0.785051`, the gap to `0.90` is `0.114949`, and the full measured
rule bundle contributes only `+0.018124`. Repeating that class of work cannot
plausibly close a gap `6.34x` larger.

The exploration objective is therefore:

> Maximise independent fresh-150 title F1 by increasing useful information at
> the image/observation/candidate boundaries, subject to zero critical factual
> mutations, one Luna call, an 80-character final title, and bounded latency and
> token cost.

No proposal below has Production authority. A large oracle is not a positive
asset; it is only permission to build a falsifiable experiment.

## First-principles model

The path is an information channel:

`source pixels -> model observation -> typed candidates -> compatibility
ranking -> CSM/SEM -> Composer`

The audited perfect-restoration ceilings identify where information is lost:

| Earliest boundary | Audited occurrences | Perfect restoration ceiling | Delta from current candidate |
|---|---:|---:|---:|
| Model/exhaustive did not express | 255 | `0.878026` | `+0.092975` |
| Schema did not retain | 109 | `0.818167` | `+0.033116` |
| Composer did not emit | 63 | `0.805929` | `+0.020878` |
| All missing occurrences restored | 427 | `0.923252` | `+0.138201` |
| All reference-absent candidate tokens removed | 285 | `0.856724` | `+0.071673` |

The last two rows prove that neither recall nor precision can reach `0.90`
alone. A viable architecture needs new upstream information and a safer joint
decision. Composer-only work is not a current accuracy head.

## Exploration portfolio

### A. Effective visual pixels, not a detail flag

#### A1. Edge evidence sheet in the same Luna call

- Keep the front and back originals.
- Deterministically build one 2x2 sheet from the top and bottom regions of both
  sides. Do not OCR, sharpen, label, or invent pixels.
- Send `front + back + evidence sheet` in the same request.
- Intended recovery: exact serial/numbered-print and printed marker text first;
  finish and colour are secondary hypotheses.

Why it can be large: 52 audited upstream-missing occurrences on 47 cards are
serial/marker, and the wider geometry-sensitive pool is 186 occurrences on 112
cards. A serial edge occupying roughly 15% of the source receives about 6.4x
the image-area budget when shown separately.

First gate: a six-card engineering preflight proves different request bytes,
transform SHA isolation, image validity, and <=40% treatment input-token
growth. It is not an accuracy screen. If it passes, use paired cloud fresh150.

#### A2. Real high-resolution `high` versus `original`

The retained fresh150 is not a real original-image cohort: all 300 objects are
1400px JPEGs with a common encoding profile. Its measured `original - high`
delta of `-0.014329` cannot answer whether 3000-8000px phone originals help.

Build a separate image-backed cohort whose original longest side is at least
3000px and whose original file SHA is retained. Compare paired `high` and
`original`; do not rerun this question on the 1400px cohort.

#### A3. Card-boundary normalisation

Measure card occupancy, rotation, blur, and glare before implementing anything.
Only if a material cohort slice wastes pixels on background or orientation,
test deterministic deskew/tight-card framing as one additional view in the
same call. A quality score may route an input; it may not reject a valid upload
or create a second model call.

### B. Same-call observation capacity

#### B1. Literal typed observation lane

Add a zero-authority response section after canonical fields, with independent
capacity for:

- complete identity phrases;
- literal printed markers;
- exact stamped serials;
- printed parallel phrases or explicitly labelled visual-pattern cues.

Rows retain source region and provenance. They are candidates only: no direct
CSM, Composer, persistence, or Production admission. This tests whether the
canonical schema is causing self-censorship without letting free expression
become final title authority.

Existing bare/canonical complementarity bounds the opportunity: 44 bare wins
contained 85 correct incremental occurrences; 38 were already in canonical
raw fields, 36 mapped to known-but-empty fields, and 11 were parser-unassigned.
The raw union is a negative asset (`-0.055811`), so the experiment must measure
typed capture rather than concatenate words.

#### B2. Two-candidate hypothesis beam

As a separate arm, allow at most two mutually exclusive candidates for
ambiguous Product/Set/Parallel roles, each with `region`, `basis`, and no
canonical authority. This asks Luna to expose its internal world knowledge
instead of collapsing uncertainty into one guess.

The beam is not bundled into B1 by default. Existing retained outputs can
measure pollution and output cost, but only a same-call paired run can show
whether it recovers information that bare and exhaustive prompts both omitted.

#### B3. Phrase-and-role compiler

Resolve complete phrases such as `Star Wars`, `Trainer Gallery`, full product
hierarchies, and `Pick 2`. Token fragments, biography text, uniform colours,
statistics, copyright text, and unsupported numeric roles remain candidate or
rejected. This compiler is evaluated only after B1/B2 create new candidates;
running it against the current pool is polishing a dry well.

### C. A small, falsifiable world model

#### C1. Exact slab-certificate anchor

The exhaustive fresh150 output contains one unambiguous 7-12 digit
`certification_number` on 37/150 cards, with zero multi-number conflicts. Those
37 cards already score `0.865142`, versus `0.758826` on the other 113, so the
slab label is demonstrably useful rather than a universal missing path.

The remaining opportunity is still material as an upper bound:

- restoring all 71 audited missing occurrences on those 37 cards while keeping
  every current token gives global `0.803063`, or `+0.018012`;
- making only those 37 cards perfect gives global `0.818316`, or `+0.033265`;
- removing every reference-absent token only on those cards gives `+0.014804`.

These are label oracles, not registry forecasts. The local schema already
defines an exact `(grader, cert_number)` registry whose result remains a
candidate and requires current-image agreement. No local evidence currently
proves that the registry contains useful rows, and live row coverage was not
queried. Therefore the next gate is data coverage, not resolver code:

1. capture grader and cert number as zero-authority slab observations;
2. measure exact registry hits and field completeness;
3. replay only fields returned by a unique reviewed hit;
4. reject on any current-image identity contradiction.

No fuzzy lookup, vector neighbour, or cert-derived current-copy serial is
allowed.

#### C2. Source-versioned compatibility graph

Represent candidate relationships, not encyclopaedic prose:

- subject/character <-> team, league, or IP;
- year/season <-> manufacturer and product;
- product/set <-> release and parallel vocabulary;
- parallel <-> denominator or printed marker where officially documented.

Every edge has source, source version, effective interval, and confidence.
Absence is `UNKNOWN`, never false. The graph may reject an impossible
combination or rank candidates; it may not overwrite exact visible text.

The current official graph is too sparse: only 5 of 150 cards have a unique
exact join. More resolver code against this asset is STOP until coverage is
materially larger.

The completed relation audit makes the deficit concrete. The local official
asset has 143 required records but only 15 product-set pairs and zero
product-parallel, set-parallel, or product-set-parallel tuples. Current world
relations correct one final-title token on one card; the replacement oracle is
only `+0.000606`. Treating missing subject-year or product-year edges as
negative evidence would falsely reject `28.0%` and `34.7%` of covered correct
values. Therefore current assets are STOP for accuracy promotion and all
future coverage remains positive-support-only.

#### C3. Joint compatibility ranker

Rank a whole candidate tuple rather than approving fields independently. A
candidate wins only when visible evidence and the compatibility graph agree;
conflict produces a generic safe title or a traceable unresolved candidate.
The ranker is useful only after B1/B2 supplies alternatives and C1 has coverage.

#### C4. Correction-to-asset learning loop

Long-term, convert accepted writer corrections into field-level candidate
facts with image/session lineage. Promotion requires repeated independent
evidence or an official source, and evaluation splits are isolated by physical
card and capture session. This is how the world asset compounds without turning
one writer edit into global truth.

### D. Measurement truth and reachable ceiling

The reviewed title is confirmed title ground truth, but not field ground truth.
Reference-absent tokens may be wrong facts, legal-but-omitted terms, synonyms,
or terms dropped by the 80-character convention. Before treating precision
cleanup as factual correction, classify the 285 extra occurrences into:

- visibly/semantically wrong fact;
- valid fact omitted by the writer;
- CSM/COS suppression or budget choice;
- redundant synonym;
- cannot determine without image/field review.

If writer-choice noise is material, calibrate a small stratified subset with a
second independent writer and field labels. This does not inflate the model's
score; it tells us whether `0.90` is a reachable product target under the
current metric.

The 285-row precision ledger now gives the minimum calibration workload:

- 33 occurrences / 26 cards are clear same-role factual conflicts; deleting
  all of them has a label oracle of only `+0.007838`;
- 86 / 57 have positive visible or official support but were omitted by the
  writer; blind deletion would add `+0.019401` to title F1 while potentially
  erasing true evidence;
- 12 are Composer redundancy, 12 are spelling/tokenisation style, and 142 are
  unresolved reference absence;
- no current combined token violates the measured COS/TCG suppression rule.

Writer B therefore reviews only the 285 disputed occurrences across 117 cards
(`2.44` per card), blind to Writer A's title and model confidence, and labels
`VISIBLE_TRUE / FALSE / OPTIONAL_TITLE / REQUIRED_TITLE / UNKNOWN`. Writer A
only reviews B-confirmed omissions and unknowns; a third reviewer handles
explicit disagreements. No one rewrites all 150 titles.

## What the old nine-hour exploration contributes

The reusable discovery is not the old OCR/vector/catalog architecture. It is
the causal evidence:

- the fat path lost `9.05pp` to the bare model on 255 paired cards and spent far
  more tokens and latency;
- catalog/vector assistance added no measured accuracy and increased
  hallucinations;
- anti-hallucination prompt rules suppressed Refractor/Prizm/Holo vocabulary
  after their candidate-based release condition had been disabled;
- asking for full serial numerators changed the serial behaviour but not title
  F1 because the 80-character budget made the trade zero-sum;
- schema and authority must be separated: canonical structure is valuable, but
  it must not erase observations before they can be resolved.

Those results directly motivate A/B/C and forbid restoring the old services.

## Portfolio gates

1. Zero-cost first: offline coverage, request-byte fingerprints, parser and
   provenance tests, title replay, adversarial numeric/product cases.
2. Do not count mechanisms. Only orthogonal mechanisms with a plausible
   `>= +0.003` title-F1 contribution enter a paid bundle.
3. Image/observation changes require paired cloud runs because replay cannot
   simulate a model seeing new pixels or a new response schema.
4. Fresh150 promotion gate per arm: `>=8` wins, `0` losses, no critical
   numeric/identity drift, no unrelated-field regression, no title over 80.
5. Paid bundle and control must be contemporaneous, order-balanced, separately
   checkpointed, and request-byte-distinct.
6. No Production consideration before a later independent cloud-simulated
   fresh150 reaches `>=0.90` with zero critical factual errors.

## Current ownership

| Workstream | Deliverable |
|---|---|
| Visual information | Source-image audit, evidence-sheet prototype, high-resolution cohort contract, cost/latency bounds |
| Same-call expression | Literal-lane coverage oracle, optional hypothesis-beam arm, contract harness and pollution audit |
| World/precision | Extra-token truth ledger, compatibility-graph coverage, minimum useful asset expansion, ranker screen |
| Integration | Cross-stream Pareto ranking and the smallest justified paired fresh150 design |

Provider calls in this exploration brief: 0. Production/runtime changes: 0.
