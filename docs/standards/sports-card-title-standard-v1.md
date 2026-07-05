# Sports Card Title Standard v1

Listing Copilot Foundation Specification

Status: Draft v1
Owner: LYNCA Listing Intelligence
Scope: Sports Cards (Basketball, Football, Baseball, Soccer, F1, UFC, Hockey, etc.)

## Objective

The goal of Listing Copilot is not to generate random eBay titles.

The goal is to generate:

Commercially Accurate Titles

using a repeatable hierarchy of evidence, structured title grammar, and marketplace-standard formatting.

The system should prioritize:

1. Accuracy
2. Commercial usefulness
3. Marketplace convention
4. Consistency

over keyword stuffing or generic AI wording.

## Layer 1: Evidence Layer

Listing Copilot should first identify structured facts.

Evidence fields:

- Year
- Manufacturer
- Product
- Player(s)
- Card Type
- Rainbow Parallel
- Variation Parallel
- Serial Number
- Attributes
- Auto
- RC
- SSP
- Case Hit
- JPN
- Korea
- Grade

Auto, Patch, and Relic are visible evidence fields and common Card Type components. They are not Attributes.

The goal of this layer is:

Fact Extraction

not title writing.

## Layer 2: Evidence Hierarchy

When information conflicts:

Always trust higher hierarchy.

Priority:

Tier 1: Card Design Evidence

Tier 2: Grading Slab Evidence

Tier 3: Registry / Historical Database

Tier 4: Visual Inference

### Card Design Evidence

Includes:

- Card Front
- Card Back
- Printed Card Text
- Printed Product Information
- Printed Serial Number
- Printed Card Type

Highest authority.

### Grading Slab Evidence

Includes:

- PSA Label
- BGS Label
- SGC Label
- CGC Label

Used when card itself does not provide enough information.

### Registry / Historical Knowledge

Includes:

- Known Card Types
- Known Checklists
- Known Product Structures
- Known SSP Knowledge
- Future Cloud Database

Used only when Card Design and Slab do not provide sufficient evidence.

### Visual Inference

Lowest authority.

Examples:

- Looks Gold
- Looks Orange
- Looks Wave

Must never override stronger evidence.

### Conflict Resolution Examples

Example 1:

Card Back:

`2025-26 Topps Chrome Basketball`

PSA Label:

`2025`

Output:

`2025-26`

Example 2:

Card Type:

`Dual Signatures`

Model Guess:

`Dual Auto`

Output:

`Dual Signatures`

Example 3:

Card Front:

`01/25`

Label:

No Serial

Output:

`01/25`

## Layer 3: Grammar Layer

Canonical Sports Card Grammar:

Year -> Manufacturer -> Product -> Player(s) -> Card Type -> Parallel -> Serial Number -> Attributes -> Grade

Example:

```text
2025-26
Topps
Chrome
Cooper Flagg
Chrome Rookie Auto
Gold Refractor
31/50
RC
PSA 9/10
```

Final Output:

`2025-26 Topps Chrome Cooper Flagg Chrome Rookie Auto Gold Refractor 31/50 RC PSA 9/10`

### Field Definitions

#### Year

Examples:

- 2025
- 2025-26
- 2024-25
- 2015-16

Season years have priority.

#### Manufacturer

Examples:

- Topps
- Panini
- Upper Deck
- Leaf
- Futera

Manufacturer is the conceptual product-owner field. In the current V1.x schema, this is represented by `brand`.

#### Product

Examples:

- Chrome
- Cosmic Chrome
- Dynasty
- Flawless
- Prizm
- Immaculate
- National Treasures
- Exquisite

#### Player(s)

Examples:

- Cooper Flagg
- Stephen Curry
- Shaquille O'Neal
- Anfernee Hardaway

Multiple players preserved.

#### Card Type

Examples:

- Chrome Rookie Auto
- Chrome Auto
- Dual Signatures
- Duo Logoman Autographs
- Star Swatch Signatures
- Patch Auto

