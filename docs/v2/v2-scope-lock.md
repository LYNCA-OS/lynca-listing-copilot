# Listing Copilot V2.0 Scope Lock

Status: Design Draft v2.0
Owner: LYNCA Listing Intelligence
Companion Documents:

- `feedback-loop-v2.md`
- `database-schema-v2.md`
- `ui-wireframe-v2.md`

## Purpose

This document locks the V2.0 product scope for the Listing Copilot feedback loop.

V2.0 exists to create the smallest possible image-title memory system without turning operators into labelers.

The operating principle is:

```text
One Extra Click
```

The normal workflow remains:

```text
Upload
  |
Generate
  |
Edit Title
  |
Save
```

The stored memory unit is:

- `generated_title`
- `corrected_title`
- `front_image_url` or `front_image_reference`
- `back_image_url` or `back_image_reference`
- `timestamp`
- `operator`

## Must Have

V2.0 must include:

- generated title capture
- corrected title capture
- front image URL or front image reference capture
- back image URL or back image reference capture when available
- timestamp capture
- operator capture
- feedback creation on Save when the title changed
- no required feedback form
- no required correction reason
- no required admin approval before the listing can be saved
- simple admin review of raw before/after title corrections
- clear separation between raw feedback memory and future registry updates

The Save action is the feedback action.

## Nice To Have

V2.0 may include these only if they do not increase operator friction:

- link feedback to an existing listing session
- link feedback to an existing saved listing
- link feedback to an existing image batch
- small image thumbnails in admin review
- basic newest-first admin sorting
- basic admin search by title text
- basic admin filtering by date
- copyable generated and corrected title text

Nice-to-have items must not block launch.

They must not introduce required categories, tags, explanations, or classifications.

## Out Of Scope

V2.0 excludes:

- error category selection
- tag selection
- explanation fields
- correction classification
- operator training labels
- model retraining
- automatic prompt updates
- automatic registry updates
- registry editing UI
- approval queues
- title quality scoring
- semantic diffing
- confidence scoring
- vector memory
- accepted-title analytics
- correction frequency dashboard
- CSV export requirement
- multi-step admin review workflow
- changes to runtime behavior beyond feedback capture design
- database schema changes in this document

V2.0 feedback is raw memory only.

It is not a registry, not a labeling pipeline, and not an automated learning system.

Image evidence is included so future registry review can inspect visual distinctions such as Gold Refractor vs Gold Wave Refractor, Orange Refractor vs Orange Raywave, Orange Geometric Refractor, Black Gold, and Dual Logoman Autographs without asking operators to classify them during Save.

## Success Metrics

V2.0 is successful if:

- operators can complete the normal workflow without any new required labeling step
- corrected titles are captured when operators save changed titles
- each captured event includes generated title, corrected title, image evidence, timestamp, and operator
- admins can review raw correction history
- feedback rows can reveal repeated title-generation and visual-distinction mistakes through human review
- the system creates useful memory without slowing down listing work

Qualitative success:

- operators feel like they are saving listings, not filling out training data
- admins can see what changed without asking operators for explanations
- future registry candidates can be discovered from repeated image-title corrections

## Launch Criteria

V2.0 is ready to launch when:

- the intended user workflow is documented
- the intended admin workflow is documented
- the feedback fields are documented
- the image evidence fields are documented
- the Supabase storage role is documented
- the out-of-scope boundaries are documented
- unchanged titles are explicitly handled by product decision
- the admin review surface can answer:
  - what was generated
  - what was saved
  - which front/back images support the memory event
  - who saved it
  - when it was saved

Launch should not wait for:

- taxonomy design
- registry automation
- model retraining
- advanced analytics
- title diff visualization
- export workflows
- V2.1 review tooling

V2.0 should launch as soon as the smallest memory loop is coherent.
