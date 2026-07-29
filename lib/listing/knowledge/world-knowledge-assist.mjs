import crypto from "node:crypto";

import { runBoundedOpenAiAssist } from "../providers/openai-bounded-assist.mjs";

export const worldKnowledgeAssistContract = Object.freeze({
  owner: "V4_WORLD_KNOWLEDGE_ASSIST",
  input_schema_version: "world-knowledge-assist-input-v1",
  proposal_schema_version: "world-knowledge-proposal-v1",
  prompt_version: "world-knowledge-query-proposal-v1",
  execution_mode: "INDEPENDENT_TEXT_ONLY",
  source_type: "MODEL_WORLD_KNOWLEDGE",
  source_trust: "HEURISTIC_MODEL_PRIOR",
  permission: "QUERY_EXPANSION_ONLY",
  candidate_support: "DENIED_WITHOUT_INDEPENDENT_CORROBORATION",
  resolver_access: "DENIED",
  title_access: "DENIED"
});

const targetFields = Object.freeze(["product", "team"]);
const allowedObservationFields = Object.freeze([
  "year",
  "manufacturer",
  "sport",
  "ip_sport",
  "set",
  "subset",
  "insert",
  "players",
  "card_name",
  "collector_number",
  "checklist_code",
  "tcg_card_number",
  "card_number",
  "language"
]);
const abstentionReasons = Object.freeze([
  "INSUFFICIENT_KNOWLEDGE",
  "AMBIGUOUS",
  "CONFLICTING_PRIOR",
  "NOT_APPLICABLE"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.some(valuePresent);
  if (typeof value === "boolean") return value === true;
  return cleanText(value) !== "" && cleanText(value).toUpperCase() !== "UNKNOWN";
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function observationFields(snapshot = {}) {
  const source = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
  return Object.freeze(Object.fromEntries(allowedObservationFields
    .filter((field) => valuePresent(source[field]))
    .map((field) => [field, source[field]])));
}

function unknownRows(trace = []) {
  const rows = Array.isArray(trace) ? trace : [];
  return targetFields.flatMap((field) => {
    const matches = rows.filter((row) => cleanText(row?.field).toLowerCase() === field);
    if (matches.length !== 1 || cleanText(matches[0]?.status).toUpperCase() !== "UNKNOWN") return [];
    const row = matches[0];
    return [{
      field,
      constraint_status: "UNKNOWN",
      reason_code: cleanText(row.reason) || "UNKNOWN",
      constraint_version: cleanText(row.provenance?.version) || null,
      constraint_rule_id: cleanText(row.provenance?.rule_id) || null
    }];
  });
}

export function buildWorldKnowledgeAssistInput({
  observationSnapshot = {},
  forwardEnumerationTrace = [],
  observationSnapshotHash = "",
  routeInputHash = "",
  deadlineMs = 1_800
} = {}) {
  const unresolvedTargets = Object.freeze(unknownRows(forwardEnumerationTrace));
  const input = {
    schema_version: worldKnowledgeAssistContract.input_schema_version,
    observation_contract: "read_only_sparse_v3",
    observation_snapshot_hash: cleanText(observationSnapshotHash) || sha256(observationSnapshot),
    route_input_hash: cleanText(routeInputHash) || null,
    target_fields: Object.freeze(unresolvedTargets.map((row) => row.field)),
    observed_facts: observationFields(observationSnapshot),
    unresolved_targets: unresolvedTargets,
    budget: Object.freeze({
      max_paid_calls: unresolvedTargets.length ? 1 : 0,
      deadline_ms: Math.max(250, Math.min(5_000, Number(deadlineMs) || 1_800))
    })
  };
  return Object.freeze({
    ...input,
    input_hash: sha256(input)
  });
}

export function worldKnowledgeProposalSchema(fields = []) {
  const allowed = [...new Set((Array.isArray(fields) ? fields : []).map(cleanText).filter((field) => targetFields.includes(field)))];
  if (!allowed.length) throw new Error("world knowledge assist requires UNKNOWN target fields");
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string", enum: allowed },
            value: { type: "string" },
            rank: { type: "integer", minimum: 1, maximum: 3 }
          },
          required: ["field", "value", "rank"]
        }
      },
      abstentions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string", enum: allowed },
            reason_code: { type: "string", enum: [...abstentionReasons] }
          },
          required: ["field", "reason_code"]
        }
      }
    },
    required: ["proposals", "abstentions"]
  };
}

export function buildWorldKnowledgePrompt(input = {}) {
  return [
    "You propose search aliases for collectible-card retrieval. You do not identify the card and you do not write a title.",
    `Targets: ${(input.target_fields || []).join(", ")}.`,
    `Observed facts: ${JSON.stringify(input.observed_facts || {})}.`,
    `Constraint outcomes: ${JSON.stringify(input.unresolved_targets || [])}.`,
    "Return up to three ranked aliases per target only when your prior is useful; otherwise abstain.",
    "Never output grade, certification, condition, serial numerator, defects, SEM, title, source type, trust, or resolved status."
  ].join("\n");
}

