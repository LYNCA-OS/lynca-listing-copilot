# Listing Copilot Supabase Integration Plan v2

Status: Design Draft v2.0
Owner: LYNCA Listing Intelligence
Companion Documents:

- `feedback-loop-v2.md`
- `database-schema-v2.md`
- `ui-wireframe-v2.md`
- `v2-scope-lock.md`

## Purpose

This document describes how the V2.0 Memory Layer connects:

- Vercel
- Supabase
- Current Listing Copilot

It is a plan only. It does not define implementation code, migrations, or runtime changes.

V2.0 memory is not text-only. Each memory event must connect the generated title, corrected title, front/back image evidence, timestamp, and operator.

## 1. Current Architecture

Current Listing Copilot is a title-generation workflow.

Conceptual flow:

```text
User Upload
  |
Listing Copilot Generation
  |
Editable Listing Title
  |
User Save
```

The current system can generate and normalize listing titles, but it does not yet preserve operator corrections with image evidence as durable memory.

Current limitations for learning:

- generated titles are not consistently stored as before-state memory
- corrected titles are not consistently stored as after-state memory
- front/back image evidence is not stored with corrected titles
- title corrections are not available for admin review
- future registry improvements rely on manual observation instead of image-title feedback history

## 2. Target Architecture

V2.0 adds a minimal Memory Layer through Supabase.

Target conceptual flow:

```text
Vercel App
  |
Current Listing Copilot
  |
Generated Title
  |
Operator Edit
  |
Save
  |
Supabase Feedback Memory
  |
Admin Review
```

Vercel remains the application hosting layer.

Current Listing Copilot remains the title-generation and editing experience.

Supabase becomes the storage layer for raw before/after title corrections and the image evidence required to review those corrections.

The title generator does not need to read from Supabase in V2.0.

## 3. Required Supabase Services

V2.0 requires only the Supabase services needed for small durable feedback memory.

Required:

- database table for title feedback events
- image evidence storage or image evidence references
- authenticated identity or equivalent operator identity
- write path for feedback creation
- read path for admin review

Likely required depending on current app setup:

- Supabase Auth, if operator identity is managed through Supabase
- Supabase Storage, if the app needs Supabase to persist uploaded front/back image evidence
- Row Level Security policies, if the feedback table is exposed through client-side Supabase access
- service role access, if feedback writes or admin reads happen through trusted server-side routes

Not required for V2.0:

- Realtime
- Edge Functions
- Vector
- database webhooks
- automated retraining jobs
- registry automation

## 4. Environment Variables

V2.0 needs environment variables only for connecting Vercel-hosted app surfaces to Supabase.

Expected variable categories:

- Supabase project URL
- public client key, if client-side Supabase access is used
- server-only service role key, if trusted server-side access is used
- Supabase storage bucket name or image reference namespace, if image evidence is stored in Supabase
- admin access configuration, if admin review is protected separately

Environment variable handling principles:

- public keys may be available to browser code only when protected by appropriate database access rules
- service role keys must remain server-side only
- production and preview environments should use intentionally selected Supabase projects or branches
- local development should use clearly separated local or development credentials

This document does not define exact variable names.

## 5. Authentication Assumptions

V2.0 assumes every feedback event can be associated with an operator.

Acceptable operator identity sources:

- existing application user identity
- Supabase Auth user identity
- trusted internal operator account mapping
- server-side session identity already used by Listing Copilot

The chosen identity must support:

- storing `operator_id`
- showing operator identity in admin review
- preventing anonymous or ambiguous feedback rows in normal production use

V2.0 does not require:

- new user roles beyond operator and admin
- complex permission groups
- per-card ownership modeling
- public user accounts

Admin review assumes a trusted internal admin surface.

## 6. Feedback Save Flow

The feedback save flow happens after title generation and title editing.

Conceptual sequence:

```text
1. Listing Copilot generates title
2. App preserves generated title for the current session
3. App preserves front/back image evidence references for the current asset
4. Operator edits title if needed
5. Operator clicks Save
6. App compares generated title and final saved title
7. If changed, app writes feedback event and image evidence references to Supabase
8. Normal listing save flow completes
```

Required feedback event data:

- generated title
- corrected title
- front image URL or front image reference
- back image URL or back image reference when available
- timestamp
- operator

V2.0 product decision:

- changed titles create feedback events
- unchanged titles do not need to create feedback events

The operator should not see a separate feedback prompt.

## 7. Admin Review Flow

Admin review reads raw feedback memory from Supabase.

Conceptual flow:

```text
Admin Opens Review Surface
  |
App Reads Feedback Rows
  |
Admin Reviews Generated vs Corrected Titles
  |
Admin Identifies Repeated Patterns
  |
Future Registry Notes Are Created Separately
```

Admin review should show:

- timestamp
- operator
- front/back image evidence
- generated title
- corrected title

Admin review does not require:

- approval status
- category labeling
- tags
- explanations
- correction taxonomy
- automated registry updates

The admin surface is for observation and future planning, not for modifying raw memory.

## 8. Minimal Implementation Order

This is the recommended build order for V2.0 when implementation begins.

1. Confirm current Listing Copilot save point
2. Confirm where generated title can be preserved until Save
3. Confirm how front/back image evidence will be stored or referenced
4. Confirm operator identity source
5. Confirm Supabase project and environment separation
6. Add minimal feedback storage with image evidence fields
7. Add feedback write on changed-title Save
8. Add simple admin read view with image evidence display
9. Verify unchanged titles do not create unnecessary feedback rows
10. Verify changed titles capture generated title, corrected title, image evidence, timestamp, and operator
11. Launch V2.0 as raw memory only

Implementation should stop there for V2.0.

Anything involving taxonomy, registry automation, retraining, analytics, or correction classification belongs in V2.1 or later.
