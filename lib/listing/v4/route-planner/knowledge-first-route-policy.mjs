// Server-owned route policy for the model-as-assistant architecture.
//
// The model is never the title owner and a complete full-card observation is
// never a required route. Canonical evidence and deterministic knowledge run
// first; the model may only propose values for explicitly UNKNOWN fields.

// This policy is shadow-only until a paired evaluation proves that the
// targeted routes preserve accuracy. Keeping the decision pure makes it
// replayable without Provider, Queue, Storage, or UI dependencies.

export const knowledgeFirstRoutePolicy = Object.freeze({
  policy_id: "knowledge-first-model-assist-route",
  policy_version: "2026-07-28.1",
  schema_version: "knowledge-first-route-decision-v1"
});

export const knowledgeFirstRoutes = Object.freeze({
  HIGHER_AUTHORITY_FINAL: "HIGHER_AUTHORITY_FINAL",
  DETERMINISTIC_FINAL: "DETERMINISTIC_FINAL",
  TARGETED_VISUAL_ASSIST: "TARGETED_VISUAL_ASSIST",
  KNOWLEDGE_ASSIST: "KNOWLEDGE_ASSIST",
  TARGETED_VISUAL_AND_KNOWLEDGE: "TARGETED_VISUAL_AND_KNOWLEDGE",
  WRITER_REVIEW: "WRITER_REVIEW"
});

