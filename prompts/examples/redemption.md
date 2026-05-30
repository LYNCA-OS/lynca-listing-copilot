# Redemption Examples

Redemption cards should preserve the actual redemption contents.

Good:

`2026 Bowman Baseball Munetaka Murakami Chrome Rookie Auto Refractor Redemption`

Bad:

`Topps Redemption Card`

Rules:

- Set `redemption: true` only when the item is a redemption card.
- Title should include the player/character and exact card promised by the redemption.
- Preserve rookie, auto, refractor, parallel, serial, and product terms when visible.
- If the redemption contents are unreadable, confidence should be FAILED or LOW depending on how much is visible.
