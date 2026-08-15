# TCG Grammar Context Authority v1

Status: Approved on 2026-08-15 (Asia/Shanghai).

Observation
↓
Question
↓
Proposed Decision
↓
Rollback boundary

## Observation

The protected activation deploy `31820306085` stopped before Production
promotion because its live TCG case was persisted and replayed as `NON_TCG`.
The exact durable-row sanitized reconstruction is frozen in
`scripts/fixtures/production-writer-journey-tcg-grammar-misroute-v1.json`.
The raw provider field-source array was not retained and is not reconstructed
as historical fact.

The durable projection contains `grammar=standard`, no Manufacturer/IP, Set
`Trainer Gallery`, and Card Number `TG22/TG30`. The current parser therefore
selected the Standard v0.3 Composer.
The resolution reader was correct: it faithfully returned the wrong grammar
that the writer had persisted.

This incident does not prove the raw source partition for those two fields.
The raw provider `field_sources` were not retained, the durable observation
rows label admitted semantic values as visual, and the Web receipt separately
supports Set. A positive rule therefore also requires a new source-authority
receipt; this fixture alone cannot activate it.

Two tempting repairs are invalid:

- A lettered `N/D` shape cannot author TCG grammar. Adversarial sports-shaped
  examples such as
  `RC1/RC100`, `SP1/SP50`, `AU1/AU25`, and `TT1/TT99` have the same shape.
- The Web receipt supports only Product and Set. It does not authorize Web,
  its hostname, its query, or its path to author Grammar or IP.

COS-38 decides how to classify a number after TCG context is known. It does
not authorize using a TCG-only number predicate to infer that context.

## Question

May a proposed exact joint namespace claim establish TCG grammar from
source-authority-bound Set and Card Number fields without authoring IP or
changing either field?

The first proposed registry entry is the exact tuple:

- Set equals `Trainer Gallery` after canonical whitespace normalization; and
- Card Number is a member of the reviewed namespace: prefix `TG`, denominator
  `TG30`, and ordinal `1..30` with the same prefix on both sides.

This is a reviewed tuple identity, not an inversion of the generic TCG number
classifier. Neither Set nor number shape alone can author Grammar.

## Approved Decision

Approved answer: yes, but only through a
versioned CSM registry release.

- The registry returns one TCG Grammar context claim or `ABSTAIN`; unknown,
  near-match, conflicting, and incomplete inputs abstain.
- Both Set and Card Number must already be admitted from current-image
  evidence. A corrected title, Writer Journey case ID, expected grammar, asset
  ID, session ID, hash, model query, URL, or external candidate cannot satisfy
  the claim.
- A durable source-authority receipt must prove original-image presence for
  both tuple fields and bind the Web partition. Set or Card Number with only
  Web/external support makes the registry `ABSTAIN`.
- The claim changes only resolved Grammar from Standard to TCG. Raw Grammar is
  retained, the mismatch is recorded, and IP remains empty unless an
  independent CSM rule resolves it.
- Lot grammar is never overridden.
- `TG22/TG30` without the exact Set is insufficient. The exact Set without the
  paired namespace is insufficient. Near matches such as `Trainer Galleries`
  and `Trainer Gallery Insert` are insufficient.
- `TG0/TG30`, `TG31/TG30`, `TG99/TG999`, a mismatched prefix, or a denominator
  other than `TG30` is outside v1 and makes the registry `ABSTAIN`.
- Standard numerical rarity (`17/50`, `04/10`, `1/1`, `150/299`) and sports
  letter-prefix ratios remain Standard or fail closed; a generic number-shape
  predicate never enters this claim.

The 255-item supporting corpus
`data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json` (SHA-256
`9fa09c495d04c649b1e74aa057d6a5d426f6e0cc620032f2fd53b0e2b07308ba`)
contains one exact
`Trainer Gallery` + paired `TGn/TGn` occurrence and no other letter-prefix
ratio. That is supporting evidence, not proof of global exclusivity; the
adversarial sports matrix remains a mandatory release gate.

The source-authority receipt must retain:

- semantic-state and normalized-field-sources SHA-256 values;
- current-image and Web-source presence for Set and Card Number;
- the durable operation payload plus ordered original/recognition image
  fingerprint-set SHA-256 values;
- the tenant and recognition-session identity SHA-256, so an otherwise exact
  execution bundle cannot move between durable sessions;
- hashes of the server-issued provider client request ID and the exact provider
  response ID, so an otherwise identical receipt bundle cannot move between
  assets, paid attempts, or responses;
- `authority_used=CURRENT_IMAGE`, an audit version, and its own SHA-256.

The grammar-context receipt must retain:

- `APPLIED`, `ABSTAIN`, or `NOT_REQUIRED` status;
- claim ID, raw/resolved Grammar, normalized Set/Card Number;
- registry release/version/content and record SHA-256 values;
- normalization/policy versions and the source-authority receipt SHA-256;
- exact reason/conflict codes, `ip_action=UNCHANGED`,
  `web_authority_used=false`, and its own SHA-256.

Activating the registry requires new SEM decision, response-parser, resolver,
writer, and durable projection identities. Existing v3 or
`thin-path-observation-only-v1` identities must not acquire changed semantics;
the immutable rollback reader must first gain an append-only forward reader for
the new checkpoint tuple.

For a current-semantics writer, registry absence, `ABSTAIN`, or an invalid
authority receipt must fail closed when a Standard observation contains a
number that requires TCG context. It must not persist a Standard title while
silently carrying an unclassified TCG number.

## Rollback boundary

- Historical captured-e1ae parsing and every stored v1/v2/v3 replay remain
  byte-exact. The registry applies only to fresh current-writer observations.
- Removing or deactivating the registry makes the joint namespace `ABSTAIN` and
  restores the fail-closed ambiguity gate for new observations. It must not
  restore the pre-decision permissive Standard publication. Existing rows
  retain their persisted Grammar and Composer receipts.
- Only an explicit full-writer rollback may restore the historical writer's
  behavior; registry absence inside the current writer is never permissive.
- The registry adds no provider call, Web call, catalog lookup, external
  identity action, or title token.
- A release must prove exact positive, near-match, sports collision, numeric
  rarity, malformed-code, Lot, historical replay, and zero-provider-call
  readback cases before promotion.

## Approval record

Approved by the owner in the current Codex task on 2026-08-15 (Asia/Shanghai).

The approval is limited to the exact v1 joint namespace and boundaries in this
document: source-authority-bound `Trainer Gallery` + `TG1..30/TG30` may author
resolved TCG Grammar only; raw Grammar is retained, IP is unchanged, Web is not
authority, Lot/unknown/conflict abstain, and historical rows are never rewritten.

Implementation and release evidence must bind this document's SHA-256. Linear
linkage may be appended after the connector is callable; its absence cannot
broaden the approved semantics.
