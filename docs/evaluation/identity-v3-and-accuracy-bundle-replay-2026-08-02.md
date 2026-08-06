# Open identity v3 and three-mechanism replay — 2026-08-02

## Scope and claim boundary

This is a zero-provider-cost replay. The canonical and exhaustive rows were
already paid for and share the same 150 asset IDs. The replay never calls Luna,
never writes CSM/SEM, and remains evaluation-only. It is evidence for choosing
the next independent 150-card confirmation cohort, not a production accuracy
claim.

## Why v2 was rejected

The v2 rule admitted a visible identity/affiliation into an empty `set` slot
when it was not a known team, grader, rights mark, or product fragment. On the
paired 150-card exhaustive checkpoint it changed 16 cards:

| Replay | F1 | Wins | Losses | Ties |
|---|---:|---:|---:|---:|
| canonical baseline | 0.7669268 | — | — | — |
| identity v2 | 0.7666778 | 5 | 10 | 135 |

The ten losses were not visual misses. They were semantic role errors: `PTPA`,
`MLB PLAYERS`, `PLAYERS`, `Sports Collectors Digest`/`SCD`, `adidas`, `Wilson`,
and `bibigo` are a tennis association, rights/provenance labels, slab/grader
text, or sponsor marks rather than the card set.

## v3 semantic veto

v3 keeps the open expression channel but rejects only the measured non-set
roles above plus generic organization/rights/sponsor/product markers. It also
normalizes punctuation before admission. It does not use model knowledge as a
field value and does not replace a non-empty canonical set.

| Replay | Changed | Wins | Losses | Ties | Δ macro F1 | Reference loss | Over 80 |
|---|---:|---:|---:|---:|---:|---:|---:|
| identity v3 | 5 | 5 | 0 | 145 | **+0.003282** | 0 | 0 |

Changed positive cards:

| Card | Baseline → replay | Δ F1 |
|---|---|---:|
| Diana Shnaider | `Topps Diana…` → `Topps GRAPHITE Diana…` | +0.1026 |
| Star Wars | `Topps Chrome …` → `Topps Chrome STAR WARS …` | +0.1023 |
| Disney Elsa | `…Chrome Elsa…` → `…Chrome Disney Elsa…` | +0.0702 |
| VeeFriends Cow | `…Chrome Common Sense Cow…` → `…Chrome VeeFriends Common Sense Cow…` | +0.1364 |
| Disney Mufasa | `…Chrome Mufasa…` → `…Chrome Disney Mufasa…` | +0.0809 |

## Same-call candidate-expression v4 replay

The same v3 resolver was also applied to the standalone `candidate_facts`
channel emitted by candidate-expression v4. This is a separate expression
source from the exhaustive observation arm, but it covers only 102 completed
development rows. It requires no new provider call:

| Replay | Cards | Changed | Wins | Losses | Ties | Δ macro F1 |
|---|---:|---:|---:|---:|---:|---:|
| v4 candidate facts → identity v3 | 102 | 3 | 3 | 0 | 99 | **+0.002580** |

The three additions are Disney Elsa, Disney Mufasa, and VeeFriends Adaptable
Alien. The resolver rejected a copyright/company line as non-set evidence and
did not admit the earlier v4 false identities. This is the first direct sign
that a more open same-call expression channel can produce recoverable signal;
it is still development-overlap evidence, not a 150-card confirmation.

Artifact: `artifacts/candidate-expression-v4/development-150/identity-replay-v3.json`.

### Completed 150-card v4 tail and team-affiliation veto

The original v4 development run had 131 unique completed cards across three
checkpoint directories. We paid only the 19 missing asset IDs, at the same
candidate_expression_v4_high / gpt-5.6-luna / none contract, then merged the
first response for each asset. Fifty-two duplicate rows from earlier retries
were ignored rather than counted as extra cards. The merge receipt is
artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl.receipt.json.

The first complete replay exposed three false set promotions: FC Barcelona,
Atlanta Hawks, and Boston Red Sox. A fourth team (Minnesota Twins) and a
numeric 3PLAYERS badge were neutral/noisy variants of the same role error. The
v3 resolver now rejects this measured team-affiliation class while still
admitting non-team identity marks such as Disney and VeeFriends.

| Replay | Cards | Changed | Wins | Losses | Ties | Δ macro F1 | Reference loss | Over 80 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| v4 facts → identity-v3 before team veto | 150 | 8 | 4 | 3 | 143 | +0.000483 | 0 | 0 |
| v4 facts → identity-v3 with team veto | 150 | 4 | 4 | 0 | 146 | **+0.002187** | 0 | 0 |

The four surviving changes are all identity additions with positive paired F1:
Disney Elsa (+0.0833), VeeFriends Common Sense Cow (+0.0649), Disney Mufasa
(+0.0989), and VeeFriends Adaptable Alien (+0.0809). This is a stronger
development signal than the partial 102-card screen, but it remains overlap
evidence and is not production authority or an independent 150-card claim.

Artifact: artifacts/candidate-expression-v4/development-150/identity-replay-v3-team-veto-2026-08-02.json.

## Orthogonal three-mechanism bundle

The bundle applies, in order: identity v3, the already-screened
known-manufacturer product extension v2, and the narrow single-digit serial
format rule (`5/20 → 05/20`, `8/25 → 08/25`). The bundle is deliberately not
the stopped broad serial rule and does not include the stopped free-product
overlay.

| Stage | Changed | Wins | Losses | Ties | Δ macro F1 |
|---|---:|---:|---:|---:|---:|
| identity v3 | 5 | 5 | 0 | 145 | +0.003282 |
| + product v2 | 6 | 6 | 0 | 144 | +0.003750 |
| + serial single-digit | 8 | 8 | 0 | 142 | **+0.004777** |

Bundle safety checks: 0 reference-token losses, 0 titles over 80 characters.
The full per-card/per-stage ledger is in
`artifacts/extreme-observation-2026-08-02/accuracy-bundle-v3-replay-150.json`.

## Decision

Keep the team-vetoed v3 and the three-mechanism bundle evaluation-only. Pre-register one
independent 150-card confirmation with the same safety gates:

1. no reference-token loss;
2. no title over 80 characters;
3. no negative field-level ledger;
4. positive paired result, not just aggregate mean.

If any safety gate fails, retain the useful evidence but do not admit the
mechanism into CSM/SEM or production. Production remains on the deployed
canonical thin path.
