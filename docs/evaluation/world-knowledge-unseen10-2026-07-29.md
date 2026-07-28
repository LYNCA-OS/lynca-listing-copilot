# World Knowledge Unseen-10 Canary — 2026-07-29

## Decision

`NO_ACTIVATE`.

The single hosted round is not large enough to prove that model world knowledge is generally harmful. It is sufficient to prove that an unchecked model-memory proposal must not become identity evidence.

Production defaults remain unchanged. Resolver remains the final field owner.

## Frozen comparison

- Run: [GitHub Actions 30396157629](https://github.com/LYNCA-OS/lynca-listing-copilot/actions/runs/30396157629)
- Deployment SHA: `5bccac8b52ffa3de1e1db396c26f780429b5de6d`
- Cohort: first 10 cards from the unseen development/regression set; not holdout
- Arms: identical read-only compact observation contract; Candidate alone enabled world-knowledge proposals
- Cache: cold-algorithm bypass
- Provider calls: 10 per arm, 20 total

## Results

| Metric | Baseline | Candidate | Delta |
| --- | ---: | ---: | ---: |
| Policy-fair token recall | 0.380159 | 0.373809 | -0.006349 |
| Provider p50 | 4,038 ms | 4,050 ms | +12 ms |
| Provider p95 | 5,226 ms | 5,791 ms | +565 ms |
| Total tokens | 39,511 | 43,355 | +9.73% |
| Prompt chars p50 | 2,533 | 3,417 | +884 |

Per card: 1 improved, 1 regressed, 8 tied.

The critical regression changed `2024 Panini Phoenix Rookies Caleb Williams #151` into `2020 Prizm Caleb Williams RC Chicago Bears`. The `Prizm` proposal was `KNOWN / UNCHECKED / set_not_in_model` yet entered identity resolution.

Candidate proposal counts:

- 15 total
- 10 `ACCEPTED`
- 3 `UNCHECKED`
- 2 `INVALID`
- 0 `REFUTED`

All unchecked and invalid proposals were product proper nouns. Team proposals were current-image `OBSERVED` values in this cohort.

## Resulting boundary

- `UNCHECKED` remains visible in evaluation Trace only.
- `UNCHECKED` is never emitted as Identity Resolver evidence.
- A model self-labelled `OBSERVED` proposal has no direct-evidence contract and therefore also remains Trace-only.
- Only independently constraint-validated `KNOWN` proposals may become `ACCEPTED` evidence, never truth.
- The world-knowledge owner version participates in the pipeline fingerprint only when that evaluation lane is enabled.

## Independent chain finding

Recognition preflight produced `20/20 recognition_http_error` and zero evidence fields. Cloud logs proved those requests were misrouted to the field-only Vision OCR service and returned HTTP 404. This is a chain configuration defect, not evidence against the Recognition Worker algorithm, and is fixed independently from this strategy boundary.
