# LYNCA CSM Title Definition v2

Status: Canonical SEM standard
Scope: Standard collectible cards plus TCG cards
Marketplace title limit: 80 characters
Source of record: Linear COS-10, COS-11, COS-12, COS-13, COS-14, COS-20, COS-21, COS-22, COS-23
Machine version: `linear-cos-10-23-v25`

## Core Principle

The system stores complete structured identity, but the marketplace title is a compressed serialization.

Current coverage principle: do not add new top-level grammar brackets just because an industry term appears to span multiple brackets. Mainstream Standard Card and TCG cases are covered by the current grammar. The hard cases are usually composite tokens, not missing top-level fields. Evolution should happen through richer internal structure and smarter output composition, especially inside `Print Finish`, while keeping marketplace output natural.

Do not confuse CSM fields with implementation or evidence terms:

- `Numerical Rarity`: the CSM field for production quantity / limited-numbering semantics, rendered as `2/3` when fully read from the current card or `#/3` when only the denominator is known.
- `print_run_number`, `print_run_numerator`, `print_run_denominator`, `numbered_to`, `serial_number`, and `serial_denominator`: implementation/evidence terms that may support Numerical Rarity. They are not canonical editable CSM fields.
- `Card Number`: card type, checklist, design, or set number, for example `PAU`, `TCLA`, `OP01-120`, `TAEV-EN006`, or TCG set numbering such as `139/205`.

The title should preserve the complete current-image print run when it is directly read, such as `2/3` or `15/150`. If only the denominator is known, render the safe placeholder, such as `#/3`. Never copy a print-run numerator from a catalog/reference candidate.

## Standard Card Grammar

For Sports, Entertainment, Culture, Celebrity, and other non-TCG standard cards:

`Year -> Manufacturer -> Product -> Set -> Subject -> Card Name -> Release Variant -> Print Finish -> Numerical Rarity -> Descriptive Rarity -> Card Number -> Search Optimization -> Grading Info`

Hidden category values such as `Basketball`, `Baseball`, `Marvel Comics`, or `Entertainment` are classification data. They do not normally render as title tokens unless part of an actual product name.

## TCG Grammar

For Pokemon, One Piece, Yu-Gi-Oh, Dragon Ball, and other TCG products:

`Year -> IP -> Language -> Manufacturer -> Product -> Set -> Subject -> Card Name -> Card Number -> Descriptive Rarity -> Numerical Rarity -> Variant -> Product Finish -> Special Stamp -> Grading Info -> Description -> Search Optimization`

TCG storage may use compact language values such as `EN`, `JP`, `CN`, `KR`, etc. Marketplace output may render `JP` as `Japanese`, `CN` as `Chinese`, and `KR` as `Korean`; `EN` can be hidden when the title is already clear. English is hidden for standard cards.

Unlike Standard Card Grammar, TCG titles are card-centric. Card Number is an identity anchor and appears immediately after Card Name.

## Field Definitions

`Year`: Card product or release year. Prefer primary card text, then secondary card text, then slab label. Do not use copyright year as product year without support.

`IP`: Rendered only for TCG. Examples: `Pokemon`, `One Piece`, `Yu-Gi-Oh`, `Dragon Ball`.

`Manufacturer`: Publisher or maker, such as `Panini`, `Topps`, `Konami`, `Bandai`.

`Product`: Product line, such as `Immaculate`, `Prizm`, `Topps Chrome`, `One Piece Card Game`.

`Set`: Product sub-set or TCG release set when applicable.

`Manufacturer/Product/Set smart composition`: backend records may keep all long fields separately, such as `Panini / Panini Prizm Black / Panini Prizm Black FOTL`. Output must merge the hierarchy and remove redundant or distribution/configuration words, rendering `Panini Prizm Black`. This smart composition applies to both Standard Card Grammar and TCG Grammar.

`Subject`: Player, character, team subject, or multiple subjects.

`Card Name`: Full named card identity such as `Dual Patch Auto`, `Rookie Ticket`, `Best Performance`, `Holo EX`.

