# Visual Concept Extraction #001

Status: Pre-Verification Knowledge Extraction Only
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22T09:09:41.900Z

## Critical Safety Note

This extraction is derived primarily from generated-title vs corrected-title patterns.

The Tier A and Tier B labels below are extraction priority labels only. They are not verified visual concept tiers.

No concept in this document may be promoted to Visual Registry Tier A or Tier B until it passes the mandatory Visual Verification Layer defined in `visual-verification-layer-v1.md`.

Title correction alone does not prove visual identity. For example, `Bowman Chrome` corrected to `Bowman Sapphire` does not prove the card is visually Sapphire.

## Safety Status

- Runtime code was not modified.
- Registry data was not modified.
- Resolver logic was not modified.
- Prompts were not modified.
- No upgrades were deployed or installed.
- This document extracts visual knowledge only.
- No visual concept is verified by this document alone.

## Inputs

- `docs/v2/review-cycle-001-results.md`
- `data/learning/review-candidates-2026-06-22.json`
- `docs/v2/visual-registry-v1.md`

## Method

The extraction reviewed visual-confusion candidates and all image-backed review candidates in `review-candidates-2026-06-22.json`. Candidates were grouped by visual concept terms found in pattern labels, generated titles, corrected titles, and representative examples. Evidence counts below are linked candidate evidence counts, not approval counts. They indicate how much Cycle #001 evidence touched a concept, but they do not prove the concept is correct.

Pre-verification tier definitions:

- Tier A: strong extraction candidate, must pass visual verification before Visual Registry candidate drafting.
- Tier B: promising extraction candidate, must show partial visual support before Visual Registry promotion.
- Tier C: insufficient evidence, keep on watchlist.

## Top Visual Concepts

| Concept | Tier | Evidence count | Candidate groups | Review status | Suggested next action |
| --- | --- | ---: | ---: | --- | --- |
| Sapphire | A | 36 | 23 | `candidate` | Create Visual Registry candidate; split Product Line vs Sapphire parallel/edition before any proposal. |
| Refractor | A | 97 | 92 | `candidate` | Create broad parent Visual Registry candidate, then split into color and pattern child concepts. |
| Auto / Autograph | A | 104 | 125 | `candidate` | Create image-backed test case set for visible signature vs title wording. |
| Patch / Relic | A | 20 | 25 | `candidate` | Create Visual Registry candidates for memorabilia classes; collect negative examples. |
| Shimmer | B | 38 | 9 | `needs_more_evidence` | Promising finish concept; collect more examples and separate from Sapphire/Refractor. |
| Geometric | B | 10 | 10 | `needs_more_evidence` | Promising visual finish; accept strongest examples as test cases before resolver work. |
| Wave / Raywave | B | 9 | 12 | `needs_more_evidence` | Promising but sparse; separate Wave, Red Wave, Purple Wave, and Raywave. |
| Cosmic Chrome | B | 7 | 5 | `needs_more_evidence` | Promising product-line concept; verify release identity from back/checklist evidence. |
| Star Fractor | B | 5 | 3 | `needs_more_evidence` | Promising but tied to few examples; accept as test case first. |
| Gold Refractor | B | 48 | 21 | `needs_more_evidence` | Common color/finish concept; separate from Gold Wave, Gold Geometric, Gold Sapphire. |
| Orange Refractor | B | 25 | 16 | `needs_more_evidence` | Common color/finish concept; review against Star Fractor, Sapphire, and red/orange swaps. |
| Platinum | B | 10 | 8 | `needs_more_evidence` | Likely product-line/title identity issue; separate Topps Chrome Platinum from generic Chrome. |
| Padparadscha | C | 14 | 4 | `needs_more_evidence` | Insufficient distinct evidence; keep as watchlist/test-case candidate only. |
| Gold Wave | C | 0 | 0 | `insufficient_evidence` | No direct Cycle #001 evidence found; seed as watchlist concept only. |

## Tier A: Strong Visual Concepts

### Sapphire

