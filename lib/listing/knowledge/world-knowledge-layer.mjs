import { createHash } from "node:crypto";

import { optionFlag, envFlag } from "../pipeline/flags.mjs";
import { providerOptionsFromPayload } from "../pipeline/provider-options.mjs";
import {
  enumerateProduct,
  enumerateTeam,
  norm,
  outcomes
} from "../catalog/constraint-enumerator.mjs";

export const worldKnowledgeLayerVersion = "world-knowledge-layer-v2";
export const worldKnowledgeProposalFields = Object.freeze(["team", "product"]);
export const worldKnowledgeProposalBases = Object.freeze(["OBSERVED", "KNOWN"]);

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function observedClaim(result = {}) {
  const sources = [
    result.raw_observed_fields,
    result.candidate_observation_snapshot,
    result.raw_provider_fields,
    result.resolved_fields,
    result.resolved,
    result.fields
  ].filter((value) => value && typeof value === "object" && !Array.isArray(value));
  const merged = Object.assign({}, ...sources.reverse());
  return {
    year: merged.year,
    manufacturer: merged.manufacturer || merged.brand,
    sport: merged.ip_sport || merged.sport,
    players: merged.players || merged.subjects,
    player: merged.player || merged.subject,
    set: merged.set || merged.subset || merged.insert,
    card_name: merged.card_name
  };
}

function allowedTeamValues(claim = {}, model = {}) {
  const outcome = enumerateTeam(claim, model);
  return {
    checked: outcome.status === outcomes.VALUE || outcome.status === outcomes.EMPTY,
    reason: outcome.reason,
    values: outcome.status === outcomes.VALUE ? outcome.candidates : []
  };
}

function allowedProductValues(claim = {}, model = {}) {
  const outcome = enumerateProduct(claim, model);
  return {
    checked: outcome.status === outcomes.VALUE,
    reason: outcome.reason,
    values: outcome.status === outcomes.VALUE ? outcome.candidates : []
  };
}

export function worldKnowledgeProposalsEnabled(payload = {}, env = process.env) {
  const options = providerOptionsFromPayload(payload, env);
  const requested = optionFlag(
    options,
    "v4_world_knowledge_proposals",
    envFlag(env, "ENABLE_V4_WORLD_KNOWLEDGE_PROPOSALS", false)
  ) === true;
  return requested
    && cleanText(options.recognition_benchmark_profile) === "cold_algorithm_benchmark"
    && cleanText(options.trace_level) === "evaluation";
}

export function validateWorldKnowledgeProposal(proposal = {}, claim = {}, model = null) {
  const field = cleanText(proposal.field || proposal.f).toLowerCase();
  const value = cleanText(proposal.value || proposal.v);
  const basis = cleanText(proposal.basis || proposal.b).toUpperCase();
  if (!worldKnowledgeProposalFields.includes(field) || !value || !worldKnowledgeProposalBases.includes(basis)) {
    return { field, value, basis, disposition: "INVALID", checked: false, reason: "invalid_proposal_contract" };
  }
  if (/[?？]/.test(value) || /\b(?:maybe|possibly|probably|likely|unknown|uncertain)\b/i.test(value)) {
    return { field, value, basis, disposition: "INVALID", checked: false, reason: "uncertain_proposal_value" };
  }
  if (field === "product" && /\b(?:insert|subset)\b/i.test(value)) {
    return { field, value, basis, disposition: "INVALID", checked: false, reason: "product_hierarchy_mismatch" };
  }
  if (basis === "OBSERVED") {
    return { field, value, basis, disposition: "ACCEPTED", checked: false, reason: "current_image_observation" };
  }
  if (!model) {
    return { field, value, basis, disposition: "UNCHECKED", checked: false, reason: "no_model" };
  }
  const coverage = field === "team"
    ? allowedTeamValues(claim, model)
    : allowedProductValues(claim, model);
  if (!coverage.checked) {
    return { field, value, basis, disposition: "UNCHECKED", ...coverage };
  }
  const accepted = coverage.values.some((candidate) => norm(candidate) === norm(value));
  return {
    field,
    value,
    basis,
    disposition: accepted ? "ACCEPTED" : "REFUTED",
    checked: true,
    reason: accepted ? coverage.reason : `${coverage.reason}_conflict`,
    allowed_values: coverage.values
  };
}

function proposalId(row = {}) {
  return `world:${createHash("sha256")
    .update(JSON.stringify([row.field, row.value, row.basis, row.disposition]))
    .digest("hex").slice(0, 16)}`;
}

export function attachWorldKnowledgeProposals(result = {}, model = null, { enabled = false } = {}) {
  const proposals = Array.isArray(result.world_knowledge_proposals) ? result.world_knowledge_proposals : [];
  const claim = observedClaim(result);
  const decisions = proposals.map((proposal) => validateWorldKnowledgeProposal(proposal, claim, model));
  const accepted = decisions.filter((row) => row.disposition === "ACCEPTED" || row.disposition === "UNCHECKED");
  const identityEvidenceItems = enabled ? accepted.map((row) => ({
    field: row.field,
    value: row.value,
    source: row.basis === "OBSERVED" ? "PRIMARY_FAST_VISION" : "MODEL_WORLD_KNOWLEDGE",
    confidence: row.basis === "OBSERVED" ? 0.78 : row.checked ? 0.68 : 0.58,
    metadata: {
      candidate_id: proposalId(row),
      evidence_kind: "WORLD_KNOWLEDGE_PROPOSAL",
      proposal_basis: row.basis,
      constraint_checked: row.checked,
      constraint_disposition: row.disposition,
      constraint_reason: row.reason,
      candidate_is_evidence_not_truth: true,
      layer_version: worldKnowledgeLayerVersion
    }
  })) : [];
  return {
    ...result,
    world_knowledge: {
      schema_version: worldKnowledgeLayerVersion,
      enabled: enabled === true,
      owner: "world_knowledge_layer",
      proposal_count: proposals.length,
      accepted_count: decisions.filter((row) => row.disposition === "ACCEPTED").length,
      unchecked_count: decisions.filter((row) => row.disposition === "UNCHECKED").length,
      refuted_count: decisions.filter((row) => row.disposition === "REFUTED").length,
      invalid_count: decisions.filter((row) => row.disposition === "INVALID").length,
      decisions,
      identity_evidence_items: identityEvidenceItems
    }
  };
}
