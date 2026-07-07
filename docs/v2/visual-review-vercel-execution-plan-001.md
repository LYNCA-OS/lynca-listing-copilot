# Visual Review Prototype #001 Vercel Execution Plan

Status: Documentation Only
Owner: LYNCA Listing Intelligence
Companion Documents:

- `visual-review-report-001.md`
- `visual-verification-layer-v1.md`
- `image-evidence-audit-001.md`

## Purpose

This document updates the Visual Review Prototype #001 plan so actual GPT Vision review can run server-side in the Vercel environment where OpenAI credentials already exist.

No implementation is included in this document.

## Why Local Execution May Fail

The local prototype successfully downloaded representative Supabase image evidence, but all GPT Vision calls failed with network/API connectivity errors.

Local execution may fail because:

- the local environment may not be able to reach `https://api.openai.com`
- local shell execution may not have the same network route as production
- local environment variables may not match Vercel production
- local `OPENAI_API_KEY` should not be required for this workflow
- secrets should not be copied from Vercel into local files just to run a review job

The local run proved image retrieval and packaging, not vision analysis.

## Why Vercel Server-Side Execution Is Preferred

The production Vercel environment already supports Listing Copilot title generation using server-side OpenAI credentials.

Vercel server-side execution is preferred because:

- `OPENAI_API_KEY` already exists in the server environment
- secrets can remain server-side
- image URLs can be loaded by trusted server code
- GPT Vision calls can run without exposing credentials to browser clients
- admin-triggered review can reuse existing deployment security patterns
- results can later be written to `data/learning` artifacts or a Supabase review table

This does not require local `OPENAI_API_KEY`.

## Required Safety

Any future implementation must follow these rules:

- admin-only
- no public endpoint
- no secret exposure
- no local secret copying
- small batch size, 10-20 candidates per run
- logs must not contain image base64
- logs must not contain API keys
- logs must not contain full signed secrets or authorization headers
- logs should include only candidate ids, feedback ids, status, timing, and high-level error messages
- no runtime title generation changes
- no registry updates
- no resolver updates
- no prompt updates
- no automatic installation

## Future Implementation Option

A future implementation may use:

```text
Protected API Route
  |
Manual Admin Trigger
  |
Load 10-20 Review Candidates
  |
Fetch Representative Images Server-Side
  |
Send Images To GPT Vision
  |
Store Visual Review Results
```

Possible route shape:

```text
POST /api/admin/visual-review/run
```

This route must be protected. It must not be public.

Possible request body:

```json
{
  "candidate_ids": ["learn-0016", "learn-0020"],
  "max_candidates": 10,
  "dry_run": false
}
```

Possible output:

```json
{
  "ok": true,
  "reviewed_count": 10,
  "failed_count": 0,
  "result_location": "data/learning/visual-review-001/visual-review-results-001.json"
}
```

## Result Storage Options

Initial result storage may be one of:

- `data/learning/visual-review-001/visual-review-results-001.json`
- `docs/v2/visual-review-report-001.md`
- a future Supabase review table

Supabase review-table storage is preferred later if repeated admin review runs become normal.

## Required Result Fields

Each reviewed candidate should produce:

- candidate id
- feedback id
- generated title
- corrected title
- front image URL
- back image URL
- visual evidence summary
- visual confidence: High, Medium, or Low
- `visually_supported`
- `visually_uncertain`
- `text_only`
- `needs_external_checklist`
- caveats

## Non-Goals

This plan does not:

- implement an API route
- change Listing Copilot title generation
- modify registry data
- modify resolver logic
- modify prompts
- deploy an upgrade
- expose secrets
- create a public review endpoint

## Next Safe Step

The next safe step is to implement a protected, admin-only Vercel server-side visual review route in a separate change.

That future change should be reviewed as security-sensitive because it uses server-side OpenAI credentials and internal image evidence.

