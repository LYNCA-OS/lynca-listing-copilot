# Listing Copilot V2.0 Memory Layer Implementation Plan

Status: Analysis Draft v2.0
Owner: LYNCA Listing Intelligence
Companion Documents:

- `feedback-loop-v2.md`
- `database-schema-v2.md`
- `supabase-integration-plan.md`
- `ui-wireframe-v2.md`
- `v2-scope-lock.md`

## Purpose

This document reviews the current Listing Copilot codebase and identifies the smallest implementation path for the V2.0 Memory Layer.

It is analysis only. It does not include implementation code.

## Summary Finding

Current Listing Copilot is a generate-and-copy tool.

It does not currently have:

- editable title state
- a Save action
- a saved listing object
- a feedback endpoint
- an admin review surface
- Supabase integration

Therefore, the smallest V2.0 Memory Layer path is to add the first minimal edit-and-save loop around the existing generated title result, then write changed titles to Supabase.

## 1. Current Title-Generation Flow

The browser workflow lives in:

- `app/listing-copilot.js`
- `app/index.html`

The title API lives in:

- `api/listing-copilot-title.js`

Current generation sequence:

```text
Upload Images
  |
Build Assets
  |
Click Start Generate
  |
processTitles()
  |
processAsset(asset)
  |
POST /api/listing-copilot-title
  |
OpenAI or fallback title result
  |
state.results
  |
renderResults()
```

Important current locations:

- `app/listing-copilot.js:15` defines top-level browser state.
- `app/listing-copilot.js:171` builds the generation request body.
- `app/listing-copilot.js:533` posts each asset to `/api/listing-copilot-title`.
- `app/listing-copilot.js:575` coordinates batch generation.
- `app/listing-copilot.js:594` pushes generated results into `state.results`.
- `api/listing-copilot-title.js:1282` creates the OpenAI title.
- `api/listing-copilot-title.js:1349` handles `POST /api/listing-copilot-title`.
- `api/listing-copilot-title.js:1377` chooses OpenAI generation or fallback generation.

The generated title returned from the API is stored as `result.title` inside `state.results`.

## 2. Current Editable Title State

There is no editable title state today.

The current UI renders generated titles into read-only textareas:

- `app/listing-copilot.js:388` renders pending read-only output.
- `app/listing-copilot.js:405` renders generated result output as read-only.

The batch title summary also renders static generated title text:

- `app/listing-copilot.js:327` renders the batch title list.
- `app/listing-copilot.js:336` maps generated results into list items.

The only title interaction today is copy:

- `app/listing-copilot.js:612` copies one title.
- `app/listing-copilot.js:624` copies all generated titles.

Smallest V2.0 implication:

The existing `state.results` array should remain the source of the original generated title, and V2.0 should introduce a separate corrected title value per result.

Conceptually:

```text
result.title = generated_title
result.correctedTitle = current editable title value
```

No correction categories, tags, explanations, or classifications are needed.

## 3. Current Save Action

There is no current Save action.

Current action buttons:

- upload images
- start generation
- copy one title
- copy all titles
- reset

Relevant locations:

- `app/index.html:71` upload button
- `app/index.html:72` start generation button
- `app/index.html:94` copy-all button
- `app/listing-copilot.js:403` per-title copy button
- `app/listing-copilot.js:680` binds generate
- `app/listing-copilot.js:681` binds reset
- `app/listing-copilot.js:682` binds copy all
- `app/listing-copilot.js:691` delegates per-title copy

Smallest V2.0 implication:

A minimal Save action must be added. Since there is no listing persistence yet, V2.0 Save should mean:

```text
Save corrected title feedback for this generated result.
```

It should not imply eBay listing creation, inventory creation, image storage, or full listing persistence.

## 4. Smallest Capture Point

The smallest capture point is the per-asset result card after generation.

Why:

- the generated title already exists in `state.results`
- the asset index already exists
- the UI already renders one title output per asset
- the operator naturally reviews one generated title at a time
- adding Save at this layer avoids changing the title-generation API

Smallest conceptual capture:

```text
generated_title: result.title
corrected_title: current editable textarea value
timestamp: server-side creation time
operator: authenticated session user
```

Recommended capture boundary:

```text
Browser Result Card
  |
Save Corrected Title
  |
POST New Feedback Endpoint
  |
Server Validates Session
  |
Server Writes Supabase Row
```

The timestamp should be assigned server-side or by Supabase default time, not trusted from the browser.

The operator should be derived from the existing signed session cookie, not entered by the user.

## 5. New Files Likely Required

Likely new files:

- `api/listing-title-feedback.js`
- `api/admin-title-feedback.js`
- `lib/listing-session.mjs`
- `lib/supabase-feedback.mjs`
- `app/admin-feedback.html`
- `app/admin-feedback.js`
- `app/admin-feedback.css`

Purpose by file:

`api/listing-title-feedback.js`

Server endpoint for saving feedback rows. It should authenticate the session, accept generated/corrected title payload, ignore unchanged titles, and write to Supabase.

`api/admin-title-feedback.js`

Server endpoint for reading recent feedback rows for an internal admin review screen.

`lib/listing-session.mjs`

