# Listing Copilot Feedback Loop v2

Status: Design Draft v2.0
Owner: LYNCA Listing Intelligence
Companion Documents:

- `database-schema-v2.md`
- `ui-wireframe-v2.md`

## Purpose

Listing Copilot V2 adds the smallest possible memory system for title improvement with image evidence.

The system stores the title Listing Copilot generated, the title an operator actually saved, and the front/back image evidence that explains the correction.

The product principle is:

```text
One Extra Click
```

The operator should not become a data labeler. The feedback loop should be captured as a natural byproduct of saving a corrected listing title.

## Core Workflow

```text
Upload
  |
Generate
  |
Edit Title
  |
Save
```

On save, the system records:

- generated title
- corrected title
- front image URL or front image reference
- back image URL or back image reference
- timestamp
- operator

The save action is the feedback event.

No additional feedback form is required.

## V2.0 Memory Unit

Each saved correction memory unit contains:

- `generated_title`
- `corrected_title`
- `front_image_url` or `front_image_reference`
- `back_image_url` or `back_image_reference`
- `timestamp`
- `operator`

For single-image assets, the front image field is required and the back image field may be empty. For front/back asset pairs, both image references should be stored.

## What V2 Does Not Ask For

V2.0 must not require:

- error category
- tags
- explanation
- classification
- confidence score
- manual evidence annotation
- card type labeling
- registry mapping

These may become useful later, but they are intentionally excluded from the V2.0 capture workflow.

## User Workflow

### 1. Upload

The operator uploads or selects card images using the normal Listing Copilot workflow.

V2.0 does not change image upload behavior.

### 2. Generate

Listing Copilot generates a proposed listing title.

The generated title is preserved internally as `generated_title`.

The image evidence for the asset is preserved as front/back references for the feedback event.

### 3. Edit Title

The operator edits the generated title only if needed.

The editable title field remains the primary user surface. The user does not need to mark what changed or why.

### 4. Save

The operator clicks Save.

If the final title differs from the generated title, Listing Copilot stores a feedback event.

The feedback event includes the image evidence used to generate the title. This is required because future registry and visual distinction review needs image-title pairs, not text-only corrections.

If the final title is identical to the generated title, the product may either skip the event or store it as an accepted title. V2.0 should default to skipping unchanged titles unless acceptance-rate tracking is explicitly needed.

## Admin Workflow

The admin experience is read-only in V2.0.

Admins can review feedback events to understand recurring correction patterns.

### Admin Review Goals

Admins should be able to answer:

- What titles are operators correcting?
- What did the model generate?
- What did the operator save?
- What image evidence produced the correction?
- Who made the correction?
- When did the correction happen?

### Admin Review Behavior

The default admin view is a chronological list of feedback events.

Each row shows:

- timestamp
- operator
- generated title
- corrected title
- front image reference
- back image reference, when available

Admins may manually inspect rows and copy findings into future registry review notes.

V2.0 does not require admin approval, tagging, classification, or correction adjudication.

## Database Tables

V2.0 requires one core feedback table.

Conceptual table:

```text
listing_title_feedback
```

Required fields:

- id
- generated_title
- corrected_title
- front_image_url or front_image_reference
- back_image_url or back_image_reference
- created_at
- operator_id

Recommended optional metadata:

- listing_session_id
- source_listing_id
- image_batch_id

The image fields are part of the V2.0 memory unit, not optional review metadata. If an asset only has one image, the front image field is required and the back image field may be empty.

The optional metadata should only be added if the application already has those identifiers. V2.0 should not create extra workflow requirements just to populate them.

## Supabase Architecture

Supabase is the feedback-memory store.

The application writes one feedback event when the operator saves a corrected title.

Recommended V2.0 flow:

```text
Frontend Save Action
  |
Title Difference Check
  |
Supabase Insert
  |
Saved Listing Continues Normally
```

Supabase responsibilities:

- store feedback rows
- store or reference front/back image evidence
- associate rows with an operator
- provide admin read access
- support future export or review workflows

The title-generation system does not need to read from this memory in V2.0.

## Future Registry Review Process

The feedback table is not the registry.

It is raw memory.

Future registry review should happen as a separate human-admin process:

```text
Feedback Events With Image Evidence
  |
Admin Pattern Review
  |
Registry Candidate Notes
  |
Approved Registry Update
  |
Future Prompt / Resolver Improvement
```

The registry should only absorb a correction pattern after repeated evidence or explicit admin validation.

Examples of future review questions:

- Did operators repeatedly restore the same official insert name?
- Did the model repeatedly collapse a product family?
- Did images show Gold Refractor, Gold Wave Refractor, Orange Raywave, Orange Geometric Refractor, Black Gold, or Dual Logoman Autographs distinctions?
- Did the model omit a serial, parallel, autograph, or grade phrase?
- Did the corrected title reveal a commercially meaningful term?

V2.0 does not automate this process. It only makes the evidence available.

## V2.0 Scope

V2.0 includes:

- capture generated title
- capture corrected title
- capture front image URL or reference
- capture back image URL or reference when available
- capture timestamp
- capture operator
- write feedback on Save
- provide a simple admin review list
- keep the operator workflow nearly unchanged

V2.0 excludes:

- error categories
- tags
- explanations
- correction classification
- model retraining
- automatic registry updates
- prompt auto-editing
- title quality scoring
- semantic diffing
- approval queues

## V2.1 Expansion

V2.1 may add lightweight review tools after V2.0 proves useful.

Potential V2.1 additions:

- accepted-title tracking for unchanged titles
- basic filtering by operator or date
- export to CSV
- manual admin status such as `reviewed`
- link feedback rows to registry candidate notes
- correction frequency counts
- simple before/after diff display
- side-by-side image review

V2.1 should still avoid forcing operators to label errors during normal listing work.

The operator principle remains:

```text
One Extra Click
```
