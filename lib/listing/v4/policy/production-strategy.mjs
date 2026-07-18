import {
  assertMatchingImageGeneration,
  classifyAssetLifecycleFailure
} from "../assets/asset-lifecycle-contract.mjs";
import {
  classifyV4JobError,
  planV4JobRetry,
  v4JobRetryPolicy
} from "../jobs/job-retry-policy.mjs";
import { planV4RecognitionRoute } from "../route-planner/route-planner.mjs";
import { applyCandidateDecisionStage } from "../../candidates/candidate-decision-stage.mjs";
import { buildCandidateSelectionPass } from "../../candidates/candidate-selection-pass.mjs";
import { buildRetrievalApplicationLayer } from "../../candidates/retrieval-application-layer.mjs";
import {
  allHardInvariantsPassSnapshot,
  solveOptimalRecognitionPolicy,
  v4LaunchPolicyConstraints
} from "./optimal-recognition-policy.mjs";

export const v4ProductionStrategyProfile = Object.freeze({
  profile_id: "v4-production-strategy",
  policy_version: "2026-07-18.1",
  execution_contract: "v4-single-invariant-spine-v1",
  route_policy_id: "typed-anchor-route-policy-v1",
  candidate_control_policy_id: "candidate-evidence-application-v1",
  shadow_recognition_policy_id: v4LaunchPolicyConstraints.policy_id,
  shadow_recognition_policy_version: v4LaunchPolicyConstraints.policy_version,
  shadow_recognition_policy_enabled: true,
  shadow_recognition_policy_can_execute: false,
  asset_lifecycle_policy_id: "immutable-image-generation-v1",
  job_recovery_policy_id: "bounded-retry-or-input-rebind-v1",
  job_retry: Object.freeze({
    max_retries: v4JobRetryPolicy.maxRetries,
    max_attempts: v4JobRetryPolicy.maxAttempts,
    backoff_seconds: v4JobRetryPolicy.backoffSeconds
  })
});

// The pipeline owns execution and I/O. This object owns only pure decisions.
// Keeping the interface small makes a policy revision or A/B profile replaceable
// without introducing a second queue, provider, persistence, or retry path.
export const v4ProductionStrategy = Object.freeze({
  profile: v4ProductionStrategyProfile,
  asset_lifecycle: Object.freeze({
    assert_image_generation: assertMatchingImageGeneration,
    classify_failure: classifyAssetLifecycleFailure
  }),
  job_recovery: Object.freeze({
    classify_failure: classifyV4JobError,
    plan_retry: planV4JobRetry
  }),
  hard_invariants: Object.freeze({
    verified_queue_execution_snapshot: allHardInvariantsPassSnapshot
  }),
  recognition_route: Object.freeze({
    plan: planV4RecognitionRoute
  }),
  candidate_control: Object.freeze({
    select: buildCandidateSelectionPass,
    build_retrieval_application: buildRetrievalApplicationLayer,
    apply_decision: applyCandidateDecisionStage
  }),
  shadow_recognition_policy: Object.freeze({
    constraints: v4LaunchPolicyConstraints,
    solve: solveOptimalRecognitionPolicy
  })
});
