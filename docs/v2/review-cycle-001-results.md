# Listing Copilot V2.1 Review Cycle #001 Results

Status: Evidence Review Complete, No Installation
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22T09:00:26.674Z

## Final Executive Summary

Review Cycle #001 is the first historical V2.1 learning checkpoint.

Final counts:

| Metric | Count |
| --- | ---: |
| Feedback rows exported | 279 |
| Image-backed rows reviewed | 176 |
| Legacy text-only rows preserved | 103 |
| Review candidates generated | 293 |
| Priority 1 candidates | 0 |
| Priority 2 candidates | 23 |
| Needs More Evidence candidates | 267 |

Critical warning:

Review Cycle #001 is text-diff-driven and evidence-linked, but not visually verified. It connects generated/corrected title differences to image URLs, but it does not prove that any visual concept is actually present in the images.

No visual concept should be promoted without the Visual Verification Layer.

Approved next operating rule:

```text
Text diffs may identify candidates.
Image evidence is required for review.
Visual verification is required for visual concept promotion.
Human approval is required before installation.
```

## Safety Status

- Runtime title generation logic was not modified.
- Registry data was not modified.
- Resolver logic was not modified.
- Prompts were not modified.
- No upgrades were installed or deployed.
- Review candidates are evidence for admin review only.

## Dataset Summary

| Metric | Value |
| --- | ---: |
| Raw Supabase feedback rows exported | 279 |
| Image-backed rows reviewed | 176 |
| Rows excluded from evidence-first review because front image was missing | 103 |
| Rows with front image URL in raw export | 176 |
| Rows with back image URL in raw export | 176 |
| Rows with back image URL in evidence review set | 176 |
| Operators represented | 1 |
| Feedback date range | 2026-06-21T09:30:11.126Z to 2026-06-22T08:28:47.322Z |
| Review candidates generated | 293 |
| Priority 1 candidates | 0 |
| Priority 2 candidates | 23 |
| Needs More Evidence candidates | 267 |
| Priority 2 candidates shown in detail | 12 |
| Needs More Evidence candidates shown in detail | 12 |

Inputs and generated artifacts:

- Full export: `data/learning/supabase-feedback-export-cycle-001.json`
- Evidence export used for review: `data/learning/supabase-feedback-export-cycle-001-evidence.json`
- Review JSON: `data/learning/review-candidates-2026-06-22.json`
- Review Markdown: `data/learning/review-candidates-2026-06-22.md`

Note: the offline review script currently requires `front_image_url`; 103 older rows without front image evidence were preserved in the raw export but excluded from the evidence-first candidate run.

## Top Repeated Replacements

Repeated replacements suggest stable generated-to-corrected title changes. Evidence is shown first for visual inspection.

#### learn-0006: 2026 -> 2025-26

Evidence count: 7
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `8cead21f-3620-416b-aa6f-4ef0c6880128`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `472e15f4-ff39-4cf6-886f-645518da36cc`, `20efe2f2-a324-4b30-ad2a-9ef6de4ac08a`, `fc49aec3-d7f5-4059-ace9-e076c223056a`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `8cead21f-3620-416b-aa6f-4ef0c6880128`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/back.jpg)
  Generated: 2026 Topps UEFA Champions League Home Advantage Vini Jr. Real Madrid
  Corrected: 2025-26 Topps UCC Vini Jr. Real Madrid Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0010: 2003 -> 2003-04

Evidence count: 5
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `set`, `insert`, `parallel`
Feedback IDs: `9207e91f-ab2e-4b12-87ab-d4c7df45e0d4`, `97a9af95-7d07-4847-8732-00947f70165c`, `5dbec99d-7359-4654-8da9-dc00bd62470a`, `684b864d-52fe-4354-9aab-bd0fbd10077e`, `85f0c7f2-107a-4dd0-af70-11278cea5c2e`

Evidence package:
- Feedback ID: `9207e91f-ab2e-4b12-87ab-d4c7df45e0d4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/def3cbfa-43d5-41af-9e6e-80182a511f02/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/def3cbfa-43d5-41af-9e6e-80182a511f02/back.jpg)
  Generated: 2003 Topps Pristine LeBron James Refractor 158/1999 PSA 10
  Corrected: 2003-04 Topps Pristine Lebron James Refractor Rookie RC 1578/1999 PSA 10
- Feedback ID: `97a9af95-7d07-4847-8732-00947f70165c`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dc76b36a-dbfa-4902-a974-4c27fb12a485/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dc76b36a-dbfa-4902-a974-4c27fb12a485/back.jpg)
  Generated: 2003 Topps LeBron James RC GEM MT PSA 10
  Corrected: 2003-04 Topps LeBron James Rookie RC PSA 10
- Feedback ID: `5dbec99d-7359-4654-8da9-dc00bd62470a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/f929204e-1e34-4c27-a7f0-3a830130a6db/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/f929204e-1e34-4c27-a7f0-3a830130a6db/back.jpg)
  Generated: 2003 Topps Chrome Dwyane Wade Black Refractor 253/500 PSA 10
  Corrected: 2003-04 Topps Chrome Dwyane Wade Black Refractor Rookie RC 253/500 PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0011: 2025 -> 2026

Evidence count: 5
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `11485f06-22f8-4d96-a6d0-8eefabffda6a`, `abd544c9-1667-43aa-9a0f-9ef188e2593a`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `20bbc565-f130-4674-9e84-449f48d484be`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`

Evidence package:
- Feedback ID: `11485f06-22f8-4d96-a6d0-8eefabffda6a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/back.jpg)
  Generated: 2025 Topps Chrome WWE Penta Orange Refractor 25/25
  Corrected: 2026 Topps Cosmic Chrome WWE Penta Orange Refractor 25/25 Star Fractor SSP
- Feedback ID: `abd544c9-1667-43aa-9a0f-9ef188e2593a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/db72ccf9-78d4-434d-bda1-36252aec8d0f/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/db72ccf9-78d4-434d-bda1-36252aec8d0f/back.jpg)
  Generated: 2025 Bowman Chrome Carson Benge New York Mets Yellow Shimmer 50/75
  Corrected: 2026 Bowman Chrome Sapphire Carson Benge New York Mets Yellow Sapphire 50/75
- Feedback ID: `f7dace0d-7382-4322-a53d-fd516b6def48`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/back.jpg)
  Generated: 2025 Bowman Chrome Charlie Condon Auto Refractor 047/499
  Corrected: 2026 Bowman Chrome Charlie Condon 1st Prospect Auto Refractor 047/499 RC

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0015: 2025 -> 2025-26

Evidence count: 4
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `175d492f-5743-4564-9e10-932164ff6199`, `d100faf0-b51d-44cf-8e31-82e0bab919ba`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `b70f1371-6c82-40d0-bb7f-a848e2fbd4ed`

Evidence package:
- Feedback ID: `175d492f-5743-4564-9e10-932164ff6199`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6e6dcb29-0f9c-47ec-846d-b3c7dbb948fe/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6e6dcb29-0f9c-47ec-846d-b3c7dbb948fe/back.jpg)
  Generated: 2025 Bowman Chrome Madison Booker Texas 1st Bowman RC
  Corrected: 2025-26 Bowman Chrome University Madison Booker Stained Glass SSP
- Feedback ID: `d100faf0-b51d-44cf-8e31-82e0bab919ba`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/ad6cd936-0ee8-4cf3-8312-dbc2e4cb73ff/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/ad6cd936-0ee8-4cf3-8312-dbc2e4cb73ff/back.jpg)
  Generated: 2025 Topps Bowman Chrome Sienna Betts UCLA Basketball RC
  Corrected: 2025-26 Topps Bowman University Chrome Sienna Betts UCLA Anime SSP
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0016: Chrome -> Sapphire

Evidence count: 4
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`, `auto_relic_patch`
Feedback IDs: `4fa7153f-46c0-422a-946f-08874260eea8`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `c346d240-597d-4d31-933a-29abea3b23e0`, `dbd4923f-1e67-463a-94e5-010858b3d6ea`

Evidence package:
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
- Feedback ID: `c346d240-597d-4d31-933a-29abea3b23e0`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3067fe41-0b93-44a6-9c26-e9938a65510c/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3067fe41-0b93-44a6-9c26-e9938a65510c/back.jpg)
  Generated: 2025 Bowman Chrome Cooper Flagg Sapphire Selections RC Auto 01/25
  Corrected: 2025 Bowman Sapphire Cooper Flagg Sapphire Selections Auto RC Orange Refractor 01/25

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0017: RC -> Rookie

Evidence count: 4
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `insert`, `player_subject`
Feedback IDs: `71480b5f-dcd3-4060-a37a-5bc33dc10b31`, `bcc038ca-a848-40d7-880b-993df6d706ff`, `81ef9f4a-2ca4-461f-9201-fe1b8b70f958`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`

Evidence package:
- Feedback ID: `71480b5f-dcd3-4060-a37a-5bc33dc10b31`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c696bfc9-aaac-4609-8a5c-82fecbe68d7e/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c696bfc9-aaac-4609-8a5c-82fecbe68d7e/back.jpg)
  Generated: 2013 Calbee Shohei Ohtani Exciting RC PSA 10
  Corrected: 2013 Calbee Shohei Otani Exciting Rookie PSA 10
- Feedback ID: `bcc038ca-a848-40d7-880b-993df6d706ff`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c0f8434-9654-41d3-9375-12fc9486bb07/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c0f8434-9654-41d3-9375-12fc9486bb07/back.jpg)
  Generated: 1968 Topps Mets RC Stars Jerry Koosman Nolan Ryan EX-MT PSA 6
  Corrected: 1968 Topps Mets Rookie Stars Jerry Koosman Nolan Ryan RC PSA 6
- Feedback ID: `81ef9f4a-2ca4-461f-9201-fe1b8b70f958`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/672dedab-8760-407c-b173-1b10585313e2/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/672dedab-8760-407c-b173-1b10585313e2/back.jpg)
  Generated: 2013 BBM RC Edition Shohei Ohtani & Tomoyuki Sugano Card Shop Promo PSA 10
  Corrected: 2013 BBM Rookie Edition Shohei Ohtani Card Shop Promo Prospect PSA 10

Suggested decisions: Accept as registry rule; Ignore; Needs more evidence

## Top Added Phrases

Added phrases usually indicate missing title details. These need image inspection before becoming rules.

#### learn-0001: RC

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `grade`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `4fa7153f-46c0-422a-946f-08874260eea8`, `9eff0074-5d1f-4fd8-a248-3015029c1e12`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `ce012f76-6812-4ca4-b3b9-0354bdff8401`, `91197813-7288-4b77-977a-7a658193d3cb`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`, `96329059-7734-4ea1-981a-22b3b8029236`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0002: Rookie

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `f043f338-8230-49e8-aa00-87a0bbf0d20b`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `9ebd4c0c-fce0-4d0a-a422-6aca59f32da3`, `97a9af95-7d07-4847-8732-00947f70165c`, `e71c7818-c0a7-4b8b-9d6f-81889d168e9c`, `7e44e985-7103-4e21-a3e0-37aa5f959513`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `aa4590e7-b478-477d-996c-195c27b72b44`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC
- Feedback ID: `f043f338-8230-49e8-aa00-87a0bbf0d20b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/back.jpg)
  Generated: 2018 Topps Shohei Ohtani Future Stars Auto 1/5 PSA 8
  Corrected: 2018 Topps Shohei Ohtani Future Stars Rookie Auto Autograph RC 1/5 PSA 8

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0004: SSP

Evidence count: 8
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `c2646c28-13c7-4a01-8d6f-eea638452a58`, `98e3641d-9ea2-4655-94df-7d7e32eaef4a`, `73bb2821-a4ed-4314-94c5-ae5ab358c3e1`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`, `5cbb07ef-d616-4cb2-89c1-4c0d97053ca9`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/back.jpg)
  Generated: 2026 Topps Bukayo Saka Arsenal Home Advantage
  Corrected: 2025-26 Topps UCC Bukayo Saka Arsenal FC Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0007: Autograph

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `779c2f9d-279b-4e68-96f4-de98b7d4e158`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`, `b383a540-0f06-4dcb-8977-2f43ab108cc5`, `fc5b5070-5189-4d8b-93a0-6984815fcc60`

Evidence package:
- Feedback ID: `779c2f9d-279b-4e68-96f4-de98b7d4e158`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
  Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
  Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10
- Feedback ID: `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/back.jpg)
  Generated: 2012-13 Immaculate Kobe Bryant All-Star Lineage Auto 03/15 BGS 9/10
  Corrected: 2012-13 Panini Immaculate Kobe Bryant All Star Lineage Auto Autograph 03/15 BGS 9
- Feedback ID: `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg)
  Generated: 2019-20 Panini Eminence Peerless Stephen Curry Patch Auto 3/5
  Corrected: 2019-20 Panini Eminence Stephen Curry Peerless Patch Auto Autograph 3/5

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0008: Platinum

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `parallel`, `player_subject`, `auto_relic_patch`, `wording_normalization`
Feedback IDs: `4b579e7c-83e8-4ed6-87f4-03b06d826f9f`, `6321c429-4f45-42c6-95c2-a5bdf2596745`, `19ed7442-8dfc-4dd1-9ad4-7938fa2ffb54`, `35ba78a4-d235-4896-8cf8-9a6010f8ad4c`, `ea8da68f-2016-4150-944f-c9ce324609f8`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

## Top Removed Phrases

Removed phrases may indicate hallucinated or over-applied details.

#### learn-0005: RC

Evidence count: 8
Risk: medium
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`
Feedback IDs: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `8fdd4466-7812-4a25-a951-f9e5527442d4`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `b25df3a9-60cc-4ca2-96e7-bd0ea98a98d7`, `c346d240-597d-4d31-933a-29abea3b23e0`, `eff8bbc3-2581-4718-badb-984fbbfe477f`