`Release Variant`: A version difference of the same Card Name or Card Type within the same release system caused by layout, composition, or design direction. Examples include `Variation`, `Horizontal`, `Vertical`, `Image Variation`, and `International`. It is not Product, Set, Finish, Rarity, or distribution/product configuration.

`Product configuration`: `FOTL`, `Hobby`, `Retail`, `Choice`, `Fast Break`, and `Sapphire` are product/distribution/configuration terms. They do not belong in Release Variant. Store them in backend product/configuration data and include them in output only when commercially useful and the 80-character budget allows.

`Card Name/Release Variant/Print Finish smart composition`: backend records may store these fields separately, but output should merge them into a natural commercial phrase and remove duplicate words. Example backend fields `Gold Refractor Autograph / Variation / Gold` should render as `Gold Refractor Auto Variation`, not duplicate `Gold` and not split the phrase unnaturally. This smart composition applies to both Standard Card Grammar and TCG Grammar.

`TCG Subject/Card Name separation`: TCG titles are card-centric, but Subject and Card Name must still remain separable. Example: `Pikachu Illustrator` should store `Subject = Pikachu` and `Card Name = Illustrator`. Do not store the whole phrase as Subject. If the printed card name is the same as the subject, such as `Charizard ex`, both fields may contain the same value and the renderer deduplicates output.

`Card Number`: For non-TCG this is low priority, such as `PAU`, `DPA`, `TCLA`. If the visible code is `PAU-AED`, `AED` is a subject abbreviation and may be omitted, rendering `#PAU`. If recognized and the 80-character budget allows, include it. If it is not recognized, do not invent it. If the title is too long, remove this field before higher-priority fields. For TCG, card number is important because it identifies a card within a set, but it may still be omitted from the marketplace title when the 80-character budget would otherwise displace higher-value rarity, finish, special stamp, or grading tokens.

`Descriptive Rarity`: Especially common in TCG, such as `SR`, `AR`, `UR`. Less common in standard sports cards.

`Numerical Rarity`: Production quantity / limited-numbering semantics, such as `2/3`, `15/150`, `01/50`, or denominator-only `#/50`. Implementation may store supporting evidence in fields such as `print_run_number`, `print_run_numerator`, `print_run_denominator`, `numbered_to`, `serial_number`, or `serial_denominator`, but those names are not canonical editable CSM fields. Fill Numerical Rarity only when current-card evidence clearly shows a print limit. If the current image directly supports the numerator and denominator, output the full value. If only the denominator is directly readable, output the denominator placeholder. If no print limit is visible, leave it empty. `1/1` remains `1/1`.

`Product Finish`: Surface or finish terms such as `Aqua`, `Gold`, `Gold Shimmer`, `Master Ball Holo`, `Sparkle`, `Holo`.

`Special Stamp`: TCG-only event, prize, staff, or promotion stamp.

`Grading Info`: PSA, BGS, TAG, CGC, SGC, and other grading companies with card and auto grades. Example: `BGS 8.5/10`.

`Description`: Secondary manually editable descriptors such as `Case Hit`, `SSP`, first serial, jersey number, or other context. Only standardized descriptors should be automatic.

`Search Optimization`: Supported marketplace keywords such as `Auto`, `RC`, `1st Edition`, or team name. It is not identity.

## Compression Policy

The renderer adds a field only if the result fits within 80 characters, or removes lower-priority fields first.

For non-TCG cards, remove `Card Number` before Product Finish, Variant, Numerical Rarity, Subject, Product, and Grading Info.

For TCG cards, prefer `Card Number` when the title budget allows, but do not let it displace higher-value rarity, finish, special stamp, or grading tokens in the 80-character marketplace title.

Do not add filler tokens to occupy space.

## Linear SEM Decision Bindings

These bindings are now the canonical interpretation layer for GitHub code, Supabase records, catalog promotion, feedback learning, and future training exports.

### COS-10: Card Number vs Numerical Rarity

`Card Number` is a printed design, checklist, set, or card-type identifier. Examples: `SWS`, `SWS-LBJ`, `PAU`, `DPA`, `TCAR`, `OP01-120`, and TCG set numbers such as `139/205`.

`Numerical Rarity` is the current-card print-limit serialization. Examples: `04/10`, `02/99`, `2/3`, `15/150`, `#/50`, and `1/1`.

