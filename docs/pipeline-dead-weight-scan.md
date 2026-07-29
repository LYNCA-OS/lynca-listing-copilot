# What the pipeline pays for, and what it gets

Every line is a count taken from production on 2026-07-29, not an impression.

The scan found two different things that look alike and must not be treated
alike: **work that runs and produces nothing**, and **work that was built
correctly and never runs at all**. The first should be cut. The second should be
wired — cutting it would throw away the answer to a real problem.

## CUT — runs, costs time, produces almost nothing

| component | cost | output |
|---|---|---|
| vector worker | 3.5s per call, 217 minutes total | **92.7%** return zero candidates; index holds 587 rows last written 2026-07-06 |
| OCR rendezvous | main path waits 657ms avg, 1.7s p90, 24.5s max | **4.6%** of sessions get any field changed |
| OCR jobs | failures average 454s, max 86 min, 3 attempts | `card_code_crop` succeeds 23%; 1,178 jobs never ran |
| anchor / candidate lookup | included above | **94%** return zero candidates; scout disabled on 3,494 sessions |

These four are one chain, together costing **over 4 seconds per request** for
near-zero output. They are cuttable because they are attempting something
already measured as unworkable: recovering identity from visual similarity and
a side-car OCR. The evidence that it does not work is not an opinion — the
index is empty, the OCR fails, and the candidates are zero.

## WIRE — built, tested, correct, running nowhere

| thing | state |
|---|---|
| `constraint-enumerator` | tested; resolves 65% of empty teams, 30% of products; **not wired** |
| `composeParallel` | tested; turns a 0.8%-filled field into `Silver /75`; **not wired** |
| `subject-normalizer` | tested; **wired to the enumerator only** |
| `entity-existence` | built; **not wired** |
| `card_identity_prototypes` | table + FK correct; **0 rows** |
| `catalog_parallels` | columns exactly right; **0 rows** |
| `v4_sem_validation_events` | **0 rows** |
| `v4_field_evidence` (surface_color) | **0 rows** |
| `productSchemas` | `[]` at every call site |

Nine of them. The pattern is not that the work was wrong — the schemas are
right, the tests pass. It is that **"built and tested" was accepted as "done"**,
and nothing was ever connected.

`lib/listing/catalog/derive-fields.mjs` now collapses the first three into one
import and one call, and returns a `trace` plus `summariseDerivation` so the
question "was wiring this worth it" is answered with a count instead of a
belief. On seven representative production card shapes: 9 gaps filled, 1
correctly declared EMPTY, 2 honestly left UNKNOWN.

## KEEP — expensive but load-bearing

| thing | why it stays |
|---|---|
| the 69.3% of empty output slots | Task A removed request-side fields and lost 6.91pp familiar / 7.74pp unseen. The empty tokens act as a checklist. Compress the *response*, never the *request*. |
| `catalog_import_staging` | 105,558 rows, 291 MB, **0 marked imported** — it is the Topps checklist asset, not exhaust. It has never entered the system, which is a wiring failure, not a reason to delete. |

## The rule this produced

Built → wired → **measured as a positive asset**. Skipping the third step is how
nine correct modules ended up doing nothing, and how four subsystems ended up
costing four seconds a request to return nothing.

Before proposing anything new here, grep for it first. In this codebase the
probability that it already exists and is simply unwired is higher than the
probability that it needs building.
