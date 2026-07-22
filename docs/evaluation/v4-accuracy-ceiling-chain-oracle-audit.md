# V4 Accuracy Ceiling and Chain Oracle Audit

## Decision

This is the next authoritative accuracy investigation. It is an offline, full-information audit and does not tune or route the production strategy.

The 351 writer-approved titles are commercial title truth and seed every SEM review row. They are not silently promoted to field truth. Formal denominators accept only:

- explicit human field review; or
- a separately recorded promotion where title parsing agrees with a trusted catalog/official source.

All title-only parser outputs remain `REVIEWED_TITLE_DERIVED_SEM_PROXY`. They may prioritize review and report diagnostic coverage, but cannot produce a formal Oracle claim.

## Dataset layers

1. **Title mother set**: all 351 writer-approved titles.
2. **Image-backed chain set**: 248 rows currently have at least one image and can run Evidence Oracle.
3. **Formal Golden SEM set**: only promoted/reviewed fields.
4. **Frozen partitions**: development, validation, and holdout are identity-group isolated. Formal freezing requires at least 45 holdout cards.

The remaining 103 title-only rows stay useful for parser, catalog coverage, and reranker training candidates, but they are excluded from image-chain denominators.

## Required trace contract

Each `v4-chain-oracle-trace-v1` card records:

- `evidence_observations[]`: GPT-5 mini, Google Vision crop, anchor, and other sensor field outputs;
- `retrieval_candidates[]`: stable candidate id, sealed catalog identity id, source, rank, and fields through Top-20; the truth dataset separately records accepted identity/candidate ids;
- `selected_candidate_id`;
- `application_decisions[]`: field, candidate value, apply/abstain, and reason;
- `resolver_fields`;
- `renderer_fields`: SEM fields explicitly emitted by the renderer.

The final title is retained as an artifact, but Renderer Fidelity must not be computed by feeding it through the same SEM Parser used to create review suggestions.

## Frozen metrics

- **Evidence Oracle Recall**: reviewed truth fields seen correctly by at least one sensor / evidence source divided by applicable reviewed fields.
- **Retrieval Recall@K**: cards whose sealed correct identity occurs within rank K divided by cards with sealed identity truth.
- **Selection Accuracy**: correct selected identity divided by cards where the correct identity is present in Top-20.
- **Safe Application Recall**: truth-correct selected candidate fields actually applied divided by truth-correct selected candidate fields available to apply.
- **Safe Application Precision**: truth-correct applied fields divided by all applied fields that have reviewed truth.
- **Resolver Fidelity**: correctly applied fields preserved by the Resolver divided by correctly applied fields.
- **Renderer Fidelity**: correct resolved fields explicitly emitted by the Renderer divided by correct resolved fields.

Every report includes numerator, denominator, trace coverage, and per-field breakdown. Missing instrumentation yields a missing denominator; it never becomes a zero or a pass.

## Execution order

1. Restore the 351-row private export and build parser-prefilled review rows.
2. Promote fields by human confirmation or trusted-source agreement.
3. Freeze identity-isolated development / validation / holdout partitions, holdout at least 45.
4. Run every image-backed card through all full-information actions, regardless of online early-stop policy.
5. Evaluate the seven-stage loss waterfall and rank the largest recoverable loss.
6. Change only the responsible module, then rerun development and validation. Holdout remains sealed until a release decision.

## 2026-07-22 bootstrap evidence

- Recovered the complete private Supabase export: 351/351 rows have writer-approved titles; 248/351 are image-backed.
- Parser prefill coverage: year 351, manufacturer 337, product 351, subject 343, card number 4, print finish 191, numerical rarity 208, and grade 95.
- The minimal confirm-or-correct worklist contains 2,379 populated field decisions instead of asking operators to fill every blank field.
- The sealed pre-review allocation is development 246, validation 52, holdout 53. It is not a formal frozen Golden SEM release until reviewed identities are validated.
- A 10-card historical production trace was replayed as `PROXY_ONLY`: Evidence 27/67, Safe Application Recall 8/28, Safe Application Precision 8/8, Resolver Fidelity 7/8, and Renderer Fidelity 7/7. Retrieval/Selection remained unscored because accepted candidate identities were not sealed.

The 10-card proxy suggests the largest currently observable loss is conservative candidate-field application. It is diagnostic only: merged production evidence is not the requested all-sensor full-information trace, and title-derived fields are not formal field truth.