export function validateWorldKnowledgeProposal(raw = {}, input = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("world_knowledge_proposal_not_object");
  if (Object.keys(raw).some((key) => !["proposals", "abstentions"].includes(key))) {
    throw new Error("world_knowledge_proposal_forbidden_root_field");
  }
  const targets = new Set(Array.isArray(input.target_fields) ? input.target_fields : []);
  const proposals = Array.isArray(raw.proposals) ? raw.proposals : [];
  const abstentions = Array.isArray(raw.abstentions) ? raw.abstentions : [];
  const seenRanks = new Set();
  const validatedProposals = proposals.map((proposal) => {
    if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)
      || Object.keys(proposal).some((key) => !["field", "value", "rank"].includes(key))) {
      throw new Error("world_knowledge_proposal_forbidden_field");
    }
    const field = cleanText(proposal?.field).toLowerCase();
    const value = cleanText(proposal?.value);
    const rank = Number(proposal?.rank);
    const key = `${field}:${rank}`;
    if (!targets.has(field) || !value || !Number.isInteger(rank) || rank < 1 || rank > 3 || seenRanks.has(key)) {
      throw new Error("world_knowledge_proposal_invalid");
    }
    seenRanks.add(key);
    return Object.freeze({
      field,
      value,
      rank,
      source_type: worldKnowledgeAssistContract.source_type,
      source_trust: worldKnowledgeAssistContract.source_trust,
      permission: worldKnowledgeAssistContract.permission,
      validation_status: "UNVERIFIED"
    });
  });
  const validatedAbstentions = abstentions.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || Object.keys(row).some((key) => !["field", "reason_code"].includes(key))) {
      throw new Error("world_knowledge_abstention_forbidden_field");
    }
    const field = cleanText(row?.field).toLowerCase();
    const reason = cleanText(row?.reason_code).toUpperCase();
    if (!targets.has(field) || !abstentionReasons.includes(reason)) throw new Error("world_knowledge_abstention_invalid");
    return Object.freeze({ field, reason_code: reason });
  });
  for (const target of targets) {
    const proposed = validatedProposals.some((row) => row.field === target);
    const abstained = validatedAbstentions.some((row) => row.field === target);
    if (proposed === abstained) throw new Error(`world_knowledge_target_outcome_invalid_${target}`);
  }
  return Object.freeze({
    schema_version: worldKnowledgeAssistContract.proposal_schema_version,
    input_hash: input.input_hash || null,
    proposals: Object.freeze(validatedProposals),
    abstentions: Object.freeze(validatedAbstentions),
    permission: worldKnowledgeAssistContract.permission,
    candidate_support: worldKnowledgeAssistContract.candidate_support,
    resolver_effect: "NONE",
    title_effect: "NONE"
  });
}

export async function runWorldKnowledgeAssist({
  input,
  shardKey = "",
  preferredKeySlot = null,
  modelOverride = "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal = null,
  requestContext = {}
} = {}) {
  if (!input?.target_fields?.length) {
    return {
      ...worldKnowledgeAssistContract,
      execution_status: "SKIPPED",
      execution_reason: "NO_UNKNOWN_KNOWLEDGE_TARGETS",
      paid_provider_calls: 0,
      input_hash: input?.input_hash || null,
      output: null
    };
  }
  const result = await runBoundedOpenAiAssist({
    prompt: buildWorldKnowledgePrompt(input),
    schema: worldKnowledgeProposalSchema(input.target_fields),
    schemaName: "listing_world_knowledge_proposal_v1",
    images: [],
    allowTextOnly: true,
    shardKey,
    preferredKeySlot,
    modelOverride,
    maxOutputTokens: 256,
    timeoutMs: input.budget?.deadline_ms || 1_800,
    textVerbosity: "low",
    env,
    fetchImpl,
    signal,
    requestContext: {
      ...(requestContext && typeof requestContext === "object" ? requestContext : {}),
      provider_call_purpose: "world_knowledge_query_expansion"
    }
  });
  return {
    ...worldKnowledgeAssistContract,
    execution_status: "COMPLETED",
    execution_reason: null,
    paid_provider_calls: result.usage?.provider_calls || 1,
    input_hash: input.input_hash,
    response_hash: result.response_hash,
    model_id: result.model_id,
    latency_ms: result.latency_ms,
    usage: result.usage,
    output: validateWorldKnowledgeProposal(result.parsed, input)
  };
}

export const __worldKnowledgeAssistTestHooks = Object.freeze({
  abstentionReasons,
  allowedObservationFields,
  sha256,
  stableJson,
  targetFields,
  unknownRows
});