Tier: A
Concept family: product finish / product line
Evidence count: 36
Candidate groups: 23
Review status: `candidate`
Common confusions: Chrome (23), Refractor (18), Auto (15), Orange (13), Gold (10), RC (9)
Suggested next action: Create Visual Registry candidate; split Product Line vs Sapphire parallel/edition before any proposal.

Representative image evidence:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `4fa7153f-46c0-422a-946f-08874260eea8`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/89a399e3-f5a6-4853-b18c-d625e541c9cd/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/89a399e3-f5a6-4853-b18c-d625e541c9cd/back.jpg)
  Generated: 2025 Bowman Chrome Caleb Wilson 1st Auto 1/1
  Corrected: 2025 Bowman Sapphire Caleb Wilson Chrome Auto Padparadscha Refractor 1st 1/1 RC
- Feedback ID: `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/cb52a56e-9dbd-4c8a-9e9d-6c5ca65878e9/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/cb52a56e-9dbd-4c8a-9e9d-6c5ca65878e9/back.jpg)
  Generated: 2025 Bowman Chrome Cooper Flagg RC Red Refractor 1/5
  Corrected: 2025 Bowman Sapphire Cooper Flagg Chrome Red Refractor Rookie 1/5 RC

### Refractor

Tier: A
Concept family: parallel / surface finish
Evidence count: 97
Candidate groups: 92
Review status: `candidate`
Common confusions: Chrome (85), Auto (42), RC (37), Gold (25), Orange (24), Red (22)
Suggested next action: Create broad parent Visual Registry candidate, then split into color and pattern child concepts.

Representative image evidence:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `f7dace0d-7382-4322-a53d-fd516b6def48`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/back.jpg)
  Generated: 2025 Bowman Chrome Charlie Condon Auto Refractor 047/499
  Corrected: 2026 Bowman Chrome Charlie Condon 1st Prospect Auto Refractor 047/499 RC
- Feedback ID: `8d9acd04-13e1-40d1-a448-0bfcafad4656`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/back.jpg)
  Generated: 2024 Topps Chrome Holger Rune 1st Yellow Refractor 37/50
  Corrected: 2024 Topps Chrome Tennis Holger Rune 1st Gold Refractor 37/50 RC

### Auto / Autograph

Tier: A
Concept family: signature evidence
Evidence count: 104
Candidate groups: 125
Review status: `candidate`
Common confusions: RC (61), Chrome (53), Refractor (42), Rookie (31), Red (26), Gold (23)
Suggested next action: Create image-backed test case set for visible signature vs title wording.

Representative image evidence:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `f7dace0d-7382-4322-a53d-fd516b6def48`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/back.jpg)
  Generated: 2025 Bowman Chrome Charlie Condon Auto Refractor 047/499
  Corrected: 2026 Bowman Chrome Charlie Condon 1st Prospect Auto Refractor 047/499 RC
- Feedback ID: `4fa7153f-46c0-422a-946f-08874260eea8`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/89a399e3-f5a6-4853-b18c-d625e541c9cd/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/89a399e3-f5a6-4853-b18c-d625e541c9cd/back.jpg)
  Generated: 2025 Bowman Chrome Caleb Wilson 1st Auto 1/1
  Corrected: 2025 Bowman Sapphire Caleb Wilson Chrome Auto Padparadscha Refractor 1st 1/1 RC

### Patch / Relic

Tier: A
Concept family: memorabilia evidence
Evidence count: 20
Candidate groups: 25
Review status: `candidate`
Common confusions: Auto (20), Autograph (7), RC (7), Gold (5), Rookie (4), Blue (3)
Suggested next action: Create Visual Registry candidates for memorabilia classes; collect negative examples.

Representative image evidence:
- Feedback ID: `779c2f9d-279b-4e68-96f4-de98b7d4e158`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
  Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
  Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10
- Feedback ID: `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg)
  Generated: 2019-20 Panini Eminence Peerless Stephen Curry Patch Auto 3/5
  Corrected: 2019-20 Panini Eminence Stephen Curry Peerless Patch Auto Autograph 3/5
