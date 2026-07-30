# B6 Catalog Gap Coverage Reclassification

Date: 2026-07-30
Scope: the 2,093 `OPEN / CATALOG_COVERAGE_GAP` rows in the audited production snapshot
Mode: read-only diagnosis; no catalog write, promotion, or status mutation

## Frozen result

The three original predicates overlap and therefore must not be added as if
they were three buckets:

| Predicate | Rows | Meaning |
|---|---:|---|
| product + year already exists | 985 | Product-year is physically present somewhere in the all-catalog snapshot; no backfill |
| set text matches a catalog product | 242 | Possible field-role error; still requires validation |
| observed product is absent at every year | 808 | Catalog-name absence, not proof of a genuine identity gap |

The overlaps are:

- product-year + set match: 169
- set match + product absent: 46
- product-year + product absent: impossible by definition

The complete six-cell partition is `816 + 169 + 27 + 46 + 762 + 273 = 2,093`:

| Predicate cell | Rows |
|---|---:|
| product-year only | 816 |
| product-year + set match | 169 |
| set match only | 27 |
| set match + product absent | 46 |
| product absent only | 762 |
| none of the three | 273 |

Applying the deterministic priority `product-year > set-as-product > product
absent > unclassified` produces the only mutually exclusive operational split:

| Disposition | Rows | Allowed next action |
|---|---:|---|
| `NO_BACKFILL_PRODUCT_YEAR_PRESENT` | 985 | Retrieval diagnostic; do not backfill or auto-close |
| `SET_AS_PRODUCT_CANDIDATE` | 73 | Validate field role, year, and manufacturer |
| `PRODUCT_NAME_ABSENT_FROM_CATALOG` | 762 | Send to reviewed-internal confirmation |
| `UNCLASSIFIED` | 273 | Manual taxonomy review |

The earlier apparent remainder of 58 was an arithmetic artifact: the three
overlapping predicate counts double-count 215 rows, while the true unclassified
cell contains 273 rows (`273 - 215 = 58`).

## Safety boundary

None of these four dispositions is named `GENUINE_MISSING`. Product-name absence
does not prove that a card identity is absent, because the observed product can
itself be wrong and the gap queue is single-system output rather than independent
ground truth. All 762 rows remain review candidates with:

```text
catalog_write_allowed = false
required_next_action = REVIEWED_INTERNAL_CONFIRMATION
```

The 73 set-as-product candidates are also not directly applicable. In the live
audit only 43 shared the expected year, and only 12 also had explicit compatible
manufacturer evidence. Those 12 are high-safety review opportunities, not
automatic field application or catalog promotion.

The 985 rows show only all-catalog physical presence at the product-year level.
They do not demonstrate that an exact card row exists and therefore cannot be
described as `RETRIEVAL_FIXABLE` state or auto-closing. Retrieval failure is a
diagnostic hypothesis to test, not permission to mutate the row.

## B6 closure disposition

The known frozen cohorts can now be turned into a deterministic **work packet**,
but not into automatic catalog writes or closed queue rows:

| Rows | Deterministic next action | Queue result |
|---:|---|---|
| 985 | `RUN_RETRIEVAL_DIAGNOSTIC` | keep open |
| 762 | `REVIEWED_INTERNAL_CONFIRMATION` | keep open |
| 73 | `REVIEW_SET_AS_PRODUCT_WITH_YEAR_AND_MANUFACTURER` | keep open |
| 273 | `MANUAL_TAXONOMY_REVIEW` | keep open |
| 929 | `DETERMINISTIC_REPLAY_TO_CAPTURE_CONFLICT_TRACE` | keep open |

This accounts for 3,022 of the 3,090 frozen open rows. The remaining 68
trust/post-observation blocked rows were not provided as an exact row-level
cohort and therefore remain `UNACCOUNTED_OPEN_ROWS`; the disposition tool fails
closed rather than manufacturing their identities.

The current source now records `candidate_snapshot.conflict_rows` and bounded
field/reason detail for newly generated conflict rows. That is prospective
telemetry, not a retroactive repair of the historical 929 rows. Until those rows
are replayed against a version-matched deterministic trace, all 929 receive
`CONFLICT_RETRACE_REQUIRED`; none can be auto-closed from a non-zero conflict
count alone.

Accordingly, the B6 classification work packet is executable, but B6 itself is
not closed:

```text
disposition_packet_ready = true
catalog_gap_closed = false
gate = FAIL_CLOSED
automatic_close_count = 0
catalog_write_count = 0
production_title_change_count = 0
identity_truth_count = 0
training_eligible_count = 0
holdout_consumed_count = 0
```

Run `scripts/build-catalog-gap-disposition.mjs` with the exact 2,093-row
coverage export and exact 929-row conflict export. It rejects missing counts,
duplicate IDs, contradictory coverage predicates, and any generated unsafe
mutation permission. Its output contains only IDs, dispositions, and review or
replay actions; it never changes production titles, catalog rows, queue status,
ground truth, training eligibility, or holdout data.

## Reproduction

1. Run `scripts/sql/audit-catalog-gap-coverage-classification-v1.sql` in a
   read-only session against the same catalog snapshot. It transcribes the
   executed audit's exact comparison contract: `lower(trim(product))`, the first
   four-digit year, `coalesce(set, card_name)`, and all physical catalog product
   rows. It emits the overlapping predicates, mutually exclusive split, total
   invariants, and `catalog_write_allowed=false`.
   Its row export carries both complementary names,
   `product_seen_any_year` and `product_absent`, so the Node audit cannot invert
   the absence predicate by accident.
2. For a row-level export containing the three booleans, run:

   ```bash
   node scripts/audit-catalog-gap-coverage-classification.mjs \
     --input /path/to/read-only-row-export.jsonl \
     --expected-total 2093
   ```

3. Run `node scripts/audit-catalog-gap-coverage-classification.test.mjs` to
   prove that the frozen overlap cells reproduce `985 / 73 / 762 / 273`, every
   row receives exactly one disposition, contradictory predicates fail closed,
   and no automatic genuine-missing/backfill state exists.
4. Run `node scripts/build-catalog-gap-disposition.test.mjs` to reproduce the
   safe `985 / 73 / 762 / 273 / 929` work split, the 68-row accounting gap, and
   the zero-mutation fail-closed gate.

The SQL and Node audit are observational only. The existing
`catalog-promote-gap-queue.mjs` remains a review-packet builder and does not emit
executable promotion SQL.

The frozen counts above came from the previously executed production audit.
This checked-in SQL was not re-executed from this checkout because no valid
read-only production connection was available here; it must not be presented as
a new live database measurement.
