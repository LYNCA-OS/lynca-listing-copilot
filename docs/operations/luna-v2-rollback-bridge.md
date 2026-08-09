# Luna v2 rollback bridge release contract

The pre-bridge Production deployment identified during release review as
`361b5...` is an active-v1 runtime and cannot validate or replay a v2 external
identity receipt. It is therefore not a safe rollback target after v2 starts
writing durable checkpoints.

The first protected bridge dispatch, Actions run `31334470937`, stopped at
`compatibility_bridge_parent_mismatch` before any step referenced Production
credentials or accessed the provider or database, and before candidate creation
or promotion. The bridge commit was correct; the default depth-one checkout hid
its parent, and the later depth-one main-ref fetch would have recreated the same
shallow boundary.

The safe release order is fixed:

1. Treat database migration #225 as a completed, immutable prerequisite. The
   append-only v2 Registry row was applied DB-first through its isolated guard
   and its exact readback was verified; do not apply or mutate it again in this
   release. Active v1 still queries only its v1 ID, and the bridge has no
   active-v2 readiness or behavior dependency.
2. Keep the reviewed active-v1 forward-reader commit
   `9b65f7ccf7c97643104c8aafb6156bcd9b715516` immutable. Create exactly one
   checkout repair commit directly on that parent. Its only changed paths are
   the workflow, this runbook, the bridge selector and test, and the Production
   release-boundary test enumerated by `COMPATIBILITY_BRIDGE_CHANGED_PATHS`.
   Both checkout and the explicit main-ref freshness fetch retain depth two.
   After those five paths are frozen, compute the commit tree and include
   exactly one
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

The compatibility class is commit-bound and intentionally non-reusable: the
repair selector requires parent `9b65f7ccf7c97643104c8aafb6156bcd9b715516`
and exactly the five repair paths, an ordinary commit cannot select its reduced
manifest, and an active-v2 runtime cannot satisfy its active-v1 contract proof.
The inherited bridge changes only historical validation, replay, persistence,
and readback; the repair changes no data-plane file. Fresh resolution, health,
profile, Registry readiness, and title composition remain active v1.