Official card types have very high priority.

#### Parallel

Split conceptually into:

Rainbow Parallel:

- Gold Refractor
- Orange Refractor
- Red Refractor

Variation Parallel:

- Red Propulsion
- Green Geometric
- Black Finite

#### Serial Number

Examples:

- 01/25
- 31/50
- 2/5
- 1/1

Tier 1 information.

Must never be removed.

#### Attributes

Examples:

- RC
- SSP
- Case Hit
- JPN
- Korea

Attributes can coexist.

Auto, Patch, and Relic are not Attributes. They belong to Card Type or card-type components.

#### Grade

Always appears last.

Examples:

- PSA 10
- PSA 9/10
- PSA AUTO 10
- BGS 9.5
- BGS 9.5/10
- BGS AUTO 10

## Layer 4: Cleanup Layer

Future Cleanup Layer does not understand cards.

Future Cleanup Layer only formats titles.

Current V1.x Cleanup may perform pragmatic semantic repairs. Future Resolver should own semantic decisions, while Cleanup should own formatting and deduplication.

### Manufacturer Deduplication

`Topps Topps Dynasty` -> `Topps Dynasty`

`Panini Panini Flawless` -> `Panini Flawless`

### Auto Deduplication

`Chrome Auto Auto` -> `Chrome Auto`

`RC Auto Chrome Auto` -> `Chrome Auto RC`

Auto should only appear once.

### Card Number Suppression

Card Number is low-priority for non-TCG cards, not forbidden. Include it only when it is visible and the 80-character budget allows.

When a code ends with a subject abbreviation, display the card-type prefix only:

- `PAU-AED` -> `#PAU`
- `SR-KD` -> `#SR`

Remove Card Number before higher-priority fields when the title is too long.

### Numerical Rarity / Serial Number Separation

`serial_number` stores the raw physical-copy reading from the current image. `numerical_rarity` is the title module and must not be mechanically derived from `serial_number`.

If current-card evidence directly supports a print-limit value, preserve it in the title:

- 01/25 -> 01/25
- 31/50 -> 31/50
- 2/5 -> 2/5
- 1/1 -> 1/1

If only the denominator is known, render the safe denominator placeholder:

- /25 -> #/25
- #/50 -> #/50

Never copy a serial numerator from catalog/reference candidates.

If no print limit is visible or confidently recognized, leave `numerical_rarity` empty even when other number-like text exists.

### Product Protection

Never collapse:

`Topps Cosmic Chrome` -> `Topps Chrome`

`Topps Dynasty` -> `Topps`

`Panini Immaculate` -> `Immaculate`

Product identity is valuable.

## Layer 5: Grading Semantics

The system must understand what was graded.

Not just the grade number.

### PSA

Card Grade Only:

- PSA 10
- PSA 9
- PSA AUTH
- PSA ALTERED

Card Grade + Auto Grade:

- PSA 10/10
- PSA 9/10
- PSA 10/9
- PSA AUTH/10

Auto Grade Only:

- PSA AUTO 10
- PSA AUTO 9
- PSA AUTO AUTH

Never output:

`PSA 10`

when only autograph grade exists.

### BGS

Card Grade Only:

- BGS 10
- BGS 9.5
- BGS 9
- BGS AUTH
- BGS ALTERED

Card Grade + Auto Grade:

- BGS 10/10
- BGS 9.5/10
- BGS 9/9
- BGS AUTH/10

Auto Grade Only:

- BGS AUTO 10
- BGS AUTO 9
- BGS AUTO AUTH

Never output:

`BGS 10`

when only autograph grade exists.

## Long-Term Evolution

Future Architecture:

```text
Vision
  |
Evidence Layer
  |
Resolver Layer
  |
Grammar Engine
  |
Cleanup Layer
  |
Final Title
```

Vision is the upstream model/input perception step. Evidence Layer begins after vision output is converted into structured facts.

The long-term objective is to transition away from patch-heavy title generation and toward a structured grammar-based title engine.
