# Exploration Ledger — 2026-08-05

> **Correction — 2026-08-09:** Arm E's live runner passed
> `asset_id::arm` to a corpus keyed by sealed-label identity. A zero-call audit
> found exact-self or near-duplicate exposure on 9/255 cards (including eight
> exact own-title exposures). Its reported `+0.0051`, `9/7/34`, and “zero
> leaks” conclusion are **VOID and non-promotable**, not a positive signal.
> See [`evaluation/kfold-few-shot-live-identity-correction-2026-08-09.md`](./evaluation/kfold-few-shot-live-identity-correction-2026-08-09.md).

What was tried to raise recognition accuracy, what it measured, and why each
thing is not being pursued. Written so someone who was not here can decide
whether to re-open any of it.

Everything below is a paired measurement on sealed reviewed titles. Nothing is
an opinion about what should work.

---

## Where accuracy actually stands

255 sealed reviewed cards, scored under the current ruler
(`sem-equiv-1+ced5663c6ec7`):

| Cohort | raw token F1 | equivalent F1 |
|---|---|---|
| 150 cohort | 0.7891 | **0.8170** |
| 105 holdout | 0.8078 | **0.8371** |
| **Combined 255** | **0.7968** | **0.8253** |

`raw` scores against the writer's exact string. `equivalent` applies the
founder-adjudicated equivalence rules — synonyms, season spans, abbreviations,
safe finish degradation. The gap between them, +0.0285, is metric blindness that
has been removed, not pipeline improvement.

**Reference point:** writer self-agreement is about **0.929**. Two competent
writers given the same card disagree roughly 7% of the time, so 0.93 is a hard
ceiling for "match one writer's string" no matter what is built.

---

## How the remaining loss is distributed

578 missing tokens and 346 extra tokens across 255 cards, bucketed by what
would have to change to fix them:

| Bucket | Share | Cards | What would fix it |
|---|---|---|---|
| A — resolved into a field, never printed | 17.8% | 71 | Composer priority / 80-char budget |
| B — spelling or word-split difference | 2.8% | 14 | Ruler, free |
| C — synonym not credited | **0.0%** | 0 | Nothing left — ruler has no synonym debt |
| D — writer trade knowledge | 3.6% | 21 | Corpus only |
| **E — genuinely missed or wrong** | **75.8%** | 194 | Recognition |

The ruler side is 6.4% in total. **There is almost nothing left to win by
adjudicating the metric.** Three quarters of the loss is recognition.

> A first version of this classifier put 23.9% in bucket C and would have made
> "more ruler work" the headline recommendation. It was wrong: it filed every
> wrong colour as an un-credited synonym, because it asked whether the token was
> in the synonym vocabulary rather than whether we had emitted another form of
> the same class. `scripts/audit-residual-loss.mjs` now prints examples for every
> bucket for exactly this reason.

---

## Field ceilings — what a PERFECT answer is worth

Measured by substituting the reference's own value and rescoring. A cheating
upper bound: no implementation can beat it. Free to compute, so it runs before
any paid experiment.

| Field | 150 cohort | 105 holdout | Population | Verdict |
|---|---|---|---|---|
| `print_finish` | **+0.0365** | **+0.0249** | 96 / 55 cards, 27 / 15 right | largest |
| `serial` | +0.0161 | +0.0109 | 82 / 56 cards, 53 / 42 right | above drift |
| `card_number` | **+0.0000** | **+0.0000** | **3 / 0 cards** | **worthless here** |

Measured run-to-run drift is **0.009**. An effect smaller than that cannot be
told apart from running the same arm twice.

`scripts/measure-field-ceilings.mjs`

---

## Rejected: prompt changes

All on 50 paired cards, alternating per card, `effort=low`, `detail=high`. The
only variable is the wording.

| Arm | Δ F1 | W/L/T | p | Verdict |
|---|---|---|---|---|
| B — loosen "printed" to "visible evidence"; drop "colour alone is a good answer" | **-0.0063** | 5/11/32 | 0.21 | rejected |
| C — permission to name the parallel family from the product line | **-0.0092** | 9/15/26 | 0.31 | rejected |
| D — four constructed filled examples | **-0.0017** | 7/11/32 | 0.48 | rejected |
| E — k-fold few-shot from the real 255 corpus | +0.0051 (reported) | 9/7/34 | 0.80 | **VOID: live identity leak** |

### Why B and C failed, and it is the same reason

**Relaxing the literal discipline costs transcription.** Both arms produced the
same class of regression:

```
082/100 -> 82/100         a dropped leading zero
PSA 10  -> PSA 9          a misread grade
2024    -> 2023           a wrong year
Willie Mays -> W. Mays    a compressed name
""      -> Blue Shimmer   an invented finish; the truth was Crystallized
```

