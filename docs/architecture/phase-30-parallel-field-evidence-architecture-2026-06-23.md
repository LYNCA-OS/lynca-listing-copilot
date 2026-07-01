# Phase 30 - Parallel Field Evidence Architecture

Date: 2026-06-23

## Decision

LYNCA should not rely on a single full-card VLM call as the final identity authority.

The next recognition architecture should use a two-layer perception plan:

1. Full-card pass for global context and coarse candidate identity.
2. Parallel targeted field probes for high-risk identity fields.
3. Identity Resolution System as the only final field-level decision layer.
4. ABSTAIN / rescan / human review when evidence remains conflicting or weak.

This is an accuracy-and-latency architecture. Cost is a lower priority and should be optimized only after the acceptance gate is stable.

## Research Signals

Primary research and implementation references reviewed:

- Multi-stage field extraction with OCR and compact VLMs: https://arxiv.org/abs/2510.23066
- BLOCKIE semantic block extraction for visually rich documents: https://arxiv.org/abs/2505.13535
- VGR visual grounded reasoning with region detection and replay: https://arxiv.org/html/2506.11991v1
- DocVLM OCR-enhanced VLM reading efficiency: https://openaccess.thecvf.com/content/CVPR2025/html/Nacson_DocVLM_Make_Your_VLM_an_Efficient_Reader_CVPR_2025_paper.html
- VLM OCR abstention via latent representation probes: https://arxiv.org/html/2511.19806v1
- Baidu Unlimited-OCR release: https://github.com/baidu/Unlimited-OCR

Relevant conclusions for card identity:

- Multi-stage extraction is a better fit than one-shot full-image extraction when the task has local fields and business-critical errors. The financial-document pipeline reports large accuracy and latency gains by narrowing the visual scope before structured extraction.
- Region replay / grounding is the right mental model for serials, grade labels, card codes, and color parallels: locate the visual evidence, then answer from that region.
- OCR text alone is not enough for card identity because layout and visual surface matter. OCR should become evidence, not truth.
- Abstention is a first-class system behavior. A model saying "HIGH confidence" is not a reliable fact; agreement, source priority, structural validity, and conflict intensity should drive routing.
- Unlimited-OCR is relevant as a future local OCR specialist, but it is not an immediate production dependency because it requires GPU hosting and was released on 2026-06-23. Treat it as a candidate OCR provider behind an adapter.

## Proposed Runtime Plan

For each card:

1. Generate or reuse signed URLs for front/back images.
2. Run one global legacy vision provider pass:
   - purpose: coarse identity, title draft, visible field list
   - output source: `MODEL_INFERENCE`
   - never final truth by itself
3. Run targeted probes in parallel when fields are critical or global pass is uncertain:
   - `subject_probe`: player/character/team
   - `year_product_probe`: year, manufacturer, product, set, insert
   - `serial_probe`: serial number and denominator
   - `grade_probe`: slab company, card grade, auto grade, grade type
   - `parallel_probe`: color, refractor/parallel/variation
   - `checklist_probe`: collector number and checklist code
4. Convert every probe result into evidence items with:
   - field
   - value
   - source
   - confidence
   - image role
   - region role
   - prompt profile
   - model id
5. Feed evidence into `resolveIdentity`.
6. Only non-ABSTAIN identity may render an AI-complete title.

## Probe Trigger Rules

Default for commercial mode:

- Always run `subject_probe`, `year_product_probe`, and `parallel_probe`.
- Run `serial_probe` if either title/reference/global pass/OCR sees a slash-number pattern, or the card appears numbered.
- Run `grade_probe` if slab-like surface, grade label region, or grade text is visible.
- Run `checklist_probe` for back images and card-code crop regions.
- Run a second probe only when the first probe conflicts with global evidence or produces low confidence.

This gives fast parallelism without exploding calls blindly.

## Image Strategy

Use three image scopes:

