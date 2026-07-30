# What blocks launch

For Codex. Route decision is made: **all-cloud**. Local/Mac is not the target.

Nine blockers. Each states what closes it, who can close it, and what evidence
counts. Ordered by whether launching without it would ship something wrong, then
by cost.

Governance unchanged (`docs/brief-the-road-to-day-one-naming.md` §0): the result
is required, the route is negotiable, a dead path is reported with its evidence
and followed by the next route — and a number that cannot be obtained honestly
is reported as missing, never manufactured.

---

## B1. The same card gets two names — CORRECTNESS BLOCKER

**Do not launch past this one.** Everything else is speed or coverage; this is
the product being wrong in front of a buyer.

```
same asset, re-recognised within one hour, identical deployed code
  identity agreed   50.3%   (3,345 pairs)
  title agreed      12.4%
prompts of byte-identical size
  identity agreed   53.5%
```

`temperature: 0` is already set. Deploy drift is excluded by the window. Prompt
drift is real but secondary. In our own data this shows up as `luka dončić` and
`luka donči`, `dan marino` and `dan marino teal dolphins` — one card, two names,
an hour apart.

**Closes with:** the N30 contract you already built and never ran — same card,
30 serial runs, cache bypass, no replay, no whole-job retry, no provider retry,
one provider HTTP per run, byte-exact final title. Report the distribution, not
a verdict.

**Then:** if instability is in the model, the only defence is deciding once and
reusing the decision, which makes identity caching a requirement rather than an
optimisation. If it collapses under a byte-identical prompt, it is ours and it
is fixable. **Which of the two decides the whole caching design**, so this runs
before anything else.

**Owner:** you. I cannot run 30 provider calls.

---

## B2. GCP billing account is closed — USER ACTION

```
billing account 01836C-EC055E-6FDAF1   open: False
```

Consequences, all verified: Cloud Run rejects every write (`BILLING_DISABLED`),
OCR workers return `ocr_worker_unavailable`, the vector index is frozen at 587
rows last written 2026-07-06, and `/readyz` on the Vision worker returns 500
without reaching the container.

Nothing is accruing cost. Several things are quietly not running, and on an
all-cloud route the OCR lane is one of them.

**Closes with:** restoring or migrating billing. **Owner: Fei.** Not
recoverable by either of us.

**Do not** re-test Google Vision until this is closed — that was already agreed
and it still holds.

---

## B3. Legal Joint Gate has never run

Your own status: `PRODUCTION = NO_GO`, `LEGAL JOINT GATE = NOT_RUN`, and the
candidate architecture is "committed, pushed, not deployed — not production
evidence".

**Closes with:** the sequence you specified, in order — Phase 1 RegionEvidence
adapter, Phase 2 Development evidence recovery to ≥92%, Phase 3 legal offline
replay through Retrieval → Selection → Application → Resolver → Renderer,
Phase 4 one untouched Validation, Phase 5 one cold 20.

**Two caveats that are now live:**

- The gate hard-requires `google annotate = 1`. On an all-cloud route that is
  fine, but do not fabricate a Google call to satisfy it if the call did not
  happen.
- SIFT-consumed Validation-21 cannot be reused. Any new product model needs
  unconsumed G2 or a fresh independent Validation.

---

## B4. Unseen accuracy is 0.4056 against a target of 0.85

44 points, and **nobody has established where the loss is**. That is the actual
blocker — not the gap itself.

**Closes with:** attribution of the unseen failure by SEM module. I cannot do
it: the cohort-to-session mapping lives in your gate artifacts, and substituting
production-wide data for the unseen cohort would produce a misleading answer.

**What the attribution decides:**

- loss mostly in fields the card *does* state → a reading problem, and 85% is
  reachable
- loss mostly in product line and parallel proper nouns → 85% requires either
  emblem recognition or accepting descriptive forms in the score, and **that is
  a product decision, not an engineering one**. Surface it rather than optimising
  around it.

Relevant measured constraint: the product line is never text on a card, it is an
emblem. On unseen products the world engine cannot supply it either, by
definition of unseen.

---

## B5. Two PRs open, neither validated

