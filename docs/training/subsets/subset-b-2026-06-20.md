# Subset B Training Report

Date: 2026-06-20

## Overview

Subset B focused less on title grammar and more on:

- Registry Coverage
- Card Type Taxonomy
- Evidence Extraction
- Ground Truth Validation

Compared to Subset A:

Subset A primarily exposed title-generation and evidence-quality issues.

Subset B primarily exposed collectible knowledge and classification issues.

## Major Discovery 1

Marketplace Title != Ground Truth

A key lesson from Subset B:

Marketplace titles are not always correct.

Example:

Cooper Flagg

Marketplace Title:

`2026 Topps Cosmic Chrome Basketball Etched In Glass Insert Rookie Cooper Flagg`

Actual Card:

`Bowman Chrome`

Copilot:

`Bowman Chrome`

Result:

Copilot Correct

Marketplace Title Incorrect

## New Training Principle

Future training should use:

```text
Image
  |
Copilot Output
  |
Marketplace Title
  |
Ground Truth
  |
Root Cause
```

Marketplace titles are references.

Ground Truth is the training target.

## Major Discovery 2

Registry Coverage Is Becoming The Bottleneck

Current system generally performs well on:

- Year
- Player
- Product
- Grade

Remaining misses increasingly involve:

- Official Card Type
- Insert Names
- SSP Names
- Historical Product Knowledge

Examples:

Kobe Bryant

Expected:

- 2010 NBA Champions
- Silver Bar

Issue:

Card Type Recognition

VJ Edgecombe

Expected:

- Next Episode

Issue:

Card Type Registry Coverage

Kevin Durant Noir

Expected:

- Jumbo Material

Issue:

Official Card Type Recognition

Stephen Curry Ultraviolet

Expected:

- Ultraviolet

Issue:

Registry Coverage

PJ Washington Jr / Tyler Herro

Expected:

- Duo Logoman Autographs

Issue:

Registry Coverage + Visual Recognition

## Major Discovery 3

Serial Recovery Remains Weak

Subset B again exposed:

Serial Missing

Examples:

- 01/25
- 04/10
- 06/10
- 33/100

Priority:

Serial Recovery remains Tier 1.

Serials directly affect:

- Searchability
- Value
- Marketability

## Major Discovery 4

Card Type vs Parallel Taxonomy Is Working

Subset B validates the current taxonomy.

### Card Type

Examples:

- Next Episode
- Ultraviolet
- Duo Logoman Autographs
- Jumbo Material
- 2010 NBA Champions
- Etched In Glass
- Picture Perfect
- Spotlight Signatures

Definition:

Publisher-defined official design names.

### Parallel

Examples:

- Gold Refractor
- Orange Refractor
- Gold Vinyl
- Red Label
- Gold

Definition:

Parallel treatments layered onto a card type.

## Layer Classification

### Evidence Problems

Most common.

Examples:

- Serial missing
- Gold Vinyl
- Red Label
- 2010 NBA Champions
- Silver Bar

### Resolver Problems

Moderate frequency.

Examples:

- Ultraviolet
- Duo Logoman Autographs
- Next Episode
- Jumbo Material

### Grammar Problems

Very few.

Subset B suggests:

Grammar Layer is largely stable.

### Cleanup Problems

Minimal.

No major cleanup failures observed.

## Priority List

### Priority 1

Registry Expansion

Targets:

- Next Episode
- Ultraviolet
- Duo Logoman Autographs
- Jumbo Material
- 2010 NBA Champions
- Silver Bar

### Priority 2

Serial Recovery

Targets:

- 01/25
- 04/10
- 06/10
- 33/100

### Priority 3

Ground Truth Framework

Future training should distinguish:

Marketplace Title

vs

Ground Truth

to avoid learning marketplace mistakes.

## Final Conclusion

Subset A taught:

How to write titles.

Subset B taught:

What the card actually is.

The next major gains are likely to come from:

- Registry Expansion
- Evidence Extraction
- Serial Recovery
- Ground Truth Validation

rather than additional Grammar Layer improvements.

The system is gradually moving from a title-generation problem toward a collectible knowledge problem.
