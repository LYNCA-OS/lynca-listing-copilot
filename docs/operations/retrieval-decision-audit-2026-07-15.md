# Retrieval Decision Audit - 2026-07-15

## Scope

- Source run: `launch-throughput-255-1784019390435`
- Cohort: latest 100 attempted cards
- Window: 2026-07-14 09:19:57Z to 09:37:45Z
- Technical success: 100/100
- Reviewed ground truth available: 100/100
- Paid recognition calls during this audit: 0

This audit measures retrieval participation, not recognition accuracy. It replays
the existing cloud report and does not change provider, prompt, resolver, gate,
or renderer behavior.

## Participation Contract

Each retrieval source is classified by the deepest auditable contribution:

1. `NOT_USED`
2. `OBSERVATION_ONLY`
3. `FIELD_EVIDENCE`
4. `CANDIDATE_RANKING`
5. `IDENTITY_DECISION`

Multiple roles may be retained. For example, a catalog candidate can provide
field evidence and also enter candidate ranking, while its primary level is
`CANDIDATE_RANKING`.

## Results

| Metric | Result |
| --- | ---: |
| Catalog hit rate | 36/100 (36.0%) |
| Catalog used rate | 27/100 (27.0%) |
| Catalog applied rate | 0/100 (0.0%) |
| Vector hit rate | 87/100 (87.0%) |
| Vector used rate | 26/100 (26.0%) |
| Vector applied rate | 0/100 (0.0%) |
| Any retrieval available | 94/100 (94.0%) |
| Available but unused | 56/94 (59.6%) |
| Available but not applied | 94/94 (100.0%) |
| Candidate to final | 0/38 (0.0%) |

Catalog returned 161 raw candidates; 75 prompt candidates were recorded across
27 cards. Vector returned 435 raw candidates; 57 prompt candidates were
recorded across 26 cards.

## Interpretation

Retrieval infrastructure is active, but the existing report cannot prove that
any candidate changed a final field or title:

- 9/36 catalog hits remained observation-only.
- 61/87 vector hits remained observation-only.
- 38 cards exposed retrieval candidates to ranking or provider context.
- No card retained a candidate application trace or identity-decision record.

The report therefore records zero explicit recoveries and zero explicit
regressions. This is not evidence of zero hidden effect: those 38 prompt-exposed
cards have no paired retrieval-off result, so causal net benefit is unknown.

## Data Quality Boundary

Historical `prompt_assist_used=true` is a mode flag, not proof that a candidate
entered the prompt. Some fail-closed candidates carried this flag while their
prompt candidate count was zero. The audit intentionally ignores that flag as
ranking evidence.

Official checklist contribution also cannot be separated from generic catalog
contribution in this historical cohort because per-candidate source traces were
not retained. New job-status responses expose the Retrieval Participation Layer
so future runs can attribute source, roles, supported fields, applied fields,
and identity decisions directly.

## Reproduction

```bash
npm run audit:retrieval-decision -- \
  --input /path/to/reliability-255.json \
  --sample-size 100 \
  --selection latest_attempted \
  --out-dir data/eval/retrieval-decision-audit
```