- Feedback ID: `e460c34a-11fd-427e-9b79-4699e7bc11ac`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2382160f-0075-4a6c-9b70-dc0c0b27b1b1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2382160f-0075-4a6c-9b70-dc0c0b27b1b1/back.jpg)
  Generated: 2020 Panini Flawless Justin Herbert RC Dual Patch Auto Silver 05/20 PSA 9/10
  Corrected: 2020 Panini Flawless Justin Herbert Rookie Dual Patch Auto Silver RC 05/20 PSA 9/10

## Tier B: Promising Concepts

### Shimmer

Tier: B
Concept family: parallel / surface finish
Evidence count: 38
Candidate groups: 9
Review status: `needs_more_evidence`
Common confusions: Chrome (8), Refractor (7), Sapphire (5), Orange (5), Red (5), Auto (5)
Suggested next action: Promising finish concept; collect more examples and separate from Sapphire/Refractor.

Representative image evidence:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/back.jpg)
  Generated: 2024 Prizm Jayden Daniels RC Gold Shimmer 09/10 PSA 10
  Corrected: 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10
- Feedback ID: `abd544c9-1667-43aa-9a0f-9ef188e2593a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/db72ccf9-78d4-434d-bda1-36252aec8d0f/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/db72ccf9-78d4-434d-bda1-36252aec8d0f/back.jpg)
  Generated: 2025 Bowman Chrome Carson Benge New York Mets Yellow Shimmer 50/75
  Corrected: 2026 Bowman Chrome Sapphire Carson Benge New York Mets Yellow Sapphire 50/75

### Geometric

Tier: B
Concept family: parallel / surface pattern
Evidence count: 10
Candidate groups: 10
Review status: `needs_more_evidence`
Common confusions: Auto (10), RC (8), Rookie (7), Chrome (6), Purple (5), Refractor (4)
Suggested next action: Promising visual finish; accept strongest examples as test cases before resolver work.

Representative image evidence:
- Feedback ID: `ebb6f765-aaad-4bbe-9001-2fe592d15172`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/back.jpg)
  Generated: 2025 Topps Chrome Flavio Cobolli RC Purple 16/50 Auto
  Corrected: 2025 Topps Chrome Tennis Flavio Cobolli Gold Geometric Rookie Auto RC 16/50
- Feedback ID: `750306e2-9fa4-4ee9-b0bc-e98154b316cb`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/eebcb5b8-b4ea-4c5c-8334-ae28fe1c72f6/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/eebcb5b8-b4ea-4c5c-8334-ae28fe1c72f6/back.jpg)
  Generated: 2026 Bowman Chrome Yojancel Cabrera 1st Bowman Auto Blue Refractor 119/150
  Corrected: 2026 Bowman Chrome Yojancel Cabrera 1st Auto Blue Geometric Refractor 119/150
- Feedback ID: `eff8bbc3-2581-4718-badb-984fbbfe477f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/06a516d0-4491-46fa-8f5e-74c9036c2273/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/06a516d0-4491-46fa-8f5e-74c9036c2273/back.jpg)
  Generated: 2025-26 Topps Finest Cooper Flagg RC Masters Auto 01/35
  Corrected: 2025-26 Topps Finest Cooper Flagg Masters Auto RC Yellow Geometric 01/35

### Wave / Raywave

Tier: B
Concept family: parallel / surface pattern
Evidence count: 9
Candidate groups: 12
Review status: `needs_more_evidence`
Common confusions: Chrome (11), Refractor (11), Auto (6), Red (5), Purple (5), Orange (2)
Suggested next action: Promising but sparse; separate Wave, Red Wave, Purple Wave, and Raywave.

Representative image evidence:
- Feedback ID: `44738aef-f306-4e60-956b-5babfa10f641`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/767bf418-107c-479b-9e32-4ce941edb8b7/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/767bf418-107c-479b-9e32-4ce941edb8b7/back.jpg)
  Generated: 2024 Bowman Chrome Leo De Vries Prospect Auto Gold Refractor 45/50 PSA 10
  Corrected: 2024 Bowman Chrome Leo De Vries Auto Gold Refractor 1st 45/50 Padres PSA 10
