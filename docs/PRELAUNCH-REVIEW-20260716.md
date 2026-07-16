# Pre-launch review — 2026-07-16

Reviewer pass over the new branches and the GPT-supervisor (codex) changes,
requested before launch. Scope: branch hygiene + code security. Algorithm
changes were explicitly out of scope (still being iterated separately) —
only sanity-scanned for security, no issues.

## TL;DR

- **Security: clean.** No real secrets committed, admin/tenant/migration
  surfaces are correctly authenticated, tenant isolation and dynamic SQL are
  professional-grade. Details below.
- **Integration branch is launch-ready by tests:** offline suite **152/152**
  on `codex/listing-production-integration` @ 8d4f789.
- **The "not uploaded cleanly" issue is branch topology, not lost work** —
  see Branch hygiene. One redundant local branch to clean up; the real
  launch action (integration → main) is a team decision, not done here.

## Branch topology (as of review)

| Branch | Pushed? | Relationship |
|---|---|---|
| `main` @ 7dbe360 | yes | current production line; does NOT yet contain the integration work |
| `codex/listing-production-integration` @ 8d4f789 | yes | **the real launch target**; already merged track-c + track-d + auth-design + origin/main. 206 files / +30,696 vs main |
| `codex/track-c-production-engineering` | yes | subsumed by integration |
| `codex/track-d-data-assets` | yes | subsumed by integration |
| `codex/auth-productization-design` | yes | subsumed by integration |
| `codex/writer-mode` @ f291584 | **NO (local only)** | **redundant** — it is an ancestor of integration (merge-base == its own HEAD); all its content already lives in integration and beyond |

The "didn't upload cleanly" symptom = `codex/writer-mode` exists only as a
local branch + worktree and was never pushed, but that is harmless because
integration already contains everything it introduced. Nothing was lost.

### Actions
- **Safe to delete `codex/writer-mode`** (branch + its worktree at
  `/Users/paidaxin/Documents/Lynca/lynca-listing-copilot-writer-mode`).
  Left for the owner to run (it lives under a codex worktree; not deleted by
  the reviewer):
  ```bash
  git worktree remove /Users/paidaxin/Documents/Lynca/lynca-listing-copilot-writer-mode
  git branch -D codex/writer-mode
  ```
- **Launch = merge `codex/listing-production-integration` into `main`.**
  206 files / 30k lines: a team decision + maintenance-window operation,
  deliberately NOT performed in this review. Recommended path: open a PR
  integration → main so CI runs, review the diff, then merge. Note the
  branch also carries new SQL migrations (below) that must be applied in a
  maintenance window, not via the runtime migration endpoints.

## Security audit (integration branch)

**Verdict: no blocking issues.**

- **Admin endpoints** (`api/admin-*.js`): every one wires
  `platformAdminAuth` (`x-lynca-platform-admin-secret` /
  `LYNCA_PLATFORM_ADMIN_SECRET`, constant-time compare). Runtime migration
  handlers additionally fail closed in production
  (`runtimeMigrationAuth` → 403 when `VERCEL_ENV/NODE_ENV=production`),
  so an admin secret alone cannot run migrations against prod.
- **Tenant endpoints** (`api/v4/tenant-settings.js`, `tenant-members.js`):
  `requireTenantAccess` + explicit permission (`CONFIGURE_TENANT` etc.) +
  strict input whitelisting (allowed-keys set, enum/format validation).
- **v4 endpoints**: worker endpoints gate on `isV4WorkerRequest`; job/status
  endpoints on session + `enforceApiRateLimit`; `listing-copilot-title` /
  `listing-preingest` delegate to the session-authed handlers as before.
- **Tenant RLS + dynamic SQL** (`20260715065803_track_c_tenant_foundation_
  expand.sql`, 35 policies / 70 dynamic statements): identifiers use `%I`,
  literals `%L`; the 8 raw `%s` are only in RAISE exception message text and
  one hardcoded constraint clause; table names come from an in-migration
  hardcoded array, never user input. RLS predicates use standard
  `private.is_tenant_member` / `has_tenant_permission` /
  `current_app_user_id` helpers. No injection surface.
- **Secrets**: the only credential-looking literals in new diffs are test
  fixtures (`internal-service-origin.test.mjs`, `test-admin-token`, etc.);
  no real prod secret literals anywhere in the tree; `.secrets/`, `.env*`
  still gitignored; no sensitive files tracked on any branch.
- **CI hardening added**: a fail-closed guard requiring the dispatch to
  target the current `main` HEAD, plus a read-only Track-C schema preflight.
- **New crons** (vercel.json): only internal endpoints
  (`listing-preingest-worker`, `storage-retention-cleanup`) — expected.

## Launch-readiness signals

- Offline suite on integration: **152/152 PASS** (excluding the known
  runtime-credentialed `v4-writer-export` suite).
- 61 new test files accompany the new surfaces (tenant, platform-admin,
  observability, track-c/d) — good coverage discipline from the supervisor.

## Follow-ups for the owner (not done in review)

1. Delete the redundant `codex/writer-mode` branch + worktree (commands above).
2. Open integration → main as a PR; let CI run; apply the new SQL migrations
   in a maintenance window (they are not meant for the runtime endpoints).
3. After merge, redeploy (`vercel deploy --prod --yes`) and run the cloud
   `smoke-gate` per the EVAL_REGISTRY protocol.