Evidence package:
- Feedback ID: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2025 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `f12bc03a-9838-4860-a7e6-aa56fb2966a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2026 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/back.jpg)
  Generated: 2024 Prizm Jayden Daniels RC Gold Shimmer 09/10 PSA 10
  Corrected: 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0014: GEM MT

Evidence count: 4
Risk: medium
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `insert`
Feedback IDs: `97a9af95-7d07-4847-8732-00947f70165c`, `f81b59e7-cb52-4801-acf1-9aa9997937cf`, `867649e1-e758-418c-b40e-bb1ee33ff827`, `d3212008-62dd-4dd1-bc07-883287c32018`

Evidence package:
- Feedback ID: `97a9af95-7d07-4847-8732-00947f70165c`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dc76b36a-dbfa-4902-a974-4c27fb12a485/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dc76b36a-dbfa-4902-a974-4c27fb12a485/back.jpg)
  Generated: 2003 Topps LeBron James RC GEM MT PSA 10
  Corrected: 2003-04 Topps LeBron James Rookie RC PSA 10
- Feedback ID: `f81b59e7-cb52-4801-acf1-9aa9997937cf`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7a3a7772-cbfe-4819-93e1-55f388343e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7a3a7772-cbfe-4819-93e1-55f388343e5a/back.jpg)
  Generated: 1998 Fleer Ultra Michael Jordan Gold Medallion GEM MT PSA 10
  Corrected: 1998-99 Fleer Ultra Michael Jordan Gold Medallion PSA 10
- Feedback ID: `867649e1-e758-418c-b40e-bb1ee33ff827`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0f90a9c7-302a-45d0-9dce-a4c2304bfb67/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0f90a9c7-302a-45d0-9dce-a4c2304bfb67/back.jpg)
  Generated: 989 Upper Deck Ken Griffey Jr. Star RC GEM MT PSA 10
  Corrected: 1989 Upper Deck Ken Griffey Jr. Rookie RC PSA 10

Suggested decisions: Accept as registry rule; Ignore; Needs more evidence

#### learn-0035: 1st Bowman

Evidence count: 2
Risk: high
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `parallel`, `player_subject`
Feedback IDs: `c742350e-54a4-4e82-821b-ad3935816857`, `6911f299-e025-467b-83e3-edb1dc89dcbb`

Evidence package:
- Feedback ID: `c742350e-54a4-4e82-821b-ad3935816857`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/49b7bd83-d89f-4d98-96ea-174852009c11/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/49b7bd83-d89f-4d98-96ea-174852009c11/back.jpg)
  Generated: 2025 Bowman Draft Seth Hernandez 1st Bowman Chrome Orange Auto 07/25 PSA 10
  Corrected: 2025 Bowman Sapphire Seth Hernandez Chrome Auto Orange Refractor 07/25 PSA 10
- Feedback ID: `6911f299-e025-467b-83e3-edb1dc89dcbb`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/49eeea4d-c3fe-4148-87ea-ffb051429a28/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/49eeea4d-c3fe-4148-87ea-ffb051429a28/back.jpg)
  Generated: 2025 Bowman Chrome Cam Schlittler 1st Bowman Auto Orange Wave 20/25 PSA 10
  Corrected: 2025 Bowman Chrome Cam Schlittler Auto Orange Wave Refractor 1st 20/25 PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0036: Auto

Evidence count: 2
Risk: high
Pattern type: `same_removed_phrase`
Likely change types: `product`, `insert`, `parallel`, `player_subject`, `auto_relic_patch`
Feedback IDs: `ebb6f765-aaad-4bbe-9001-2fe592d15172`, `16c44d0d-c6eb-4764-8b60-cc898a5569e0`

Evidence package:
- Feedback ID: `ebb6f765-aaad-4bbe-9001-2fe592d15172`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/back.jpg)
  Generated: 2025 Topps Chrome Flavio Cobolli RC Purple 16/50 Auto
  Corrected: 2025 Topps Chrome Tennis Flavio Cobolli Gold Geometric Rookie Auto RC 16/50
- Feedback ID: `16c44d0d-c6eb-4764-8b60-cc898a5569e0`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/df3e4b74-355d-45f9-80a7-1e96cce8b001/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/df3e4b74-355d-45f9-80a7-1e96cce8b001/back.jpg)
  Generated: 2021 Ben Baller Chrome Rafael Devers Red Refractor Auto 5/5 PSA 9
  Corrected: 2021 Topps Chrome Ben Baller Rafael Devers Auto Red Refractor 5/5 PSA Auto 9

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0037: Basketball

Evidence count: 2
Risk: high
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`
Feedback IDs: `82eccccc-7e80-423c-8627-c75138697c43`, `b70f1371-6c82-40d0-bb7f-a848e2fbd4ed`

Evidence package:
- Feedback ID: `82eccccc-7e80-423c-8627-c75138697c43`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/475ccfbf-ea6a-4db8-ae4a-a444e57aea48/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/475ccfbf-ea6a-4db8-ae4a-a444e57aea48/back.jpg)
  Generated: 2023-24 Donruss Optic Basketball Jonathan Kuminga 3/8 Prizm
  Corrected: 2023-24 Panini Donruss Optic Jonathan Kuminga 3/8 Lucky Hyper
- Feedback ID: `b70f1371-6c82-40d0-bb7f-a848e2fbd4ed`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/ae5ad6df-07c5-4129-abf4-f54d17b2a6a8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/ae5ad6df-07c5-4129-abf4-f54d17b2a6a8/back.jpg)
  Generated: 2025 Topps Signature Class Basketball Cooper Flagg RC Class Auto Red Parallel
  Corrected: 2025-26 Topps Signature Class Cooper Flagg Rookie Auto Red RC /25 Redemption Card

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0038: Bowman

Evidence count: 2
Risk: high
Pattern type: `same_removed_phrase`
Likely change types: `product`, `parallel`
Feedback IDs: `750306e2-9fa4-4ee9-b0bc-e98154b316cb`, `0fa17bec-0996-46ea-bc12-4334eebedb3e`

Evidence package:
- Feedback ID: `750306e2-9fa4-4ee9-b0bc-e98154b316cb`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/eebcb5b8-b4ea-4c5c-8334-ae28fe1c72f6/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/eebcb5b8-b4ea-4c5c-8334-ae28fe1c72f6/back.jpg)
  Generated: 2026 Bowman Chrome Yojancel Cabrera 1st Bowman Auto Blue Refractor 119/150
  Corrected: 2026 Bowman Chrome Yojancel Cabrera 1st Auto Blue Geometric Refractor 119/150
- Feedback ID: `0fa17bec-0996-46ea-bc12-4334eebedb3e`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/8f159e9b-27a9-4043-866b-42b7f76898a2/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/8f159e9b-27a9-4043-866b-42b7f76898a2/back.jpg)
  Generated: 2026 Bowman Chrome Kendry Chourio 1st Bowman Purple Refractor 105/250
  Corrected: 2026 Bowman Chrome Kendry Chourio 1st Purple Raywave Refractor 105/250

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

## Top Product Confusions

Product candidates include product-line, brand, or release-family corrections.

#### learn-0001: RC

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `grade`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `4fa7153f-46c0-422a-946f-08874260eea8`, `9eff0074-5d1f-4fd8-a248-3015029c1e12`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `ce012f76-6812-4ca4-b3b9-0354bdff8401`, `91197813-7288-4b77-977a-7a658193d3cb`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`, `96329059-7734-4ea1-981a-22b3b8029236`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0002: Rookie

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `f043f338-8230-49e8-aa00-87a0bbf0d20b`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `9ebd4c0c-fce0-4d0a-a422-6aca59f32da3`, `97a9af95-7d07-4847-8732-00947f70165c`, `e71c7818-c0a7-4b8b-9d6f-81889d168e9c`, `7e44e985-7103-4e21-a3e0-37aa5f959513`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `aa4590e7-b478-477d-996c-195c27b72b44`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC
- Feedback ID: `f043f338-8230-49e8-aa00-87a0bbf0d20b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/back.jpg)
  Generated: 2018 Topps Shohei Ohtani Future Stars Auto 1/5 PSA 8
  Corrected: 2018 Topps Shohei Ohtani Future Stars Rookie Auto Autograph RC 1/5 PSA 8

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0004: SSP

Evidence count: 8
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `c2646c28-13c7-4a01-8d6f-eea638452a58`, `98e3641d-9ea2-4655-94df-7d7e32eaef4a`, `73bb2821-a4ed-4314-94c5-ae5ab358c3e1`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`, `5cbb07ef-d616-4cb2-89c1-4c0d97053ca9`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/back.jpg)
  Generated: 2026 Topps Bukayo Saka Arsenal Home Advantage
  Corrected: 2025-26 Topps UCC Bukayo Saka Arsenal FC Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0005: RC

Evidence count: 8
Risk: medium
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`
Feedback IDs: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `8fdd4466-7812-4a25-a951-f9e5527442d4`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `b25df3a9-60cc-4ca2-96e7-bd0ea98a98d7`, `c346d240-597d-4d31-933a-29abea3b23e0`, `eff8bbc3-2581-4718-badb-984fbbfe477f`

Evidence package:
- Feedback ID: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2025 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `f12bc03a-9838-4860-a7e6-aa56fb2966a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2026 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/back.jpg)
  Generated: 2024 Prizm Jayden Daniels RC Gold Shimmer 09/10 PSA 10
  Corrected: 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0006: 2026 -> 2025-26

Evidence count: 7
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `8cead21f-3620-416b-aa6f-4ef0c6880128`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `472e15f4-ff39-4cf6-886f-645518da36cc`, `20efe2f2-a324-4b30-ad2a-9ef6de4ac08a`, `fc49aec3-d7f5-4059-ace9-e076c223056a`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `8cead21f-3620-416b-aa6f-4ef0c6880128`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/back.jpg)
  Generated: 2026 Topps UEFA Champions League Home Advantage Vini Jr. Real Madrid
  Corrected: 2025-26 Topps UCC Vini Jr. Real Madrid Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

## Top Insert Confusions

Insert candidates include missing, over-applied, or corrected insert names.

#### learn-0001: RC

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `grade`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `4fa7153f-46c0-422a-946f-08874260eea8`, `9eff0074-5d1f-4fd8-a248-3015029c1e12`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `ce012f76-6812-4ca4-b3b9-0354bdff8401`, `91197813-7288-4b77-977a-7a658193d3cb`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`, `96329059-7734-4ea1-981a-22b3b8029236`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0002: Rookie

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `f043f338-8230-49e8-aa00-87a0bbf0d20b`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `9ebd4c0c-fce0-4d0a-a422-6aca59f32da3`, `97a9af95-7d07-4847-8732-00947f70165c`, `e71c7818-c0a7-4b8b-9d6f-81889d168e9c`, `7e44e985-7103-4e21-a3e0-37aa5f959513`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `aa4590e7-b478-477d-996c-195c27b72b44`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC
- Feedback ID: `f043f338-8230-49e8-aa00-87a0bbf0d20b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/back.jpg)
  Generated: 2018 Topps Shohei Ohtani Future Stars Auto 1/5 PSA 8
  Corrected: 2018 Topps Shohei Ohtani Future Stars Rookie Auto Autograph RC 1/5 PSA 8

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0004: SSP

Evidence count: 8
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `c2646c28-13c7-4a01-8d6f-eea638452a58`, `98e3641d-9ea2-4655-94df-7d7e32eaef4a`, `73bb2821-a4ed-4314-94c5-ae5ab358c3e1`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`, `5cbb07ef-d616-4cb2-89c1-4c0d97053ca9`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/back.jpg)
  Generated: 2026 Topps Bukayo Saka Arsenal Home Advantage
  Corrected: 2025-26 Topps UCC Bukayo Saka Arsenal FC Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0005: RC

Evidence count: 8
Risk: medium
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`
Feedback IDs: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `8fdd4466-7812-4a25-a951-f9e5527442d4`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `b25df3a9-60cc-4ca2-96e7-bd0ea98a98d7`, `c346d240-597d-4d31-933a-29abea3b23e0`, `eff8bbc3-2581-4718-badb-984fbbfe477f`

Evidence package:
- Feedback ID: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2025 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `f12bc03a-9838-4860-a7e6-aa56fb2966a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2026 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/back.jpg)
  Generated: 2024 Prizm Jayden Daniels RC Gold Shimmer 09/10 PSA 10
  Corrected: 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0006: 2026 -> 2025-26

Evidence count: 7
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `8cead21f-3620-416b-aa6f-4ef0c6880128`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `472e15f4-ff39-4cf6-886f-645518da36cc`, `20efe2f2-a324-4b30-ad2a-9ef6de4ac08a`, `fc49aec3-d7f5-4059-ace9-e076c223056a`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `8cead21f-3620-416b-aa6f-4ef0c6880128`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/back.jpg)
  Generated: 2026 Topps UEFA Champions League Home Advantage Vini Jr. Real Madrid
  Corrected: 2025-26 Topps UCC Vini Jr. Real Madrid Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

## Top Parallel Confusions

Parallel candidates need careful visual review because the risk of overgeneralizing surface treatments is high.

#### learn-0001: RC

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `grade`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `4fa7153f-46c0-422a-946f-08874260eea8`, `9eff0074-5d1f-4fd8-a248-3015029c1e12`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `ce012f76-6812-4ca4-b3b9-0354bdff8401`, `91197813-7288-4b77-977a-7a658193d3cb`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`, `96329059-7734-4ea1-981a-22b3b8029236`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0002: Rookie

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `f043f338-8230-49e8-aa00-87a0bbf0d20b`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `9ebd4c0c-fce0-4d0a-a422-6aca59f32da3`, `97a9af95-7d07-4847-8732-00947f70165c`, `e71c7818-c0a7-4b8b-9d6f-81889d168e9c`, `7e44e985-7103-4e21-a3e0-37aa5f959513`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `aa4590e7-b478-477d-996c-195c27b72b44`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC
- Feedback ID: `f043f338-8230-49e8-aa00-87a0bbf0d20b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/back.jpg)
  Generated: 2018 Topps Shohei Ohtani Future Stars Auto 1/5 PSA 8
  Corrected: 2018 Topps Shohei Ohtani Future Stars Rookie Auto Autograph RC 1/5 PSA 8

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0004: SSP