- Feedback ID: `34d3f053-b36a-41b5-bcb8-b5fc270e139b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2fc9ba70-b565-4f55-817e-6a06f7e10c03/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2fc9ba70-b565-4f55-817e-6a06f7e10c03/back.jpg)
  Generated: 2024 Bowman Chrome Leo De Vries 1st Bowman Auto Red Wave 1/5 PSA 9/10
  Corrected: 2024 Bowman Chrome Leo De Vries Red Wave Refractor Auto 1st 1/5 Padres PSA 9/10
- Feedback ID: `6911f299-e025-467b-83e3-edb1dc89dcbb`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/49eeea4d-c3fe-4148-87ea-ffb051429a28/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/49eeea4d-c3fe-4148-87ea-ffb051429a28/back.jpg)
  Generated: 2025 Bowman Chrome Cam Schlittler 1st Bowman Auto Orange Wave 20/25 PSA 10
  Corrected: 2025 Bowman Chrome Cam Schlittler Auto Orange Wave Refractor 1st 20/25 PSA 10

### Cosmic Chrome

Tier: B
Concept family: product line / release design
Evidence count: 7
Candidate groups: 5
Review status: `needs_more_evidence`
Common confusions: Refractor (4), Star Fractor (3), Orange Refractor (3), Orange (3), Auto (3), SSP (3)
Suggested next action: Promising product-line concept; verify release identity from back/checklist evidence.

Representative image evidence:
- Feedback ID: `11485f06-22f8-4d96-a6d0-8eefabffda6a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/back.jpg)
  Generated: 2025 Topps Chrome WWE Penta Orange Refractor 25/25
  Corrected: 2026 Topps Cosmic Chrome WWE Penta Orange Refractor 25/25 Star Fractor SSP
- Feedback ID: `c6b9348e-b971-4c64-bb96-7b665152fa17`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/8e109955-4f8a-42a9-a1d9-e86ee55997cd/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/8e109955-4f8a-42a9-a1d9-e86ee55997cd/back.jpg)
  Generated: 2025 Topps Cosmic Chrome Jayden Higgins RC First Flight Signature Auto 09/50
  Corrected: 2025 Topps Cosmic Chrome Jayden Higgins RC First Flight Signature Gold Interstellar Auto 09/50
- Feedback ID: `fc49aec3-d7f5-4059-ace9-e076c223056a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7fe3d533-83ce-4835-a742-38d987163284/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7fe3d533-83ce-4835-a742-38d987163284/back.jpg)
  Generated: 2026 Topps Cosmic Chrome Cooper Flagg Auto 40/50 RC
  Corrected: 2025-26 Topps Cosmic Chrome Cooper Flagg Auto Gold Interstellar Refractor /50 RC

### Star Fractor

Tier: B
Concept family: parallel / visual finish
Evidence count: 5
Candidate groups: 3
Review status: `needs_more_evidence`
Common confusions: Chrome (3), Cosmic Chrome (3), Refractor (3), Orange Refractor (3), Orange (3), SSP (3)
Suggested next action: Promising but tied to few examples; accept as test case first.

Representative image evidence:
- Feedback ID: `11485f06-22f8-4d96-a6d0-8eefabffda6a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/back.jpg)
  Generated: 2025 Topps Chrome WWE Penta Orange Refractor 25/25
  Corrected: 2026 Topps Cosmic Chrome WWE Penta Orange Refractor 25/25 Star Fractor SSP

### Gold Refractor

Tier: B
Concept family: parallel / color finish
Evidence count: 48
Candidate groups: 21
Review status: `needs_more_evidence`
Common confusions: Chrome (20), Auto (14), RC (12), Rookie (7), Sapphire (6), Orange (6)
Suggested next action: Common color/finish concept; separate from Gold Wave, Gold Geometric, Gold Sapphire.

Representative image evidence:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `8d9acd04-13e1-40d1-a448-0bfcafad4656`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/back.jpg)
  Generated: 2024 Topps Chrome Holger Rune 1st Yellow Refractor 37/50
  Corrected: 2024 Topps Chrome Tennis Holger Rune 1st Gold Refractor 37/50 RC
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC

### Orange Refractor

