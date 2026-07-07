# Fixture Set #002 Candidate Discovery

Status: Candidate Discovery Only, No Fixtures Created
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `review-cycle-001-results.md`
- `visual-review-report-001b.md`
- `fixtures/visual-fixture-set-001.md`
- `dataset-snapshot-002.md`

## Scope

This document identifies the next five high-value visual concepts that are not already represented in Fixture Set #001.

No fixtures are created here. No runtime code, registry, resolver, prompt, deployment, or upgrade changes are included.

Fixture Set #001 already covers:

- Sapphire
- Bowman Sapphire / Padparadscha Refractor
- Gold Geometric
- Blue Geometric Refractor
- Purple Raywave Refractor

## Candidate Summary

| Candidate | Concept | Evidence count | Expected fixture role | Expected value |
| --- | --- | ---: | --- | --- |
| `learn-0124` | Red Wave Refractor | 1 | positive | Add wave-pattern coverage not present in Set #001 |
| `learn-0007` | Autograph / card-auto grade split | 5 | positive | Preserve PSA/BGS card-grade vs auto-grade distinctions |
| `learn-0046` | Orange Shimmer, not Orange Sapphire | 2 | negative / confusion | Prevent over-labeling Shimmer as Sapphire |
| `learn-0021` | Series 2 / Major League Material Relic | 3 | confusion / checklist-dependent | Capture relic/set/parallel ambiguity before rule changes |
| `learn-0004` | SSP case-hit / short-print language | 8 | positive / checklist-dependent | Create evidence queue for Shadow Etch, Home Advantage, Pixel Burst SSP review |

## Candidates

### 1. Red Wave Refractor

| Field | Value |
| --- | --- |
| concept | `Red Wave Refractor` |
| evidence count | 1 |
| common confusion | `Red Refractor` |
| representative feedback ids | `07515e36-27e2-4268-bc01-a4e0a61a82cf` |
| expected fixture role | `positive` |
| expected value to Listing Copilot | Adds a clean wave-pattern fixture that is not represented in Fixture Set #001. Useful for testing wave vs generic refractor language. |

Representative image URLs:

| Feedback ID | Front | Back |
| --- | --- | --- |
| `07515e36-27e2-4268-bc01-a4e0a61a82cf` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2ea50875-02f2-413e-8e37-a535b15f0e20/front.jpg` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2ea50875-02f2-413e-8e37-a535b15f0e20/back.jpg` |

Evidence note:

Visual Review #001B marked `learn-0124` visually supported with high confidence. The visual explanation identified a distinct wave-like background foil pattern supporting `Red Wave Refractor` over generic `Red Refractor`.

### 2. Autograph / Card-Auto Grade Split

| Field | Value |
| --- | --- |
| concept | `Autograph / card-auto grade split` |
| evidence count | 5 |
| common confusion | Generic `Auto`, missing set/year, or collapsed PSA/BGS card grade and autograph grade |
| representative feedback ids | `779c2f9d-279b-4e68-96f4-de98b7d4e158`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f` |
| expected fixture role | `positive` |
| expected value to Listing Copilot | Creates durable examples for high-value autograph listings where card grade and auto grade must not be merged or dropped. |

Representative image URLs:

| Feedback ID | Front | Back |
| --- | --- | --- |
| `779c2f9d-279b-4e68-96f4-de98b7d4e158` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg` |
| `33485dc8-b1e1-4341-ad32-5ccdcf2739a4` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/front.jpg` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/back.jpg` |
| `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg` |

Evidence note:

Visual Review #001B marked the Kobe Bryant autograph example visually supported with high confidence. The PSA label and card back supported 2012-13 Panini Prizm Kobe Bryant Autographs with PSA 9 card grade and Auto 10.

### 3. Orange Shimmer, Not Orange Sapphire

| Field | Value |
| --- | --- |
| concept | `Orange Shimmer, not Orange Sapphire` |
| evidence count | 2 |
| common confusion | `Orange Sapphire`, `Sapphire Edition`, generic `Sapphire` upgrade |
| representative feedback ids | `a3b3eb3c-c982-4033-ba51-172d561c1a4b`, `abd544c9-1667-43aa-9a0f-9ef188e2593a` |
| expected fixture role | `negative / confusion` |
| expected value to Listing Copilot | Adds a guardrail fixture against over-promoting Sapphire when the image evidence favors Shimmer or lacks Sapphire indicators. |