const visualFieldTargets = Object.freeze([
  "year",
  "manufacturer",
  "players",
  "card_name_or_insert_or_code"
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function present(value) {
  if (Array.isArray(value)) return value.some(present);
  if (typeof value === "boolean") return value === true;
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text !== "" && text.toUpperCase() !== "UNKNOWN";
}

function evidenceValue(evidence = {}, field = "") {
  const entry = object(evidence[field]);
  return entry.normalized_value ?? entry.value ?? null;
}

function firstPresent(...values) {
  return values.find(present) ?? null;
}

function canonicalSnapshot(evidenceDocument = {}) {
  const resolved = object(evidenceDocument.resolved);
  const evidence = object(evidenceDocument.evidence);
  const value = (field) => firstPresent(
    evidenceValue(evidence, field),
    resolved[field]
  );
  const players = firstPresent(value("players"), value("character"));
  const literalIdentity = firstPresent(
    value("card_name"),
    value("insert"),
    value("set"),
    value("collector_number"),
    value("checklist_code"),
    value("tcg_card_number"),
    value("card_number")
  );
  return {
    year: value("year"),
    manufacturer: firstPresent(value("manufacturer"), value("brand")),
    players,
    literal_identity: literalIdentity,
    product: value("product"),
    set: value("set"),
    surface_color: value("surface_color"),
    parallel_exact: value("parallel_exact")
  };
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function visualTargetsFor(snapshot = {}) {
  return visualFieldTargets.filter((field) => {
    if (field === "players") return !present(snapshot.players);
    if (field === "card_name_or_insert_or_code") return !present(snapshot.literal_identity);
    return !present(snapshot[field]);
  });
}

function knowledgeTargetsFor(snapshot = {}) {
  const targets = [];
  // Product identity is often emblematic rather than printed. It belongs in a
  // bounded knowledge proposal, never in a forced visual transcription.
  if (!present(snapshot.product)) targets.push("product");
  // Exact finish naming is optional and must not trigger a call by itself. If
  // the surface colour is visible, however, a knowledge proposal may help the
  // existing constraints validate a canonical finish name.
  if (present(snapshot.surface_color) && !present(snapshot.parallel_exact)) {
    targets.push("parallel_exact");
  }
  return targets;
}

function decision({
  route,
  reasonCodes = [],
  visualTargets = [],
  knowledgeTargets = [],
  imagePolicy = "NONE",
  modelCallBudget = 0,
  higherAuthorityRoute = null,
  evidenceSnapshot = {}
} = {}) {
  return Object.freeze({
    schema_version: knowledgeFirstRoutePolicy.schema_version,
    policy_id: knowledgeFirstRoutePolicy.policy_id,
    policy_version: knowledgeFirstRoutePolicy.policy_version,
    production_effect: "SHADOW_ONLY",
    // The deployed executor still runs the full Provider. Keeping that action
    // explicit prevents a counterfactual route decision from being mistaken
    // for an activated fast path in reports or launch gates.
    production_action: "RUN_FULL_PROVIDER",
    counterfactual_action: route,
    route,
    reason_codes: Object.freeze(unique(reasonCodes)),
    higher_authority_route: higherAuthorityRoute || null,
    full_provider_required: false,
    full_provider_allowed_as_default: false,
    complete_title_output_allowed: false,
    model_role: modelCallBudget > 0 ? "UNKNOWN_FIELD_PROPOSER" : "NOT_REQUIRED",
    model_call_budget: modelCallBudget,
    visual_field_targets: Object.freeze(unique(visualTargets)),
    knowledge_field_targets: Object.freeze(unique(knowledgeTargets)),
    image_policy: imagePolicy,
    field_application_owner: "IDENTITY_RESOLVER",
    fallback: "ABSTAIN_OR_WRITER_REVIEW",
    evidence_snapshot: Object.freeze({ ...evidenceSnapshot })
  });
}

export function planKnowledgeFirstRecognition({
  evidenceDocument = {},
  usableImageCount = 0,
  exactAnchorShadow = null,
  higherAuthorityRoute = ""
} = {}) {
  const authority = String(higherAuthorityRoute || "").trim();
  const snapshot = canonicalSnapshot(evidenceDocument);

  if (authority) {
    return decision({
      route: knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL,
      reasonCodes: ["HIGHER_AUTHORITY_RESULT_AVAILABLE"],
      higherAuthorityRoute: authority,
      evidenceSnapshot: snapshot
    });
  }

  if (exactAnchorShadow?.eligible === true) {
    return decision({
      route: knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL,
      reasonCodes: ["UNIQUE_EXACT_ANCHOR_ELIGIBLE"],
      higherAuthorityRoute: "EXACT_ANCHOR_FINAL",
      evidenceSnapshot: snapshot
    });
  }

  if (Number(usableImageCount || 0) < 1) {
    return decision({
      route: knowledgeFirstRoutes.WRITER_REVIEW,
      reasonCodes: ["NO_USABLE_IMAGE", "MODEL_CANNOT_REPAIR_MISSING_INPUT"],
      evidenceSnapshot: snapshot
    });
  }

  const visualTargets = visualTargetsFor(snapshot);
  const knowledgeTargets = knowledgeTargetsFor(snapshot);

  if (!visualTargets.length && !knowledgeTargets.length) {
    return decision({
      route: knowledgeFirstRoutes.DETERMINISTIC_FINAL,
      reasonCodes: ["CANONICAL_EVIDENCE_SUFFICIENT"],
      evidenceSnapshot: snapshot
    });
  }

  if (visualTargets.length && knowledgeTargets.length) {
    return decision({
      route: knowledgeFirstRoutes.TARGETED_VISUAL_AND_KNOWLEDGE,
      reasonCodes: ["VISIBLE_FIELDS_UNKNOWN", "KNOWLEDGE_FIELDS_UNKNOWN"],
      visualTargets,
      knowledgeTargets,
      imagePolicy: "PRIMARY_PLUS_RELEVANT_CROPS_ONLY",
      modelCallBudget: 1,
      evidenceSnapshot: snapshot
    });
  }

  if (visualTargets.length) {
    return decision({
      route: knowledgeFirstRoutes.TARGETED_VISUAL_ASSIST,
      reasonCodes: ["VISIBLE_FIELDS_UNKNOWN"],
      visualTargets,
      imagePolicy: "RELEVANT_CROPS_ONLY",
      modelCallBudget: 1,
      evidenceSnapshot: snapshot
    });
  }

  return decision({
    route: knowledgeFirstRoutes.KNOWLEDGE_ASSIST,
    reasonCodes: ["KNOWLEDGE_FIELDS_UNKNOWN"],
    knowledgeTargets,
    imagePolicy: "NONE",
    modelCallBudget: 1,
    evidenceSnapshot: snapshot
  });
}