Tier: B
Concept family: parallel / color finish
Evidence count: 25
Candidate groups: 16
Review status: `needs_more_evidence`
Common confusions: Chrome (16), Auto (13), Sapphire (9), RC (7), Red (5), Gold (4)
Suggested next action: Common color/finish concept; review against Star Fractor, Sapphire, and red/orange swaps.

Representative image evidence:
- Feedback ID: `4b579e7c-83e8-4ed6-87f4-03b06d826f9f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2919c065-79d3-4d17-8f99-db1ef3d3b146/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2919c065-79d3-4d17-8f99-db1ef3d3b146/back.jpg)
  Generated: 2025 Topps Chrome Javier Báez Detroit Tigers 03/10
  Corrected: 2025 Topps Chrome Platinum Javier Báez Black Refractor Detroit Tigers Auto 03/10
- Feedback ID: `19ed7442-8dfc-4dd1-9ad4-7938fa2ffb54`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/535a63b9-3a44-4902-b8f6-7ef712ec1695/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/535a63b9-3a44-4902-b8f6-7ef712ec1695/back.jpg)
  Generated: 2025 Topps Chrome Dalton Rushing RC Orange Refractor 12/25 Auto Dodgers
  Corrected: 2025 Topps Chrome Platinum Dalton Rushing RC Orange Refractor 12/25 Auto Dodgers
- Feedback ID: `550a77a6-cd18-4aec-a48b-80075b51da32`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/5449b928-a115-4bac-8e70-0b9c16cb484a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/5449b928-a115-4bac-8e70-0b9c16cb484a/back.jpg)
  Generated: 2024 Topps Chrome Grigor Dimitrov Auto 03/25
  Corrected: 2024 Topps Chrome Tennis Grigor Dimitrov Orange Refractor Auto 03/25

### Platinum

Tier: B
Concept family: product line
Evidence count: 10
Candidate groups: 8
Review status: `needs_more_evidence`
Common confusions: Chrome (8), Auto (7), Refractor (6), RC (6), Gold (4), Gold Refractor (4)
Suggested next action: Likely product-line/title identity issue; separate Topps Chrome Platinum from generic Chrome.

Representative image evidence:
- Feedback ID: `4b579e7c-83e8-4ed6-87f4-03b06d826f9f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2919c065-79d3-4d17-8f99-db1ef3d3b146/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2919c065-79d3-4d17-8f99-db1ef3d3b146/back.jpg)
  Generated: 2025 Topps Chrome Javier Báez Detroit Tigers 03/10
  Corrected: 2025 Topps Chrome Platinum Javier Báez Black Refractor Detroit Tigers Auto 03/10
- Feedback ID: `6321c429-4f45-42c6-95c2-a5bdf2596745`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a568e10b-56db-46dc-8810-02545b1de8d8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a568e10b-56db-46dc-8810-02545b1de8d8/back.jpg)
  Generated: 2025 Topps Chrome Spencer Schwellenbach RC Auto 15/99
  Corrected: 2025 Topps Chrome Platinum Spencer Schwellenbach RC Auto Blue 55/99
- Feedback ID: `19ed7442-8dfc-4dd1-9ad4-7938fa2ffb54`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/535a63b9-3a44-4902-b8f6-7ef712ec1695/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/535a63b9-3a44-4902-b8f6-7ef712ec1695/back.jpg)
  Generated: 2025 Topps Chrome Dalton Rushing RC Orange Refractor 12/25 Auto Dodgers
  Corrected: 2025 Topps Chrome Platinum Dalton Rushing RC Orange Refractor 12/25 Auto Dodgers

## Tier C: Insufficient Evidence

### Padparadscha

Tier: C
Concept family: rare parallel naming
Evidence count: 14
Candidate groups: 4
Review status: `needs_more_evidence`
Common confusions: Sapphire (4), Chrome (4), Refractor (4), Auto (4), RC (4), Gold (2)
Suggested next action: Insufficient distinct evidence; keep as watchlist/test-case candidate only.

