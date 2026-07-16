# Listing Copilot Auth Productization Design

Status: product and interaction design ready; production wiring must start only after Track C tenant/RBAC work is integrated. This branch does not change live authentication, Supabase schema, or production routes.

## Decision

- Launch with invite-only email OTP. An idempotent invitation-provisioning workflow pre-creates only the Supabase Auth identity and a server-only pending invitation. It must not create an active Track C profile or tenant membership. OTP requests use `shouldCreateUser: false`; after the first successful verification, one local database transaction binds the verified Auth identity, creates or links the application user, creates the active tenant membership, and marks the invitation accepted. This avoids both arbitrary signups and pre-verification tenant access.
- Do not launch phone OTP in the first release. Keep the account contract compatible with `phone_e164`, but show the option only after an SMS provider, supported-country policy, CAPTCHA, delivery monitoring, and a cost ceiling are configured.
- Keep the rotated legacy MTV credential as a bounded compatibility path named `MTV 管理员预览`. It belongs to an isolated preview tenant and must not be treated as a platform administrator.
- Track C is the single authority for tenant identity, roles, API authorization, Storage ownership, and session revocation. Do not create a parallel auth/session implementation on the writer branch.

## Why invite-only first

Listing Copilot consumes paid model capacity and accepts customer card images. Open self-service registration would expose both cost and data-isolation risk before quotas, billing, abuse prevention, and customer support exist. The first release therefore uses an invitation or approved-domain gate.

The request-code response should stay generic whether an email is invited or not. This prevents account enumeration. An invited identity receives an OTP; an uninvited identity receives no access and can be routed to a later request-access flow.

## Human and environment verification

Human verification is a server-enforced prerequisite for sending an OTP, not a decorative client checkbox. Use a managed challenge such as Cloudflare Turnstile or hCaptcha. Low-risk traffic may pass without an interactive puzzle; suspicious traffic is escalated. The server must verify the challenge token, expected hostname/action, expiry, and single-use status before it asks Supabase to send a code.

Each request is evaluated across several coarse signals:

- HMAC-pseudonymized destination and recent send history;
- HMAC-pseudonymized IP or coarse network prefix, with allowances for shared office networks;
- a server-issued first-party opaque device/session identifier stored only in a `__Host-lc_device` cookie with `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` and no `Domain` attribute;
- invitation, tenant, and account status;
- project-wide mail volume, provider health, and a global circuit breaker.

Do not build canvas, audio, font, plugin, hardware, or persistent cross-site fingerprinting. Environment signals reduce automation risk but never establish identity. Keep the retained risk record minimal, pseudonymous, time-bounded, and unavailable to product analytics. Generate rate-limit keys with a rotating server secret and HMAC plus explicit TTLs; never store raw destinations or reversible/unsalted hashes for this purpose. Persist the HMAC key version with invitation and limit records, and allow current-plus-previous-key lookup only until the longest invitation or rate-limit TTL has elapsed.

The device cookie contains at least 128 bits of cryptographic randomness and is either signed by the server or mapped to a server-side record; an arbitrary client value is never trusted. If the cookie is missing or deleted, minting a replacement is itself rate-limited by IP/coarse-network and global buckets and starts in the stricter unknown-device risk tier. Expired device records and signing keys have bounded retention and rotation. This identifier remains only one abuse signal and never grants identity or access.

Recommended launch defaults are one request per destination per 60 seconds, five per destination per hour, a configurable IP/device bucket, and five OTP verification attempts before invalidating the challenge. These are application limits in addition to provider limits and must be tuned from delivery and abuse telemetry. Every resend performs a fresh risk evaluation; a new managed challenge is required when the previous token was consumed or the risk level changed.

## Identity and data contract

Track C already defines `OWNER`, `MANAGER`, and `WRITER`. Product preview status is a property of the tenant/data boundary, not a stronger role.

```text
auth_user_id        Supabase Auth UUID
user_id             stable application user id
tenant_id           server-resolved active membership
role                OWNER | MANAGER | WRITER
tenant_mode         PRODUCTION | PREVIEW
auth_method         EMAIL_OTP | PHONE_OTP | LEGACY_PREVIEW
session_version     revocation counter checked by the server
```