- `full_front/full_back`: for global identity and product context.
- `region_crop`: deterministic crop roles already represented by `crop-planner.mjs` such as serial, card code, grade label, and year/product.
- `model_selected_region`: future grounding stage where a model returns bounding boxes, then the system replays crops.

The near-term implementation can start with signed full images plus static crop roles. The later implementation should add dynamic region selection.

## Why This Should Be Faster

The current single-process evaluation is slow because every item waits for one large full-image call. The improved architecture speeds up production in two ways:

- Within one card, targeted probes run concurrently.
- Across cards, queue-level concurrency can be controlled separately from per-card probe concurrency.

The system should enforce two concurrency budgets:

- `CARD_CONCURRENCY`: number of cards processed at once.
- `PROBE_CONCURRENCY_PER_CARD`: number of field probes per card.

This avoids overloading legacy vision provider while still exploiting parallelism.

## Why This Should Be More Accurate

Card-title failures are mostly identity-field failures, not grammar failures.

Targeted probes reduce error modes:

- Serial: crop/probe focuses on small slash-number text and avoids title hallucination.
- Grade: slab label probe outranks front/back visual guess.
- Parallel/color: dedicated probe forces visible color evidence and can conflict with global guess.
- Player/product: separate global and text probes create independent evidence for resolver agreement.

Identity Resolution then decides per field, so a wrong color probe does not corrupt player/year, and a good serial probe can override weak global output.

## Expected Output Shape

Add a sidecar object to recognition output:

```json
{
  "perception_plan": {
    "strategy": "GLOBAL_PLUS_PARALLEL_FIELD_PROBES",
    "card_concurrency": 4,
    "probe_concurrency_per_card": 4,
    "probes": []
  },
  "evidence_items": [],
  "identity_resolution": {},
  "per_field_probe_report": {
    "serial_number": {
      "attempted": true,
      "latency_ms": 0,
      "provider_error": null,
      "evidence_count": 0
    }
  }
}
```

## Evaluation Plan

Run three reports on the same 248 image-backed Supabase cohort:

1. `baseline_full_card_legacy-vision-provider`: current one-pass image eval.
2. `parallel_field_probe_v1`: global pass plus static targeted probes.
3. `parallel_field_probe_v2`: global pass plus targeted probes plus low-confidence retry.

Compare:

- parsed success rate
- corrected-title exact proxy
- critical title error rate
- wrong year / serial / grade / color rates
- provider error rate
- median and p95 latency
- provider calls per card
- ABSTAIN rate

Do not claim commercial exact-resolution accuracy until reviewed field-level ground truth exists.

## Unlimited-OCR Position

Unlimited-OCR should be evaluated as an optional OCR evidence provider, not as the identity solver.

Near-term use:

- Extract all visible text from front/back images or crops.
- Feed extracted text as `OCR_ONLY` / `CARD_FRONT_PRINTED_TEXT` / `CARD_BACK_PRINTED_TEXT` evidence.
- Use it to support or contradict legacy vision provider, not to override slab/registry.

Production constraints:

- Requires GPU hosting or a managed inference endpoint.
- Newly released on 2026-06-23, so it needs sandbox evaluation before production.
- Must be wrapped behind the same provider safety controls: timeout, retries, model id whitelist, no secret logging, no long-lived signed URLs.

## Implementation Steps

1. Add `lib/listing/perception/field-probe-plan.mjs`.
2. Add `scripts/evaluate-legacy-vision-provider-parallel-field-probes.mjs`.
3. Add prompt profiles for each probe, returning only one narrow JSON object.
4. Reuse `createListingImageSignedReadUrl` for all image inputs.
5. Convert probe outputs into Identity Resolution evidence items.
6. Add a report merger that compares baseline vs field-probe metrics.
7. Keep this behind a feature flag until the 248-image cohort shows improvement.

## Non-Goals

- Do not replace Identity Resolution with model confidence.
- Do not let marketplace text override card/slab/registry evidence.
- Do not train on manual test feedback yet.
- Do not store signed URLs.
- Do not make the feedback image bucket public.
