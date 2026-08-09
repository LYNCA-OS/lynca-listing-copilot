# Luna v2 rollback bridge release contract

The pre-bridge Production deployment identified during release review as
`361b5...` is an active-v1 runtime and cannot validate or replay a v2 external
identity receipt. It is therefore not a safe rollback target after v2 starts
writing durable checkpoints.

The safe release order is fixed:

1. Treat database migration #225 as a completed, immutable prerequisite. The
   append-only v2 Registry row was applied DB-first through its isolated guard
   and its exact readback was verified; do not apply or mutate it again in this
   release. Active v1 still queries only its v1 ID, and the bridge has no
   active-v2 readiness or behavior dependency.
2. Create one active-v1 forward-reader commit directly on the reviewed parent
   `35e825f1a3a6411fecceb0a7bb638d341f848a2e`. Its changed paths must equal the
   tracked bridge artifact manifest, and its message must contain exactly one
   `LYNCA-Release-Class: compatibility-bridge-v1` trailer plus exactly one
   `LYNCA-Compatibility-Bridge-Tree: <HEAD tree SHA>` trailer.
3. Dispatch `deploy-production` with `release_class=compatibility-bridge`. The
   immutable candidate must pass the ordinary NON_TCG, TCG, and large-transport
   Writer Journey cases plus the zero-provider-call active-v1/dormant-v2 proof.
   The paid active-v2 parity case is out of domain for this release only.
4. Let the normal promotion path make the bridge canonical. If post-promotion
   verification fails, the unchanged automatic rollback restores the captured
   pre-bridge deployment and the bridge remains HOLD.
5. Dispatch the later active-v2 commit as an ordinary release. Before creating
   its candidate, the same workflow captures the now-canonical bridge as the
   rollback deployment. The ordinary release must pass the complete v3 Writer
   Journey manifest, including the exact external-identity parity case.

The compatibility class is commit-bound and intentionally non-reusable: an
ordinary commit cannot select its reduced manifest, and an active-v2 runtime
cannot satisfy its active-v1 contract proof. The bridge changes only historical
validation, replay, persistence, and readback; fresh resolution, health,
profile, Registry readiness, and title composition remain active v1.
