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

## Decision

The independent-150 gate is correctly blocked by source-data capacity, not by a
missing local script. Do not spend provider calls trying to manufacture an
independent 150 from the same 255 rows. Acquire at least 150 new image-backed,
label-blind cards with sealed references before promoting any accuracy overlay.
