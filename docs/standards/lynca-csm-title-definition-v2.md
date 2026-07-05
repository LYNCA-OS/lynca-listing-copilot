# LYNCA CSM Title Definition v2

Status: Active draft
Scope: Standard collectible cards plus TCG cards
Marketplace title limit: 80 characters

## Core Principle

The system stores complete structured identity, but the marketplace title is a compressed serialization.

Current coverage principle: do not add new top-level grammar brackets just because an industry term appears to span multiple brackets. Mainstream Standard Card and TCG cases are covered by the current grammar. The hard cases are usually composite tokens, not missing top-level fields. Evolution should happen through richer internal structure and smarter output composition, especially inside `Print Finish`, while keeping marketplace output natural.

Do not confuse these three fields:

- `serial_number`: physical copy number, for example `2/3`.
- `numerical_rarity`: print-limit serialization rendered in title, for example `2/3` when fully read or `#/3` when only the denominator is known.
- `card_number`: card type or set number, for example `PAU`, `TCLA`, `139/205`.

The title should preserve the complete current-image serial when it is directly read, such as `2/3` or `15/150`. If only the denominator is known, render the safe placeholder, such as `#/3`. Never copy a serial numerator from a catalog/reference candidate.

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

`Numerical Rarity`: Print-limit serialization, such as `2/3`, `15/150`, `01/50`, or denominator-only `#/50`. This is the title module, not a renderer-derived copy of `serial_number`. Fill it only when current-card evidence clearly shows a print limit. If the current image directly supports the numerator and denominator, output the full value. If only the denominator is directly readable, output the denominator placeholder. If no print limit is visible, leave it empty. `1/1` remains `1/1`.

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
