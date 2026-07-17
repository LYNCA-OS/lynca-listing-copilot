# Stabilize workbench motion

Status: DONE

## Problem

The workbench has frequent re-renders and a keyboard-first review loop. Decorative card travel, global transitions, permanent `will-change`, and multiple infinite indicators make the interface feel less stable and can interrupt focus.

## Implementation

- Use shared motion tokens: 140ms press, 180ms popover, 220ms surface.
- Never animate Enter save/advance, textarea focus, image-side switching, Escape close, or keyboard copy/reject.
- Keep only true in-progress indicators. Queued and completed states are static.
- Animate progress with `transform: scaleX()`, not width.
- Limit transitions to explicit properties on explicit components.
- For reduced motion, keep gentle color/opacity feedback and remove spatial movement.

## Acceptance

- No global `transition: all`.
- No permanent list-level `will-change`.
- Writer keyboard flow has no transform animation or artificial delay.
- All motion uses transform/opacity/color and completes within 300ms.

## Result

- Removed the artificial writer save/reject delay and card-travel animation.
- Converted progress updates from layout-changing width animation to `scaleX()`.
- Added scoped duration/easing tokens, pointer-only hover feedback, and a reduced-motion contract.