Recommended additive profile fields after Track C lands:

```text
display_name
phone_e164          nullable and unused in release 1
onboarding_completed_at
last_login_at
```

Add a separate server-only invitation state machine rather than extending Track C's current `ACTIVE | DISABLED` user and membership states:

```text
tenant_invitations
  id
  tenant_id
  auth_user_id
  destination_hmac
  destination_hmac_key_version
  idempotency_key
  role                OWNER | MANAGER | WRITER
  status              PROVISIONING | PENDING | ACCEPTED | REVOKED | EXPIRED | FAILED
  expires_at
  accepted_at
  created_at
```

Provisioning is a retry-safe workflow, not a cross-system transaction. First insert or reuse a deterministic `PROVISIONING` record, then create or resolve the Supabase Auth user idempotently, and finally attach `auth_user_id` and move the record to `PENDING`. A partial failure becomes `FAILED` with an auditable retry path; retries resume from the stored idempotency key and never create a duplicate invitation or Auth identity.

`PENDING` invitations never satisfy membership lookup and never authorize tenant data. On successful OTP verification, lock the invitation, require its destination and Auth identity to match the verified identity, then atomically create/link `users`, create `tenant_members` as `ACTIVE`, and mark the invitation `ACCEPTED`. This also prevents an existing Track C user from gaining a second tenant membership before accepting that tenant's invitation.

The application session endpoint should return the stable ids, display label, tenant name, role, `tenant_mode`, and scoped permissions. Business records must continue to use the stable application user id, never an email address, phone number, or the literal `mtv` label.

## User flow

1. The user enters an invited email.
2. The client completes a managed human/environment challenge when required.
3. The server follows a fail-closed sequence: verify the managed challenge with its provider; then, in one local database transaction, insert a unique replay digest, check and increment every destination/IP/device/global bucket, and confirm either a valid `PENDING` invitation or an `ACTIVE` user with at least one `ACTIVE` membership, without exposing which condition matched. Only after that transaction commits may it ask Supabase Auth to send a six-digit OTP with `shouldCreateUser: false`. Disabled users, users without an active membership, and failed/expired/revoked invitations receive the same generic response but no send. Any failed step stops the send. A provider send failure still consumes the attempt and is audited.
4. The screen moves to one accessible OTP input that supports paste, `autocomplete=one-time-code`, Enter submit, edit-email, resend countdown, and explicit error text.
5. The server verifies the OTP and takes one of two explicit branches. For a matching `PENDING` invitation, it locks and accepts the invitation, atomically creates/links the Track C user and active membership, then issues the existing HttpOnly application session. For a returning `ACTIVE` user, it makes no invitation change and resolves existing active memberships through Track C's tenant selection contract.
6. First login asks only for an optional display name, then enters the workspace. Do not add a multi-page tutorial.
7. The application header shows display name, masked email, role/preview badge, tenant name, and logout.
8. Session expiry or account suspension must not silently clear an unfinished title. Re-authentication should return to the original route and preserve recoverable local work.

## MTV administrator preview

- Public copy never exposes the account name or credential.
- The login page keeps a quiet secondary `管理员预览` disclosure below the normal OTP flow.
- The legacy identity maps to `tenant_legacy` during transition, with the product label `MTV 管理员预览` and `tenant_mode=PREVIEW`.
- Preview feedback, exports, and usage must be marked as preview data and excluded from production writer throughput, commercial accuracy, and training eligibility by default.
- Preview capability is not platform operations capability. Destructive migrations, catalog imports, vector indexing, worker controls, and secrets require the separate server-only platform-admin contract.
- Never restore the historical literal `mtv` password. Only the rotated environment credential remains valid.
- If the legacy password entry remains at launch, protect it with independent account-plus-IP limits, a five-failure temporary lockout, security-event audit logs, and alerting for repeated lockouts. It never shares the OTP rate-limit budget.

## UI states required before launch

- Requesting code, code sent, verifying, success.
- Environment check idle, checking, passed, failed, expired, and escalated challenge.
- Invalid destination, invalid/expired code, rate limited, send failure, network failure.
- Invitation absent, membership disabled, tenant disabled, multiple-tenant selection.
- Edit destination and resend after the server-provided cooldown.
- Admin preview collapsed and expanded states.
- Desktop and mobile layouts, keyboard-only navigation, visible focus, screen-reader status, paste and IME behavior.