Evidence count: 8
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `c2646c28-13c7-4a01-8d6f-eea638452a58`, `98e3641d-9ea2-4655-94df-7d7e32eaef4a`, `73bb2821-a4ed-4314-94c5-ae5ab358c3e1`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`, `5cbb07ef-d616-4cb2-89c1-4c0d97053ca9`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/back.jpg)
  Generated: 2026 Topps Bukayo Saka Arsenal Home Advantage
  Corrected: 2025-26 Topps UCC Bukayo Saka Arsenal FC Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0005: RC

Evidence count: 8
Risk: medium
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`
Feedback IDs: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `8fdd4466-7812-4a25-a951-f9e5527442d4`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `b25df3a9-60cc-4ca2-96e7-bd0ea98a98d7`, `c346d240-597d-4d31-933a-29abea3b23e0`, `eff8bbc3-2581-4718-badb-984fbbfe477f`

Evidence package:
- Feedback ID: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2025 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `f12bc03a-9838-4860-a7e6-aa56fb2966a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2026 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/back.jpg)
  Generated: 2024 Prizm Jayden Daniels RC Gold Shimmer 09/10 PSA 10
  Corrected: 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0006: 2026 -> 2025-26

Evidence count: 7
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `8cead21f-3620-416b-aa6f-4ef0c6880128`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `472e15f4-ff39-4cf6-886f-645518da36cc`, `20efe2f2-a324-4b30-ad2a-9ef6de4ac08a`, `fc49aec3-d7f5-4059-ace9-e076c223056a`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `8cead21f-3620-416b-aa6f-4ef0c6880128`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/back.jpg)
  Generated: 2026 Topps UEFA Champions League Home Advantage Vini Jr. Real Madrid
  Corrected: 2025-26 Topps UCC Vini Jr. Real Madrid Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

## Top Serial Corrections

Serial candidates include missing, corrected, or reformatted serial numbering.

#### learn-0001: RC

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `grade`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `4fa7153f-46c0-422a-946f-08874260eea8`, `9eff0074-5d1f-4fd8-a248-3015029c1e12`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `ce012f76-6812-4ca4-b3b9-0354bdff8401`, `91197813-7288-4b77-977a-7a658193d3cb`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`, `96329059-7734-4ea1-981a-22b3b8029236`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0002: Rookie

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `f043f338-8230-49e8-aa00-87a0bbf0d20b`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `9ebd4c0c-fce0-4d0a-a422-6aca59f32da3`, `97a9af95-7d07-4847-8732-00947f70165c`, `e71c7818-c0a7-4b8b-9d6f-81889d168e9c`, `7e44e985-7103-4e21-a3e0-37aa5f959513`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `aa4590e7-b478-477d-996c-195c27b72b44`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC
- Feedback ID: `f043f338-8230-49e8-aa00-87a0bbf0d20b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/back.jpg)
  Generated: 2018 Topps Shohei Ohtani Future Stars Auto 1/5 PSA 8
  Corrected: 2018 Topps Shohei Ohtani Future Stars Rookie Auto Autograph RC 1/5 PSA 8

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0004: SSP

Evidence count: 8
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `c2646c28-13c7-4a01-8d6f-eea638452a58`, `98e3641d-9ea2-4655-94df-7d7e32eaef4a`, `73bb2821-a4ed-4314-94c5-ae5ab358c3e1`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`, `5cbb07ef-d616-4cb2-89c1-4c0d97053ca9`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/back.jpg)
  Generated: 2026 Topps Bukayo Saka Arsenal Home Advantage
  Corrected: 2025-26 Topps UCC Bukayo Saka Arsenal FC Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0006: 2026 -> 2025-26

Evidence count: 7
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `8cead21f-3620-416b-aa6f-4ef0c6880128`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `472e15f4-ff39-4cf6-886f-645518da36cc`, `20efe2f2-a324-4b30-ad2a-9ef6de4ac08a`, `fc49aec3-d7f5-4059-ace9-e076c223056a`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `8cead21f-3620-416b-aa6f-4ef0c6880128`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/back.jpg)
  Generated: 2026 Topps UEFA Champions League Home Advantage Vini Jr. Real Madrid
  Corrected: 2025-26 Topps UCC Vini Jr. Real Madrid Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0007: Autograph

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `779c2f9d-279b-4e68-96f4-de98b7d4e158`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`, `b383a540-0f06-4dcb-8977-2f43ab108cc5`, `fc5b5070-5189-4d8b-93a0-6984815fcc60`

Evidence package:
- Feedback ID: `779c2f9d-279b-4e68-96f4-de98b7d4e158`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
  Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
  Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10
- Feedback ID: `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/back.jpg)
  Generated: 2012-13 Immaculate Kobe Bryant All-Star Lineage Auto 03/15 BGS 9/10
  Corrected: 2012-13 Panini Immaculate Kobe Bryant All Star Lineage Auto Autograph 03/15 BGS 9
- Feedback ID: `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg)
  Generated: 2019-20 Panini Eminence Peerless Stephen Curry Patch Auto 3/5
  Corrected: 2019-20 Panini Eminence Stephen Curry Peerless Patch Auto Autograph 3/5

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

## Top Grade Corrections

Grade candidates include slab company, grade number, and grade wording corrections.

#### learn-0001: RC

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `grade`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `4fa7153f-46c0-422a-946f-08874260eea8`, `9eff0074-5d1f-4fd8-a248-3015029c1e12`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `ce012f76-6812-4ca4-b3b9-0354bdff8401`, `91197813-7288-4b77-977a-7a658193d3cb`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`, `96329059-7734-4ea1-981a-22b3b8029236`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0007: Autograph

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `779c2f9d-279b-4e68-96f4-de98b7d4e158`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`, `b383a540-0f06-4dcb-8977-2f43ab108cc5`, `fc5b5070-5189-4d8b-93a0-6984815fcc60`

Evidence package:
- Feedback ID: `779c2f9d-279b-4e68-96f4-de98b7d4e158`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
  Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
  Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10
- Feedback ID: `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/back.jpg)
  Generated: 2012-13 Immaculate Kobe Bryant All-Star Lineage Auto 03/15 BGS 9/10
  Corrected: 2012-13 Panini Immaculate Kobe Bryant All Star Lineage Auto Autograph 03/15 BGS 9
- Feedback ID: `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg)
  Generated: 2019-20 Panini Eminence Peerless Stephen Curry Patch Auto 3/5
  Corrected: 2019-20 Panini Eminence Stephen Curry Peerless Patch Auto Autograph 3/5

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0047: /10

Evidence count: 1
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `serial`, `grade`
Feedback IDs: `58d35842-a5e6-4f80-9bc3-103dcbd02f49`

Evidence package:
- Feedback ID: `58d35842-a5e6-4f80-9bc3-103dcbd02f49`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/40ed623c-2829-404f-854c-eb7b2eff4dc1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/40ed623c-2829-404f-854c-eb7b2eff4dc1/back.jpg)
  Generated: 2022 Game of Thrones Kit Harington Autographed Costume Patch Beckett 9.5 12/50
  Corrected: 2022 Game of Thrones Kit Harington Autographed Costume Patch BBGS 9.5/10 12/50

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0052: 10

Evidence count: 1
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `grade`
Feedback IDs: `b291c1b5-ecdc-4e9e-9fd6-1162fa37e8ae`

Evidence package:
- Feedback ID: `b291c1b5-ecdc-4e9e-9fd6-1162fa37e8ae`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1e2b04e-9934-47eb-9301-93a69e5f735b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1e2b04e-9934-47eb-9301-93a69e5f735b/back.jpg)
  Generated: 2018 Topps Silver Pack Shohei Ohtani '83 Chrome Promo Blue Refractor 18/150 PSA
  Corrected: 2018 Topps Shohei Ohtani Silver Pack RC Blue Refractor 018/150 PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0056: 2012-13

Evidence count: 1
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `set`, `serial`, `auto_relic_patch`, `grade`
Feedback IDs: `779c2f9d-279b-4e68-96f4-de98b7d4e158`

Evidence package:
- Feedback ID: `779c2f9d-279b-4e68-96f4-de98b7d4e158`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
  Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
  Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

## Top Auto/Relic/Patch Corrections

Auto/relic/patch candidates include autograph, memorabilia, relic, and patch wording corrections.

#### learn-0002: Rookie

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `f043f338-8230-49e8-aa00-87a0bbf0d20b`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `9ebd4c0c-fce0-4d0a-a422-6aca59f32da3`, `97a9af95-7d07-4847-8732-00947f70165c`, `e71c7818-c0a7-4b8b-9d6f-81889d168e9c`, `7e44e985-7103-4e21-a3e0-37aa5f959513`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `aa4590e7-b478-477d-996c-195c27b72b44`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC
- Feedback ID: `f043f338-8230-49e8-aa00-87a0bbf0d20b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/back.jpg)
  Generated: 2018 Topps Shohei Ohtani Future Stars Auto 1/5 PSA 8
  Corrected: 2018 Topps Shohei Ohtani Future Stars Rookie Auto Autograph RC 1/5 PSA 8

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0007: Autograph

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `779c2f9d-279b-4e68-96f4-de98b7d4e158`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`, `b383a540-0f06-4dcb-8977-2f43ab108cc5`, `fc5b5070-5189-4d8b-93a0-6984815fcc60`

Evidence package:
- Feedback ID: `779c2f9d-279b-4e68-96f4-de98b7d4e158`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
  Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
  Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10
- Feedback ID: `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/back.jpg)
  Generated: 2012-13 Immaculate Kobe Bryant All-Star Lineage Auto 03/15 BGS 9/10
  Corrected: 2012-13 Panini Immaculate Kobe Bryant All Star Lineage Auto Autograph 03/15 BGS 9
- Feedback ID: `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg)
  Generated: 2019-20 Panini Eminence Peerless Stephen Curry Patch Auto 3/5
  Corrected: 2019-20 Panini Eminence Stephen Curry Peerless Patch Auto Autograph 3/5

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0008: Platinum

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `parallel`, `player_subject`, `auto_relic_patch`, `wording_normalization`
Feedback IDs: `4b579e7c-83e8-4ed6-87f4-03b06d826f9f`, `6321c429-4f45-42c6-95c2-a5bdf2596745`, `19ed7442-8dfc-4dd1-9ad4-7938fa2ffb54`, `35ba78a4-d235-4896-8cf8-9a6010f8ad4c`, `ea8da68f-2016-4150-944f-c9ce324609f8`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0009: Tennis

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `ebb6f765-aaad-4bbe-9001-2fe592d15172`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `7bcba0b1-56c8-47ef-a9a9-dfde40b4e7a9`, `06f4c79c-0f3d-4840-bb5c-296eea5bddf2`, `550a77a6-cd18-4aec-a48b-80075b51da32`

Evidence package:
- Feedback ID: `ebb6f765-aaad-4bbe-9001-2fe592d15172`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/back.jpg)
  Generated: 2025 Topps Chrome Flavio Cobolli RC Purple 16/50 Auto
  Corrected: 2025 Topps Chrome Tennis Flavio Cobolli Gold Geometric Rookie Auto RC 16/50
- Feedback ID: `8d9acd04-13e1-40d1-a448-0bfcafad4656`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/back.jpg)
  Generated: 2024 Topps Chrome Holger Rune 1st Yellow Refractor 37/50
  Corrected: 2024 Topps Chrome Tennis Holger Rune 1st Gold Refractor 37/50 RC
- Feedback ID: `7bcba0b1-56c8-47ef-a9a9-dfde40b4e7a9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84625cc9-ad15-4250-bc89-a95301c1fefe/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84625cc9-ad15-4250-bc89-a95301c1fefe/back.jpg)
  Generated: 2025 Topps Triumphant Victoria Mboko Auto 35/35
  Corrected: 2025 Topps Triumphant Tennis Victoria Mboko Green Foil Autographs Auto 35/35

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0016: Chrome -> Sapphire

Evidence count: 4
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`, `auto_relic_patch`
Feedback IDs: `4fa7153f-46c0-422a-946f-08874260eea8`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `c346d240-597d-4d31-933a-29abea3b23e0`, `dbd4923f-1e67-463a-94e5-010858b3d6ea`

Evidence package:
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
- Feedback ID: `c346d240-597d-4d31-933a-29abea3b23e0`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3067fe41-0b93-44a6-9c26-e9938a65510c/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3067fe41-0b93-44a6-9c26-e9938a65510c/back.jpg)
  Generated: 2025 Bowman Chrome Cooper Flagg Sapphire Selections RC Auto 01/25
  Corrected: 2025 Bowman Sapphire Cooper Flagg Sapphire Selections Auto RC Orange Refractor 01/25

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

## Top Visual Confusions

Visual confusions are image-specific candidates that should be reviewed separately from wording changes. These are strong test-case candidates even when they do not justify registry or resolver changes.

#### learn-0001: RC

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `grade`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `4fa7153f-46c0-422a-946f-08874260eea8`, `9eff0074-5d1f-4fd8-a248-3015029c1e12`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `ce012f76-6812-4ca4-b3b9-0354bdff8401`, `91197813-7288-4b77-977a-7a658193d3cb`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`, `96329059-7734-4ea1-981a-22b3b8029236`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0002: Rookie

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `f043f338-8230-49e8-aa00-87a0bbf0d20b`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `9ebd4c0c-fce0-4d0a-a422-6aca59f32da3`, `97a9af95-7d07-4847-8732-00947f70165c`, `e71c7818-c0a7-4b8b-9d6f-81889d168e9c`, `7e44e985-7103-4e21-a3e0-37aa5f959513`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `aa4590e7-b478-477d-996c-195c27b72b44`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC
- Feedback ID: `f043f338-8230-49e8-aa00-87a0bbf0d20b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/back.jpg)
  Generated: 2018 Topps Shohei Ohtani Future Stars Auto 1/5 PSA 8
  Corrected: 2018 Topps Shohei Ohtani Future Stars Rookie Auto Autograph RC 1/5 PSA 8

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0004: SSP

Evidence count: 8
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `c2646c28-13c7-4a01-8d6f-eea638452a58`, `98e3641d-9ea2-4655-94df-7d7e32eaef4a`, `73bb2821-a4ed-4314-94c5-ae5ab358c3e1`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`, `5cbb07ef-d616-4cb2-89c1-4c0d97053ca9`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/back.jpg)
  Generated: 2026 Topps Bukayo Saka Arsenal Home Advantage
  Corrected: 2025-26 Topps UCC Bukayo Saka Arsenal FC Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0005: RC