Arm C is the sharper result because it lost on the field it was built to fix:
finish hits 11 → 12, finish errors 3 → 5, serials exact 14 → 13. It bought one
right answer for two wrong ones.

**`"Read this trading card and report what is printed on it"` is not a defect.
It is load-bearing** — it is what keeps serials, grades and years exact. The
model spends any licence it is granted globally, not on the field the licence
named.

### Why E cannot be resolved on this corpus

**2026-08-09 correction:** this section preserves the original power analysis,
but it no longer describes admissible evidence. The live identity mismatch
allowed answer-bearing examples into some prompts, so there is no valid effect
size to power. Re-running requires the sealed/physical identity and a manifest
hash over every card-keyed request.

+0.0051 is positive and is the only positive result of the four. It is also
unreadable: at 9W/7L the win share is 56% and 68% of cards are ties, so
detecting it at p<0.05 with power 0.8 requires **1569 cards**. The corpus has
**255**.

Scaling up is not expensive here — it is arithmetically unavailable. The
framework computes this rather than guessing; the human recommendation before it
was "run 150 cards", which was wrong.

`lib/listing/evaluation/kfold-few-shot.mjs`, `docs/explorations/`

---

## Rejected: structured `serial`

The research report recommends extending the treatment that took grading exact
from 33/38 to 38/38 — splitting a compound scalar into its facts — to `serial`.

Measured: **+0.0015, 9W/10L/31T, p=1.000, serial exact 15 → 15.**

The number is the weaker half. The mechanism reading is the finding — the model
returned `serial_parts` on **50 of 50** cards:

| legibility | cards |
|---|---|
| READABLE | 24 — and the split value was byte-identical to the scalar on all 24 |
| no serial at all | 26 |
| **PARTIAL** | **0** ← the entire premise |
| **rescued by the split** | **0** |

A crisp denominator beside a scratched numerator did not occur once. **A stamped
serial is either legible or it is not**, so the split addresses a case this
corpus does not contain. The prompt clause it was meant to relax — leave the
field empty when EITHER number is unclear — costs nothing, because EITHER is
never the state.

This is why the mechanism is read and not only the delta. A +0.001 on its own
files as "structured serial did not help", which invites retrying it next
quarter. What is recorded is that there is nothing there to help.

---

## Not built: `card_number` structuring, and the ROI-crop Gate that depends on it

The research report sets a P0 target of `card_number exact recall +5pp` and
makes it half the success criterion for the ROI-crop experiment.

**A card number appears in 3 of 150 reviewed titles and 0 of 105.** Writers do
not publish it. A perfect answer is worth +0.000000 on this corpus, so no
experiment aimed at it can produce a reading, and half of that Gate is
unmeasurable as written.

The report's reasoning is sound. What it lacked is this corpus.

---

## Not built: cropping for the finish

With `card_number` gone, the obvious rescue for the crop direction was to aim it
at `print_finish`, which carries the largest field ceiling at +0.036. It does
not survive its own ceiling check.

A crop can only help where the model SAW something and judged it wrong. It
cannot help where the answer is what a product line calls its parallels, which
is not printed on the card at all — and permission to use that knowledge is
Arm C, already measured at -0.0092.

| | said-but-wrong (croppable) | said-nothing (product knowledge) |
|---|---|---|
| 150 cohort | 18 cards **+0.0126** | 15 cards +0.0078 |
| 105 holdout | 3 cards **+0.0011** | 14 cards +0.0146 |

The croppable half averages **+0.0068 against drift of 0.009**. Below drift means
a perfect crop could not be told apart from noise, at any price. The two cohorts
also disagree six-fold on how many cards are croppable at all — 18 against 3 —
so designing around either branch is fitting to one cohort.

One hypothesis died here: the closed `parallel_family` enum was expected to be
the constraint, having seen the model answer "Shimmer" where the truth was
"Crystallized", a word the enum lacks. **Of 21 wrong answers, 20 had the correct
word available in the enum and the model chose another.** The enum is not the
limit.

`scripts/diagnose-finish-failure-mode.mjs`

---

## Previously measured, re-confirmed, still rejected

| Direction | Result | Cost |
|---|---|---|
| Bottom-band region crop | +0.0048, 27W/19L, **p=0.302** | latency +47%, input tokens +24% |
| `image_detail` original vs high | 5W/11L — current `high` already wins | — |
| reasoning `medium` / `max` | latency-prohibitive; `max` ≈ 43s | writer budget is 6–8s |
| Catalog assist | accuracy unchanged 34/50, hallucinations +4 | — |
| Vector retrieval | unchanged 32/50, +5 | — |
| Multi-stage candidate pipeline | bare model **0.8334** vs thin pipeline 0.743 vs fat 0.759 | 147W/32L/76T for the bare model |
| Generalised auto-rotation | rotated cards were not below cohort F1; OCR orientation fired on 62 normal images | — |
| Emitting both synonym forms | "Auto Autograph" -0.0091 (7W/47L); "Rookie RC" -0.0027 (13W/29L) | — |