Representative image evidence:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `4fa7153f-46c0-422a-946f-08874260eea8`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/89a399e3-f5a6-4853-b18c-d625e541c9cd/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/89a399e3-f5a6-4853-b18c-d625e541c9cd/back.jpg)
  Generated: 2025 Bowman Chrome Caleb Wilson 1st Auto 1/1
  Corrected: 2025 Bowman Sapphire Caleb Wilson Chrome Auto Padparadscha Refractor 1st 1/1 RC

### Gold Wave

Tier: C
Concept family: parallel / surface pattern
Evidence count: 0
Candidate groups: 0
Review status: `insufficient_evidence`
Common confusions: None surfaced
Suggested next action: No direct Cycle #001 evidence found; seed as watchlist concept only.

Representative image evidence:
- No representative image-backed examples surfaced in Cycle #001.

## Top Visual Confusions

| Confusion | Primary concept | Confused with | Extraction finding |
| --- | --- | --- | --- |
| Sapphire vs Chrome/Refractor | Sapphire | Chrome, Refractor | High evidence; split product identity from finish/parallels. |
| Cosmic Chrome vs Chrome | Cosmic Chrome | Chrome, Star Fractor, Orange Refractor | Promising but needs checklist/back evidence. |
| Star Fractor vs Orange Refractor | Star Fractor | Orange Refractor, Cosmic Chrome, SSP | Sparse but high-value test-case candidate. |
| Geometric vs Refractor/Wave/Shimmer | Geometric | Refractor, Purple, Gold, Auto | Promising visual finish; needs negative examples. |
| Shimmer vs Sapphire/Refractor | Shimmer | Sapphire, Refractor, Orange, Red | Promising; separate product-line corrections from surface finish. |
| Wave/Raywave vs Refractor | Wave / Raywave | Refractor, Red, Purple, Orange | Sparse; likely test-case first. |
| Patch vs Relic/Memorabilia | Patch / Relic | Auto, Relic, Patch, Memorabilia | Strong candidate for image-backed tests. |
| Auto vs Autograph wording | Auto / Autograph | Patch, Relic, RC/Rookie | Strong title+image evidence, but should be test/prompt candidate before resolver. |
| Padparadscha vs Sapphire/Refractor | Padparadscha | Sapphire, Refractor, Chrome, Auto | Insufficient distinct evidence; watchlist only. |
| Gold Wave vs Gold Refractor | Gold Wave | Gold Refractor, Gold Shimmer, Gold Geometric | No direct Cycle #001 evidence; seed only. |

## Top Candidate Test Cases

These are image-backed examples that should be considered for permanent regression coverage before any registry, resolver, or prompt change.

### Sapphire: 72d6f937-4d5e-40d3-ab76-612b9ac12511

Suggested status: Accept as test case candidate
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie

### Sapphire: 4fa7153f-46c0-422a-946f-08874260eea8

Suggested status: Accept as test case candidate
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/89a399e3-f5a6-4853-b18c-d625e541c9cd/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/89a399e3-f5a6-4853-b18c-d625e541c9cd/back.jpg)
Generated: 2025 Bowman Chrome Caleb Wilson 1st Auto 1/1
Corrected: 2025 Bowman Sapphire Caleb Wilson Chrome Auto Padparadscha Refractor 1st 1/1 RC

### Refractor: 72d6f937-4d5e-40d3-ab76-612b9ac12511

Suggested status: Accept as test case candidate
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie

### Refractor: f7dace0d-7382-4322-a53d-fd516b6def48

Suggested status: Accept as test case candidate
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/back.jpg)
Generated: 2025 Bowman Chrome Charlie Condon Auto Refractor 047/499
Corrected: 2026 Bowman Chrome Charlie Condon 1st Prospect Auto Refractor 047/499 RC

### Auto / Autograph: 72d6f937-4d5e-40d3-ab76-612b9ac12511

Suggested status: Accept as test case candidate
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie

### Auto / Autograph: f7dace0d-7382-4322-a53d-fd516b6def48

Suggested status: Accept as test case candidate
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/back.jpg)
Generated: 2025 Bowman Chrome Charlie Condon Auto Refractor 047/499
Corrected: 2026 Bowman Chrome Charlie Condon 1st Prospect Auto Refractor 047/499 RC

### Patch / Relic: 779c2f9d-279b-4e68-96f4-de98b7d4e158

