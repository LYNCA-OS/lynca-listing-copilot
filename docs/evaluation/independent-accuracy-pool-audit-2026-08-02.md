# Independent accuracy pool audit — 2026-08-02

Read-only audit of the configured Supabase `listing_title_feedback` table.
No rows were written and no image URLs or titles were exported.

| Check | Count |
|---|---:|
| Feedback rows | 358 |
| Rows with a front image | 255 |
| Rows with a back image | 254 |
| Rows with both front and back images | 254 |
| Existing development cohort | 150 |
| Remaining image-backed rows outside development | 105 |

The 255 image-backed rows are exactly the reviewed blind pool already used by
the accuracy work. Therefore the largest available non-overlapping slice is 105
cards, not 150. A mixed 150 can be replayed (105 outside-development plus 45
development cards), but it cannot establish an independent-card confirmation.

## Additional observe-only source

The 30 rows in `v4_writer_feedback_events` were also checked by their embedded
`recognition_result.data_identity.image_references`, not only by the
`listing_assets` foreign key. All 30 rows contain two original image references
(60 image objects total), but every row is `OBSERVE_ONLY`; the associated
recognition payload marks the journey `ADMIN_TEST_ONLY`, and the writer action
is `ACCEPT` rather than a sealed reviewed correction. This is enough for a
small out-of-cohort diagnostic screen, not an independent accuracy label set.
It does not change the 105-card non-overlapping bound above.

## Decision

The independent-150 gate is correctly blocked by source-data capacity, not by a
missing local script. Do not spend provider calls trying to manufacture an
independent 150 from the same 255 rows or by treating the 30 observe-only
events as ground truth. Acquire at least 150 new image-backed, label-blind cards
with sealed references before promoting any accuracy overlay.

## Separate 17-card unseen-product source

The older catalog checkout contains a separate 17-card
`unseen_product_benchmark` with local original images and sealed
manufacturer-checklist identity labels. Its asset IDs do not overlap the 255
reviewed blind cards, so it is valid for a small cross-distribution screen.
It is concentrated in Panini Phoenix/Prizm and uses one image per card; it is
not a replacement for a broad marketplace 150-card gate. The 17-card screen is
recorded in [accuracy-unseen17-screen-2026-08-02.md](accuracy-unseen17-screen-2026-08-02.md).

## Legacy worktree inventory

An additional read-only search covered the older local checkouts, including
`lynca-listing-copilot.v2_pai` and the June internal backup. It found material
images, but no additional eligible labels:

| Source | Images / cards | Why it cannot pass the gate |
| --- | ---: | --- |
| `ebay-c100-cloud-eval-dataset-20260707` | 200 / 100 | The sealed policy says `seller_title_is_ground_truth:false` and `ebay_answer_key_is_reviewed_ground_truth:false`; writer review is required. |
| `ebay-image-intake-dataset-20260701` | 344 / 172 | Same policy; `commercial_accuracy_eval_eligible` is not granted. |
| June internal `development-reviewed-30` | no material image pool | Corrected titles are annotation hints only and the split is development, not commercial holdout. |
| Public-card / real-photo candidate inventories | varied | Each inventory explicitly sets `commercial_accuracy_eval_eligible:false`. |

These assets remain useful for diagnostics or future human review, but treating
their seller/corrected titles as sealed ground truth would turn a data-source
policy failure into a false independent-150 claim. The independent-card gate
therefore remains genuinely short of 150.
