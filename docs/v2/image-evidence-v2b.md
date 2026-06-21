# Listing Copilot V2.0B Image Evidence Design

Status: Design Draft v2.0B
Owner: LYNCA Listing Intelligence
Companion Documents:

- `feedback-loop-v2.md`
- `database-schema-v2.md`
- `implementation-plan-v2.md`
- `supabase-integration-plan.md`

## Purpose

V2.0B adds image evidence to the validated V2.0A feedback loop.

V2.0A proved:

```text
Generate title
  |
Edit title
  |
Save
  |
Insert feedback row into Supabase
```

V2.0B keeps the same operator workflow and stores front/back image evidence alongside new feedback rows.

## Product Principle

```text
One Extra Click
```

The operator should not do anything beyond the existing Save action.

V2.0B must not add:

- registry workflow
- analytics workflow
- admin dashboard
- tags
- classifications
- labeling UI
- explanation fields
- image attachment step

## Storage Decision

For V2.0B MVP, keep the existing `listing_title_feedback` table columns:

- `front_image_url`
- `back_image_url`

These fields should store stable Supabase Storage URLs.

They should not store raw object paths.

No new schema columns are required for the V2.0B MVP.

## Supabase Storage Bucket

Use one private Supabase Storage bucket:

```text
listing-feedback-images
```

The bucket is private so image evidence remains internal.

The server-side feedback save flow is responsible for uploading images and writing stable URLs into the feedback row.

## Image Source

V2.0B should reuse the images already uploaded for title generation whenever possible.

The operator should not re-upload images.

The browser already holds optimized front/back image data for the generated asset. V2.0B can pass that existing image evidence to the server during Save.

## V2.0B Feedback Row

For new V2.0B rows:

```text
generated_title: populated
corrected_title: populated
front_image_url: stable Supabase Storage URL
back_image_url: stable Supabase Storage URL or null
operator_id: populated
created_at: populated
```

Single-image asset:

```text
front_image_url populated
back_image_url null
```

Front/back asset:

```text
front_image_url populated
back_image_url populated
```

## V2.0A Compatibility

Existing V2.0A rows remain valid.

V2.0A rows may have:

```text
front_image_url null
back_image_url null
```

This is expected and should not be treated as an error.

V2.0B should only populate image URLs for new feedback rows created after V2.0B is deployed.

No backfill is required for V2.0B MVP.

## Recommended Server Flow

Recommended V2.0B save flow:

```text
Operator clicks Save
  |
Browser sends generated title, corrected title, and existing front/back image data
  |
Server validates changed title
  |
Server uploads front/back images to listing-feedback-images
  |
Server creates stable Supabase Storage URLs
  |
Server inserts listing_title_feedback row with image URLs
```

The feedback row should not be created if the title did not change.

## URL Stability

`front_image_url` and `back_image_url` should be stable enough for future review.

For the V2.0B MVP, stable URL means:

- it can be stored in the table
- it can be resolved later by trusted internal tooling
- it does not depend on the operator's browser session
- it is not a temporary blob URL or data URL

If signed URLs are used, the stored value should not be a short-lived signed URL. Store a stable Supabase Storage URL format that can be resolved by trusted server-side code.

## Out Of Scope

V2.0B does not include:

- registry automation
- analytics
- admin dashboard
- image labeling
- visual classification
- correction categories
- tags
- explanation prompts
- model retraining
- V2.0A image backfill
- new table columns

V2.0B only adds image evidence storage for new feedback rows.

