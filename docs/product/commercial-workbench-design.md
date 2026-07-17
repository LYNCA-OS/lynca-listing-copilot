# Commercial AI listing workbench

## Product frame

Listing Copilot is a production desk, not a marketing dashboard. The core loop is:

1. intake a batch of card images;
2. let the durable queue prepare and generate;
3. review every final title;
4. persist the writer decision;
5. export only the persisted accepted batch.

The existing all-card review remains available. Writer mode adds a keyboard-first, one-card-at-a-time queue without changing the persistence contract.

## Visual system

- Mist-violet canvas and white working surfaces.
- Desaturated plum structure, deep aubergine typography, and no large black surfaces.
- Muted violet for the single primary action; sage green only for persisted success.
- Crisp borders, restrained radii, minimal shadow, no glass or decorative gradients.
- Card imagery has priority over metadata; operational status stays compact and stable.

## Interaction rules

- Enter saves and advances only after the server confirms the feedback transaction.
- High-frequency keyboard operations are immediate and do not animate.
- Export remains unavailable until every accepted row is persisted.
- Failure is shown inline and focus remains on the current card.
- Session, tenant, queue, and verification boundaries remain visible but never expose internal secrets.

## Auth boundary

- The launch path is invite-only email OTP.
- Managed human verification is server-verified and fail-closed.
- MTV is an isolated preview tenant owner, not a platform administrator.
- Phone OTP is not presented as available until a real SMS provider, cost controls, and abuse controls exist.
- Preview must not inherit production Supabase credentials.

## Preview release boundary

- Deploy from `codex/commercial-listing-workbench-preview` to a dedicated Vercel Preview project, never with `--prod`.
- The preview project may hold only isolated MTV display credentials and a preview session-signing secret.
- Do not attach production Supabase, provider, worker, SMTP, or Turnstile secrets to the preview project.
- Email OTP stays visibly fail-closed until an isolated Supabase project, delivery channel, HMAC/device secrets, hostname-bound Turnstile, and invitation seed are configured together.
- Recognition, persistence, and export endpoints remain unavailable without their isolated service configuration; the preview is for product and interaction acceptance, not production data processing.
- Promotion requires a separate deployment decision after Preview E2E, migration replay, and environment-scope review.
