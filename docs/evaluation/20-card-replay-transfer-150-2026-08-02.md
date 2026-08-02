# Transfer of 20-card replay candidates to 150 cards — 2026-08-02

## Scope

This receipt answers the request to move mechanisms that previously had only a
20-card screen/replay onto 150 cards without buying another model call. It uses
the existing 150-card canonical and candidate-expression checkpoints. Every
result below is `evaluation_only`; none changes CSM/SEM authority or production.

## Replays that are executable on 150

| Mechanism transferred from the 20-card work | 150-card artifact | Baseline → replay F1 | Wins / losses / ties | Reference-loss cards | >80 cards | Decision |
|---|---|---:|---:|---:|---:|---|
| v4 vocabulary admission (printed insert / printed parallel / literal rarity) | `vocabulary-replay-150-2026-08-02.json` | 0.771494 → 0.773725 (+0.002231) | 4 / 0 / 146 | 0 | 0 | **positive candidate** |
| visible identity-to-Set replay (the safe downstream analogue of the 20-card identity-hypothesis screen) | `identity-hypothesis-replay-150-2026-08-02.json` | 0.771494 → 0.773681 (+0.002187) | 4 / 0 / 146 | 0 | 0 | **positive candidate** |
| composed narrow bundle (identity + vocabulary/serial/insert overlays) | `replay-direct-150-2026-08-02.json` | 0.771494 → 0.778394 (+0.006900) | 13 / 0 / 137 | 0 | 0 | **positive replay; not production proof** |

The first two rows are deliberately reported separately. The bundle's `+0.006900`
is not the arithmetic sum of the two deltas; the stages are cumulative and the
same card can benefit from more than one safe overlay.

### Changed-card detail

The vocabulary replay changed four cards: `MOJO PRIZM`, `MIRRORED`, `GOLD
SHIMMER`, and `1ST BOWMAN`. The identity replay changed four cards by filling an
empty Set from an image-anchored logo/identity fact: Disney Elsa, VeeFriends
Common Sense Cow, Disney Mufasa, and VeeFriends Adaptable Alien. The complete
per-card records, source facts, and score deltas are in the two JSON artifacts.

## 20-card arms that cannot be honestly “replayed” on 150 for free

These experiments changed the model request shape or added a response field.
Their 20-card treatment outputs do not exist for the other 130 cards, so
reapplying their exact result on 150 would require 130 new paid provider calls.
We do not silently substitute a different producer and call it the same arm.

| 20-card arm | Why an exact 150 replay is unavailable | Current decision |
|---|---|---|
| canonical free-title / product-evidence response | only 20 treatment payloads; no 150 treatment field output | 20-card arm remains stopped; a separate 150 free-title projection already has 2 losses and one reference-token loss, so it is **STOP** |
| canonical open-evidence response | only 20 open-ledger payloads; the 150 exhaustive observation payload is a different schema and producer | keep as capture diagnostic, not a claimed 150 replay |
| canonical IP field | only 20 IP treatment fields; v4 identity facts are not the same canonical-IP response | do not infer a 150 IP result |
| 512-token output cap | output-cap behavior is provider/request-shape dependent; it cannot be reconstructed from canonical fields | 20-card screen remains negative/neutral; no new paid run |
| expression v5 slot allocation | only 20 v5 expression outputs; the 150 checkpoint is v4, not v5 | 20-card screen remains **STOP**; do not extrapolate v4 as v5 |
| one-call canonical identity-hypothesis schema | only 20 treatment responses; the 150 row above is the safe v4-fact/identity resolver analogue, not the same request arm | raw hypothesis channel remains stopped; no model-knowledge promotion |

## Why the remembered 0.8x and current 0.7x both appear

The `0.8x` figures came from small 20-card external screens (for example,
canonical high `0.7818`, `0.8172`, or `0.8162`, depending on the arm and cohort).
On the fresh mixed 150-card confirmation, the same structured canonical arm is
`0.7678`; the free-expression arm is `0.7147`. The current Composer replay
baseline is `0.771494` because it composes the saved canonical fields under the
current SEM rules. These are different cohorts and, for the replay baseline,
different scoring stage—not different production architectures.

The production path remains the structured canonical → CSM/SEM → Composer
chain. The `0.7x` free-expression output is an evaluation capture/control lane,
not the authority path we should ship.

## Gate

The 150 replays make vocabulary and visible-identity admission worth carrying
into the next pre-registered independent 150 confirmation. They do not justify
shipping them yet: the current 150 is a reused/development cohort, not a new
sealed label-blind cohort. No Cloud Run, OCR, vector store, or second model call
was added.