Suggested status: Accept as test case candidate
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10

### Patch / Relic: ba1aa25e-52ed-44bc-89f7-2b6fe56d917f

Suggested status: Accept as test case candidate
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg)
Generated: 2019-20 Panini Eminence Peerless Stephen Curry Patch Auto 3/5
Corrected: 2019-20 Panini Eminence Stephen Curry Peerless Patch Auto Autograph 3/5

### Shimmer: 72d6f937-4d5e-40d3-ab76-612b9ac12511

Suggested status: Needs more evidence before test case approval
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie

### Shimmer: 9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a

Suggested status: Needs more evidence before test case approval
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/back.jpg)
Generated: 2024 Prizm Jayden Daniels RC Gold Shimmer 09/10 PSA 10
Corrected: 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10

### Geometric: ebb6f765-aaad-4bbe-9001-2fe592d15172

Suggested status: Needs more evidence before test case approval
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/back.jpg)
Generated: 2025 Topps Chrome Flavio Cobolli RC Purple 16/50 Auto
Corrected: 2025 Topps Chrome Tennis Flavio Cobolli Gold Geometric Rookie Auto RC 16/50

### Geometric: 750306e2-9fa4-4ee9-b0bc-e98154b316cb

Suggested status: Needs more evidence before test case approval
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/eebcb5b8-b4ea-4c5c-8334-ae28fe1c72f6/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/eebcb5b8-b4ea-4c5c-8334-ae28fe1c72f6/back.jpg)
Generated: 2026 Bowman Chrome Yojancel Cabrera 1st Bowman Auto Blue Refractor 119/150
Corrected: 2026 Bowman Chrome Yojancel Cabrera 1st Auto Blue Geometric Refractor 119/150

### Wave / Raywave: 44738aef-f306-4e60-956b-5babfa10f641

Suggested status: Needs more evidence before test case approval
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/767bf418-107c-479b-9e32-4ce941edb8b7/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/767bf418-107c-479b-9e32-4ce941edb8b7/back.jpg)
Generated: 2024 Bowman Chrome Leo De Vries Prospect Auto Gold Refractor 45/50 PSA 10
Corrected: 2024 Bowman Chrome Leo De Vries Auto Gold Refractor 1st 45/50 Padres PSA 10

### Wave / Raywave: 34d3f053-b36a-41b5-bcb8-b5fc270e139b

Suggested status: Needs more evidence before test case approval
Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2fc9ba70-b565-4f55-817e-6a06f7e10c03/front.jpg)
Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2fc9ba70-b565-4f55-817e-6a06f7e10c03/back.jpg)
Generated: 2024 Bowman Chrome Leo De Vries 1st Bowman Auto Red Wave 1/5 PSA 9/10
Corrected: 2024 Bowman Chrome Leo De Vries Red Wave Refractor Auto 1st 1/5 Padres PSA 9/10

## Extraction Findings

- Sapphire, Refractor, Auto/Autograph, and Patch/Relic have enough image-backed review evidence to become first Visual Registry candidate drafts.
- Geometric, Shimmer, Wave/Raywave, Cosmic Chrome, Star Fractor, Gold Refractor, Orange Refractor, and Platinum are promising but need tighter separation into positive, negative, and confusion examples.
- Padparadscha appears in Cycle #001, but the distinct evidence is too sparse and mixed with Sapphire/Refractor context; keep it as a watchlist/test-case concept.
- Gold Wave did not surface as a direct Cycle #001 concept. It should remain seeded from the Visual Registry design, not treated as extracted evidence.
- Broad concepts like Chrome and Refractor are too large for direct resolver changes. They should become parent Visual Registry concepts with narrower child concepts.

## Suggested Next Actions

- Draft Visual Registry candidate entities for Tier A concepts.
- For Tier B concepts, collect at least 3 positive examples and 2 negative/confusion examples before proposal drafting.
- Treat Tier C concepts as watchlist entries only.
- Convert the strongest image-specific examples into test case proposals before any resolver proposal.
- Do not install any registry, resolver, prompt, or test changes from this extraction without separate approval.
