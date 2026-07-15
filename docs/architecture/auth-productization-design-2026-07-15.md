# Listing Copilot Auth Productization Design

Status: product and interaction design ready; production wiring must start only after Track C tenant/RBAC work is integrated. This branch does not change live authentication, Supabase schema, or production routes.

## Decision

- Launch with invite-only email OTP. The login and registration flow is one action: the first successful verification creates the Supabase Auth identity, while access still requires an active tenant membership.
- Do not launch phone OTP in the first release. Keep the account contract compatible with `phone_e164`, but show the option only after an SMS provider, supported-country policy, CAPTCHA, delivery monitoring, and a cost ceiling are configured.
- Keep the rotated legacy MTV credential as a bounded compatibility path named `MTV 管理员预览`. It belongs to an isolated preview tenant and must not be treated as a platform administrator.
- Track C is the single authority for tenant identity, roles, API authorization, Storage ownership, and session revocation. Do not create a parallel auth/session implementation on the writer branch.

## Why invite-only first

Listing Copilot consumes paid model capacity and accepts customer card images. Open self-service registration would expose both cost and data-isolation risk before quotas, billing, abuse prevention, and customer support exist. The first release therefore uses an invitation or approved-domain gate.

The request-code response should stay generic whether an email is invited or not. This prevents account enumeration. An invited identity receives an OTP; an uninvited identity receives no access and can be routed to a later request-access flow.

## Human and environment verification

Human verification is a server-enforced prerequisite for sending an OTP, not a decorative client checkbox. Use a managed challenge such as Cloudflare Turnstile or hCaptcha. Low-risk traffic may pass without an interactive puzzle; suspicious traffic is escalated. The server must verify the challenge token, expected hostname/action, expiry, and single-use status before it asks Supabase to send a code.

Each request is evaluated across several coarse signals:

- hashed destination and recent send history;
- IP hash or coarse network prefix, with allowances for shared office networks;
- a first-party opaque device/session identifier;
- invitation, tenant, and account status;
- project-wide mail volume, provider health, and a global circuit breaker.

Do not build canvas, audio, font, plugin, hardware, or persistent cross-site fingerprinting. Environment signals reduce automation risk but never establish identity. Keep the retained risk record minimal, pseudonymous, time-bounded, and unavailable to product analytics.

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

The application session endpoint should return the stable ids, display label, tenant name, role, `tenant_mode`, and scoped permissions. Business records must continue to use the stable application user id, never an email address, phone number, or the literal `mtv` label.

## User flow

1. The user enters an invited email.
2. The client completes a managed human/environment challenge when required.
3. The server validates the single-use challenge, applies destination/IP/device/global limits, checks the invitation without exposing the result, and asks Supabase Auth to send a six-digit OTP.
4. The screen moves to one accessible OTP input that supports paste, `autocomplete=one-time-code`, Enter submit, edit-email, resend countdown, and explicit error text.
5. The server verifies the OTP, resolves one active Track C membership, and issues the existing HttpOnly application session. Multiple memberships use Track C's tenant selection contract.
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
  { channel: "email", destination, challenge_token, environment_id? }
  -> 202 with a generic message and server cooldown

POST /api/auth/verify-code
  { channel: "email", destination, code, tenant_id? }
  -> Track C application session or tenant-choice response
```

The server may use Supabase Auth REST with `SUPABASE_PUBLISHABLE_KEY`; the browser must never receive the service-role/secret key. Production email OTP requires custom SMTP and a template containing `{{ .Token }}`. Supabase's shared SMTP is not a production delivery path for arbitrary customer addresses.

The request-code endpoint must verify the managed challenge server-side before any invitation lookup or provider call. Client-declared `verified=true`, browser metadata, or a reusable CAPTCHA token are never sufficient. Store only a server-issued opaque `environment_id`; rotate it after suspicious behavior and never use it as an account identifier.

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
5. Reuse the additive `auth-product-flow.mjs` logic and `auth-preview.css` design, then wire the production `login.html` to the new auth endpoints.

Do not modify Track C's uncommitted auth files from this design branch. The preview intentionally lives in additive files and makes no API request.

## Release gates

- Cross-tenant negative tests for session, job, image, feedback, retry, and export ownership.
- `MTV 管理员预览` receives `403` for every platform-admin operation.
- Client-supplied tenant/operator identifiers never override the authenticated context.
- OTP request enumeration, resend, brute-force, CAPTCHA, SMTP delivery, expiry, and suspension tests.
- Challenge-token replay, hostname/action mismatch, expired challenge, shared-network false positives, device/IP bucket exhaustion, and global circuit-breaker tests.
- Old benchmark/smoke automation continues through a bounded compatibility credential until it receives a service-token replacement.
- Preview actions do not enter production metrics or learning datasets.
- Email OTP Preview E2E on the deployed Vercel/Supabase configuration before production rollout.

## Prototype

Open `/app/auth-preview.html`. It is a functional interaction prototype only. Use `123456` as the preview OTP; it never calls a real API or changes authentication state.
