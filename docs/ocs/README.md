# OCS canonical resources — repository side

Mirrors the numbered resource structure defined in Linear:
`【Infrastructure】LYNCA Organizational Cognition System`.

## Source-of-truth boundaries, and what that means for these files

The OCS contract assigns each source a distinct authority:

| source | owns |
|---|---|
| Foundation | mission, values, principles, founder intent |
| **Linear** | **current project definition, canonical specifications, decision proposals** |
| **GitHub** | **implemented system behaviour** |
| Production Reality | observations, user behaviour, commercial outcomes, validation evidence |

> Production evidence may challenge existing assumptions, but it cannot silently
> rewrite canonical principles or specifications.

So these files are **not** a second copy of the specification. Linear owns the
spec. This directory owns what is *implemented*, and carries production evidence
where that evidence is what the resource is for.

Where a resource's canonical content lives in Linear and has not been mirrored,
the file says so rather than paraphrasing it. **An invented specification is
worse than an absent one** — it is exactly the silent rewrite the contract
forbids.

## Contents

| resource | state |
|---|---|
| `00-philosophy-and-definition.md` | mirrored from the Linear homepage |
| `10-system-responsibilities.md` | **awaiting Linear content** |
| `20-system-architecture.md` | loop mirrored; implementation mapping added |
| `30-sources-of-truth-and-learning-loop.md` | **production audit — repository contribution** |
| `40-authority-and-governance.md` | boundaries mirrored; enforcement points added |
| `50-capability-stack-and-interfaces.md` | stack mirrored from the Jul 28 update |
| `60-current-phase-and-rebuild-contract.md` | phase mirrored; repo status added |

## Placement

Current phase is *Repository Genesis*, and a dedicated canonical OCS repository
may be intended (COS-29). These files live here because this is where the
production audit was produced; if a dedicated repository is created they move
wholesale, and nothing here assumes this location is final.
