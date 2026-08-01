# Candidate identity replay v2 screen — 2026-08-02

## Decision

`CAPTURE_ONLY / HOLD_FOR_150_CONFIRMATION`. This is an evaluation-only,
zero-cost replay. It is not imported by the thin production path and must not
be promoted from the 102-card development replay alone.

## Why v2 exists

The earlier identity replay filled an empty `set` from any logo or affiliation.
On the 102-card v4 development replay it produced 4 wins and 12 losses
(`delta_macro_f1 = -0.0041880237`). The losses were structurally clustered:

- teams: Golden State Warriors, New York Knicks, and Los Angeles Lakers;
- service/rights marks: NFLPA and BECKETT;
- product fragments: Optic O, B Chrome, and OPTIC O DONRUSS.

This is not a vision failure. It is a field-role error after expression.

## Mechanism

`candidate-identity-replay-v2.mjs` makes two minimal changes while preserving
the v1 boundary:

1. `identity` and `affiliation` + `logo_or_symbol` observations may propose an
   empty set, except for a small world-knowledge denylist of teams, graders,
   and rights/union marks;
2. a candidate sharing a meaningful token with the existing manufacturer or
   product is rejected as a product fragment.

Affiliation facts that are not on that denylist can still be useful IP/project
signals (for example Disney or VeeFriends). No canonical field is changed in
the production path.

## Free replay evidence

Using the same canonical-v3 baseline and the same 102 candidate-expression-v4
rows as the v1 comparison, after allowing non-team affiliation signals:

| population | baseline F1 | v2 replay F1 | delta | wins | losses | ties |
|---|---:|---:|---:|---:|---:|---:|
| 102-card development overlap | 0.7610423595 | 0.7636219358 | +0.0025795763 | 3 | 0 | 99 |

The three changed cards are two Disney cards and one VeeFriends card. No team,
rights mark, or product fragment is admitted.

## Gate

This is a promising semantic guard, not a production claim. Run it against the
independent 150-card candidate-expression cohort when that cohort is complete.
Promotion requires no losses, no field-role violations, and a positive paired
150-card result. If the independent cohort is unavailable, keep this module in
evaluation-only status.
