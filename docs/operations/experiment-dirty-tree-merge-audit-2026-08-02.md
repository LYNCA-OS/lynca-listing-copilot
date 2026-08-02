# Experiment dirty-tree merge audit — 2026-08-02

## Conclusion

Do not merge the experiment checkout as a whole. The production mainline is
already the clean thin route at `799bb1ea`; the uncommitted tree is a mixture of
useful evaluation work and older path fragments. A file being newer in the
experiment checkout is not evidence that it belongs in production.

## Reject from the production merge

- `app/listing-copilot.js`: the diff reintroduces the legacy v4 queue, job
  status, pre-ingest and recovery endpoints. That contradicts the production
  intent contract: upload starts recognition, one direct CSM request owns the
  result, and the old path is retired.
- `lib/listing/thin/thin-listing-path.mjs`: the diff removes canonical provider
  error classification, safe-to-retry semantics, request receipts and rate
  telemetry. Those are required to distinguish a definitive provider error
  from an unknown post-send outcome; merging the diff would weaken the
  fail-closed authority boundary.
- Broad legacy/v4 changes in the dirty tree, including queue/status helpers,
  vector/OCR tests, and speculative provider fallbacks: they are not part of
  `CSM_THIN_DIRECT` and must stay out of production.

## Keep, but still evaluation-only

- The 150-card paired accuracy reports and their append-only artifacts.
- The eight narrow Composer/SEM replay mechanisms, including the exact TCG IP
  logo and single-digit serial candidates. Their replay evidence is positive
  but not an independent 150-card production confirmation.
- The candidate-expression analyzers and adversarial tests. They capture model
  expression for diagnosis; they do not change CSM/SEM authority or add a
  second production call.
- The production cloud runtime evidence and stage-telemetry documentation.

## Review before any future merge

The large CSM persistence, Supabase writer, orchestration and migration diffs
must be compared against the already-deployed production versions one contract
at a time. Only an additive, reversible change with a passing targeted test,
zero old-path imports, and a measured 150-card decision may leave this hold
state. This audit intentionally made no code merge or deletion.
