# Listing Copilot Visual Verification Layer V1

Status: Design Draft v1
Owner: LYNCA Listing Intelligence
Companion Documents:

- `visual-registry-v1.md`
- `visual-concept-extraction-001.md`
- `review-cycle-001-results.md`
- `learning-console-v2.1.md`

## Purpose

The Visual Verification Layer introduces a mandatory image-review stage between review candidates and visual concepts.

Current risk:

```text
generated_title -> corrected_title
```

can suggest a visual concept that is not actually supported by the images.

Example:

```text
Generated: Bowman Chrome
Corrected: Bowman Sapphire
```

This correction alone does not prove the card is Sapphire. The title difference may reflect operator preference, checklist knowledge, text on the back, a product-line correction, or a mistake. No visual concept may be promoted to Tier A or Tier B from title comparison alone.

## Core Rule

No visual concept may be promoted to Tier A or Tier B without image review.

Title diffs can nominate concepts. Images must verify them.

## Workflow

```text
Candidate
  |
Representative Images
  |
Visual Review
  |
Concept Verification
  |
Visual Registry Candidate
```

The Visual Verification Layer sits between:

```text
Review Candidates
  |
Visual Concepts
```

It converts text-derived candidates into visually reviewed concept candidates.

## Non-Goals

Visual Verification Layer V1 does not:

- modify runtime title generation
- mutate the registry
- add resolver behavior
- edit prompts
- deploy upgrades
- auto-approve visual concepts
- train or fine-tune a model
- create RAG or vector memory
- replace human review

## Candidate Input

Each candidate entering visual verification should include:

| Field | Purpose |
| --- | --- |
| `candidate_id` | Review candidate identifier |
| `proposed_visual_concept` | Concept inferred from correction pattern |
| `feedback_ids` | Source feedback records |
| `front_image_url` | Representative front image URL |
| `back_image_url` | Representative back image URL, when available |
| `generated_title` | Generated title before correction |
| `corrected_title` | Operator-saved corrected title |
| `likely_change_types` | Existing V2.1 detected change types |
| `text_evidence_count` | Count from title-diff grouping before visual review |

`text_evidence_count` must never be treated as visual evidence count.

## Required Review Actions

For each candidate, the reviewer must:

1. Load representative `front_image_url`.
2. Load representative `back_image_url`, when available.
3. Inspect whether the proposed visual concept is visible, text-supported, checklist-supported, or unsupported.
4. Record a verification outcome.
5. Assign visual confidence.
6. Decide whether the candidate can become a Visual Registry candidate.

The reviewer should inspect up to 5 representative examples for grouped candidates before assigning Tier A or Tier B.

## Verification Outcomes

Each candidate must receive one verification outcome.

| Outcome | Meaning |
| --- | --- |
| `visually_supported` | The concept is visible in the image evidence itself |
| `visually_uncertain` | The image may support the concept, but the visual signal is ambiguous |
| `text_only` | The correction is supported only by title text, back text, slab text, checklist text, or operator wording, not by visual appearance |
| `needs_external_checklist` | The image is insufficient; external checklist or product reference is required |

### visually_supported

Use when the visual concept can be seen directly.

Examples:

- wave pattern is visible for Wave or Gold Wave
- geometric surface pattern is visible for Geometric
- signature is visible for Auto
- relic/patch window is visible for Patch or Relic

### visually_uncertain

Use when the image may support the concept, but an admin cannot confidently distinguish it from a neighboring concept.

Examples:

- Gold Refractor vs Gold Wave where texture is unclear
- Shimmer vs Sapphire where image compression hides pattern
- Star Fractor vs other Cosmic Chrome treatments where star pattern is hard to see

### text_only

Use when the correction may be correct, but it is not visually verified.

Examples:

- `Bowman Chrome` corrected to `Bowman Sapphire` because of back text or checklist knowledge, not visible surface evidence
- `Topps Chrome` corrected to `Topps Chrome Platinum` from product naming
- `RC` or `Rookie` added from title convention

Text-only candidates may become registry, prompt, documentation, or test case candidates, but they cannot become Tier A or Tier B visual concepts.

### needs_external_checklist

Use when visual review cannot decide the concept and the correct answer depends on a release checklist, product configuration, serial-number mapping, or official naming.

