# Deep-purple clock wheel

Status: DONE

## Why this motion exists

The writer queue is spatial navigation, not decoration. The active card should read as the fixed selection plane while the next cards recede along one vertical axis. A short pointer or wheel transition should preserve object continuity; the high-frequency Enter-to-save path must remain immediate.

Animation vocabulary: **Perspective + 3D tilt + Scale + Scroll-driven animation**.

## Visual system

- Restore the original product's deep-purple foundation without returning to a near-black page: base `#160f23`, surface `#21172f`, elevated surface `#2b1c3d`, contrast-safe primary violet `#7c3aed`, and a restrained cyan signal `#57d4eb`.
- Make the palette a tokenized skin system rather than a one-off repaint. Ship four contrast-safe presets: `deep-purple` (default), `midnight-blue`, `jade-tech`, and `classic-light`. `classic-light` preserves the pre-redesign low-saturation violet-white workbench while inheriting the new contrast/focus/readability gates. A compact header control cycles them and persists the choice locally. Adding a future preset must require only one registry entry and one token block, not component edits.
- Apply the saved skin to login/register as well as the workbench and update the browser `theme-color`. Do not offer unrestricted raw color inputs because arbitrary combinations can break contrast and status semantics.
- Use liquid glass only where material hierarchy matters: the sticky app header, mode switcher, and selected wheel shell. Glass uses translucent deep-purple fill, a restrained specular edge, and `backdrop-filter` only behind short chrome; the text editor itself remains an opaque, high-contrast production surface.
- The glass highlight may cross the selected shell once during pointer/wheel navigation, sharing the same `190ms` transition. It must never float, breathe, loop, or react to each keystroke. Provide an opaque fallback under `@supports` and reduced-transparency preferences.
- Keep the center card at full opacity and scale. Dark presets keep the first next card readable at `0.68` opacity and `0.94` scale, and the second identifiable at `0.56` opacity and `0.86` scale. The light preset keeps text at full opacity and expresses depth through progressively lighter surfaces so contrast does not collapse.
- Use a vertical perspective of roughly `980px`, shallow `rotateX` values, scale, and position opacity so the stack reads as one clock-like bearing rather than disconnected cards. Do not mask the shared 3D track because CSS masks flatten the preserved scene in Chrome.
- Recognition state and card number remain visible on every preview layer. Depth must never be communicated by blur alone.

## Interaction

- Pointer click and physical wheel navigation: one `190ms` transform/opacity entrance using the existing custom ease-out curve. Forward motion enters from `+12px`; backward motion enters from `-12px`.
- Keyboard activation of a preview and Enter-to-save: no spatial animation and no delay.
- No stagger, bounce, spring, per-character motion, continuous glow, or layout animation.
- `prefers-reduced-motion: reduce` removes all spatial wheel animation while retaining the static opacity/scale hierarchy.
- `prefers-contrast: more` increases preview opacity/borders; `prefers-reduced-transparency` replaces glass with opaque deep-purple surfaces.

## Implementation

- `app/theme-controller.js` and page heads: apply a saved preset before first paint, expose the preset registry, cycle from the header control, update accessible text/swatch and `theme-color`, and tolerate unavailable local storage.
- `app/index.html`: add the compact theme-cycle control without displacing session or batch actions on mobile.
- `app/listing-copilot.js`: render a previous slot, a full-opacity current slot, and two next-depth slots; expose direction only for pointer/wheel navigation; clear transient motion state after the entrance.
- `app/commercial-ui.css`: replace the one-off commercial palette with semantic theme tokens and four preset blocks, including the preserved native violet-white skin; style the four-slot perspective stack; animate wrapper slots using only transform and opacity; update mobile rows and reduced-motion coverage.
- `scripts/writer-wheel-mode.test.mjs`: assert the second next depth, pointer-only animation gate, dark-purple tokens, clock perspective, readable depth opacities, and reduced-motion override.

## Acceptance

- At desktop and 390px mobile widths, the current card is unambiguously selected and the two cards below are progressively lighter while card/status text remains readable.
- Each theme can be selected in one action, survives reload, retains readable focus/status contrast, and does not alter wheel geometry or persistence behavior.
- Mouse wheel and pointer preview navigation show one brief axis transition; keyboard-triggered navigation and Enter persistence do not animate.
- No horizontal overflow, obscured controls, console errors, or new 404s in the deployed Preview.
- Focus order, ARIA labels, persistence gating, export gating, and standard card mode remain unchanged.

## Result

- Implemented the four-slot writer axis with an explicit previous row, full-opacity current work surface, and two progressively receding next rows. Pointer and physical-wheel navigation consume a one-render `190ms` motion token; keyboard activation and Enter persistence never receive that token.
- Added theme-aware wheel/chrome/material tokens, four whitelisted presets, pre-CSS local persistence, cross-tab synchronization, browser `theme-color` updates, and the same accessible cycle control on workbench, login, and registration pages. The light preset preserves copy contrast through surface depth rather than whole-card opacity.
- Added opaque reduced-transparency fallbacks, reduced-motion suppression, higher-contrast fallbacks, focus/fallback targets, explicit edge-slot rows, and native wheel handling on editor controls. A foreground mask was explicitly rejected after Chrome verification showed that it flattened the shared 3D track.
- Focused source tests, syntax checks, and `git diff --check` pass. Real Chrome at 390px verified four-theme cycling/persistence, CSS parsing, login/register theme controls, zero horizontal overflow, and zero page errors. Authenticated workbench/Preview visual verification remains part of the parent release pass.