Evidence count: 8
Risk: medium
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`
Feedback IDs: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `8fdd4466-7812-4a25-a951-f9e5527442d4`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `b25df3a9-60cc-4ca2-96e7-bd0ea98a98d7`, `c346d240-597d-4d31-933a-29abea3b23e0`, `eff8bbc3-2581-4718-badb-984fbbfe477f`

Evidence package:
- Feedback ID: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2025 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `f12bc03a-9838-4860-a7e6-aa56fb2966a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2026 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/back.jpg)
  Generated: 2024 Prizm Jayden Daniels RC Gold Shimmer 09/10 PSA 10
  Corrected: 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0006: 2026 -> 2025-26

Evidence count: 7
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `8cead21f-3620-416b-aa6f-4ef0c6880128`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `472e15f4-ff39-4cf6-886f-645518da36cc`, `20efe2f2-a324-4b30-ad2a-9ef6de4ac08a`, `fc49aec3-d7f5-4059-ace9-e076c223056a`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `8cead21f-3620-416b-aa6f-4ef0c6880128`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/back.jpg)
  Generated: 2026 Topps UEFA Champions League Home Advantage Vini Jr. Real Madrid
  Corrected: 2025-26 Topps UCC Vini Jr. Real Madrid Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0007: Autograph

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `779c2f9d-279b-4e68-96f4-de98b7d4e158`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`, `b383a540-0f06-4dcb-8977-2f43ab108cc5`, `fc5b5070-5189-4d8b-93a0-6984815fcc60`

Evidence package:
- Feedback ID: `779c2f9d-279b-4e68-96f4-de98b7d4e158`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
  Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
  Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10
- Feedback ID: `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/back.jpg)
  Generated: 2012-13 Immaculate Kobe Bryant All-Star Lineage Auto 03/15 BGS 9/10
  Corrected: 2012-13 Panini Immaculate Kobe Bryant All Star Lineage Auto Autograph 03/15 BGS 9
- Feedback ID: `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg)
  Generated: 2019-20 Panini Eminence Peerless Stephen Curry Patch Auto 3/5
  Corrected: 2019-20 Panini Eminence Stephen Curry Peerless Patch Auto Autograph 3/5

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0008: Platinum

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `parallel`, `player_subject`, `auto_relic_patch`, `wording_normalization`
Feedback IDs: `4b579e7c-83e8-4ed6-87f4-03b06d826f9f`, `6321c429-4f45-42c6-95c2-a5bdf2596745`, `19ed7442-8dfc-4dd1-9ad4-7938fa2ffb54`, `35ba78a4-d235-4896-8cf8-9a6010f8ad4c`, `ea8da68f-2016-4150-944f-c9ce324609f8`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

## Priority 1

Priority 1 means high evidence plus low risk. No Cycle #001 candidates met both conditions.

| Candidate | Evidence | Risk | Pattern | Example Correction |
| --- | ---: | --- | --- | --- |
| None | 0 | n/a | n/a | n/a |

## Priority 2

Priority 2 means high evidence plus medium risk. These are the strongest candidates for future proposal drafting, but none are approved yet.

#### learn-0001: RC

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `grade`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `4fa7153f-46c0-422a-946f-08874260eea8`, `9eff0074-5d1f-4fd8-a248-3015029c1e12`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `ce012f76-6812-4ca4-b3b9-0354bdff8401`, `91197813-7288-4b77-977a-7a658193d3cb`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`, `96329059-7734-4ea1-981a-22b3b8029236`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0002: Rookie

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `f043f338-8230-49e8-aa00-87a0bbf0d20b`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `9ebd4c0c-fce0-4d0a-a422-6aca59f32da3`, `97a9af95-7d07-4847-8732-00947f70165c`, `e71c7818-c0a7-4b8b-9d6f-81889d168e9c`, `7e44e985-7103-4e21-a3e0-37aa5f959513`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `aa4590e7-b478-477d-996c-195c27b72b44`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC
- Feedback ID: `f043f338-8230-49e8-aa00-87a0bbf0d20b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/back.jpg)
  Generated: 2018 Topps Shohei Ohtani Future Stars Auto 1/5 PSA 8
  Corrected: 2018 Topps Shohei Ohtani Future Stars Rookie Auto Autograph RC 1/5 PSA 8

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0004: SSP

Evidence count: 8
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `c2646c28-13c7-4a01-8d6f-eea638452a58`, `98e3641d-9ea2-4655-94df-7d7e32eaef4a`, `73bb2821-a4ed-4314-94c5-ae5ab358c3e1`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`, `5cbb07ef-d616-4cb2-89c1-4c0d97053ca9`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/back.jpg)
  Generated: 2026 Topps Bukayo Saka Arsenal Home Advantage
  Corrected: 2025-26 Topps UCC Bukayo Saka Arsenal FC Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0005: RC

Evidence count: 8
Risk: medium
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`
Feedback IDs: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `8fdd4466-7812-4a25-a951-f9e5527442d4`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `b25df3a9-60cc-4ca2-96e7-bd0ea98a98d7`, `c346d240-597d-4d31-933a-29abea3b23e0`, `eff8bbc3-2581-4718-badb-984fbbfe477f`

Evidence package:
- Feedback ID: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2025 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `f12bc03a-9838-4860-a7e6-aa56fb2966a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2026 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/back.jpg)
  Generated: 2024 Prizm Jayden Daniels RC Gold Shimmer 09/10 PSA 10
  Corrected: 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0006: 2026 -> 2025-26

Evidence count: 7
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `8cead21f-3620-416b-aa6f-4ef0c6880128`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `472e15f4-ff39-4cf6-886f-645518da36cc`, `20efe2f2-a324-4b30-ad2a-9ef6de4ac08a`, `fc49aec3-d7f5-4059-ace9-e076c223056a`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `8cead21f-3620-416b-aa6f-4ef0c6880128`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/back.jpg)
  Generated: 2026 Topps UEFA Champions League Home Advantage Vini Jr. Real Madrid
  Corrected: 2025-26 Topps UCC Vini Jr. Real Madrid Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0007: Autograph

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `779c2f9d-279b-4e68-96f4-de98b7d4e158`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`, `b383a540-0f06-4dcb-8977-2f43ab108cc5`, `fc5b5070-5189-4d8b-93a0-6984815fcc60`

Evidence package:
- Feedback ID: `779c2f9d-279b-4e68-96f4-de98b7d4e158`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
  Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
  Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10
- Feedback ID: `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/back.jpg)
  Generated: 2012-13 Immaculate Kobe Bryant All-Star Lineage Auto 03/15 BGS 9/10
  Corrected: 2012-13 Panini Immaculate Kobe Bryant All Star Lineage Auto Autograph 03/15 BGS 9
- Feedback ID: `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg)
  Generated: 2019-20 Panini Eminence Peerless Stephen Curry Patch Auto 3/5
  Corrected: 2019-20 Panini Eminence Stephen Curry Peerless Patch Auto Autograph 3/5

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0008: Platinum

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `parallel`, `player_subject`, `auto_relic_patch`, `wording_normalization`
Feedback IDs: `4b579e7c-83e8-4ed6-87f4-03b06d826f9f`, `6321c429-4f45-42c6-95c2-a5bdf2596745`, `19ed7442-8dfc-4dd1-9ad4-7938fa2ffb54`, `35ba78a4-d235-4896-8cf8-9a6010f8ad4c`, `ea8da68f-2016-4150-944f-c9ce324609f8`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0009: Tennis

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `ebb6f765-aaad-4bbe-9001-2fe592d15172`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `7bcba0b1-56c8-47ef-a9a9-dfde40b4e7a9`, `06f4c79c-0f3d-4840-bb5c-296eea5bddf2`, `550a77a6-cd18-4aec-a48b-80075b51da32`

Evidence package:
- Feedback ID: `ebb6f765-aaad-4bbe-9001-2fe592d15172`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/back.jpg)
  Generated: 2025 Topps Chrome Flavio Cobolli RC Purple 16/50 Auto
  Corrected: 2025 Topps Chrome Tennis Flavio Cobolli Gold Geometric Rookie Auto RC 16/50
- Feedback ID: `8d9acd04-13e1-40d1-a448-0bfcafad4656`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/back.jpg)
  Generated: 2024 Topps Chrome Holger Rune 1st Yellow Refractor 37/50
  Corrected: 2024 Topps Chrome Tennis Holger Rune 1st Gold Refractor 37/50 RC
- Feedback ID: `7bcba0b1-56c8-47ef-a9a9-dfde40b4e7a9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84625cc9-ad15-4250-bc89-a95301c1fefe/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84625cc9-ad15-4250-bc89-a95301c1fefe/back.jpg)
  Generated: 2025 Topps Triumphant Victoria Mboko Auto 35/35
  Corrected: 2025 Topps Triumphant Tennis Victoria Mboko Green Foil Autographs Auto 35/35

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0010: 2003 -> 2003-04

Evidence count: 5
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `set`, `insert`, `parallel`
Feedback IDs: `9207e91f-ab2e-4b12-87ab-d4c7df45e0d4`, `97a9af95-7d07-4847-8732-00947f70165c`, `5dbec99d-7359-4654-8da9-dc00bd62470a`, `684b864d-52fe-4354-9aab-bd0fbd10077e`, `85f0c7f2-107a-4dd0-af70-11278cea5c2e`

Evidence package:
- Feedback ID: `9207e91f-ab2e-4b12-87ab-d4c7df45e0d4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/def3cbfa-43d5-41af-9e6e-80182a511f02/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/def3cbfa-43d5-41af-9e6e-80182a511f02/back.jpg)
  Generated: 2003 Topps Pristine LeBron James Refractor 158/1999 PSA 10
  Corrected: 2003-04 Topps Pristine Lebron James Refractor Rookie RC 1578/1999 PSA 10
- Feedback ID: `97a9af95-7d07-4847-8732-00947f70165c`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dc76b36a-dbfa-4902-a974-4c27fb12a485/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dc76b36a-dbfa-4902-a974-4c27fb12a485/back.jpg)
  Generated: 2003 Topps LeBron James RC GEM MT PSA 10
  Corrected: 2003-04 Topps LeBron James Rookie RC PSA 10
- Feedback ID: `5dbec99d-7359-4654-8da9-dc00bd62470a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/f929204e-1e34-4c27-a7f0-3a830130a6db/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/f929204e-1e34-4c27-a7f0-3a830130a6db/back.jpg)
  Generated: 2003 Topps Chrome Dwyane Wade Black Refractor 253/500 PSA 10
  Corrected: 2003-04 Topps Chrome Dwyane Wade Black Refractor Rookie RC 253/500 PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0011: 2025 -> 2026

Evidence count: 5
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `11485f06-22f8-4d96-a6d0-8eefabffda6a`, `abd544c9-1667-43aa-9a0f-9ef188e2593a`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `20bbc565-f130-4674-9e84-449f48d484be`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`

Evidence package:
- Feedback ID: `11485f06-22f8-4d96-a6d0-8eefabffda6a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/back.jpg)
  Generated: 2025 Topps Chrome WWE Penta Orange Refractor 25/25
  Corrected: 2026 Topps Cosmic Chrome WWE Penta Orange Refractor 25/25 Star Fractor SSP
- Feedback ID: `abd544c9-1667-43aa-9a0f-9ef188e2593a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/db72ccf9-78d4-434d-bda1-36252aec8d0f/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/db72ccf9-78d4-434d-bda1-36252aec8d0f/back.jpg)
  Generated: 2025 Bowman Chrome Carson Benge New York Mets Yellow Shimmer 50/75
  Corrected: 2026 Bowman Chrome Sapphire Carson Benge New York Mets Yellow Sapphire 50/75
- Feedback ID: `f7dace0d-7382-4322-a53d-fd516b6def48`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/back.jpg)
  Generated: 2025 Bowman Chrome Charlie Condon Auto Refractor 047/499
  Corrected: 2026 Bowman Chrome Charlie Condon 1st Prospect Auto Refractor 047/499 RC

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0012: Disney

Evidence count: 4
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `parallel`, `serial`, `player_subject`
Feedback IDs: `18cec42b-47d4-4b36-b538-6aa3a974cd6a`, `8f9d6d58-804d-403e-bf30-2e29d1c8680d`, `ab73edcf-2d50-4c5c-95a4-3924690d0dac`, `f692a642-4e0a-4a97-ab98-2cc2773739bd`

Evidence package:
- Feedback ID: `18cec42b-47d4-4b36-b538-6aa3a974cd6a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/accc532a-a585-4efb-87c1-7fa0f329a243/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/accc532a-a585-4efb-87c1-7fa0f329a243/back.jpg)
  Generated: 2026 Topps Chrome Mitchie Torres Disney Purple Parallel 032/100
  Corrected: 2026 Topps Chrome Disney Mitchie Torres 101 Dalmatians Shimmer Refractor 32/101
- Feedback ID: `8f9d6d58-804d-403e-bf30-2e29d1c8680d`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/b8f90256-f1be-4f79-88d3-0cac423dd937/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/b8f90256-f1be-4f79-88d3-0cac423dd937/back.jpg)
  Generated: 2026 Topps Chrome Judy Hopps Disney Card 069/101
  Corrected: 2026 Topps Chrome Disney Judy Hopps Dalmatians Refractor 069/101
