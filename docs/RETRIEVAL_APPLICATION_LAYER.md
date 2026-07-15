# Retrieval Application Layer

## Purpose

Retrieval candidates are not truth. This layer converts candidate records into
field-level evidence before Identity Resolution. Catalog and vector retrieval
remain candidate generators; the Identity Resolver remains the final decision
maker.

## Runtime flow

```text
Catalog / vector candidates
  -> Candidate Control Plane
  -> Retrieval Application Layer
  -> field evidence decisions
  -> Identity Resolution
  -> deterministic Renderer
```

The application layer does not change retrieval queries, candidate ranking,
provider prompts, or renderer policy.

## Field decision contract

Every candidate field produces a decision row:

```json
{
  "candidate_id": "...",
  "field": "product",
  "old_value": null,
  "candidate_value": "Topps Chrome",
  "confidence": 0.72,
  "source": "OFFICIAL_CHECKLIST",
  "decision": "APPLY"
}
```

Decisions:

- `APPLY`: the existing Candidate Control Plane safe-application policy allows
  the field to enter Identity Resolution as candidate evidence.
- `SUPPORT`: the candidate corroborates a current-image value but cannot fill or
  replace it.
- `BLOCK`: field permission, conflict, or identity policy prevents use.
- `REJECT`: the candidate is not decision eligible or was not selected.

## Safety invariants

- Candidate evidence is tagged `candidate_is_evidence_not_truth`.
- Raw retrieval candidates do not bypass the application layer.
- Resolver convergence cannot re-inject raw candidates.
- Serial numerator, grade, certificate number, and other physical-instance
  fields cannot be copied from catalog or vector references.
- Approved vector references are support-only for missing identity fields.
- Direct current-image evidence and explicit conflicts remain authoritative.

## Feature flag

```text
ENABLE_RETRIEVAL_APPLICATION=true
```

The request-level equivalent is
`provider_options.enable_retrieval_application`. Disabling the flag keeps
retrieval observable but converts all candidate field rows to `REJECT` and
prevents raw-candidate fallback.

## Paired ablation

The dedicated modes keep full L2, OCR/evidence completion, provider, image
settings, and prompt core unchanged. They also disable Approved Memory,
identity-result cache, external retrieval, and corrected-title hints so the
only treatment is Catalog + Vector + Retrieval Application:

```bash
npm run eval:retrieval-off -- \
  --dataset data/eval/golden-sem.json \
  --out data/eval/retrieval-off.json \
  --limit 100 --concurrency 2 --progress

npm run eval:retrieval-on -- \
  --dataset data/eval/golden-sem.json \
  --out data/eval/retrieval-on.json \
  --limit 100 --concurrency 2 --progress
```

Then compare the paired reports:

```bash
npm run eval:retrieval-application-ablation -- \
  --dataset data/eval/golden-sem.json \
  --off data/eval/retrieval-off.json \
  --on data/eval/retrieval-on.json \
  --out data/eval/retrieval-application-ablation.json
```

The report includes SEM card/field accuracy, the launch-critical fields
(`subject`, `product`, `set`, `card_number`, `print_finish`,
`numerical_rarity`, `grading_info`), candidate application rate, the full
retrieval-to-title funnel, recovery/regression, and per-card `retrieval_delta`.
A causal comparison is valid only when card cohort, deployment, model, and
prompt core are identical; the evaluator checks the declared contract and
runtime leakage. Provider success, p50/p95 latency, throughput, and token
totals remain in the same report as operational guardrails.