## Future server contract

Add these only on top of the integrated Track C baseline:

```text
POST /api/auth/request-code
  { channel: "email", destination, challenge_token }
  -> 202 with a generic message and server cooldown

POST /api/auth/verify-code
  { channel: "email", destination, code, tenant_id? }
  -> Track C application session or tenant-choice response
```

The server may use Supabase Auth REST with `SUPABASE_PUBLISHABLE_KEY`; the browser must never receive the service-role/secret key. The server must disable auto-signup for code requests (`shouldCreateUser: false`) because invitation provisioning pre-creates the bounded Auth identity and returning users already have one. The application profile and active membership are created only when a new invitation is accepted after successful verification. Production email OTP requires custom SMTP and a template containing `{{ .Token }}`. Supabase's shared SMTP is not a production delivery path for arbitrary customer addresses.

The request-code endpoint must verify the managed challenge server-side before any invitation/account lookup or provider call. After provider verification, replay-digest insertion, all rate-limit checks/increments, and the pending-invitation-or-active-member eligibility check happen atomically in the local database before Supabase is called. Client-declared `verified=true`, browser metadata, a reusable CAPTCHA token, or a client-supplied environment/device identifier are never sufficient; ignore or reject those fields. Store only the server-issued device identifier in the bounded first-party cookie described above, rotate it after suspicious behavior, and never use it as an account identifier.

The verify-code endpoint must reject any code that does not strictly match `^[0-9]{6}$` before calling the provider. Client-side digit normalization is an input convenience only and is never a server validation rule.

## Phone OTP phase 2 gate

Phone OTP becomes visible only when all of these are true:

- SMS provider and supported-country allowlist are configured.
- E.164 normalization, recycled-number recovery policy, and account linking are defined.
- CAPTCHA, per-IP/per-destination limits, daily spend ceiling, and alerting are active.
- Delivery/failure metrics and customer support handling are available.
- Relevant regional SMS and privacy requirements have been reviewed.

## Integration order and conflict boundary

1. Finish and integrate Track C as the authority for tenant/session/RBAC and ownership.
2. Integrate Track D, replacing its legacy session hunks with Track C contracts.
3. Integrate the writer-mode commit and manually resolve its `app/listing-copilot.js` overlap with Track D.
4. Create the OTP implementation branch from that integrated baseline.
5. Reuse the local-only `prototypes/auth-productization/auth-product-flow.mjs` logic and `auth-preview.css` design, then wire the production `login.html` to the new auth endpoints.

Do not modify Track C's uncommitted auth files from this design branch. The preview intentionally lives in local-only additive files and makes no API request.

## Release gates

- Cross-tenant negative tests for session, job, image, feedback, retry, and export ownership.
- `MTV 管理员预览` receives `403` for every platform-admin operation.
- Client-supplied tenant/operator identifiers never override the authenticated context.
- OTP request enumeration, resend, brute-force, CAPTCHA, SMTP delivery, expiry, and suspension tests.
- New invitation acceptance, returning-member login, disabled-user no-send, provisioning retry/idempotency, and partial-failure recovery tests.
- Challenge-token replay, hostname/action mismatch, expired challenge, shared-network false positives, device/IP bucket exhaustion, and global circuit-breaker tests.
- Old benchmark/smoke automation continues through a bounded compatibility credential until it receives a service-token replacement.
- Preview actions do not enter production metrics or learning datasets.
- Email OTP Preview E2E on the deployed Vercel/Supabase configuration before production rollout.
- The existing GitHub `ci.yml` offline-test glob runs `scripts/auth-product-preview.test.mjs`; keep this prototype contract check in CI, not in a Vercel build that intentionally excludes `prototypes/`.

## Prototype

Serve the repository root locally and open `/prototypes/auth-productization/auth-preview.html`. It is a functional interaction prototype only. Use `123456` as the preview OTP; it never calls a real API or changes authentication state. The entire `prototypes/` tree is excluded by `.vercelignore` and must never ship in a production or Preview deployment.
