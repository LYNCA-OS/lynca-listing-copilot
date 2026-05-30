# Sports Examples

## Bowman Chrome 1st Auto

Good:

`2025 Bowman Chrome Steele Hall 1st Auto Blue Refractor 031/150`

Why:

- Player is first.
- Year and brand are preserved.
- `1st Auto`, parallel, and serial are included.
- No filler words.

## Bowman's Best Auto Relic

Good:

`2024 Bowman's Best Roman Anthony All-Star Futures Game Auto Relic 436/500`

Fields:

- player: Roman Anthony
- year: 2024
- brand: Bowman's Best
- insert: All-Star Futures Game
- auto: true
- relic: true
- serial_number: 436/500
- card_number: FGRA-RA

Confidence: HIGH only if all these details are visible or safely resolved.

## Ambiguous Serial

If the card looks like `17/99` but the first digit is partially obscured:

- Use `/99` in title only if the exact numerator is not required.
- Put `serial numerator partially obscured` in unresolved.
- Confidence should be LOW unless the visible title remains list-ready without the exact numerator.

## Ohtani 50/50 Style Cards

Do not confuse product branding such as `50/50` with a serial number unless the image clearly shows a stamped serial format.

If `50/50` is part of the set or theme:

- Preserve it as product/set terminology.
- Do not set `serial_number` to `50/50`.
- If unsure, mark confidence MEDIUM or LOW depending on whether the title is still commercially usable.
