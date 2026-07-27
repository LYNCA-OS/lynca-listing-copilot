# Offline night: audit the structure

Written 2026-07-27. Everything here is code reading, recorded traces, pure
functions and `node --test`. No database, no model calls, no deployments.

## The database is down. Plan around it, do not try to fix it.

An 82,825-row ingest ran against a free-tier project already at 1,381 MB, filled
the volume, and Postgres now crash-loops: redo completes at 36/2D65CE30 every
cycle, then `could not write to file "pg_wal/xlogtemp": No space left on device`
and startup exits. Data is intact; the server cannot open for writes. The plan
is upgraded tomorrow.

So: no paired evals, no smoke runs, no ingest, and no recovery attempts —
freeing space needs a connection and the connection needs free space, which has
already been tried from three directions.

## Why structure, and not more fixes

Five changes in two days were reverted or withheld after measurement:

| change | result |
|---|---|
| catalog fills an unresolved field (`6d83810`) | gate never fires in production; inert |
| vocabulary in the optical-parallel gate (`3adf2ab`) | zero delta; fallback path unreached |
| ground the finish family on a vision read (`2b1b7f4`) | −5.4 points, reverted |
| consult the catalog before observation (`88d807ad`) | −11.75 points, reverted |
| existence check on claimed identity (`82ee970b`) | 16 of 17 false positives; withheld |

The pattern is not bad luck. Each was a local fix aimed at a symptom whose cause
sits in how the pipeline is wired, and three of the five failed for **the same
structural reason**, described below. The codebase is large enough that finding
the rest by encountering them one regression at a time is the slowest possible
method. Tonight is for finding them by reading.

---

## Audit A — the "absence is evidence against" class

This bug has appeared three times in two days, in three different modules, and
each time cost either a regression or weeks of suppressed output.

1. **Print-run evidence** (`f14f7df`). The renderer suppressed a resolved print
   run whenever no `field_evidence` entry existed for it — and the provider
   never emitted one. Serial hit rate was 0 of 41 while 9 of 14 numbered cards
   already held the correct value.
2. **Serial numerator** (`78cf4d8`). `serialNumeratorVerified` is genuinely
   three-state — confirmed, refused, nobody looked — and both producers were
   built with `||`, which cannot express the third. "Nobody looked" arrived at
   the renderer as "the image refused it", printing `#/25` for `12/25` on 27 of
   60 cards, 23 of which held the exactly correct numerator.
3. **Anchor routing** (`anchor-router.mjs`). The pre-observation catalog lookup
   requires two of {year, product, subject} to be directly read — and `product`
   is one of the three, which is what the lookup exists to establish.
   `pre_l2_anchor_lookup_attempted` is false on 60 of 60 cards.

**The task:** find every remaining instance. The signature to search for is a
gate whose required signal is produced by a step that does not run, or a
tri-state value flattened by `||`, `Boolean(...)`, `=== true`, or a default of
`false` where `null` is meaningful.

Concretely, sweep `lib/listing/` and `lib/identity-resolution/` for:

- parameters defaulting to `false` that are compared against `=== false`
  somewhere downstream — that asymmetry is exactly the serial bug;
- `||` chains producing a value consumed as three-state;
- gates requiring evidence of a kind the producer never emits. Cross-check
  against the recorded rows: if a `field_evidence` key never appears in any of
  the 60 reports in `artifacts/smoke/paired-eval/`, any gate requiring it is
  permanently closed.

**Deliverable:** one entry per finding with the file and line, the condition,
proof from the recorded reports that the required signal is absent or the third
state is reachable, and the blast radius (how many of the 60 cards it affects).
**Do not fix them.** Every fix from this audit has regressed when measured, and
nothing can be measured tonight.

---

## Audit B — dead wiring

Three features exist, are tested, and never execute in production. There are
likely more, and each is either a bug or code that should be deleted.

1. `productSchemas` is `[]` at **every** call site — `identity-convergence-retriever.mjs:50`
   and `:72`, `retrieval-application-replay.mjs:234`, `listing-resolution-gate.mjs:2860`.
   So `allowedCardTypes`, `allowedChecklistCodes` and
   `parallelSerialTaxonomyCompatibility` all evaluate over an empty set and
   constrain nothing. The engine that should have rejected `2021 Panini
   Contours` has never been given a single schema.
2. The pre-observation catalog lookup, above: 0 of 60.
3. `ENABLE_LISTING_FAST_PATH`: all 60 rows are `COLD_START_SAFE_DRAFT` because
   the harness passes `--disable-identity-cache`, so the warm path has never
   been evaluated once.