---

## Shipped this cycle, with evidence

| Change | Measurement |
|---|---|
| `reasoning=low` in `CSM_THIN_RUNTIME_CONTRACT` | +0.019042 on 105 (42W/18L, p=0.0027), +0.014190 on 150 |
| Structured `grading_info` | graded exact 33/38 → 38/38 |
| Lot marker `Lot*N` → `LotxN` (COS-49) | **+0.0916 on lot cards, 7W/0L, p=0.0156** |
| Bare colour is evidence, not canonical Print Finish (COS-49) | 65 canonical fields corrected, **0 titles changed** |
| Ruler: any year inside a season span is correct | previously only the opening year was credited |
| Ruler: a safe finish degradation ranks above a wrong claim | previously they scored identically |

---

## Instrument errors caught, and how

Six in one session. Recorded because the pattern matters more than any single
one: **an instrument that confirms the expected answer is the failure mode this
work is most exposed to.**

1. **A prompt prohibition read as a capability ceiling.** The exhaustive-
   observation arm was told *"Do not infer facts from general card knowledge"*,
   and its silence was reported as "the model cannot see it". The founder
   challenged it; the prohibition was in the prompt's own last line. This is now
   an automated probe.

2. **An arm's schema never reached the model.** `arm.responseSchema` was read in
   exactly one place — to fingerprint the run — and the request always used the
   hard-coded canonical schema. With `strict: true` the model could not return a
   new field even though the prompt asked for it. **Zero of 50 cards returned
   `serial_parts`.** Eighteen arms declare their own schema; all had been running
   the canonical one. One sentence from reporting a falsification of an
   experiment that had never run.

3. **A residual-loss classifier that inflated the ruler's share** from 0% to
   23.9% by filing wrong values as un-credited synonyms.

4. **An instrument warning that fired on its own success:** "0 losses" was
   flagged as a broken detector, when 0 losses is the desired result of a clean
   sweep.

5. **A loss audit that silently returned nothing** — `git diff-tree` produces no
   output on a merge commit, and the empty result was nearly read as "no
   losses".

6. **A ruler tested on synthetic strings too short to separate anything**, which
   made a working rule look broken.

---

## Bugs found and fixed on the way

| Bug | Impact |
|---|---|
| Glass Box read broken in four layers | the COS-42 inspector returned an empty trace for **every** card in production; its migration had also never been applied |
| `dropped_trace` composition receipt | four fields persisted as `undefined` on **both** branches; `deepEqual` was satisfied by two missing keys |
| Duplicate migrations | the same three migrations existed twice under two version stamps |
| `arm.responseSchema` passthrough | see above |
| `api/csm-resolution-view.js` unclassified | shipped without an API access-contract classification |

---

## What the evidence supports next

Not a recommendation to try another prompt. Eight mechanisms have now been
measured — prompt loosening, identification permission, constructed examples,
real-corpus examples, structured serial, region crops (twice), reasoning tiers,
image detail — and every one is negative or below drift except k-fold examples,
which the corpus cannot resolve.

The thin path is at a local optimum for this model, and the remaining headroom
(75.8% recognition) has no untested mechanism pointing at it.

Three honest options, in the order the evidence supports them:

1. **Accept 0.825 and clear the demo blockers.** COS-51's 20-card production
   journey is still open and is the launch path.
2. **Grow the corpus.** Every ceiling here is computed on 255 cards; the long
   tail is not covered. Real writer feedback is the only thing that grows the
   corpus and the example pool at once. The COS-42 review ledger became usable
   for the first time today.
3. **Re-test the premise that the model is capable enough.** Every measurement
   in this repository is on `gpt-5.6-luna`, and the five self-imposed
   prohibitions the B probe found mean "the model cannot" has never actually
   been tested — only "the model was not allowed to".

---

## How to reproduce or extend any of this

```bash
npm run test:thin-path                      # includes every gate named here

node scripts/measure-field-ceilings.mjs     # what a perfect field is worth
node scripts/audit-residual-loss.mjs        # where the remaining loss lives
node scripts/diagnose-finish-failure-mode.mjs
node scripts/decompose-accuracy-headroom.mjs

# Review any paired run. The harness runs this automatically when a run
# finishes; this entry point is for runs that predate the framework.
node scripts/review-exploration.mjs \
  --artifact artifacts/<run>/thin-path-gpt-5.6-luna.jsonl \
  --control <arm> --treatment <arm> [--prereg docs/explorations/<file>.json]
```

Any new exploration must be preregistered before it costs anything —
`preregister()` refuses to return without a hypothesis, a mechanism, a cohort
and a falsifier, and warns when the measured ceiling is below drift.
`lib/listing/evaluation/exploration-review.mjs`
