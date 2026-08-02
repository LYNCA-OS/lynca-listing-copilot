# Second-writer calibration packet — 285 disputed tokens (2026-08-02)

## Status

`UNVERIFIED_REQUIRES_HUMAN_BLIND_REVIEW`.

The packet is generated and reproducible, but no model or automated script is
allowed to substitute for Writer B's visual judgment. This is deliberately an
external-evidence gate, not an accuracy score.

## Scope

- 117 cards with at least one disputed token;
- 285 disputed field/value occurrences;
- original front/back image references retained;
- Writer A's title hidden;
- sealed reference title hidden;
- each dispute asks for `VISIBLE_TRUE`, `VISIBLE_FALSE`, `OPTIONAL_TITLE`,
  `REQUIRED_TITLE`, or `UNKNOWN`;
- after Writer B, a third reviewer adjudicates explicit disagreements.

The packet separates `field_truth` from `title_preference`; a token cannot be
deleted merely because it is absent from Writer A's title or the sealed
reference title.

## Files

- Blind packet: [`blind-packet.json`](../../artifacts/second-writer-calibration-285-2026-08-02/blind-packet.json)
- Hidden scoring map: [`hidden-scoring-map.json`](../../artifacts/second-writer-calibration-285-2026-08-02/hidden-scoring-map.json)
- Rebuilder: [`build-second-writer-calibration-packet-285.mjs`](../../scripts/build-second-writer-calibration-packet-285.mjs)

No provider calls, runtime changes, or Production authority are involved.

