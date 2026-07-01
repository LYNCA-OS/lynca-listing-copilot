# Phase 19 Low-Cost Identity Fast Path

Date: 2026-06-23
Branch: `v2_pai`

## Goal

Listing Copilot should behave like a light industrial identity resolver, not a per-request vision generation toy.

For medium traffic, the cheapest reliable sequence is:

1. verified upload metadata
2. exact approved identity memory
3. deterministic identity resolution gate
4. legacy vision provider primary vision only when memory misses
5. retrieval and focused reread only when evidence is weak
6. GPT-4.1 emergency only by explicit operator action

## Fast Path Added

The title API now checks approved identity memory before selecting a vision provider.

The lookup is intentionally narrow:

- only when `LISTING_APPROVED_MEMORY_ENABLED` is enabled
- only when Supabase feedback storage is configured
- only for a computed asset fingerprint from uploaded image hashes or storage paths
- only after primary storage images are verified
- only exact `asset_fingerprint` matches from approved review records
- no writes, no feedback retention, no training-data mutation

On hit, the approved record becomes `INTERNAL_APPROVED_HISTORY` evidence and still passes through `resolveIdentity` and the deterministic English title renderer. The stored approved title is not treated as the final generated title.

## Cost And Latency Impact

For repeated assets or already approved commercial samples:

- legacy vision provider calls: `0`
- OpenAI calls: `0`
- external retrieval calls: `0`
- expected remote operations: storage verification reads plus one approved-history read

This makes same-asset retries and approved sample reuse fast and cheap without allowing unreviewed model output to become truth.

## Loss Control

The fast path does not bypass the identity system.

It still returns:

- `identity_resolution`
- `field_states`
- `conflict_graph`
- `conflict_map`
- `confidence_report`
- deterministic final title

If the approved record is structurally incomplete and the identity gate returns `ABSTAIN`, no final title is emitted.

## Current Remaining Work

This does not yet solve full 95% exact resolution. The next major step is to feed recognition-worker OCR and slab-label evidence into the same Evidence Layer before legacy vision provider is called.

The target low-cost runtime should become:

1. approved memory exact hit
2. recognition worker OCR/slab evidence
3. internal registry and official checklist retrieval
4. legacy vision provider semantic evidence extraction
5. focused reread only for weak fields
6. human ABSTAIN queue