- Feedback ID: `ab73edcf-2d50-4c5c-95a4-3924690d0dac`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/464882e5-e85a-4b2d-ae7e-69ddf444d771/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/464882e5-e85a-4b2d-ae7e-69ddf444d771/back.jpg)
  Generated: 2026 Topps Chrome Elsa Blue Refractor 025/150
  Corrected: 2026 Topps Chrome Disney Elsa Blue Sparkle Refractor 025/150

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

## Needs More Evidence

These candidates are high risk or low evidence. They should be tracked, visually inspected, and deferred unless more evidence is collected.

#### learn-0024: 1st

Evidence count: 2
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `player_subject`, `wording_normalization`
Feedback IDs: `44738aef-f306-4e60-956b-5babfa10f641`, `e5439f71-7f3d-4168-995e-294c1c161de7`

Evidence package:
- Feedback ID: `44738aef-f306-4e60-956b-5babfa10f641`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/767bf418-107c-479b-9e32-4ce941edb8b7/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/767bf418-107c-479b-9e32-4ce941edb8b7/back.jpg)
  Generated: 2024 Bowman Chrome Leo De Vries Prospect Auto Gold Refractor 45/50 PSA 10
  Corrected: 2024 Bowman Chrome Leo De Vries Auto Gold Refractor 1st 45/50 Padres PSA 10
- Feedback ID: `e5439f71-7f3d-4168-995e-294c1c161de7`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/683c34e6-2815-45e2-ace4-33779c22b247/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/683c34e6-2815-45e2-ace4-33779c22b247/back.jpg)
  Generated: 2024 Bowman Draft Nick Kurtz Chrome Prospect Auto Blue Refractor 049/150 PSA 10
  Corrected: 2024 Bowman Draft Nick Kurtz Chrome Auto Blue Refractor 1st 049/150 PSA 10

Suggested decisions: Accept as registry rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0025: 2024 Topps Chrome

Evidence count: 2
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `parallel`, `serial`, `player_subject`
Feedback IDs: `9cc4263d-ae52-45da-8087-792bfc90e002`, `6184ed01-0bad-467c-b4f0-aa6546829bd0`

Evidence package:
- Feedback ID: `9cc4263d-ae52-45da-8087-792bfc90e002`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c19cd81e-b8b3-4036-961d-897238d23b5c/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c19cd81e-b8b3-4036-961d-897238d23b5c/back.jpg)
  Generated: Star Wars Episode I The Phantom Menace Duel of the Fates 15/49
  Corrected: 2024 Topps Chrome Star Wars #DF-3 Duel of the Fates Gold Sapphire 15/50 SP
- Feedback ID: `6184ed01-0bad-467c-b4f0-aa6546829bd0`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/96e9dae3-175e-42e2-bc09-6fcc54273b47/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/96e9dae3-175e-42e2-bc09-6fcc54273b47/back.jpg)
  Generated: Dune Paul Atreides House Atreides Topps Chrome 09/50
  Corrected: 2024 Topps Chrome Dune Paul Atreides Gold Parallel 09/50

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0026: 26 '

Evidence count: 2
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`
Feedback IDs: `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `87c11caf-a524-468c-a88d-23c38678287e`

Evidence package:
- Feedback ID: `dda2b329-2bc8-455e-8d76-e7568d2782a9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/28230917-71eb-411f-ba05-1ae7f77c7673/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/28230917-71eb-411f-ba05-1ae7f77c7673/back.jpg)
  Generated: 2025-26 Donruss Road to World Cup Lionel Messi Kaboom PSA 9
  Corrected: 2025-26 Panini Donruss Road to FIFA World Cup 26' Lionel Messi Kaboom PSA 9
- Feedback ID: `87c11caf-a524-468c-a88d-23c38678287e`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/8d45700c-a5f6-461b-a83b-8920a72b861e/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/8d45700c-a5f6-461b-a83b-8920a72b861e/back.jpg)
  Generated: 2025-26 Panini Donruss Road to FIFA World Cup Luka Modric Gold Parallel 05/10
  Corrected: 2025-26 Donruss Road to FIFA World Cup 26' Luka Modric Kaboom SP Gold 05/10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0027: Green

Evidence count: 2
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `parallel`
Feedback IDs: `4de14055-5a6b-41c1-a810-dbe525dd8239`, `3ac8f17e-5dfa-41a9-ba0f-a9f173cc2c49`

Evidence package:
- Feedback ID: `4de14055-5a6b-41c1-a810-dbe525dd8239`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/1195ccc5-ca23-45d7-8109-edae39f1b5d5/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/1195ccc5-ca23-45d7-8109-edae39f1b5d5/back.jpg)
  Generated: 2024-25 Panini Court Kings Victor Wembanyama Dressed to Impress 47/49
  Corrected: 2024-25 Panini Court Kings Victor Wembanyama Dressed To Impress Green 47/49
- Feedback ID: `3ac8f17e-5dfa-41a9-ba0f-a9f173cc2c49`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a54d555a-4256-476b-b678-a1bb00476146/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a54d555a-4256-476b-b678-a1bb00476146/back.jpg)
  Generated: 2024 Panini Select WWE Tony D'Angelo 4/5 Prizm Parallel
  Corrected: 2024 Panini Select WWE Tony D'Angelo 4/5 Green Prizm

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0028: Orange Refractor

Evidence count: 2
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `parallel`, `player_subject`
Feedback IDs: `550a77a6-cd18-4aec-a48b-80075b51da32`, `c742350e-54a4-4e82-821b-ad3935816857`

Evidence package:
- Feedback ID: `550a77a6-cd18-4aec-a48b-80075b51da32`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/5449b928-a115-4bac-8e70-0b9c16cb484a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/5449b928-a115-4bac-8e70-0b9c16cb484a/back.jpg)
  Generated: 2024 Topps Chrome Grigor Dimitrov Auto 03/25
  Corrected: 2024 Topps Chrome Tennis Grigor Dimitrov Orange Refractor Auto 03/25
- Feedback ID: `c742350e-54a4-4e82-821b-ad3935816857`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/49b7bd83-d89f-4d98-96ea-174852009c11/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/49b7bd83-d89f-4d98-96ea-174852009c11/back.jpg)
  Generated: 2025 Bowman Draft Seth Hernandez 1st Bowman Chrome Orange Auto 07/25 PSA 10
  Corrected: 2025 Bowman Sapphire Seth Hernandez Chrome Auto Orange Refractor 07/25 PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0029: Padres

Evidence count: 2
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `product`, `parallel`, `player_subject`, `auto_relic_patch`
Feedback IDs: `44738aef-f306-4e60-956b-5babfa10f641`, `34d3f053-b36a-41b5-bcb8-b5fc270e139b`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0030: Prizm

Evidence count: 2
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`
Feedback IDs: `5506caf2-af89-4119-9263-a2645fa7b3a2`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `5506caf2-af89-4119-9263-a2645fa7b3a2`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a6f9b653-29ec-4b8d-9904-9ca65d3b53bf/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a6f9b653-29ec-4b8d-9904-9ca65d3b53bf/back.jpg)
  Generated: 2024 Select Bo Nix Black Shock 1/1 PSA 9
  Corrected: 2024 Panini Select Bo Nix Premier RC Black Prizm Shock Rookie 1/1 PSA 9
- Feedback ID: `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a239ce49-32aa-4f5d-9064-676fe6ab4a6f/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a239ce49-32aa-4f5d-9064-676fe6ab4a6f/back.jpg)
  Generated: 2023 Panini Prizm Victor Wembanyama RC Silver PSA 10
  Corrected: 2023-24 Panini Prizm Victor Wembanyama RC Prizm Silver Rookie PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0031: Refractor

Evidence count: 2
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `set`, `insert`, `parallel`, `player_subject`
Feedback IDs: `91197813-7288-4b77-977a-7a658193d3cb`, `684b864d-52fe-4354-9aab-bd0fbd10077e`

Evidence package:
- Feedback ID: `91197813-7288-4b77-977a-7a658193d3cb`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/b9b8fdbc-ef43-490e-8748-289616490da5/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/b9b8fdbc-ef43-490e-8748-289616490da5/back.jpg)
  Generated: 2023-24 Topps Chrome UEFA Club Competitions Lamine Yamal Auto Orange Lava PSA 9
  Corrected: 2023-24 Topps Chrome UCC Lamine Yamal Auto RC Orange Lava Refractor PSA 9
- Feedback ID: `684b864d-52fe-4354-9aab-bd0fbd10077e`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/37b5f3ac-a128-469e-be42-a2251527544c/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/37b5f3ac-a128-469e-be42-a2251527544c/back.jpg)
  Generated: 2003 Topps Chrome Kobe Bryant XFractor 038/220 PSA 9
  Corrected: 2003-04 Topps Chrome Kobe Bryant Refractor XFractor 038/220 PSA 9

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0032: Refractor lotx3

Evidence count: 2
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `set`, `insert`, `parallel`
Feedback IDs: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`

Evidence package:
- Feedback ID: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2025 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `f12bc03a-9838-4860-a7e6-aa56fb2966a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2026 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0033: Sapphire Edition

Evidence count: 2
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `set`, `parallel`, `player_subject`
Feedback IDs: `c767604e-8b4a-4466-9b6e-f8c538060276`, `a3b3eb3c-c982-4033-ba51-172d561c1a4b`

Evidence package:
- Feedback ID: `c767604e-8b4a-4466-9b6e-f8c538060276`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/ea4e9876-850e-43e4-8123-bafd798c9a39/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/ea4e9876-850e-43e4-8123-bafd798c9a39/back.jpg)
  Generated: 2026 Bowman Chrome Aiva Arquette 1st Bowman Green Refractor 15/99
  Corrected: 2026 Bowman Chrome Sapphire Edition Aiva Arquette 1st Bowman Green Refractor 15/99
- Feedback ID: `a3b3eb3c-c982-4033-ba51-172d561c1a4b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d2ef69ea-9ac9-468d-b38e-6d85e3291918/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d2ef69ea-9ac9-468d-b38e-6d85e3291918/back.jpg)
  Generated: 2026 Bowman Chrome Parks Harper 1st Bowman Orange Shimmer 18/25
  Corrected: 2026 Bowman Chrome Sapphire Edition Parks Harper 1st Bowman Orange Sapphire 18/25

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0034: University

Evidence count: 2
Risk: high
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `serial`, `player_subject`
Feedback IDs: `175d492f-5743-4564-9e10-932164ff6199`, `d100faf0-b51d-44cf-8e31-82e0bab919ba`

Evidence package:
- Feedback ID: `175d492f-5743-4564-9e10-932164ff6199`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6e6dcb29-0f9c-47ec-846d-b3c7dbb948fe/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6e6dcb29-0f9c-47ec-846d-b3c7dbb948fe/back.jpg)
  Generated: 2025 Bowman Chrome Madison Booker Texas 1st Bowman RC
  Corrected: 2025-26 Bowman Chrome University Madison Booker Stained Glass SSP
- Feedback ID: `d100faf0-b51d-44cf-8e31-82e0bab919ba`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/ad6cd936-0ee8-4cf3-8312-dbc2e4cb73ff/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/ad6cd936-0ee8-4cf3-8312-dbc2e4cb73ff/back.jpg)
  Generated: 2025 Topps Bowman Chrome Sienna Betts UCLA Basketball RC
  Corrected: 2025-26 Topps Bowman University Chrome Sienna Betts UCLA Anime SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0035: 1st Bowman

Evidence count: 2
Risk: high
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `parallel`, `player_subject`
Feedback IDs: `c742350e-54a4-4e82-821b-ad3935816857`, `6911f299-e025-467b-83e3-edb1dc89dcbb`

Evidence package:
- Feedback ID: `c742350e-54a4-4e82-821b-ad3935816857`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/49b7bd83-d89f-4d98-96ea-174852009c11/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/49b7bd83-d89f-4d98-96ea-174852009c11/back.jpg)
  Generated: 2025 Bowman Draft Seth Hernandez 1st Bowman Chrome Orange Auto 07/25 PSA 10
  Corrected: 2025 Bowman Sapphire Seth Hernandez Chrome Auto Orange Refractor 07/25 PSA 10
- Feedback ID: `6911f299-e025-467b-83e3-edb1dc89dcbb`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/49eeea4d-c3fe-4148-87ea-ffb051429a28/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/49eeea4d-c3fe-4148-87ea-ffb051429a28/back.jpg)
  Generated: 2025 Bowman Chrome Cam Schlittler 1st Bowman Auto Orange Wave 20/25 PSA 10
  Corrected: 2025 Bowman Chrome Cam Schlittler Auto Orange Wave Refractor 1st 20/25 PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

## Registry Candidates

Potential durable card-knowledge candidates. These are not registry updates; they require separate approval and tests.

#### learn-0001: RC

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `grade`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `4fa7153f-46c0-422a-946f-08874260eea8`, `9eff0074-5d1f-4fd8-a248-3015029c1e12`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `ce012f76-6812-4ca4-b3b9-0354bdff8401`, `91197813-7288-4b77-977a-7a658193d3cb`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`, `96329059-7734-4ea1-981a-22b3b8029236`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0002: Rookie

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `f043f338-8230-49e8-aa00-87a0bbf0d20b`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `9ebd4c0c-fce0-4d0a-a422-6aca59f32da3`, `97a9af95-7d07-4847-8732-00947f70165c`, `e71c7818-c0a7-4b8b-9d6f-81889d168e9c`, `7e44e985-7103-4e21-a3e0-37aa5f959513`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `aa4590e7-b478-477d-996c-195c27b72b44`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC
- Feedback ID: `f043f338-8230-49e8-aa00-87a0bbf0d20b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/back.jpg)
  Generated: 2018 Topps Shohei Ohtani Future Stars Auto 1/5 PSA 8
  Corrected: 2018 Topps Shohei Ohtani Future Stars Rookie Auto Autograph RC 1/5 PSA 8

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0004: SSP