| PR | contents | needs |
|---|---|---|
| [#151](https://github.com/LYNCA-OS/lynca-listing-copilot/pull/151) | vector retrieval disabled by default; OCR rendezvous wait capped at 2s, then zeroed when workers are provably unavailable | paired interleaved A/B, both scoreboards |
| [#152](https://github.com/LYNCA-OS/lynca-listing-copilot/pull/152) | world engine forwards, subject normalizer, derive-fields, second-look planner, parallel ladder, three corrected claims | offline replay first, then paired |

**What #151 predicts:** 3.5s recovered from vector (3,556ms average, 92.7% zero
candidates against a 587-row index), plus a tail of up to 22s from the OCR cap,
**with no accuracy change on either scoreboard**.

If accuracy moves at all, my reasoning is wrong and I want to know: I argued the
266 calls that did return candidates are not rescuing hard cards, because they
read a card number 58.3% of the time against 33.7% and retrieval keys on the
card number — entry condition, not payoff. On team and parallel the two groups
are indistinguishable (26.7 vs 26.5, 9.4 vs 9.3).

---

## B6. The gap queue: 3,090 open, and the classification was wrong

Reclassified today from the activation funnel rather than the stored label,
because the label disagreed with the data. Originals preserved in
`candidate_snapshot.reclassification`, reversible.

```
2,093  CATALOG_COVERAGE_GAP        (was 721 — 1,372 were mislabelled)
  929  CANDIDATE_CONFLICT_BLOCKED  (real conflict_blocked_count > 0)
   ~68 trust / post-observation blocked
```

Then the coverage gaps themselves split three ways, which is the part that
matters:

```
  985 (47%)  product-year ALREADY IN CATALOG   -> retrieval failure, do NOT backfill
  242        set field holds a known product   -> the set-as-product fix targets this
  808 (39%)  product never seen                -> genuinely missing, safe to backfill
```

**Backfilling all 2,093 would insert 130 product-years that already exist**, into
a catalog that already carries 8,640 duplicate identity rows. That makes
retrieval worse, not better.

**Three actions, in this order:**

1. Mark the 985 `RETRIEVAL_FIXABLE` — they close themselves once the retrieval
   fixes in #152 ship. Do not write catalog rows for them.
2. Backfill the 808. 88% carry year + product + subject; 97% carry a draft title.
3. The 929 conflicts stay open — `candidate_snapshot` records the funnel but not
   *which field* conflicted, so they are not actionable yet. That missing detail
   is worth adding at the point of blocking.

**Also relevant:** 95% of these ran at `participation_level: LEVEL_0_SHADOW`.
The candidate mechanism is wired and deliberately switched off, so it never had
authority to resolve any of them. Turning it on affects production titles and is
a decision for Fei, not a default.

---

## B7. derive-fields is built, tested, and running nowhere

The eighth and ninth instances of the pattern `ambition.md` names.

| module | measured | state |
|---|---|---|
| `constraint-enumerator` | team 65% to VALUE/EMPTY, product 14%→30% | **not wired** |
| `composeParallel` | `parallel` filled 0.8% → `Silver /75` | **not wired** |
| `deriveCardType` | supplies `sport`, which the provider is asked for 4,695 times and has returned 0 times | **not wired** |
| `card_identity_prototypes` | table + FK correct | **0 rows** |
| `catalog_parallels` | columns exactly right | **0 rows** |

`derive-fields.mjs` collapses the first three into one import and one call and
returns a `trace` plus `summariseDerivation`, so the wiring answers "was this a
positive asset" with a count. On seven production card shapes: 9 gaps filled, 1
correctly EMPTY, 2 honestly UNKNOWN.

**One caution earned today:** the first version of `deriveCardType` inferred
sport from the brand and typed Tom Brady on a 2000 Bowman Chrome card as
baseball, because Bowman prints football too. A wrong sport is worse than none —
it made the namesake filter reject his real career. Brands that span sports are
now absent by design.

---

## B8. Card number missing on 54% of cards

The largest single field gap, and it drives the economics of the whole two-stage
route: 2,714 of the 3,125 cards with any always-present gap are missing only the
card number; everything else together is under 20%.

**The deciding fact: 92% of the cards missing one had a back image in hand.** The
picture was there and the number was not read. That is an observation failure,
which a targeted crop is the right instrument for — had it been a missing-asset
problem, the second-look route would be worthless.

`second-look-planner.mjs` is the decision layer; your targeted assist executor
(2 originals, 4 crops, 3.5s deadline) is the mechanism. They have never been
connected.

---

## B9. Writer clock versus durable clock

Measured per row, 2,008 sessions:

```
handler total   21,908ms
  provider       8,573ms
  after provider 11,690ms
    vector         3,225ms   <- cut in #151
    OCR wait         136ms   <- cut in #151
    anchor           172ms
    the rest      ~8,000ms   persistence, queue completion, serialization
```

`recognition-critical-path-v1` excludes `V4_ADAPTER`, `SESSION_PERSISTENCE`,
`QUEUE_COMPLETION`, `HTTP_SERIALIZATION` — which is why your interval union
finds only 0.111s uncovered while a naive subtraction finds seconds. Both
numbers are right; they measure different things.

**So the remaining post-provider time is not waste, it is writing the result
down.** It should be hidden rather than compressed: `WRITER_TITLE_READY` split
from `ASSET_DURABLE`, exactly as your architecture already specifies.

**And the all-cloud upload floor, which no code change reaches:**

```
T = 8 × MB / Mbps
two 6MB originals @ 20Mbps = 4.8s
two 200KB browser-resized  @ 20Mbps = 0.16s
```

Client-side resize before upload is therefore mandatory on an all-cloud route,
not an optimisation. Originals continue in the background.

---

## Retracted today — do not reason from these

| claim | status |
|---|---|
| "10,841ms of latency is uninstrumented" | **mine, wrong, retracted.** Computed by subtracting non-nested spans; 29.5% of rows had a negative residual, so the quantity had no meaning |
| "~3s of fixed overhead" | **mine, wrong.** A regression intercept |
| "60.4% of set names uniquely identify a product-year" | measured on the harvest, never transferred; 14% on production, 30% with the product-name reading |
| "69.3% of model output is waste" | **falsified by your Task A** — the tokens were empty, the asking was not |
| "the 266 vector calls might be rescuing hard cards" | checked, they are not |
| "production storage signing may be broken" | **checked, it is not** — 266 verifications today, zero failures |

---

## Order of work

```
B2 (Fei: billing)  ──┐
B1 (N30 stability) ──┼─→ B5 (validate the two PRs)
B4 (unseen attribution) ─┘        ↓
                          B6 → B7 → B8
                                  ↓
                            B3 (joint gate) → cold 20
                                  ↓
                          B9 (writer clock split)
```

B1 and B4 are the two that unlock judgement rather than throughput. Both are
blocked on artifacts only you hold — 30 provider calls and the cohort mapping.

## What a launch decision needs, minimally

1. N30 distribution reported (B1)
2. Both scoreboards plus latency, paired and interleaved, on merged #151 + #152
3. Unseen loss attributed by SEM module, with the product decision surfaced if
   the loss sits in product line and parallel names
4. One cold 20 after Dev/Val both pass
5. Abstention rate reported as a first-class metric alongside the two accuracy
   scoreboards — the system still cannot say "I don't know", and shipping a
   confident wrong name is the failure mode we have measured most often