Shared session parsing and operator extraction. The current cookie parsing and signing logic is duplicated across auth-related files and the title API; V2.0 should avoid duplicating it again.

`lib/supabase-feedback.mjs`

Small server-side helper for writing and reading feedback memory. This keeps Supabase details out of UI code and out of the title-generation endpoint.

`app/admin-feedback.html`

Minimal admin review page for raw feedback rows.

`app/admin-feedback.js`

Minimal browser logic for loading and rendering feedback rows.

`app/admin-feedback.css`

Optional only if the existing stylesheet should not carry admin-specific review layout.

Smallest alternative:

Admin review could be deferred to Supabase Table Editor for the very first internal launch. If so, only the feedback save endpoint and session/Supabase helpers are required. That would reduce V2.0 app UI scope, but it would not satisfy the previously described in-app admin review surface.

## 6. Existing Files Likely Modified

Likely modified files:

- `app/listing-copilot.js`
- `app/index.html`
- `app/listing-copilot.css`
- `api/login.js`
- `api/session.js`
- `api/listing-copilot-title.js`
- `middleware.js`
- `package.json`
- `vercel.json`

Expected modification purpose:

`app/listing-copilot.js`

Introduce corrected title state per generated result, render editable title fields, add Save button behavior, and call the feedback save endpoint.

`app/index.html`

Possibly add navigation or entry point for admin review. The core per-result Save button can likely be rendered by existing JavaScript without changing static HTML.

`app/listing-copilot.css`

Style editable title fields, Save button state, saved status, and possibly admin review UI if it shares the same stylesheet.

`api/login.js`

May remain mostly unchanged, but the session payload should be treated as the source of `operator`. If shared session utilities are introduced, this file would likely import them.

`api/session.js`

May expose the current operator for the browser or admin screen if needed. At minimum, shared session utilities should prevent more cookie parsing duplication.

`api/listing-copilot-title.js`

Should not need title-generation behavior changes. It may only be touched if session validation is moved into a shared helper.

`middleware.js`

May need to protect admin review paths if an in-app admin review page is added.

`package.json`

May need a Supabase dependency if the implementation uses the Supabase JavaScript client. If implementation uses Supabase REST from server functions, this may not be necessary.

`vercel.json`

May need rewrites for an admin review route, such as `/admin/feedback`.

## 7. Recommended Implementation Order

Recommended smallest order:

1. Extract or define shared session/operator handling.
2. Decide whether admin review is in-app for V2.0 or Supabase Table Editor for initial internal launch.
3. Add server-side Supabase feedback helper.
4. Add feedback save endpoint.
5. Preserve generated title as immutable per-result memory in `state.results`.
6. Add corrected title state per result.
7. Make per-result title field editable.
8. Add per-result Save action.
9. Save only when corrected title differs from generated title.
10. Capture operator from the signed session, not from user input.
11. Capture timestamp server-side or in Supabase.
12. Add minimal admin read endpoint.
13. Add minimal admin review page if required for V2.0 launch.
14. Verify no error category, tags, explanation, or classification entered the workflow.

Recommended implementation stop point:

```text
Generated title
  |
Operator edits title
  |
Operator clicks Save
  |
Changed title writes one raw feedback row
  |
Admin can read raw before/after rows
```

Anything beyond that belongs in V2.1.

## Risks And Constraints

### No Existing Save Concept

Because the current product only copies titles, V2.0 must define Save narrowly. It should mean saving feedback memory, not saving a full marketplace listing.

### Read-Only Title UI

The current result UI is intentionally read-only. V2.0 needs a small UI behavior change before feedback can exist.

### Operator Identity Is Present But Not Exposed

The login cookie includes a normalized `user` value, but current session checks mostly return only authenticated true/false.

The smallest operator capture path is server-side cookie decoding inside the feedback endpoint.

### Auth Logic Is Duplicated

Cookie parsing and session validation exist in multiple files. A V2.0 feedback endpoint would otherwise repeat this logic again.

Smallest clean-up with practical value:

Move shared session parsing and operator extraction into one helper before adding the feedback endpoint.

### Admin Review May Be Optional For First Internal Memory

If the goal is fastest possible memory capture, admin review can initially happen inside Supabase. If the goal is product-complete V2.0 per the design docs, add a minimal read-only admin page.

## Direct Answers

1. Current title-generation flow:

`app/listing-copilot.js` handles upload, asset creation, API calls, and rendering. `api/listing-copilot-title.js` handles title generation.

2. Editable title state:

It does not exist. Generated titles are stored in `state.results` as `result.title` and rendered read-only.

3. Save action:

It does not exist. Current user actions are generate, copy, copy all, and reset.

4. Smallest capture place:

The per-asset result card in `app/listing-copilot.js`, backed by a new server endpoint that writes generated title, corrected title, timestamp, and operator.

5. New files likely required:

At minimum, a feedback save API file and a Supabase feedback helper. For in-app admin review, add an admin read API and admin review app files.

6. Existing files likely modified:

Primarily `app/listing-copilot.js` and `app/listing-copilot.css`, with possible small changes to auth/session files, `package.json`, `middleware.js`, and `vercel.json`.

7. Recommended order:

Start with session/operator extraction, then server feedback write, then editable title state, then Save UI, then admin read/review.

