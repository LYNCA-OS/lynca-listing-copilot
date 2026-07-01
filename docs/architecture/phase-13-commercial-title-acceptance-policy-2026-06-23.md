# Phase 13 - Commercial Title Acceptance Policy

Date: 2026-06-23

## Purpose

Real marketplace titles are not always canonical. A title can be commercially acceptable when it uses shorthand, different ordering, or omitted low-risk wording, as long as the critical facts are correct and supported by trusted evidence.

This phase adds a semantic title acceptance policy so the commercial evaluator does not require string equality with a reference title. It still blocks principle-level factual errors such as wrong subject name, wrong color or parallel, wrong serial number, wrong grade, or model fields that conflict with reviewer-approved ground truth.

## Implementation

- `lib/listing/evaluation/title-acceptance-policy.mjs` evaluates final title quality from the title text, reviewer ground-truth fields, model predicted fields, and the dataset critical-field list.
- `lib/listing/evaluation/golden-dataset.mjs` now computes `final_title_required_fields` and `final_title_unsubstantiated_fields` through this policy instead of trusting model-provided booleans.
- `lib/listing/resolver/trusted-name-candidate-resolver.mjs` supports trusted structured-name correction for near misses from internal, official, grading, registry, or public structured card databases.
- `scripts/evaluate-legacy-vision-provider-public-card-images.mjs` now reports both raw strict card-name exact rate and trusted structured-name exact-or-corrected rate.

## Acceptance Rules

Accepted examples:

- `23-24 Prizm Wembanyama Silver PSA 10` can pass for a reviewed `2023-24 Panini Prizm Victor Wembanyama Silver Prizm PSA 10` asset because season shorthand, last-name shorthand, and omitted brand are tolerable when the critical facts are still present.
- A title containing `Black Gold` can pass when `Black Gold` is the reviewed set or product descriptor, because the color words are supported by trusted fields.
- legacy vision provider spelling near misses can be corrected only when a high-similarity, high-margin trusted structured candidate exists.

Rejected examples:

- `Gold Wave` for a reviewed `Silver Prizm` asset fails because color/parallel changed.
- `Victor Wenbanyama` for reviewed `Victor Wembanyama` fails because the subject name changed.
- Missing `31/50` on a serial-numbered card fails when serial number is critical.
- A predicted field of `Topps` fails against reviewed `Panini` when brand is listed as critical, even if the final title omits brand.

## Ground-Truth Boundary

Seller titles and marketplace text remain reference-only. They can help retrieval or candidate discovery, but they cannot become acceptance ground truth.

Trusted correction can use:

- internal approved review history
- internal registry
- official checklist or official product page
- official grading data
- structured card databases

It cannot use open-web snippets or marketplace seller titles as an automatic correction source.

## Commercial Gate Impact

This policy improves how held-out commercial rows will be judged once real approved-review data exists. It does not unlock the commercial readiness gate by itself.

The current public 300-card legacy vision provider run remains non-commercial reference evidence. It now has two useful signals:

- raw strict card-name exact rate
- trusted structured-name exact-or-corrected rate

Commercial readiness still requires a held-out commercial dataset built from approved reviews, including failures and manual corrections.

## Verification

Run:

```bash
npm run test:title-acceptance
node scripts/resolver.test.mjs
node scripts/evaluation-metrics.test.mjs
npm run eval:legacy-vision-provider-public-cards -- --limit 300 --out data/eval/legacy-vision-provider-public-card-image-eval-latest.json
```

The title policy tests cover near-title acceptance, wrong color/parallel rejection, wrong name rejection, missing serial rejection, wrong critical brand field rejection, and legal color words inside a reviewed set name.