Representative image URLs:

| Feedback ID | Front | Back |
| --- | --- | --- |
| `a3b3eb3c-c982-4033-ba51-172d561c1a4b` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d2ef69ea-9ac9-468d-b38e-6d85e3291918/front.jpg` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d2ef69ea-9ac9-468d-b38e-6d85e3291918/back.jpg` |
| `abd544c9-1667-43aa-9a0f-9ef188e2593a` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/db72ccf9-78d4-434d-bda1-36252aec8d0f/front.jpg` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/db72ccf9-78d4-434d-bda1-36252aec8d0f/back.jpg` |

Evidence note:

Visual Review #001B did not mark `learn-0046` visually supported. It found the first representative image aligned with `Orange Shimmer` rather than `Orange Sapphire` and required external checklist review for exact set/parallel naming. This is high-value as a negative or confusion candidate.

### 4. Series 2 / Major League Material Relic

| Field | Value |
| --- | --- |
| concept | `Series 2 / Major League Material Relic` |
| evidence count | 3 |
| common confusion | generic `Topps`, generic `Player-Worn Memorabilia`, unverified `Gold` or `Series 2` title language |
| representative feedback ids | `06ec530c-6a20-4e70-9347-5c8770da261c`, `59bfa141-3795-486d-8e17-6ea8faf3d92f`, `43895330-8edd-479a-a199-007fd36ae798` |
| expected fixture role | `confusion / checklist-dependent` |
| expected value to Listing Copilot | Captures relic/set/parallel ambiguity before any resolver or registry rule tries to infer Series 2 or Gold from incomplete visual evidence. |

Representative image URLs:

| Feedback ID | Front | Back |
| --- | --- | --- |
| `06ec530c-6a20-4e70-9347-5c8770da261c` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/5a55515b-f168-49df-b7d1-500b2f20492f/front.jpg` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/5a55515b-f168-49df-b7d1-500b2f20492f/back.jpg` |
| `59bfa141-3795-486d-8e17-6ea8faf3d92f` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a87d4741-c0f6-4d53-8f62-671c08c84c26/front.jpg` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a87d4741-c0f6-4d53-8f62-671c08c84c26/back.jpg` |
| `43895330-8edd-479a-a199-007fd36ae798` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/17fb4927-6fcf-4d8d-9798-6ac20302f43d/front.jpg` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/17fb4927-6fcf-4d8d-9798-6ac20302f43d/back.jpg` |

Evidence note:

Visual Review #001B marked `learn-0021` as visually supported but also visually uncertain and needing an external checklist. The material/relic evidence was supported, while `Series 2` and `Gold` were not fully visible.

### 5. SSP Case-Hit / Short-Print Language

| Field | Value |
| --- | --- |
| concept | `SSP case-hit / short-print language` |
| evidence count | 8 |
| common confusion | Missing `SSP`, missing product/year context, treating case-hit names as generic cards |
| representative feedback ids | `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9` |
| expected fixture role | `positive / checklist-dependent` |
| expected value to Listing Copilot | Prioritizes a recurring high-value correction class before any system change: Shadow Etch, Home Advantage, Pixel Burst, and other SSP/case-hit language need stable evidence packages. |

Representative image URLs:

| Feedback ID | Front | Back |
| --- | --- | --- |
| `02ba3de0-42f7-4139-9967-748d7c78d5e6` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg` |
| `a330845d-4308-4997-b9ab-9667b8899455` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg` |
| `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/front.jpg` | `https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/back.jpg` |

Evidence note:

Review Cycle #001 surfaced `SSP` as an eight-example repeated correction. This concept was not part of Fixture Set #001. It should be treated as a candidate discovery target, not as a verified fixture, because SSP/case-hit status often requires checklist or product-specific confirmation.

## Not Created

This document does not create Fixture Set #002. It only identifies candidate concepts and representative evidence for a later human-reviewed fixture selection step.

No runtime code, registry, resolver, prompt, or upgrade changes were made.