**The task:** find every other one. A parameter that is always passed its
default, a branch no recorded row reaches, a flag whose value is overridden by a
request option (`v4-ebay-smoke.mjs:819` hard-codes `enable_catalog_assist` and
`enable_vector_retrieval`, which is why three ablations came back unmeasurable).

Use the 60 recorded reports as the ground truth for reachability: they carry
`route`, `title_stage`, `participation_level`, funnels, and per-stage timings.
A branch no report ever takes is either dead or gated by something the harness
suppresses — say which.

**Deliverable:** a table of dead wiring: what it is, why it never fires,
whether it is a bug or removable, and what would make it fire.

---

## Audit C — the identity field lifecycle

The largest single loss in the pipeline is invisible in any single module. Of
the retrieval-application decisions across 60 cards:

```
2,626  REJECT  not_in_provider_prompt_safe_candidate_ids
  243  REJECT  candidate_not_selected
  186  SUPPORT selected_identity_matches_current_field
  109  BLOCK   unsafe_replacement_blocked
   53  APPLY   selected_candidate_safe_field_application
```

88% of what the catalog retrieves is discarded because it was not first shown to
the model — and `year`, `manufacturer`, `brand` and `product` are blocked on 60
of 60 cards regardless. The catalog is architecturally a juror on the model's
guess rather than a source of fact.

**The task:** map, for each SEM identity field, its full lifecycle across the
pipeline — where a value can be born (provider, catalog, vector, OCR, cache),
who may overwrite it, which gates can block it, and what the recorded decision
reasons say actually happens. Ground every claim in the trace packet
(`evaluation_decision_trace_packet` carries `normalization`, `resolver` with an
explicit `dropped` list, `retrieval`, `selection`, `application`, `renderer`)
and in decision-reason histograms from the 60 reports.

The output should let someone answer, without reading code: *if the catalog
knows this field with certainty, can it say so — and if not, which line stops
it?*

**Deliverable:** `docs/identity-field-lifecycle.md`, one section per field
group (year/product/set, subject, parallel, serial, card number, grade), each
with the stages, the gates, and the measured decision counts.

---

## Audit D — entity alignment, if time remains

`lib/listing/catalog/entity-existence.mjs` checks a claimed identity against 185
product lines and 30,006 set names in `data/catalog/product-schemas.json`. It
works and is **not wired in**, because exact matching calls 16 of 17
unseen-product cards fabricated. Real inventions (`Prizm Mosaic`, `Emerald
Prism`) are mixed with mere imprecision (`Talisman` against a published
`Talismen`, `Club Legends` against `Club Legends Signatures`, `Prizm` against
`Panini Prizm FIFA`).

Build `entity-alignment.mjs` returning a relation — `EXACT`, `SPELLING`,
`PREFIX`, `HYPERNYM`, `NONE` — so that only `NONE` means fabrication, with
ambiguity returned as a candidate list rather than a coin flip. Calibrate
against the labelled cases above and report precision and recall of `NONE`
separately for the 17 unseen and the 60 familiar cards.

**A false `NONE` is much worse than a missed fabrication**: suppressing a field
the model got right costs the writer a token they must retype, and the purpose
is to catch invention, not imprecision. State the operating point and the bias.

---

## Rules

1. **Offline only.** Anything needing the database or a model call is out of
   scope tonight — say so and move on.
2. **Audit, do not fix.** A, B and C produce findings, not commits to behaviour.
   Five fixes in two days were reverted or withheld after measurement, and
   nothing can be measured tonight.
3. **Absent coverage is not evidence against.** A manufacturer not harvested is
   `UNCHECKED`, never `FABRICATED`. This exact error caused two of the five
   reverted changes.
4. **Ground every claim in the recorded reports.** "This gate never fires" needs
   a count out of 60, not an argument from reading.

## Environment

```
repo   /Users/paidaxin/Documents/Lynca/lynca-catalog-vocab   (branch feat/catalog-field-vocabulary)
data   artifacts/smoke/paired-eval/vocab17-candidate-r*.json   60 familiar cards, full traces
       /tmp/unseen-baseline.json                              17 unseen-product cards
       artifacts/smoke/unseen20-labels.jsonl                  their checklist ground truth
       data/catalog/product-schemas.json                      185 product-years, 30,006 set names
       /tmp/panini-cards/*.json                               2.26M harvested cards
```

No environment variables are required.
