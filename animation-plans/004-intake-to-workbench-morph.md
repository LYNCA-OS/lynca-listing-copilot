# Intake-to-workbench morph

Status: DONE

## Why this motion exists

The upload task and the card queue are not separate pages. They are two states of one workbench: before a batch exists, upload is the only primary task; once images are ready, that same task becomes a compact control rail and makes room for review. Likewise, default mode and writer mode are two arrangements of the same cards. Motion should preserve those object relationships instead of cross-fading whole panels.

Animation vocabulary: **Shared element + View Transition + Morph + Reorder**.

## State model

- `empty`: center one upload task in the available workspace. Hide batch metrics, review queue, and export history because they have no useful state yet.
- `ready / standard`: place the same upload task at the top, expose a compact batch summary, and arrange every card in the existing vertical review list.
- `ready / writer`: keep the top intake rail fixed and arrange the current, previous, and next two card identities on the clock-like wheel.
- The first batch enters `ready / writer` so the wheel is the immediate writing surface. `默认模式` remains the preserved legacy list and is one action away; later switches within the batch preserve the user's selection.
- `reset`: return directly to `empty`. Reset is destructive and explicit, so it does not need a celebratory transition.

## Interaction

- When pointer selection or drag-and-drop first creates a batch, use one `260ms` shared-element View Transition to move the intake object from center to the top rail. Keyboard file selection updates immediately. The newly available workbench may enter through the browser's layout snapshot; do not animate image recognition progress or individual results.
- When switching modes, name at most the four wheel-visible card identities. Reuse those names on the corresponding list rows so cards spatially reorder between list and wheel in `240ms`.
- Do not stagger cards, spring, bounce, blur, or animate the full document root. View Transitions are a progressive enhancement; unsupported browsers update immediately.
- Keyboard actions, including Enter-to-save, remain immediate and must not start a View Transition. Physical wheel navigation retains the existing single `190ms` axis response.
- `prefers-reduced-motion: reduce` disables both intake and mode View Transitions. Focus, status messages, persistence confirmation, and export gating remain unchanged.

## Visual simplification

- Remove decorative outer borders and filled panel shells from intake, batch summary, review board, and saved-title board. Preserve borders only where they communicate an actionable object: the upload drop target, mode control, wheel shell, individual card, and editor.
- In `empty`, center the upload task and keep the headline compact. In `ready`, remove the marketing-style introduction so work starts at the intake rail.
- Make the writer center-card images a primary reading surface, large enough to transcribe without opening the modal. Keep the default list thumbnails compact; the modal remains an optional detail view.
- The legacy wheel viewport grid must be explicitly neutralized in the commercial layer. The new four-row track must define its own height so previous, current, next-depth-1, next-depth-2, and footer never overlap.

## Implementation

- `app/index.html`: rename the existing standard control to `默认模式 / 卡片纵列`; retain the same stable mode values and accessible pressed state.
- `app/listing-copilot.js`: derive `data-batch-state` from built assets, provide a reduced-motion-safe View Transition helper, move the ready render into the intake transition, and map the four visible asset indices between mode layouts. Clear temporary transition names after completion.
- `app/commercial-ui.css`: implement the empty and ready stage layouts, strip redundant outer shells, set the intake shared-element name, provide short View Transition timing, and override the legacy viewport with `display: block`.
- `scripts/writer-wheel-mode.test.mjs`: cover the stage states, visible mode labels, progressive View Transition gate, four-card identity cap, viewport fix, reduced motion, and no keyboard/Enter transition regression.

## Acceptance

- Before upload, the drop target is the only central task; no empty review or export boxes compete for attention.
- After first image preparation, the same upload object lands at the top and writer mode becomes visible in the center without a page flash.
- Default mode shows the complete vertical card list. Switching to writer mode maps the current visible cards onto the wheel; switching back maps them into their list positions.
- On desktop the writer center image is roughly 260–320px wide or larger; at 390px it uses the available content width and never falls back to list-thumbnail scale.
- The rendered wheel order is previous -> current -> next-depth-1 -> next-depth-2 -> footer, with the viewport and track sized to their full content.
- Desktop and 390px layouts have no horizontal overflow, inaccessible controls, console errors, new 404s, or motion under reduced-motion.

## Result

Implemented in the local preview worktree without pushing or deploying:

- Built assets now drive the explicit `empty` / `ready` stage. Empty hides mode, metrics, review, and export; first ready batches enter writer mode while `默认模式 / 卡片纵列` preserves the complete list.
- Pointer/drag intake uses one progressive `260ms` shared-element View Transition; mode buttons use a pointer-only `240ms` transition with at most four unique asset identities. Unsupported, reduced-motion, keyboard, Enter-save, background renders, and reset remain immediate.
- Redundant outer panel shells are transparent. The ready marketing intro is removed, the legacy viewport is `display: block`, and the four wheel rows own their full height.
- The writer current card alone receives the large reading layout: Chrome measured each desktop pair image at `302px` wide, while the `390px` rule stacks images at available content width. Default-list thumbnail density is unchanged.
- Desktop Chrome confirmed first-ready writer mode, up to four matched card identities, `740px` viewport/track height with the footer below the wheel, four complete standard rows, and a successful return to writer mode. Focus restoration uses `preventScroll` so the morph does not move the page.
- `node scripts/writer-wheel-mode.test.mjs`, JavaScript syntax validation, and `git diff --check` pass. Preview deployment remains a separate release step.