Evidence count: 8
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `c2646c28-13c7-4a01-8d6f-eea638452a58`, `98e3641d-9ea2-4655-94df-7d7e32eaef4a`, `73bb2821-a4ed-4314-94c5-ae5ab358c3e1`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`, `5cbb07ef-d616-4cb2-89c1-4c0d97053ca9`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/back.jpg)
  Generated: 2026 Topps Bukayo Saka Arsenal Home Advantage
  Corrected: 2025-26 Topps UCC Bukayo Saka Arsenal FC Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0005: RC

Evidence count: 8
Risk: medium
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`
Feedback IDs: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `8fdd4466-7812-4a25-a951-f9e5527442d4`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `b25df3a9-60cc-4ca2-96e7-bd0ea98a98d7`, `c346d240-597d-4d31-933a-29abea3b23e0`, `eff8bbc3-2581-4718-badb-984fbbfe477f`

Evidence package:
- Feedback ID: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2025 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `f12bc03a-9838-4860-a7e6-aa56fb2966a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2026 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/back.jpg)
  Generated: 2024 Prizm Jayden Daniels RC Gold Shimmer 09/10 PSA 10
  Corrected: 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0006: 2026 -> 2025-26

Evidence count: 7
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `8cead21f-3620-416b-aa6f-4ef0c6880128`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `472e15f4-ff39-4cf6-886f-645518da36cc`, `20efe2f2-a324-4b30-ad2a-9ef6de4ac08a`, `fc49aec3-d7f5-4059-ace9-e076c223056a`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `8cead21f-3620-416b-aa6f-4ef0c6880128`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/back.jpg)
  Generated: 2026 Topps UEFA Champions League Home Advantage Vini Jr. Real Madrid
  Corrected: 2025-26 Topps UCC Vini Jr. Real Madrid Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0007: Autograph

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `779c2f9d-279b-4e68-96f4-de98b7d4e158`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`, `b383a540-0f06-4dcb-8977-2f43ab108cc5`, `fc5b5070-5189-4d8b-93a0-6984815fcc60`

Evidence package:
- Feedback ID: `779c2f9d-279b-4e68-96f4-de98b7d4e158`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
  Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
  Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10
- Feedback ID: `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/back.jpg)
  Generated: 2012-13 Immaculate Kobe Bryant All-Star Lineage Auto 03/15 BGS 9/10
  Corrected: 2012-13 Panini Immaculate Kobe Bryant All Star Lineage Auto Autograph 03/15 BGS 9
- Feedback ID: `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg)
  Generated: 2019-20 Panini Eminence Peerless Stephen Curry Patch Auto 3/5
  Corrected: 2019-20 Panini Eminence Stephen Curry Peerless Patch Auto Autograph 3/5

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0008: Platinum

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `parallel`, `player_subject`, `auto_relic_patch`, `wording_normalization`
Feedback IDs: `4b579e7c-83e8-4ed6-87f4-03b06d826f9f`, `6321c429-4f45-42c6-95c2-a5bdf2596745`, `19ed7442-8dfc-4dd1-9ad4-7938fa2ffb54`, `35ba78a4-d235-4896-8cf8-9a6010f8ad4c`, `ea8da68f-2016-4150-944f-c9ce324609f8`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0009: Tennis

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `ebb6f765-aaad-4bbe-9001-2fe592d15172`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `7bcba0b1-56c8-47ef-a9a9-dfde40b4e7a9`, `06f4c79c-0f3d-4840-bb5c-296eea5bddf2`, `550a77a6-cd18-4aec-a48b-80075b51da32`

Evidence package:
- Feedback ID: `ebb6f765-aaad-4bbe-9001-2fe592d15172`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/back.jpg)
  Generated: 2025 Topps Chrome Flavio Cobolli RC Purple 16/50 Auto
  Corrected: 2025 Topps Chrome Tennis Flavio Cobolli Gold Geometric Rookie Auto RC 16/50
- Feedback ID: `8d9acd04-13e1-40d1-a448-0bfcafad4656`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/back.jpg)
  Generated: 2024 Topps Chrome Holger Rune 1st Yellow Refractor 37/50
  Corrected: 2024 Topps Chrome Tennis Holger Rune 1st Gold Refractor 37/50 RC
- Feedback ID: `7bcba0b1-56c8-47ef-a9a9-dfde40b4e7a9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84625cc9-ad15-4250-bc89-a95301c1fefe/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84625cc9-ad15-4250-bc89-a95301c1fefe/back.jpg)
  Generated: 2025 Topps Triumphant Victoria Mboko Auto 35/35
  Corrected: 2025 Topps Triumphant Tennis Victoria Mboko Green Foil Autographs Auto 35/35

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0010: 2003 -> 2003-04

Evidence count: 5
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `set`, `insert`, `parallel`
Feedback IDs: `9207e91f-ab2e-4b12-87ab-d4c7df45e0d4`, `97a9af95-7d07-4847-8732-00947f70165c`, `5dbec99d-7359-4654-8da9-dc00bd62470a`, `684b864d-52fe-4354-9aab-bd0fbd10077e`, `85f0c7f2-107a-4dd0-af70-11278cea5c2e`

Evidence package:
- Feedback ID: `9207e91f-ab2e-4b12-87ab-d4c7df45e0d4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/def3cbfa-43d5-41af-9e6e-80182a511f02/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/def3cbfa-43d5-41af-9e6e-80182a511f02/back.jpg)
  Generated: 2003 Topps Pristine LeBron James Refractor 158/1999 PSA 10
  Corrected: 2003-04 Topps Pristine Lebron James Refractor Rookie RC 1578/1999 PSA 10
- Feedback ID: `97a9af95-7d07-4847-8732-00947f70165c`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dc76b36a-dbfa-4902-a974-4c27fb12a485/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dc76b36a-dbfa-4902-a974-4c27fb12a485/back.jpg)
  Generated: 2003 Topps LeBron James RC GEM MT PSA 10
  Corrected: 2003-04 Topps LeBron James Rookie RC PSA 10
- Feedback ID: `5dbec99d-7359-4654-8da9-dc00bd62470a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/f929204e-1e34-4c27-a7f0-3a830130a6db/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/f929204e-1e34-4c27-a7f0-3a830130a6db/back.jpg)
  Generated: 2003 Topps Chrome Dwyane Wade Black Refractor 253/500 PSA 10
  Corrected: 2003-04 Topps Chrome Dwyane Wade Black Refractor Rookie RC 253/500 PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

## Resolver Candidates

Potential deterministic logic candidates. These need positive and negative examples before any resolver work.

#### learn-0001: RC

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `grade`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `4fa7153f-46c0-422a-946f-08874260eea8`, `9eff0074-5d1f-4fd8-a248-3015029c1e12`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `ce012f76-6812-4ca4-b3b9-0354bdff8401`, `91197813-7288-4b77-977a-7a658193d3cb`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`, `96329059-7734-4ea1-981a-22b3b8029236`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0002: Rookie

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `f043f338-8230-49e8-aa00-87a0bbf0d20b`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `9ebd4c0c-fce0-4d0a-a422-6aca59f32da3`, `97a9af95-7d07-4847-8732-00947f70165c`, `e71c7818-c0a7-4b8b-9d6f-81889d168e9c`, `7e44e985-7103-4e21-a3e0-37aa5f959513`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `aa4590e7-b478-477d-996c-195c27b72b44`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC
- Feedback ID: `f043f338-8230-49e8-aa00-87a0bbf0d20b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/back.jpg)
  Generated: 2018 Topps Shohei Ohtani Future Stars Auto 1/5 PSA 8
  Corrected: 2018 Topps Shohei Ohtani Future Stars Rookie Auto Autograph RC 1/5 PSA 8

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0004: SSP

Evidence count: 8
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `c2646c28-13c7-4a01-8d6f-eea638452a58`, `98e3641d-9ea2-4655-94df-7d7e32eaef4a`, `73bb2821-a4ed-4314-94c5-ae5ab358c3e1`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`, `5cbb07ef-d616-4cb2-89c1-4c0d97053ca9`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/back.jpg)
  Generated: 2026 Topps Bukayo Saka Arsenal Home Advantage
  Corrected: 2025-26 Topps UCC Bukayo Saka Arsenal FC Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0005: RC

Evidence count: 8
Risk: medium
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`
Feedback IDs: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `8fdd4466-7812-4a25-a951-f9e5527442d4`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `b25df3a9-60cc-4ca2-96e7-bd0ea98a98d7`, `c346d240-597d-4d31-933a-29abea3b23e0`, `eff8bbc3-2581-4718-badb-984fbbfe477f`

Evidence package:
- Feedback ID: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2025 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `f12bc03a-9838-4860-a7e6-aa56fb2966a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2026 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/back.jpg)
  Generated: 2024 Prizm Jayden Daniels RC Gold Shimmer 09/10 PSA 10
  Corrected: 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0006: 2026 -> 2025-26

Evidence count: 7
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `8cead21f-3620-416b-aa6f-4ef0c6880128`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `472e15f4-ff39-4cf6-886f-645518da36cc`, `20efe2f2-a324-4b30-ad2a-9ef6de4ac08a`, `fc49aec3-d7f5-4059-ace9-e076c223056a`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `8cead21f-3620-416b-aa6f-4ef0c6880128`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/back.jpg)
  Generated: 2026 Topps UEFA Champions League Home Advantage Vini Jr. Real Madrid
  Corrected: 2025-26 Topps UCC Vini Jr. Real Madrid Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0007: Autograph

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `779c2f9d-279b-4e68-96f4-de98b7d4e158`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`, `b383a540-0f06-4dcb-8977-2f43ab108cc5`, `fc5b5070-5189-4d8b-93a0-6984815fcc60`

Evidence package:
- Feedback ID: `779c2f9d-279b-4e68-96f4-de98b7d4e158`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
  Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
  Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10
- Feedback ID: `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/back.jpg)
  Generated: 2012-13 Immaculate Kobe Bryant All-Star Lineage Auto 03/15 BGS 9/10
  Corrected: 2012-13 Panini Immaculate Kobe Bryant All Star Lineage Auto Autograph 03/15 BGS 9
- Feedback ID: `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg)
  Generated: 2019-20 Panini Eminence Peerless Stephen Curry Patch Auto 3/5
  Corrected: 2019-20 Panini Eminence Stephen Curry Peerless Patch Auto Autograph 3/5

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0008: Platinum

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `parallel`, `player_subject`, `auto_relic_patch`, `wording_normalization`
Feedback IDs: `4b579e7c-83e8-4ed6-87f4-03b06d826f9f`, `6321c429-4f45-42c6-95c2-a5bdf2596745`, `19ed7442-8dfc-4dd1-9ad4-7938fa2ffb54`, `35ba78a4-d235-4896-8cf8-9a6010f8ad4c`, `ea8da68f-2016-4150-944f-c9ce324609f8`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0009: Tennis

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `ebb6f765-aaad-4bbe-9001-2fe592d15172`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `7bcba0b1-56c8-47ef-a9a9-dfde40b4e7a9`, `06f4c79c-0f3d-4840-bb5c-296eea5bddf2`, `550a77a6-cd18-4aec-a48b-80075b51da32`

Evidence package:
- Feedback ID: `ebb6f765-aaad-4bbe-9001-2fe592d15172`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/back.jpg)
  Generated: 2025 Topps Chrome Flavio Cobolli RC Purple 16/50 Auto
  Corrected: 2025 Topps Chrome Tennis Flavio Cobolli Gold Geometric Rookie Auto RC 16/50
- Feedback ID: `8d9acd04-13e1-40d1-a448-0bfcafad4656`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/back.jpg)
  Generated: 2024 Topps Chrome Holger Rune 1st Yellow Refractor 37/50
  Corrected: 2024 Topps Chrome Tennis Holger Rune 1st Gold Refractor 37/50 RC
- Feedback ID: `7bcba0b1-56c8-47ef-a9a9-dfde40b4e7a9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84625cc9-ad15-4250-bc89-a95301c1fefe/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84625cc9-ad15-4250-bc89-a95301c1fefe/back.jpg)
  Generated: 2025 Topps Triumphant Victoria Mboko Auto 35/35
  Corrected: 2025 Topps Triumphant Tennis Victoria Mboko Green Foil Autographs Auto 35/35

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0010: 2003 -> 2003-04

Evidence count: 5
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `set`, `insert`, `parallel`
Feedback IDs: `9207e91f-ab2e-4b12-87ab-d4c7df45e0d4`, `97a9af95-7d07-4847-8732-00947f70165c`, `5dbec99d-7359-4654-8da9-dc00bd62470a`, `684b864d-52fe-4354-9aab-bd0fbd10077e`, `85f0c7f2-107a-4dd0-af70-11278cea5c2e`

Evidence package:
- Feedback ID: `9207e91f-ab2e-4b12-87ab-d4c7df45e0d4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/def3cbfa-43d5-41af-9e6e-80182a511f02/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/def3cbfa-43d5-41af-9e6e-80182a511f02/back.jpg)
  Generated: 2003 Topps Pristine LeBron James Refractor 158/1999 PSA 10
  Corrected: 2003-04 Topps Pristine Lebron James Refractor Rookie RC 1578/1999 PSA 10
- Feedback ID: `97a9af95-7d07-4847-8732-00947f70165c`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dc76b36a-dbfa-4902-a974-4c27fb12a485/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dc76b36a-dbfa-4902-a974-4c27fb12a485/back.jpg)
  Generated: 2003 Topps LeBron James RC GEM MT PSA 10
  Corrected: 2003-04 Topps LeBron James Rookie RC PSA 10
- Feedback ID: `5dbec99d-7359-4654-8da9-dc00bd62470a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/f929204e-1e34-4c27-a7f0-3a830130a6db/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/f929204e-1e34-4c27-a7f0-3a830130a6db/back.jpg)
  Generated: 2003 Topps Chrome Dwyane Wade Black Refractor 253/500 PSA 10
  Corrected: 2003-04 Topps Chrome Dwyane Wade Black Refractor Rookie RC 253/500 PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

