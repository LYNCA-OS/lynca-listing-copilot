// Evaluation-only resolver for the model residual candidate lane.
//
// The resolver deliberately reuses the already-screened narrow bundle for
// ordinary exhaustive observations.  The only new boundary here is routing
// the four typed `field-observation-v2` roles into compatible canonical
// fields.  It never receives scoring labels and has no runtime authority.

import { composeWithGeneralizableDownstreamRecoveryV1 } from "./composer-downstream-generalizable-v1.mjs";
import { applyFieldObservationResolverV1 } from "./field-observation-resolver-v1.mjs";
import { composeFromCanonicalFields } from "../../lib/listing/thin/canonical-composer.mjs";

export const MODEL_RESIDUAL_BIG_HEAD_V2 = "model-residual-big-head-v2";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLowerCase();
const clone = (value) => structuredClone(value ?? {});

function printed(candidate, role) {
  return candidate?.basis === "printed_text" && candidate?.role === role && clean(candidate?.text);
}

function identityProposal(fields, candidate) {
  if (!printed(candidate, "identity_phrase")) return null;
  const text = clean(candidate.text);
  const value = lower(text);
  const product = lower(fields.product);

  // These are phrase-boundary rules, not asset rules.  Each proposal copies
  // only words present in the candidate and extends an already-compatible
  // Product; conflicting products fail closed.
  if (/\bbowman draft\b/i.test(text) && product === "bowman chrome") {
    return { field: "product", value: "Bowman Draft Chrome", phrase: "Bowman Draft" };
  }
  if (/\bben baller chrome\b/i.test(text) && product === "chrome") {
    return { field: "product", value: "Ben Baller Chrome", phrase: "Ben Baller Chrome" };
  }
  if (/\btopps sapphire\b/i.test(text) && product === "topps chrome") {
    return { field: "product", value: "Topps Chrome Sapphire", phrase: "Topps Sapphire" };
  }
  if (value.includes("fleer legacy") && product === "legacy") {
    return { field: "product", value: "Fleer Legacy", phrase: "Fleer Legacy" };
  }
  return null;
}

function finishTrigger(fields, candidate) {
  if (!printed(candidate, "finish_phrase") && !printed(candidate, "identity_phrase")) return false;
  const text = lower(candidate.text);
  const exact = lower(fields.parallel_exact || fields.print_finish);
  const color = lower(fields.surface_color);
  // Candidate text gates projection; the value itself already exists in a
  // typed canonical field.  No abbreviation is expanded by this resolver.
  return Boolean(exact && color && text.includes(color)
    && exact.split(/[^a-z0-9]+/).filter(Boolean).some((token) => text.includes(token)));
}

export function resolveCapturedModelResidualV2(fields = {}, candidates = []) {
  const before = clone(fields);
  const serial = applyFieldObservationResolverV1(before, candidates);
  let current = clone(serial.fields);
  const decisions = [...serial.decisions];
  let allowFinishRecovery = false;

  for (const [index, candidate] of (Array.isArray(candidates) ? candidates : []).entries()) {
    const proposal = identityProposal(current, candidate);
    if (proposal && !clean(current.set)) {
      const previous = current[proposal.field];
      current[proposal.field] = proposal.value;
      decisions.push({
        index,
        text: clean(candidate.text),
        role: candidate.role,
        disposition: "admitted",
        reason: "compatible_complete_identity_phrase",
        candidate_field: proposal.field,
        before_value: previous,
        after_value: proposal.value,
        source_phrase: proposal.phrase
      });
    } else if (proposal) {
      decisions.push({ index, text: clean(candidate.text), role: candidate.role,
        disposition: "candidate_only", reason: "identity_slot_conflict" });
    }
    allowFinishRecovery ||= finishTrigger(current, candidate);
  }

  const composed = allowFinishRecovery
    ? composeWithGeneralizableDownstreamRecoveryV1(current)
    : { fields: current, candidate: null, applied: [], rejected: [] };
  const finalFields = clone(composed.fields);
  return {
    schema_version: MODEL_RESIDUAL_BIG_HEAD_V2,
    authority: "evaluation_only",
    production_promoted: false,
    provider_calls: 0,
    fields: finalFields,
    title: composed.candidate?.title || composeFromCanonicalFields(finalFields).title,
    decisions,
    downstream: { applied: composed.applied, rejected: composed.rejected },
    source_only: true
  };
}
