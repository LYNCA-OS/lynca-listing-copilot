# Writer Mode Launch Readiness

Status: implementation candidate; Track D feedback-idempotency dependency and preview-environment transaction test still required.

## Product contract

- `Card mode` remains the default and keeps the existing multi-card review surface.
- `Writer mode` is additive: one active card, one title input, previous/next queue context, and keyboard-first operation.
- `Enter` never means “optimistically done.” The active card advances only after the feedback API confirms persistence.
- A failed save keeps the same card and title in place for retry.
- Each V4 submission owns a client-generated idempotency key and fixed client timestamp. An uncertain retry reuses both; a changed title or action creates a new revision identity.
- Persistence and training eligibility are separate: accepted or edited titles remain exportable after durable storage even when the learning pipeline is in observe-only mode; rejects are stored but excluded from the workbook.
- Background recognition updates must not replace the focused writer input.
- Writer-mode Excel exports contain only cards whose feedback status is `saved`, in original asset order. Standard-mode export behavior is unchanged.
- Export freezes the stored title snapshot and locks mutation until the workbook request finishes. The server and frontend both cap one workbook at 250 cards.
- File preprocessing, priority retry, feedback persistence, and export share a mutation lock; active recognition also blocks replacing or clearing the batch.

## Rollout and rollback

- No database migration, recognition policy, queue, provider, retrieval, or concurrency change is part of this feature.
- This UI branch intentionally does not copy Track D backend work. Deploy or merge Track D's `feedback_submission_id` API + migration first (or in the same release) before running the response-loss retry gate; the current main API safely ignores the extra client field but cannot deduplicate a lost response by it.
- The existing card mode is the immediate fallback inside the same page.
- Code rollback is limited to the writer-mode UI commit; no data rollback is required.
- Integrate from the isolated `codex/writer-mode` branch only after rebasing it onto the latest `origin/main` and re-running the gates below.

## Required gates

### Local gates

- Syntax checks for `app/listing-copilot.js`, `app/writer-wheel-mode.mjs`, and the writer-mode test.
- `scripts/writer-wheel-mode.test.mjs`.
- `scripts/provider-ui.test.mjs`.
- `scripts/v4-writer-export.test.mjs`.
- Repository `npm run check`.
- Browser checks at desktop and 390 px width: page content, mode switching, keyboard tab switching, no horizontal overflow, no console errors, no framework error overlay.

### Preview gate with real V4 routes

Use a non-production or approved preview account and a disposable card batch.

Precondition: the preview feedback response echoes `feedback_submission_id`, and replaying the same ID + payload returns the existing stored transaction instead of a second event.

1. Upload at least four images and verify the existing card mode is unchanged.
2. Switch to writer mode and confirm the first ready title receives focus without waiting for unrelated cards.
3. Edit a title and press `Enter` once. Confirm one feedback transaction is created, the canonical server title is shown, and only then the next card appears.
4. Force or simulate one feedback failure. Confirm the current card and typed title remain in place and `Enter` retries without a duplicate positive record.
   Also simulate “server committed, response lost” and confirm the retry reuses `feedback_submission_id` and returns the existing transaction.
5. Keep typing while another recognition result completes. Confirm the active input, caret, and IME composition are not replaced.
6. Save a subset of cards and export. Confirm the workbook contains only saved cards, preserves card order, embeds the expected images, and creates the export batch/items records.
7. Finish the batch and confirm the completion state and repeatable export behavior.
8. Re-run the standard card-mode save and export smoke path.
9. Verify a 250-card export is accepted and a 251-card export is stopped locally with a clear batch-size message before image uploads begin.

## Known boundary

The current browser session owns the uploaded image objects and export selection. Feedback is durable after each successful `Enter`, but refreshing or moving to another device does not reconstruct an unfinished writer batch. Cross-session batch recovery needs a separate server-side batch query/resume design and is not claimed by this release.

Repository-wide commercial readiness is a separate gate. The current golden evaluation reports an empty `held_out_commercial` split, so this writer-mode verification must not be presented as evidence that commercial recognition accuracy has passed its acceptance threshold.