The same visual pattern can only be treated as TCG `Card Number` when the card/listing context is a TCG checklist or set-number context. Otherwise a directly visible `N/D` token is `Numerical Rarity`.

### COS-11: Catalog Assist Boundary

Catalog, registry, checklist, and vector candidates are not truth by default.

They may become trusted evidence only when all conditions are true:

1. The source is trusted enough for the intended use, such as reviewed internal reference, approved reference, official checklist, or structured database.
2. Current-image recognition agrees with the candidate on concrete anchors.
3. There are no direct evidence conflicts and no material anchor contradictions.

Useful anchors include `Year`, `Subject`, `Product/Set`, `Card Number`, `Card Name`, visible `Numerical Rarity`, and `Grade label`.

Fast path is allowed only after anchor agreement. Blind trust is not allowed. Marketplace data and weak external directories remain candidate-generation or research signals only.

### COS-12: Observation Fusion Terminology

Recognition Worker, OCR, vector retrieval, and catalog retrieval may produce:

- observed field candidates
- best observed fields
- evidence patches
- supporting or conflicting sources

They must not call those fields `resolved semantic fields`. Identity Resolution and the SEM decision layer own resolved semantic fields and canonical semantic objects.

### COS-13: Commercial Feedback vs Semantic Learning

Writer title edits are `Commercial Feedback`, not immediate `Semantic Truth`.

Writers approve or edit one-line marketplace titles. They should not be asked to do semantic labeling. The system may later mine accumulated commercial feedback into semantic learning candidates, hard negatives, reranker rows, and field-level training candidates. A field becomes semantic truth only after explicit field review, trusted source agreement, or a separate promotion workflow.

### COS-14: Lot Workflow

Lot is a separate commercial listing workflow, not a failed single-card route.

When multiple separate physical cards are visible, route to Lot grammar:

`Lot quantity -> Year -> Manufacturer/Product/Set -> Subjects max 3 -> Shared Card Name/Design -> Shared Print Finish -> Shared Numerical Rarity -> Search Optimization`

A single card with multiple subjects is not a Lot. It remains one card identity with multiple subjects.

### COS-20: Candidate Participation Boundary

Catalog, vector, marketplace, and external-directory rows are candidate evidence. V4 records their production participation as:

`LEVEL_0_SHADOW -> LEVEL_1_PROMPT_ASSIST -> LEVEL_2_EVIDENCE_SUPPORT -> LEVEL_3_FIELD_APPLICATION`

Every candidate trace must preserve `candidate_id`, `source_type`, `source_trust`, `participation_level`, `anchor_agreement`, `direct_conflicts`, `field_permissions`, `applied_fields`, `blocked_fields`, and `reason_per_field`.

Candidates may support identity fields only through field permissions: `can_apply`, `support_only`, `suggest_only`, or `forbidden`. They must not override visible evidence, OCR evidence, grading-label evidence, current-copy identifiers, physical condition, grade, or certificate evidence.

### COS-21: Serial Evidence vs CSM Fields

`serial_number`, `serial_denominator`, `print_run_*`, and `numbered_to` are implementation/evidence terms. They must not become canonical editable CSM fields without explicit founder / CSM approval and repeated real collectible outlier evidence.

The CSM boundary remains:

- `Card Number` = checklist / design / card-type identifier.
- `Numerical Rarity` = production quantity / limited-numbering semantics.

Renderer display choices such as `2/3`, `#/50`, or `1/1` do not create new CSM categories.

### COS-22: V4 Release Gate

V4 cannot be called commercially ready based on title proxy recall alone. Release requires field-level semantic quality, Candidate Control Plane readiness, leak-resistant blind evaluation, queue / worker production metrics, writer-facing boundary compliance, and shadow-only boundaries for systems that are not production-authoritative.

### COS-23: Boundary-First Governance

CSM V2.5 is boundary-first, not field-expansion-first. New engineering terms must first be classified as implementation detail, recognition schema, evidence artifact, renderer behavior, workflow behavior, boundary clarification, definition proposal, or founder decision. New CSM fields require repeated real collectible outlier evidence, not implementation convenience.
