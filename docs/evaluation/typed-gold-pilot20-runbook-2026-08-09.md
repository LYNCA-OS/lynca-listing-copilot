# Typed-gold R0 20-card pilot

This pilot validates the annotation mechanism; 20 cards cannot establish a 90% accuracy claim. It uses zero provider calls, never opens reviewed-title labels, and cannot authorize Production.

## Frozen sample

The source population is the existing frozen mixed-150 asset list. A dedicated one-way builder projects the broad local dataset into an ignored, mode-0600 physical-only file. The selector accepts only card identity, physical identity, three storage-reference fields, and image role; any extra key fails closed. The only legal visible stratum is image coverage: 149 front+back cards and one front-only card. The pilot selects the front-only card plus 19 front+back cards, ordered within each stratum by a frozen salted physical-identity hash.

The physical projection and annotation packet contain internal storage references and identities, so they live only under ignored `artifacts/typed-gold-pilot20-2026-08-09/` with mode 0600. Git tracks only a privacy-safe receipt containing hashes and aggregate counts; it contains no plaintext card identity or storage location. Dataset, source cohort, projection, selection policy, critical-policy snapshot, concept-registry snapshot, and scorer bundle are SHA-bound.

The current critical policy and empty concept registry are explicitly unapproved placeholders. Even completed human work is therefore `ADJUDICATED_PILOT_ONLY`, not eligible gold, until approved frozen replacements are used to rebuild the packet.

## Build and validate blank packet

```bash
node scripts/build-typed-gold-pilot.mjs
node scripts/validate-typed-gold-pilot.mjs
```

Run `node scripts/build-typed-gold-physical-projection.mjs` before the packet builder. The validator exits 2 while incomplete and prints all truth metrics as `null`. Do not replace those nulls with zero.

## Human protocol

1. Give separate copies of the packet to Reviewer A and Reviewer B. They must not see one another's work or reviewed-title labels.
2. On every card, each reviewer records complete typed claims with field, literal value, truth status/source, evidence refs, `source_region`, title policy, and `recognition_required`. They must also mark every source region reviewed in `required_fact_scan` and independently decide the `wrong_role_axis`.
3. A third human, with a distinct reviewer id, receives both completed reviews, resolves every disagreement, and emits a complete adjudication file. The adjudicator may decide that an empty claim list is correct, but may not omit either completeness axis.
4. Validate all three files together. Any packet mutation, missing card/axis, repeated physical card, same reviewer identity, invalid source region, or absent third adjudication fails closed.

```bash
node scripts/validate-typed-gold-pilot.mjs \
  --reviewer-a=review-a.json --reviewer-b=review-b.json \
  --adjudication=adjudication.json
```

Typed precision/recall and factual-error metrics remain `null` in this R0 packet because it has no arm outputs and its policy/registry are not approved. The next step is to review annotation disagreements and freeze an approved critical policy and source-versioned concept registry—not to extrapolate accuracy from 20 cards.