Examples:

- Padparadscha naming
- Sapphire Edition vs Sapphire parallel
- short-print or SSP status
- product-year identity from release checklist

## Visual Confidence

Visual confidence is assigned after image review.

| Confidence | Meaning |
| --- | --- |
| High | Multiple representative images clearly support the concept and common confusions are accounted for |
| Medium | At least one image supports the concept, but more examples or negative cases are needed |
| Low | Evidence is ambiguous, text-derived, missing, or dependent on external checklist confirmation |

Visual confidence is separate from text evidence count.

High text evidence with low visual confidence must not become Tier A or Tier B.

## Promotion Rules

### Tier A

Tier A requires visual verification.

Minimum requirements:

- verification outcome is `visually_supported`
- visual confidence is `High`
- at least 3 representative image-backed examples are reviewed
- at least 1 common confusion or negative example is considered
- reviewer confirms the concept is visually distinguishable
- linked feedback ids are recorded
- review notes explain the visual cues

Tier A means ready for Visual Registry candidate drafting. It does not mean ready for runtime behavior.

### Tier B

Tier B requires partial visual support.

Minimum requirements:

- verification outcome is `visually_supported` or `visually_uncertain`
- visual confidence is `Medium` or higher
- at least 1 representative image-backed example is reviewed
- common confusions are listed
- reviewer notes what additional evidence is needed

Tier B concepts are promising but require more evidence before registry, resolver, or prompt proposals.

### Tier C

Tier C may remain text-derived.

Allowed cases:

- verification outcome is `text_only`
- verification outcome is `needs_external_checklist`
- visual confidence is `Low`
- no representative images are available
- images are too ambiguous to support the concept

Tier C concepts remain watchlist items. They may become test-case or checklist-review candidates, but they are not visual registry candidates until verified.

## Visual Verification Record

Each reviewed candidate should produce a verification record.

Recommended format:

```json
{
  "candidate_id": "learn-0016",
  "proposed_visual_concept": "Sapphire",
  "verification_outcome": "needs_external_checklist",
  "visual_confidence": "Low",
  "reviewed_images": [
    {
      "feedback_id": "feedback-id",
      "front_image_url": "https://example/front.jpg",
      "back_image_url": "https://example/back.jpg",
      "generated_title": "2025 Bowman Chrome Player Auto",
      "corrected_title": "2025 Bowman Sapphire Player Chrome Auto",
      "image_review_result": "text_only",
      "review_note": "Correction says Sapphire, but image review alone does not prove Sapphire product identity."
    }
  ],
  "common_confusions": ["Chrome", "Sapphire Edition", "Sapphire parallel"],
  "promotion_allowed": false,
  "allowed_tier": "Tier C",
  "next_action": "Check official checklist before Visual Registry promotion."
}
```

## Visual Registry Candidate Requirements

A Visual Registry candidate may be created only after visual verification.

Required fields:

- canonical name
- verification outcome
- visual confidence
- representative reviewed images
- common confusions
- evidence count from visually reviewed examples
- linked feedback ids
- review status
- reviewer notes

The Visual Registry must distinguish:

```text
text_evidence_count
visual_evidence_count
```

Only `visual_evidence_count` can support Tier A or Tier B.

## Impact On Visual Concept Extraction #001

`visual-concept-extraction-001.md` should be treated as pre-verification extraction.

Its Tier A and Tier B labels mean:

```text
candidate priority before image verification
```

They do not mean:

```text
verified visual concept
```

Before any concept from Extraction #001 can become a Visual Registry candidate, it must pass this Visual Verification Layer.

## Safety Principles

- No automatic learning.
- No registry mutation.
- No resolver mutation.
- No prompt mutation.
- No RAG.
- No fine-tuning.
- No visual concept promotion from title diffs alone.
- Human visual review is required before Tier A or Tier B.

## Success Criteria

Visual Verification Layer V1 is successful if:

- title-derived visual candidates are clearly separated from visually verified concepts
- every Tier A concept has high visual confidence
- every Tier B concept has partial visual support
- Tier C can safely hold text-only or checklist-dependent concepts
- false visual concepts are blocked before they reach the Visual Registry
- runtime behavior remains unchanged until separate approved implementation work