## Prompt Candidates

Potential instruction or formatting candidates. These should not encode broad factual registries.

#### learn-0001: RC

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `grade`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `4fa7153f-46c0-422a-946f-08874260eea8`, `9eff0074-5d1f-4fd8-a248-3015029c1e12`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `ce012f76-6812-4ca4-b3b9-0354bdff8401`, `91197813-7288-4b77-977a-7a658193d3cb`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`, `96329059-7734-4ea1-981a-22b3b8029236`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0002: Rookie

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `f043f338-8230-49e8-aa00-87a0bbf0d20b`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `9ebd4c0c-fce0-4d0a-a422-6aca59f32da3`, `97a9af95-7d07-4847-8732-00947f70165c`, `e71c7818-c0a7-4b8b-9d6f-81889d168e9c`, `7e44e985-7103-4e21-a3e0-37aa5f959513`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `aa4590e7-b478-477d-996c-195c27b72b44`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC
- Feedback ID: `f043f338-8230-49e8-aa00-87a0bbf0d20b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/back.jpg)
  Generated: 2018 Topps Shohei Ohtani Future Stars Auto 1/5 PSA 8
  Corrected: 2018 Topps Shohei Ohtani Future Stars Rookie Auto Autograph RC 1/5 PSA 8

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0004: SSP

Evidence count: 8
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `c2646c28-13c7-4a01-8d6f-eea638452a58`, `98e3641d-9ea2-4655-94df-7d7e32eaef4a`, `73bb2821-a4ed-4314-94c5-ae5ab358c3e1`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`, `5cbb07ef-d616-4cb2-89c1-4c0d97053ca9`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/back.jpg)
  Generated: 2026 Topps Bukayo Saka Arsenal Home Advantage
  Corrected: 2025-26 Topps UCC Bukayo Saka Arsenal FC Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0005: RC

Evidence count: 8
Risk: medium
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`
Feedback IDs: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `8fdd4466-7812-4a25-a951-f9e5527442d4`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `b25df3a9-60cc-4ca2-96e7-bd0ea98a98d7`, `c346d240-597d-4d31-933a-29abea3b23e0`, `eff8bbc3-2581-4718-badb-984fbbfe477f`

Evidence package:
- Feedback ID: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2025 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `f12bc03a-9838-4860-a7e6-aa56fb2966a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2026 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/back.jpg)
  Generated: 2024 Prizm Jayden Daniels RC Gold Shimmer 09/10 PSA 10
  Corrected: 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0007: Autograph

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `779c2f9d-279b-4e68-96f4-de98b7d4e158`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`, `b383a540-0f06-4dcb-8977-2f43ab108cc5`, `fc5b5070-5189-4d8b-93a0-6984815fcc60`

Evidence package:
- Feedback ID: `779c2f9d-279b-4e68-96f4-de98b7d4e158`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
  Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
  Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10
- Feedback ID: `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/back.jpg)
  Generated: 2012-13 Immaculate Kobe Bryant All-Star Lineage Auto 03/15 BGS 9/10
  Corrected: 2012-13 Panini Immaculate Kobe Bryant All Star Lineage Auto Autograph 03/15 BGS 9
- Feedback ID: `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg)
  Generated: 2019-20 Panini Eminence Peerless Stephen Curry Patch Auto 3/5
  Corrected: 2019-20 Panini Eminence Stephen Curry Peerless Patch Auto Autograph 3/5

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0008: Platinum

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `parallel`, `player_subject`, `auto_relic_patch`, `wording_normalization`
Feedback IDs: `4b579e7c-83e8-4ed6-87f4-03b06d826f9f`, `6321c429-4f45-42c6-95c2-a5bdf2596745`, `19ed7442-8dfc-4dd1-9ad4-7938fa2ffb54`, `35ba78a4-d235-4896-8cf8-9a6010f8ad4c`, `ea8da68f-2016-4150-944f-c9ce324609f8`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0009: Tennis

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `ebb6f765-aaad-4bbe-9001-2fe592d15172`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `7bcba0b1-56c8-47ef-a9a9-dfde40b4e7a9`, `06f4c79c-0f3d-4840-bb5c-296eea5bddf2`, `550a77a6-cd18-4aec-a48b-80075b51da32`

Evidence package:
- Feedback ID: `ebb6f765-aaad-4bbe-9001-2fe592d15172`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/back.jpg)
  Generated: 2025 Topps Chrome Flavio Cobolli RC Purple 16/50 Auto
  Corrected: 2025 Topps Chrome Tennis Flavio Cobolli Gold Geometric Rookie Auto RC 16/50
- Feedback ID: `8d9acd04-13e1-40d1-a448-0bfcafad4656`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/back.jpg)
  Generated: 2024 Topps Chrome Holger Rune 1st Yellow Refractor 37/50
  Corrected: 2024 Topps Chrome Tennis Holger Rune 1st Gold Refractor 37/50 RC
- Feedback ID: `7bcba0b1-56c8-47ef-a9a9-dfde40b4e7a9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84625cc9-ad15-4250-bc89-a95301c1fefe/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84625cc9-ad15-4250-bc89-a95301c1fefe/back.jpg)
  Generated: 2025 Topps Triumphant Victoria Mboko Auto 35/35
  Corrected: 2025 Topps Triumphant Tennis Victoria Mboko Green Foil Autographs Auto 35/35

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0012: Disney

Evidence count: 4
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `parallel`, `serial`, `player_subject`
Feedback IDs: `18cec42b-47d4-4b36-b538-6aa3a974cd6a`, `8f9d6d58-804d-403e-bf30-2e29d1c8680d`, `ab73edcf-2d50-4c5c-95a4-3924690d0dac`, `f692a642-4e0a-4a97-ab98-2cc2773739bd`

Evidence package:
- Feedback ID: `18cec42b-47d4-4b36-b538-6aa3a974cd6a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/accc532a-a585-4efb-87c1-7fa0f329a243/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/accc532a-a585-4efb-87c1-7fa0f329a243/back.jpg)
  Generated: 2026 Topps Chrome Mitchie Torres Disney Purple Parallel 032/100
  Corrected: 2026 Topps Chrome Disney Mitchie Torres 101 Dalmatians Shimmer Refractor 32/101
- Feedback ID: `8f9d6d58-804d-403e-bf30-2e29d1c8680d`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/b8f90256-f1be-4f79-88d3-0cac423dd937/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/b8f90256-f1be-4f79-88d3-0cac423dd937/back.jpg)
  Generated: 2026 Topps Chrome Judy Hopps Disney Card 069/101
  Corrected: 2026 Topps Chrome Disney Judy Hopps Dalmatians Refractor 069/101
- Feedback ID: `ab73edcf-2d50-4c5c-95a4-3924690d0dac`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/464882e5-e85a-4b2d-ae7e-69ddf444d771/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/464882e5-e85a-4b2d-ae7e-69ddf444d771/back.jpg)
  Generated: 2026 Topps Chrome Elsa Blue Refractor 025/150
  Corrected: 2026 Topps Chrome Disney Elsa Blue Sparkle Refractor 025/150

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0013: Rookie RC

Evidence count: 4
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `set`, `insert`, `player_subject`
Feedback IDs: `3e70f5d8-ca39-47b7-9192-1838f14bab1f`, `5dbec99d-7359-4654-8da9-dc00bd62470a`, `a17fbb74-df31-495a-b21d-c037fb491a6b`, `dd49f04f-a759-41c1-a507-d3c61425a65b`

Evidence package:
- Feedback ID: `3e70f5d8-ca39-47b7-9192-1838f14bab1f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84195ea5-6da1-41be-921f-f11b3e635c57/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84195ea5-6da1-41be-921f-f11b3e635c57/back.jpg)
  Generated: 2026 Topps Baseball Brice Matthews RC Stars Auto Card
  Corrected: 2026 Topps Series 2 Brice Matthews Baseball Stars Rookie RC Auto Astros
- Feedback ID: `5dbec99d-7359-4654-8da9-dc00bd62470a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/f929204e-1e34-4c27-a7f0-3a830130a6db/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/f929204e-1e34-4c27-a7f0-3a830130a6db/back.jpg)
  Generated: 2003 Topps Chrome Dwyane Wade Black Refractor 253/500 PSA 10
  Corrected: 2003-04 Topps Chrome Dwyane Wade Black Refractor Rookie RC 253/500 PSA 10
- Feedback ID: `a17fbb74-df31-495a-b21d-c037fb491a6b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c345816a-3f30-4fd7-99bb-589a42ee7967/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c345816a-3f30-4fd7-99bb-589a42ee7967/back.jpg)
  Generated: 1986 Star Court Kings Michael Jordan SCD 8.5 NM/MT+ Sports Collectors Digest 8.5
  Corrected: 1986-87 Star Court Kings Michael Jordan Rookie RC SCD 8.5

Suggested decisions: Accept as registry rule; Ignore; Needs more evidence

## Test Case Candidates

Image-specific corrections that may be valuable as permanent regression examples even without registry, resolver, or prompt changes.

#### learn-0001: RC

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `grade`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `4fa7153f-46c0-422a-946f-08874260eea8`, `9eff0074-5d1f-4fd8-a248-3015029c1e12`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `ce012f76-6812-4ca4-b3b9-0354bdff8401`, `91197813-7288-4b77-977a-7a658193d3cb`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `e460c34a-11fd-427e-9b79-4699e7bc11ac`, `96329059-7734-4ea1-981a-22b3b8029236`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0002: Rookie

Evidence count: 12
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `72d6f937-4d5e-40d3-ab76-612b9ac12511`, `5f2bf58a-cd21-4d1d-9821-79d860a5c025`, `f043f338-8230-49e8-aa00-87a0bbf0d20b`, `02c4a0f9-32c6-4460-a0b8-1d1f67012f09`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `9ebd4c0c-fce0-4d0a-a422-6aca59f32da3`, `97a9af95-7d07-4847-8732-00947f70165c`, `e71c7818-c0a7-4b8b-9d6f-81889d168e9c`, `7e44e985-7103-4e21-a3e0-37aa5f959513`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `aa4590e7-b478-477d-996c-195c27b72b44`, `5fe1da1e-2f67-4181-9f61-d955e3ac8d82`

Evidence package:
- Feedback ID: `72d6f937-4d5e-40d3-ab76-612b9ac12511`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/950abe30-0bf6-43d1-8bc7-f257608c74e1/back.jpg)
  Generated: 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9
  Corrected: 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie
- Feedback ID: `5f2bf58a-cd21-4d1d-9821-79d860a5c025`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/50388f45-00bc-4772-b687-0350a46cb844/back.jpg)
  Generated: 2025 Topps Chrome Cooper Flagg RC Yellow Refractor 50/50 Dallas Mavericks
  Corrected: 2025-26 Topps Chrome Cooper Flagg Gold Refractor Rookie 50/50 RC
- Feedback ID: `f043f338-8230-49e8-aa00-87a0bbf0d20b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7446f141-56f4-4ba1-b244-56fc9417356b/back.jpg)
  Generated: 2018 Topps Shohei Ohtani Future Stars Auto 1/5 PSA 8
  Corrected: 2018 Topps Shohei Ohtani Future Stars Rookie Auto Autograph RC 1/5 PSA 8

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0003: Panini

Evidence count: 9
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `007edfc1-e52d-4a9e-ab8f-3955e6500620`, `23063a2e-a746-477b-9be4-d96041204b01`, `17235cbb-ace4-4b17-a1bb-56b48b33e743`, `82eccccc-7e80-423c-8627-c75138697c43`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `dda2b329-2bc8-455e-8d76-e7568d2782a9`, `5506caf2-af89-4119-9263-a2645fa7b3a2`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`

Evidence package:
- Feedback ID: `007edfc1-e52d-4a9e-ab8f-3955e6500620`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e565bc46-c8af-49b5-9289-9ee901eae896/back.jpg)
  Generated: 2025-26 Donruss Elite Signatures Tyran Stokes Auto 65/75
  Corrected: 2025-26 Panini Donruss Tyran Stokes Elite Signatures Auto 65/75
- Feedback ID: `23063a2e-a746-477b-9be4-d96041204b01`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3151c595-9a45-4776-834d-7d7ed9a68e64/back.jpg)
  Generated: 2025-26 Donruss Hugo González RC Auto Green Parallel 18/49
  Corrected: 2025-26 Panini Donruss Hugo González Rated Rookie Auto Red 18/49 RC Auto
- Feedback ID: `17235cbb-ace4-4b17-a1bb-56b48b33e743`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d6a7873d-e7c0-460b-95d3-f7e8ae726e5a/back.jpg)
  Generated: 2025-26 Donruss Optic Jason Crowe Jr. Auto 17/99
  Corrected: 2025-26 Panini Donruss Optic Jason Crowe Jr. Auto 17/99

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0004: SSP

Evidence count: 8
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `c2646c28-13c7-4a01-8d6f-eea638452a58`, `98e3641d-9ea2-4655-94df-7d7e32eaef4a`, `73bb2821-a4ed-4314-94c5-ae5ab358c3e1`, `1eda9455-567b-4bd3-8ca9-aafe61b874f5`, `5cbb07ef-d616-4cb2-89c1-4c0d97053ca9`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dd09a34b-4c16-452d-903a-a43a6fade7a8/back.jpg)
  Generated: 2026 Topps Bukayo Saka Arsenal Home Advantage
  Corrected: 2025-26 Topps UCC Bukayo Saka Arsenal FC Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0005: RC

Evidence count: 8
Risk: medium
Pattern type: `same_removed_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `player_subject`
Feedback IDs: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`, `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`, `8fdd4466-7812-4a25-a951-f9e5527442d4`, `7ed2f78d-6b22-43e2-912c-e60a11e690b3`, `b25df3a9-60cc-4ca2-96e7-bd0ea98a98d7`, `c346d240-597d-4d31-933a-29abea3b23e0`, `eff8bbc3-2581-4718-badb-984fbbfe477f`

Evidence package:
- Feedback ID: `21d7fb3f-5919-4fea-97ab-cf2dd066d31b`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/6aeea319-ab1e-4402-bf32-263549bb81eb/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2025 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `f12bc03a-9838-4860-a7e6-aa56fb2966a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/3d91a47e-cbd5-41c0-bfde-44869cc3f898/back.jpg)
  Generated: 2025 Bowman Chrome Harry Ford RC Drew Gilbert RC Samuel Basallo RC
  Corrected: 2026 Bowman Chrome Harry Ford Drew Gilbert Samuel Basallo Red RC Refractor lotx3
