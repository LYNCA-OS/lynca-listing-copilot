# Listing Copilot Training Note - Pokemon Illustrator Disambiguation (V1)

## Problem

A localized Pokemon Trainer SAR card showed:

- Chinese card name: `琉琪亚的展现`
- set code: `SV9C`
- card number: `257/208`
- rarity: `SAR`
- illustrator line: `Illus. En Morikura`

The system produced a misleading title:

`2026 Pokemon Scarlet Violet 257/208 SAR En Morikura Trainer Card`

## Root Cause

The model treated illustrator metadata as the primary subject and failed to preserve the trainer/character identity.

## Rule

Illustrator names are metadata, not primary identity.

For Pokemon Trainer / Supporter / 支援者 / 训练家 cards, title priority is:

1. trainer or character name
2. card number
3. rarity
4. set code or set name
5. language or region if visible
6. artist only as optional low-priority metadata, normally omitted

If the visible trainer name is localized and cannot be reliably translated, preserve the localized name and mark confidence MEDIUM.

## Expected Behavior

Good:

`琉琪亚的展现 257/208 SAR SV9C`

Bad:

`Pokemon Scarlet Violet 257/208 SAR En Morikura Trainer Card`

Reasoning should mention that illustrator is metadata only and localized trainer identity requires operator review or online reference.
