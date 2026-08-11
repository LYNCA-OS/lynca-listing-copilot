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

The checkout-repair dispatch, Actions run `31335434486`, then proved the bridge
selector, immutable candidate, active-v1 contract, ordinary ingest, and direct
writer paths. It stopped before the large staged provider request with
`LARGE_PRESPEND_GATE_FAILED`. The executor-bound fixture reproduced the cause
without a model call: its 4.02MB and 3.92MB originals each exceeded the 3.2MB
relay limit, so the Production client correctly selected signed upload while a
relay-only gate rejected it. The transport repair keeps Production routing
unchanged and instead makes the relay fixture prove both sides of its intended
boundary: total originals above 3.2MB, each original at or below 3.2MB, and
derived recognition bytes at or below 3.2MB.

The relay-bounded dispatch, Actions run `31448835682`, then passed that fixture
build but stopped at the same pre-spend boundary. Candidate logs and the
sanitized journey receipt showed a durable asset-create request before the
staged request, with no relay request yet emitted. This is a valid scheduler
ordering: the original-upload single flight starts first, then computes upload
metadata while the staged transform independently prepares recognition bytes.
The overlap proof therefore binds the actual upload-pipeline request before the
recognition request plus the client's in-flight upload timer; it still requires
both exact relays to become durable before the recognition success response.

The overlap-proof dispatch, Actions run `31450129725`, then passed selection,
database readiness, the immutable candidate, the active-v1/dormant-v2 bridge
proof, source materialization, and the complete NON_TCG and TCG writer cases.
Its large case also completed the model request, both original relays,
persistence, Glass Box, and the feedback transaction. It stopped only because
the verifier incorrectly required the durable top-level
`dataset_disposition` to equal `ADMIN_TEST_ONLY`. The runtime contract is
intentionally split: an Owner synthetic request has
`feedback_data_use=ADMIN_TEST_ONLY`, while the saved feedback and learning
facts remain `dataset_disposition=OBSERVE_ONLY`, `training_eligible=false`, and
`production_promotion_eligible=false`. The tail repair uses that exact split
for every case, authorizes the Owner before the first upload, derives the
provider-post seal from the selected manifest, and applies the same complete
ready/runtime/deployment health predicate before and after the journey.

The safe release order is fixed:

1. Treat database migration #225 as a completed, immutable prerequisite. The
   append-only v2 Registry row was applied DB-first through its isolated guard
   and its exact readback was verified; do not apply or mutate it again in this
   release. Active v1 still queries only its v1 ID, and the bridge has no
   active-v2 readiness or behavior dependency.
2. Keep the reviewed overlap-proof bridge commit
   `ced1a23741e179618e4e7b5eca055cb10ecac8cb` immutable. Create exactly one
   tail-contract repair commit directly on that parent. Its only changed paths
   are this runbook, the bridge selector and test, and the Writer Journey
   verifier and contract enumerated by `COMPATIBILITY_BRIDGE_CHANGED_PATHS`.
   Production upload routing and bridge data-plane files remain unchanged.
   After those five paths are frozen,
   compute the commit tree and include
   exactly one
   `LYNCA-Release-Class: compatibility-bridge-v1` trailer plus exactly one
   `LYNCA-Compatibility-Bridge-Tree: <HEAD tree SHA>` trailer.
3. Dispatch `deploy-production` with `release_class=compatibility-bridge`. The
   immutable candidate must pass the ordinary NON_TCG, TCG, and large-transport
   Writer Journey cases, every Owner observe-only feedback receipt, both exact
   health reads, plus the zero-provider-call active-v1/dormant-v2 proof.
   The paid active-v2 parity case is out of domain for this release only.
4. Let the normal promotion path make the bridge canonical. If post-promotion
   verification fails, the unchanged automatic rollback restores the captured
   pre-bridge deployment and the bridge remains HOLD.
5. Dispatch the later active-v2 commit as an ordinary release. Before creating
   its candidate, the same workflow captures the now-canonical bridge as the
   rollback deployment. The ordinary release must pass the complete v3 Writer
   Journey manifest, including the exact external-identity parity case.

The compatibility class is commit-bound and intentionally non-reusable: the
repair selector requires parent `ced1a23741e179618e4e7b5eca055cb10ecac8cb`
and exactly the five repair paths, an ordinary commit cannot select its reduced
manifest, and an active-v2 runtime cannot satisfy its active-v1 contract proof.
The inherited bridge changes only historical validation, replay, persistence,
and readback; the repair changes no data-plane file. Fresh resolution, health,
profile, Registry readiness, and title composition remain active v1.