- Feedback ID: `9bde80e4-2ce5-4b38-bbab-70b4e3d67b5a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/bfda4710-6a47-4067-bbd9-aeb728e10c6b/back.jpg)
  Generated: 2024 Prizm Jayden Daniels RC Gold Shimmer 09/10 PSA 10
  Corrected: 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0006: 2026 -> 2025-26

Evidence count: 7
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `product`, `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `02ba3de0-42f7-4139-9967-748d7c78d5e6`, `a330845d-4308-4997-b9ab-9667b8899455`, `8cead21f-3620-416b-aa6f-4ef0c6880128`, `36e2f97f-53c0-4b6d-ac77-59ea29afe3b9`, `472e15f4-ff39-4cf6-886f-645518da36cc`, `20efe2f2-a324-4b30-ad2a-9ef6de4ac08a`, `fc49aec3-d7f5-4059-ace9-e076c223056a`

Evidence package:
- Feedback ID: `02ba3de0-42f7-4139-9967-748d7c78d5e6`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2409f2dd-6cb8-48bb-9cc2-09fd1029d90d/back.jpg)
  Generated: 2026 Topps Chrome Lionel Messi FC Barcelona Soccer Card Shadow Etch
  Corrected: 2025-26 Topps Chrome UCC Lionel Messi FC Barcelona Shadow Etch SSP
- Feedback ID: `a330845d-4308-4997-b9ab-9667b8899455`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/a1b60a0e-ebda-4ddb-abff-fe569365c892/back.jpg)
  Generated: 2026 Topps NBA Hoops Kevin Durant Houston Rockets 1/5
  Corrected: 2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP
- Feedback ID: `8cead21f-3620-416b-aa6f-4ef0c6880128`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/42f9f10c-ca55-46df-baaa-0b623af6e0f6/back.jpg)
  Generated: 2026 Topps UEFA Champions League Home Advantage Vini Jr. Real Madrid
  Corrected: 2025-26 Topps UCC Vini Jr. Real Madrid Home Advantage SSP

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0007: Autograph

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `product`, `set`, `serial`, `player_subject`, `auto_relic_patch`, `grade`
Feedback IDs: `779c2f9d-279b-4e68-96f4-de98b7d4e158`, `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`, `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`, `b383a540-0f06-4dcb-8977-2f43ab108cc5`, `fc5b5070-5189-4d8b-93a0-6984815fcc60`

Evidence package:
- Feedback ID: `779c2f9d-279b-4e68-96f4-de98b7d4e158`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/55580a9c-a06f-4242-9eea-a3647d6a3023/back.jpg)
  Generated: Panini Prizm 20 2 Kobe Bryant Auto PSA 10
  Corrected: 2012-13 Panini Prizm Kobe Bryant Auto Autograph PSA 9/10
- Feedback ID: `33485dc8-b1e1-4341-ad32-5ccdcf2739a4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/0c24805c-8ceb-4329-83ee-be22dbdded36/back.jpg)
  Generated: 2012-13 Immaculate Kobe Bryant All-Star Lineage Auto 03/15 BGS 9/10
  Corrected: 2012-13 Panini Immaculate Kobe Bryant All Star Lineage Auto Autograph 03/15 BGS 9
- Feedback ID: `ba1aa25e-52ed-44bc-89f7-2b6fe56d917f`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/fd959562-7d63-4bd9-a895-2a8512504542/back.jpg)
  Generated: 2019-20 Panini Eminence Peerless Stephen Curry Patch Auto 3/5
  Corrected: 2019-20 Panini Eminence Stephen Curry Peerless Patch Auto Autograph 3/5

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0008: Platinum

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `parallel`, `player_subject`, `auto_relic_patch`, `wording_normalization`
Feedback IDs: `4b579e7c-83e8-4ed6-87f4-03b06d826f9f`, `6321c429-4f45-42c6-95c2-a5bdf2596745`, `19ed7442-8dfc-4dd1-9ad4-7938fa2ffb54`, `35ba78a4-d235-4896-8cf8-9a6010f8ad4c`, `ea8da68f-2016-4150-944f-c9ce324609f8`

Evidence package:
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

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0009: Tennis

Evidence count: 5
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `insert`, `parallel`, `serial`, `player_subject`, `auto_relic_patch`
Feedback IDs: `ebb6f765-aaad-4bbe-9001-2fe592d15172`, `8d9acd04-13e1-40d1-a448-0bfcafad4656`, `7bcba0b1-56c8-47ef-a9a9-dfde40b4e7a9`, `06f4c79c-0f3d-4840-bb5c-296eea5bddf2`, `550a77a6-cd18-4aec-a48b-80075b51da32`

Evidence package:
- Feedback ID: `ebb6f765-aaad-4bbe-9001-2fe592d15172`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/9a4ceb10-494a-4b58-9276-686b2fe9f51d/back.jpg)
  Generated: 2025 Topps Chrome Flavio Cobolli RC Purple 16/50 Auto
  Corrected: 2025 Topps Chrome Tennis Flavio Cobolli Gold Geometric Rookie Auto RC 16/50
- Feedback ID: `8d9acd04-13e1-40d1-a448-0bfcafad4656`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/e777fcdb-6d26-4e56-aa2a-6156e53ce92e/back.jpg)
  Generated: 2024 Topps Chrome Holger Rune 1st Yellow Refractor 37/50
  Corrected: 2024 Topps Chrome Tennis Holger Rune 1st Gold Refractor 37/50 RC
- Feedback ID: `7bcba0b1-56c8-47ef-a9a9-dfde40b4e7a9`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84625cc9-ad15-4250-bc89-a95301c1fefe/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/84625cc9-ad15-4250-bc89-a95301c1fefe/back.jpg)
  Generated: 2025 Topps Triumphant Victoria Mboko Auto 35/35
  Corrected: 2025 Topps Triumphant Tennis Victoria Mboko Green Foil Autographs Auto 35/35

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0010: 2003 -> 2003-04

Evidence count: 5
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `set`, `insert`, `parallel`
Feedback IDs: `9207e91f-ab2e-4b12-87ab-d4c7df45e0d4`, `97a9af95-7d07-4847-8732-00947f70165c`, `5dbec99d-7359-4654-8da9-dc00bd62470a`, `684b864d-52fe-4354-9aab-bd0fbd10077e`, `85f0c7f2-107a-4dd0-af70-11278cea5c2e`

Evidence package:
- Feedback ID: `9207e91f-ab2e-4b12-87ab-d4c7df45e0d4`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/def3cbfa-43d5-41af-9e6e-80182a511f02/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/def3cbfa-43d5-41af-9e6e-80182a511f02/back.jpg)
  Generated: 2003 Topps Pristine LeBron James Refractor 158/1999 PSA 10
  Corrected: 2003-04 Topps Pristine Lebron James Refractor Rookie RC 1578/1999 PSA 10
- Feedback ID: `97a9af95-7d07-4847-8732-00947f70165c`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dc76b36a-dbfa-4902-a974-4c27fb12a485/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/dc76b36a-dbfa-4902-a974-4c27fb12a485/back.jpg)
  Generated: 2003 Topps LeBron James RC GEM MT PSA 10
  Corrected: 2003-04 Topps LeBron James Rookie RC PSA 10
- Feedback ID: `5dbec99d-7359-4654-8da9-dc00bd62470a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/f929204e-1e34-4c27-a7f0-3a830130a6db/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/f929204e-1e34-4c27-a7f0-3a830130a6db/back.jpg)
  Generated: 2003 Topps Chrome Dwyane Wade Black Refractor 253/500 PSA 10
  Corrected: 2003-04 Topps Chrome Dwyane Wade Black Refractor Rookie RC 253/500 PSA 10

Suggested decisions: Accept as registry rule; Accept as resolver rule; Ignore; Needs more evidence

#### learn-0011: 2025 -> 2026

Evidence count: 5
Risk: medium
Pattern type: `same_replacement_phrase`
Likely change types: `set`, `insert`, `parallel`, `serial`, `player_subject`
Feedback IDs: `11485f06-22f8-4d96-a6d0-8eefabffda6a`, `abd544c9-1667-43aa-9a0f-9ef188e2593a`, `f7dace0d-7382-4322-a53d-fd516b6def48`, `20bbc565-f130-4674-9e84-449f48d484be`, `f12bc03a-9838-4860-a7e6-aa56fb2966a4`

Evidence package:
- Feedback ID: `11485f06-22f8-4d96-a6d0-8eefabffda6a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/back.jpg)
  Generated: 2025 Topps Chrome WWE Penta Orange Refractor 25/25
  Corrected: 2026 Topps Cosmic Chrome WWE Penta Orange Refractor 25/25 Star Fractor SSP
- Feedback ID: `abd544c9-1667-43aa-9a0f-9ef188e2593a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/db72ccf9-78d4-434d-bda1-36252aec8d0f/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/db72ccf9-78d4-434d-bda1-36252aec8d0f/back.jpg)
  Generated: 2025 Bowman Chrome Carson Benge New York Mets Yellow Shimmer 50/75
  Corrected: 2026 Bowman Chrome Sapphire Carson Benge New York Mets Yellow Sapphire 50/75
- Feedback ID: `f7dace0d-7382-4322-a53d-fd516b6def48`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/7ea6000f-81bb-442e-926a-c50aa3894b7f/back.jpg)
  Generated: 2025 Bowman Chrome Charlie Condon Auto Refractor 047/499
  Corrected: 2026 Bowman Chrome Charlie Condon 1st Prospect Auto Refractor 047/499 RC

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

#### learn-0012: Disney

Evidence count: 4
Risk: medium
Pattern type: `same_added_phrase`
Likely change types: `parallel`, `serial`, `player_subject`
Feedback IDs: `18cec42b-47d4-4b36-b538-6aa3a974cd6a`, `8f9d6d58-804d-403e-bf30-2e29d1c8680d`, `ab73edcf-2d50-4c5c-95a4-3924690d0dac`, `f692a642-4e0a-4a97-ab98-2cc2773739bd`

Evidence package:
- Feedback ID: `18cec42b-47d4-4b36-b538-6aa3a974cd6a`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/accc532a-a585-4efb-87c1-7fa0f329a243/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/accc532a-a585-4efb-87c1-7fa0f329a243/back.jpg)
  Generated: 2026 Topps Chrome Mitchie Torres Disney Purple Parallel 032/100
  Corrected: 2026 Topps Chrome Disney Mitchie Torres 101 Dalmatians Shimmer Refractor 32/101
- Feedback ID: `8f9d6d58-804d-403e-bf30-2e29d1c8680d`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/b8f90256-f1be-4f79-88d3-0cac423dd937/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/b8f90256-f1be-4f79-88d3-0cac423dd937/back.jpg)
  Generated: 2026 Topps Chrome Judy Hopps Disney Card 069/101
  Corrected: 2026 Topps Chrome Disney Judy Hopps Dalmatians Refractor 069/101
- Feedback ID: `ab73edcf-2d50-4c5c-95a4-3924690d0dac`
  Front: [front image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/464882e5-e85a-4b2d-ae7e-69ddf444d771/front.jpg)
  Back: [back image](https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/464882e5-e85a-4b2d-ae7e-69ddf444d771/back.jpg)
  Generated: 2026 Topps Chrome Elsa Blue Refractor 025/150
  Corrected: 2026 Topps Chrome Disney Elsa Blue Sparkle Refractor 025/150

Suggested decisions: Accept as registry rule; Accept as resolver rule; Accept as prompt rule; Ignore; Needs more evidence

## Review Findings

- The strongest repeated patterns are medium-risk rather than low-risk, so Cycle #001 should not install changes directly.
- Rookie/RC handling appears frequently, but the examples mix insertion, removal, and title-position changes; this needs admin review before becoming any registry or prompt proposal.
- Several high-evidence candidates combine product, set year, insert, parallel, and serial changes in the same correction. These should be split into narrower future proposals.
- Visual distinction cases are present across parallels, Chrome/Sapphire/Cosmic-style product naming, auto/relic/patch language, and serial/SSP handling. These are good test-case candidates before they are good resolver changes.
- The evidence-first dataset is usable, but the 103 older rows without front images should remain outside image-based upgrade decisions unless backfilled or reviewed as text-only historical context.

## Approval Gate

Before any future installation, an admin must confirm:

- representative front/back images were inspected
- corrected titles are believed to be right, not merely different
- each proposal has a single narrow proposed change
- risk level and affected files are recorded
- recommended tests are listed
- high-risk visual cases have either more evidence or are accepted only as test cases

## Approved Next Operating Rule

```text
Text diffs may identify candidates.
Image evidence is required for review.
Visual verification is required for visual concept promotion.
Human approval is required before installation.
```

This rule supersedes any interpretation that Review Cycle #001 candidates are automatically valid visual concepts.

## Next Data Collection Goal

Target:

```text
500 image-backed feedback records before Visual Review Prototype #001.
```

Reason:

Cycle #001 produced 176 image-backed rows and 293 review candidates, but many candidates are mixed, high-risk, or text-derived. More image-backed records are needed before building a reliable visual review prototype or promoting visual concepts.

## Deferred Work

The following work is explicitly deferred:

- Visual Review Prototype
- Visual Registry population
- Registry updates
- Resolver updates
- Prompt updates
- Fine-tuning
- RAG

Cycle #001 produced review findings only. No system behavior changed.
