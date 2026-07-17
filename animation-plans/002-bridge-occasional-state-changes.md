# Bridge occasional state changes

Status: DONE

## Opportunities

- Pointer-opened image modal: backdrop opacity and panel scale from 0.98; pointer close is shorter. Escape closes immediately.
- Mode switch: surface color/border change only; writer content does not fly.
- Export-ready status: one-shot 160ms opacity/scale acknowledgement.
- Invitation result and tenant selector: short opacity reveal after a successful, rare action.

## Rejected opportunities

- No Enter-triggered card fly/scroll.
- No per-character, number ticker, login parallax, floating decoration, or image crossfade.
- No stagger on frequently refreshed card/result lists.

## Acceptance

- Every animated event is low frequency and clarifies state.
- Pointer and keyboard paths may intentionally have different motion.
- `prefers-reduced-motion` removes spatial motion without hiding state feedback.

## Result

- Kept one short image-modal entrance and one disclosure reveal for the rare MTV panel action.
- Mode changes use surface state only; the writer queue stays spatially stable.
- Rejected export celebration and list staggering because persistence status already communicates readiness.
