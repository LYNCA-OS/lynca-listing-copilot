# CSM thin provider authority production verification — 2026-08-01

## Outcome

The durable provider-admission authority is applied to Supabase project
`osrrujmpxxiefppjfgpd` as migration
`20260801101152_csm_thin_provider_admission_v1`.

- Reviewed source SQL SHA-256 passed to `migration up`:
  `a3fc8d5da7e7d8e42e0f4800f4078e2605e8bd8fed2a17f6c1f825fa7c7788d8`.
- Canonical SQL reconstructed by a fresh `migration fetch` SHA-256:
  `27703c7c0e4596622f176cf22749941d3122a59baac3d51888e4f0d9f155e3f4`.
  Supabase stores and reconstructs migration statements rather than retaining
  the original source file bytes, so these two hashes identify different
  representations. A fresh linked guard after acceptance still proved the
  fetched canonical local/remote ledger byte-identical; the applied migration
  was not edited, replayed, or repaired.
- The canonical remote-first ledger is `87 / 87`, with zero local-only and
  zero remote-only versions.
- `guard-db-push --linked` returned `db_push_allowed_exact_ledger` after the
  migration was fetched back. The migration itself was applied with
  `supabase migration up --linked`; no `db push` or migration-history repair
  was used.
- A real PostgREST smoke completed durable enqueue, fenced claim, settle and
  exact replay from a second worker. The injected execution ran exactly once.
  Observed local-to-remote round trips were 2,553 ms for enqueue/claim/settle
  and 382 ms for exact replay. These are one-point control-plane observations,
  not throughput claims.

## Locally proven invariants

The migration was applied to a temporary PostgreSQL 17 cluster and tested
against real transactions and concurrent clients:

- 121 claim waiters stopped at exactly 120 active attempts;
- five concurrent 110k-token attempts stopped at exactly 440k active tokens;
- the rolling 60-second target stopped at 3.6M charged tokens; 4M remains
  provider hard-limit metadata and the estimation-error envelope;
- settle replaced estimated tokens with observed usage;
- fresh backlog limited retry count and tokens to 20%, while retry borrowed
  idle capacity when no fresh row existed;
- one eligible head per tenant, dead queue-owner cleanup, reservation cleanup,
  lease fencing, cancellation and exact operation replay passed;
- two in-flight 429 responses in one cooldown epoch reduced the shared window
  once (`120/440k → 60/220k`), not twice; the second response only extended
  cooldown;
- a lost HTTP response after a committed claim can replay the exact fence only
  to the same authority worker. Capacity is not reserved twice and the model
  call is not duplicated.

## Remote security and advisor disposition

Remote catalog checks confirm all three authority tables use enabled and
forced RLS. `service_role` has no direct table `SELECT`; `authenticated` has no
claim-RPC execution; `service_role` alone can execute the six hardened
`SECURITY DEFINER` RPCs. All six functions have an empty `search_path`.

Supabase security advisors reported only `INFO` notices on these three tables:
RLS is enabled with no policies. This is intentional deny-all table access;
the only interface is the service-role RPC contract. See the
[advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

The two authority-related performance notices are not release blockers:

- the reservation foreign key has no covering index, but its referencing scope
  table has one row per provider/account/model scope; adding an index would be
  write overhead without a measured read benefit;
- the new operation status index is reported unused before production traffic,
  which is expected immediately after creation.

The project also has one pre-existing security `ERROR` on the unrelated OCS
view `public.ocs_cognition_loop_health`, plus a project-level leaked-password
protection warning. This migration did not create or change either object.

## Remaining boundary

Exactly-once external execution cannot be manufactured across arbitrary
process death without provider idempotency. If a process dies after receiving a
claim but before or during the provider request, lease expiry remains
fail-closed and the operation becomes ambiguous. The system never guesses that
a second paid call is safe; the writer retry action remains on the same durable
operation path and refuses ambiguous replay.
