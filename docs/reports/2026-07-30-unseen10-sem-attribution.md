# Unseen-10 SEM attribution

Status: frozen offline diagnosis. No Provider call, GT write, catalog write, or
production-title change was made by this audit.

## Cohort identity

- Deployed candidate SHA: `5e6dac61f1ed716d40ccf4e01b97dcc4c570338a`
- Workflow run: `30438634081`
- Cohort selected-item SHA-256: `6f27384f23163f6e40c544271ff01575272fcd4b9c42080408bc866e652b6300`
- `unseen10.json`: `c480355d93bdc6cf705ae85b57154bc1f7ecdfa3fe6b3596c59aa34de436b74d`
- `unseen10-labels.jsonl`: `40fcfb232a20bf5a1c7c13ba1f8109ea5b0343c75e35525ecf779c665d31f9c2`
- paired rows: `6705684bf1306db19bf9b53a4584c6a0017707457da8cdff031fa956f165e537`
- unseen report: `66e3de9152302b8fa5a162ac4f10c923b7da5911990996b9ca2bd034a7cec0d0`
- gate: `90692c5b8821e452120b57294097da4838e040c437dc9a1c5446b9358c8b862c`

## Scoreboard and first-loss boundary

| Metric | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| Policy-fair token recall | 0.4829366 | 0.4055555 | -0.0773811 |
| Provider latency p50 | 5,908.5 ms | 3,648.5 ms | -2,260 ms |
| Exact title-required fields | 21/57 | 15/57 semantic-valid | -6 |

The differential regression is primarily the read-only Provider contract
dropping `manufacturer`: correct Provider observations fell from 9/10 to 2/10.
Set fell from 3/7 to 1/7. Restoring the eight lost `Panini` values would only
raise estimated token recall to about 0.5202, so it does not close the 0.85 gate.

The candidate's 30 fields missing from both Provider evidence and standard
Retrieval were:

| Field | Missing |
|---|---:|
| Card number | 10 |
| Product | 9 |
| Year | 5 |
| Set / insert | 4 |
| Subject | 1 |
| Manufacturer | 1 |

Eleven additional correct *field values* appeared only inside wrong-identity
Top-K candidates. They are not successful identity recalls and were correctly
kept out of application. Selection cannot recover a candidate that is absent.

## Product and card-number limits

- Correct Product from Provider: 0/10.
- Correct Product in standard Catalog/Vector Top-K: 0/10.
- Constraint-derived Product: 1/10 (`Paragon` -> `Panini Phoenix`).
- Product remained typed `UNKNOWN`: 9/10.

The existing artifacts contain no region boxes or emblem detections. Therefore
they cannot legally split the remaining nine cards into product-text visible,
emblem visible, or not visible. The accepted Phoenix family observation is not
per-card trace evidence; RegionEvidence must provide that denominator.

All ten inputs contain one `front_original` image. Card number was 0/10 in both
arms and in Retrieval, but this cohort cannot distinguish a back-only value from
a crop, OCR, Provider, or trace failure.

## Abstention contract

The deployed candidate artifact returned `COLD_START_SAFE_DRAFT` and
`writer_review_required=false` for 10/10 cards even though the sparse identities
were unsafe. This is evidence about deployed SHA `5e6dac61...`, not the current
source tree.

Replaying the same ten complete trace packets through the current Resolver and
V4 outcome contract produced:

```text
replayable                 10/10
identity_resolution_status ABSTAIN 10/10
workflow route             DEEP_REVIEW 10/10
outcome                    WRITER_REVIEW_REQUIRED 10/10
```

This closes the known source-level serialization break. It does not prove the
future deployed exact SHA until the production Writer Journey observes the same
outcomes.

## Decisions

1. Do not tune Selection from these ten cards: the correct identity is absent.
2. Restore deterministic manufacturer evidence independently of Product work.
3. Use RegionEvidence before assigning product visibility or OCR blame.
4. Use front-and-back assets before judging card-number recovery.
5. Report abstention beside both accuracy scoreboards in every legal gate.
