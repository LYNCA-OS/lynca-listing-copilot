# Verified External Identity Marketplace Projection v1

Status: Founder approved, 2026-08-10.

Observation
↓
Question
↓
Decision
↓
Rollback boundary

## Observation

For the Owner-approved 1996-97 Stadium Club High Risers Michael Jordan card,
the desired marketplace title is:

`1996-97 Topps Stadium Club High Risers #HR14 Michael Jordan Chicago Bulls`

The canonical CSM fields remain distinct: Manufacturer is `Topps`, Product is
`Stadium Club`, Set is `High Risers`, Card Number is `HR14`, Subject is
`Michael Jordan`, and Team is `Chicago Bulls`. The difference from the baseline
eBay projection is inclusion and placement, not a new semantic field.

## Question

May an exact, source-versioned external identity receipt change the marketplace
projection while leaving the CSM observation and Standard grammar authority
unchanged?

## Decision

Yes, only through the detachable verified-external-identity marketplace
profile:

- Luna visual observation is immutable and remains separately persisted.
- External support must resolve one exact reviewed identity. A missing,
  ambiguous, partial, or conflicting match leaves the baseline byte-for-byte
  unchanged.
- Physical-copy fields such as serial, grade, certification, condition and
  optical parallel remain visual/current-copy authority.
- The verified profile may include Card Number and Team when the complete title
  remains within 80 characters.
- For this profile only, Card Number is projected after release identity and
  before Subject. The canonical `card_number` and `subject` fields are not
  relabelled or reordered in stored CSM semantics.
- The external pack, index, resolver, conflict policy, Composer, marketplace
  profile and Registry release versions are persisted and replayed.
- The profile adds no provider call and does not add web/tool data to the Luna
  request.

This decision does not globally unsuppress Card Number or Team. Existing replay
evidence shows that global unsuppression is harmful; verified external support
is the admission condition.

## Rollback boundary

Disabling the external profile restores baseline behavior for new operations.
Historical successful operations keep their immutable resolution and Composer
receipt; they are never silently recomputed under a newer pack. Removing the
pack must not change provider request bytes, the paid operation key, Storage
durability, or the baseline CSM/SEM path.
