// Evaluation-only composition of the two independently screened recovery
// layers. Identity admission runs first; the existing v3 bundle then applies
// its narrow field resolvers. Nothing here is imported by production CSM/SEM.

import { replayCandidateIdentityV3 } from "./candidate-identity-replay-v3.mjs";
import { applyAccuracyMechanismBundleV3 } from "./accuracy-mechanism-bundle-v3.mjs";

export const ACCURACY_MECHANISM_BUNDLE_V4 = "accuracy-mechanism-bundle-v4";

export function applyAccuracyMechanismBundleV4(fields = {}, {
  identityFacts = [],
  freeFields = {},
  freeTitle = "",
  observations = []
} = {}) {
  const identity = replayCandidateIdentityV3(fields, identityFacts);
  const overlays = applyAccuracyMechanismBundleV3(identity.fields, {
    freeFields,
    freeTitle,
    observations
  });
  return {
    fields: overlays.fields,
    identity_changes: identity.changes,
    identity_rejected_facts: identity.rejected_facts,
    overlay_changes: overlays.change_details,
    changes: [
      ...(identity.changes.length ? ["candidate_identity_replay_v3"] : []),
      ...overlays.changes
    ],
    bundle: ACCURACY_MECHANISM_BUNDLE_V4,
    authority: "evaluation_only",
    production_promoted: false
  };
}
