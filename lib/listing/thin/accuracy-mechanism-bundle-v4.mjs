// Evaluation-only composition of the two independently screened recovery
// layers. Identity admission runs first; the existing v3 bundle then applies
// its narrow field resolvers. Nothing here is imported by production CSM/SEM.

import { replayCandidateIdentityV3 } from "./candidate-identity-replay-v3.mjs";
import { applyAccuracyMechanismBundleV3 } from "./accuracy-mechanism-bundle-v3.mjs";

export const ACCURACY_MECHANISM_BUNDLE_V4 = "accuracy-mechanism-bundle-v4";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// A printed bare REFRACTOR is stronger evidence for the family than a model
// inferred colour.  Keep the resolver deliberately narrow: it only removes a
// colour when the current display is exactly `${surface_color} Refractor`, so
// richer printed names such as "100-Year Diamond Refractor" remain untouched.
// This is evaluation-only; production CSM/SEM must not import it.
function replayPrintedRefractorExact(fields = {}, observations = []) {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const family = clean(next.parallel_family).toLowerCase();
  const colour = clean(next.surface_color);
  const currentFinish = clean(next.print_finish);
  if (family !== "refractor" || !colour || clean(next.parallel_exact)
      || currentFinish.toLowerCase() !== `${colour} refractor`.toLowerCase()) {
    return { fields: next, changes: [] };
  }
  const evidence = (observations || []).find((observation) => (
    observation?.kind === "printed_text"
    && observation?.confidence === "high"
    && ["parallel", "parallel_label", "finish"].includes(observation?.label)
    && /^(?:REFRACTOR|REFRACTORS)$/i.test(clean(observation?.evidence))
  ));
  if (!evidence) return { fields: next, changes: [] };

  next.parallel_exact = "Refractor";
  return {
    fields: next,
    changes: [{ field: "parallel_exact", value: "Refractor", source: evidence }]
  };
}

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
  const printed = replayPrintedRefractorExact(overlays.fields, observations);
  return {
    fields: printed.fields,
    identity_changes: identity.changes,
    identity_rejected_facts: identity.rejected_facts,
    overlay_changes: [
      ...overlays.change_details,
      ...(printed.changes.length ? [{ mechanism: "printed_refractor_exact", fields: printed.changes }] : [])
    ],
    changes: [
      ...(identity.changes.length ? ["candidate_identity_replay_v3"] : []),
      ...overlays.changes,
      ...(printed.changes.length ? ["printed_refractor_exact"] : [])
    ],
    bundle: ACCURACY_MECHANISM_BUNDLE_V4,
    authority: "evaluation_only",
    production_promoted: false
  };
}
