# COS-59 Collectible Semantic State v1 vertical slice

Date: 2026-08-12

Status: evaluation-only; no Production activation

## Decision

The contrary hypothesis was that a larger semantic object should immediately
replace the current canonical path. That is lower confidence than an inert
vertical slice: no governed run has yet shown that a richer frontier response
improves grounded understanding without increasing fabrication, latency or
maintenance cost. Production therefore keeps one `gpt-5.6-luna` call at low
effort and high image detail, followed by the current deterministic Composer.

This slice makes the future architecture executable without changing that
runtime. `Collectible Semantic State v1` can retain evidence-linked facts,
relationships, conflicts and uncertainties beyond the canonical projection.
Recognition and Identity Resolution remain separate audit views derived from
the exact same response hash; they are no longer required to be separate model
calls.

## Evaluation boundary

`buildFrontierModelCsmRequest` is a pure Responses request builder. It creates
one user input containing every approved content-addressed evidence record and
every approved original image reference, requests one strict JSON-schema
response, has a provider-call budget of one, and exposes no tools, web access,
retry loop, client or dispatcher. The Production import graph is fenced from
the entire experiment directory.

Subset A now has a separate grounded-understanding scorer. It reads only the
governed canonical observations and evidence-linked semantic facts. It does
not read expected titles or run the Composer. The 16/16 test is a harness
conformance result over byte/hash-consistent synthetic image inputs, not
frontier-model accuracy evidence; a paid, frozen model run remains required
before an accuracy claim.

## Storage boundary

The Production migration ledger contains one additive, audit-only table. RLS
is enabled; `public`, `anon` and `authenticated` have no access; `service_role`
receives only `select` and `insert`; the established CSM mutation guard rejects
updates and deletes. Database constraints fix activation to `AUDIT_ONLY`, zero
added provider calls and no Writer projection. No application writer imports
or writes this table in this slice.

## Writer-perceived latency

The protected Writer Journey now measures three exact monotonic intervals:

- upload to recognition response;
- recognition response to an enabled input holding the exact response-title
  SHA-256;
- upload to editable title, equal to the sum of the first two.

`upload_to_feedback_ms` remains a separate workflow metric and cannot satisfy
the editable-title contract. A normal case above 20 seconds or a staged-large
case above 30 seconds fails the smoke as an absolute stall. The 3/4-case smoke
is diagnostic only. A quality-preserving optimization becomes required only
after two non-overlapping cohorts, each with at least 30 fresh first-attempt,
zero-retry samples, both breach either p50 8 seconds or p95 12 seconds. The gate
explicitly forbids using `low -> none`, lower image detail or an automatic
second provider call as an unmeasured latency shortcut.
The optimization gate accepts raw receipts and recomputes both cohort
summaries itself; supplied percentiles are not evidence.

## COS-59 Done acceptance: release evidence still required

The implementation acceptance is complete in this branch: one pure
full-evidence request,
one-response dual audit views, a semantic state wider than canonical fields,
separate grounded/projection evaluation surfaces, a represented non-LYNCA
profile, an additive inert migration, a Production import fence, historical
replay gates, and editable-title latency evidence. COS-59 may be marked Done
after the normal protected-release evidence proves this exact slice:

1. Protected CI is green for the exact PR head and the merged `origin/main`
   ancestry is verified.
2. Apply and verify the inert audit migration separately against Singapore
   Production, including RLS/grants and append-only mutation rejection.
3. Deploy the exact `origin/main` SHA, verify protected health, then run the
   real canonical-release Writer Journey. Its four fresh attempt-one,
   retry-zero cases must carry the new editable-title receipts and pass the
   20/30-second absolute stall limits. This n=4 smoke remains diagnostic and
   cannot itself authorize a latency optimization.
4. Complete the canonical-domain zero-provider-call readback and verify that
   the experiment package remains unreachable from Production entry points.

## Future semantic-state activation: explicitly not a COS-59 Done blocker

The following work belongs to a later semantic-state activation decision. It
must not keep this inert vertical slice perpetually open:

1. Execute the immutable frontier request on a frozen, field-reviewed cohort
   and report grounded-understanding precision/recall/F1, critical errors,
   tokens, p50/p95 latency and failures separately from projection fitness.
2. Decide whether the richer state wins after quality, latency, cost and
   maintenance penalties; rejection is a valid result and leaves Production
   unchanged.
3. Only after that decision, propose a separate Production writer/forward
   reader activation. Re-prove historical v1/v2/v3 title replay byte equality
   and provider-call invariants in that release.
