# Codex versus Canonical Naming — Subset A

Date: 2026-08-11

Recognition arm: current `gpt-5.6-luna` / `reasoning.effort=low`

Projection candidate: LYNCA Standard Naming v0.1
Decision scope: Composer/profile only; zero additional provider calls

## Decision

Raw Codex string equality is not the production oracle. Five Codex titles are
longer than the 80-character contract, and two Codex codes conflict with the
stored visible evidence (`CPA-LD` versus `CPALD`, and `KB` versus `AS-KB`). The
admissible goal is the same useful identity quality under the explicit LYNCA
budget, without repairing or inventing source facts.

The old low titles and the new titles use the same 16 persisted low semantic
observations. The only changed layer is deterministic projection. The new
profile passes 16/16 exact frozen outputs, keeps all 16 Card Numbers, preserves
every available serial byte-for-byte, and performs zero network/provider calls.
When the 80-character budget forces a choice, full subject identity and release
year outrank slab grade; grade remains when it fits without displacing those
identity terms.

Evidence binding:

- formal cloud evidence SHA-256: `dbab65be5f7421683bf63c648ffddd016787b7e26369e3e2c2a38f3694b94c61` (a-j only);
- recovery cloud evidence SHA-256: `12ffd04e74a858d29266f48a90a23989a4a3cef7c8c0b12bc1cd0be680ad5c7f` (k-p);
- sanitized CI fixture: `fixtures/csm/subset-a-low-canonical-v1.json`;
- independently pinned, domain-separated digest over only the cloud-derived
  image hashes, redacted execution anchors and canonical fields:
  `5edcf9c43d2a840f5480dd8bd980cdaf7db6f0d34c25bbca1ee5b8f69049fd78`;
- separately versioned local projection digest over expected titles/traces:
  `b4f0e4e78632b38e060b1d7708e86e4e451c49ea303803cb8522eade74e52a6d`.

## Per-card comparison

| Case | Codex reference | Existing Production low title | CNL v0.1 candidate |
| --- | --- | --- | --- |
| a | `2025-26 Topps Chrome Basketball Cooper Flagg #251 Refractor /50` | `2025 Topps Chrome Cooper Flagg Gold Refractor 50/50 RC` | `2025 Topps Chrome Cooper Flagg Gold Refractor RC Mavericks #251 50/50` |
| b | `2001 Donruss Elite Passing the Torch Autographs #PT-18 Barry Bonds / Willie Mays /50` | `2001 Elite Passing the Torch Barry Bonds Willie Mays 22/50 Auto PSA Authentic/9` | `2001 Donruss Elite Passing the Torch Barry Bonds Willie Mays Auto #PT-18 22/50` |
| c | `2025-26 Bowman Chrome Basketball Chrome Prospect Autograph #CPA-CL Caleb Wilson 1/1` | `2025-26 Topps Bowman Chrome Prospect Autograph Caleb Wilson 1/1 Auto` | `2025-26 Topps Bowman Chrome Basketball Prospect Auto Caleb Wilson #CPA-CL 1/1` |
| d | `2000 Bowman Chrome #236 Tom Brady` | `2000 Topps Bowman Chrome Tom Brady BGS 9.5` | `2000 Topps Bowman Chrome Tom Brady Patriots #236 BGS 9.5` |
| e | `1986 Fleer Michael Jordan #57 PSA 6` | `1986 Fleer Michael Jordan PSA 6` | `1986 Fleer Michael Jordan Bulls #57 PSA 6` |
| f | `2018 Topps Future Stars Autograph #FS-5 Shohei Ohtani /5` | `2018 Topps Future Stars-Autograph Shohei Ohtani 1/5 RC Auto PSA 8` | `2018 Topps Future Stars Auto Shohei Ohtani RC Angels #FS-5 1/5 PSA 8` |
| g | `2003-04 Upper Deck Glass Monumental Marks Autograph Jersey #LJJ LeBron James` | `2003-04 Upper Deck UD Glass Monumental Marks LeBron James Auto Jersey BGS 9/10` | `2003-04 Upper Deck UD Glass Monumental Marks LeBron James Auto Jersey #LJJ` |
| h | `2024 Bowman Chrome Prospect Autographs Gold Refractor #CPA-LD Leo De Vries /50` | `2024 Topps Bowman Chrome Prospect Auto Leo De Vries Gold 45/50 1st Bowman PSA 10` | `2024 Topps Bowman Chrome Prospect Auto Leo De Vries Gold Ref Padres #CPALD 45/50` |
| i | `2012 Panini Prizm Autographs #1 Kobe Bryant` | `2012 Panini Prizm Autographs Kobe Bryant Auto PSA 9/10` | `2012 Panini Prizm Autographs Kobe Bryant Lakers #1 PSA 9/10` |
| j | `2025-26 Bowman Chrome Basketball Cooper Flagg Rookie Red Refractor #BCV-1 /5` | `2025 Topps Bowman Chrome Cooper Flagg 1/5 RC` | `2025 Topps Bowman Chrome Cooper Flagg RC Dallas Mavericks #BCV-1 1/5` |
| k | `2024 Panini Prizm Gold Shimmer #347 Jayden Daniels /10` | `2024 Panini Prizm Jayden Daniels Gold Shimmer 09/10 RC PSA 10` | `2024 Panini Prizm Jayden Daniels Gold Shimmer RC Commanders #347 09/10 PSA 10` |
| l | `2000 Bowman Chrome #236 Tom Brady` | `2000 Topps Bowman Chrome Tom Brady RC BGS 9.5` | `2000 Topps Bowman Chrome Tom Brady RC Patriots #236 BGS 9.5` |
| m | `2026 Topps Cosmic Chrome Basketball Cosmic Chrome Autograph Variation #CCA-CF Cooper Flagg /50` | `2026 Topps Cosmic Chrome Autograph Variation Cooper Flagg 40/50 RC Auto` | `2026 Topps Cosmic Chrome Basketball Auto Variation Cooper Flagg RC #CCA-CF 40/50` |
| n | `1976 Topps #148 Walter Payton` | `1976 Topps Walter Payton PSA 9` | `1976 Topps Walter Payton Bears #148 PSA 9` |
| o | `2012-13 Panini Immaculate Collection All-Star Lineage Autographs #KB Kobe Bryant /15` | `2012-13 Panini Immaculate All Star Lineage Autos Kobe Bryant 03/15 Auto BGS 9/10` | `2012-13 Immaculate Collection All Star Lineage Autos Kobe Bryant #AS-KB 03/15` |
| p | `2017 Panini Impeccable Elegance Helmet Patch Autograph #107 Patrick Mahomes II /75` | `2017 Panini Impeccable Elegance Patrick Mahomes II 60/75 Auto Patch BGS 9.5/10` | `2017 Panini Impeccable Elegance Patrick Mahomes II Auto Patch Chiefs #107 60/75` |

## Proof boundaries

- The table is a projection comparison, not a new recognition claim.
- The 16 semantic inputs are frozen from fresh Production low executions whose
  original image hashes, owner receipts and durable rows were already verified.
- Historical v1/v2 titles remain replayable byte-for-byte; v0.1 applies only to
  new Standard outputs.
- A live immutable-candidate NON_TCG Writer Journey plus a post-promotion
  canonical-domain zero-call readback is still required before Production can
  be declared complete.
- Broader governed web research and richer semantic state remain COS-59 follow-up
  work; neither is silently bundled into this Composer-only release.
