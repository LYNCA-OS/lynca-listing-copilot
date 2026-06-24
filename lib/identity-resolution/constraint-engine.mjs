import { conflictSeverities } from "./types.mjs";
import {
  canonicalValueKey,
  normalizeChecklistCode,
  normalizeFieldValue,
  normalizeSource,
  normalizeText,
  parseSerial,
  sourceIsOcr,
  sourceIsMarketplace,
  sourceIsRegistry,
  sourceIsRetrieval,
  sourceIsSlab
} from "./normalizer.mjs";
import { parallelSerialTaxonomyCompatibility } from "./parallel-taxonomy.mjs";

function listFromMaybe(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function schemaRecords(productSchemas = []) {
  return listFromMaybe(productSchemas).filter((schema) => schema && typeof schema === "object");
}

function schemaMatchesIdentity(schema = {}, identity = {}) {
  if (!identity.product) return true;
  const product = normalizeText(schema.product || schema.product_name || schema.name).toLowerCase();
  return !product || product === normalizeText(identity.product).toLowerCase();
}

function collectSchemaValues(productSchemas, keys, identity = {}) {
  const values = [];
  schemaRecords(productSchemas)
    .filter((schema) => schemaMatchesIdentity(schema, identity))
    .forEach((schema) => {
      keys.forEach((key) => {
        const raw = schema[key];
        if (Array.isArray(raw)) values.push(...raw);
      });
    });
  return values;
}

function allowedChecklistCodes(productSchemas = [], registryRecords = [], identity = {}) {
  const schemaCodes = collectSchemaValues(productSchemas, ["checklist_codes", "checklistCodes", "collector_numbers", "collectorNumbers"], identity);
  const registryCodes = listFromMaybe(registryRecords).flatMap((record) => {
    const fields = record?.fields || record?.resolved || record || {};
    return [fields.checklist_code, fields.checklistCode, fields.collector_number, fields.collectorNumber].filter(Boolean);
  });
  return [...new Set([...schemaCodes, ...registryCodes].map(normalizeChecklistCode).filter(Boolean))];
}

function allowedCardTypes(productSchemas = [], identity = {}) {
  return [...new Set(collectSchemaValues(productSchemas, ["card_types", "cardTypes", "allowed_card_types", "allowedCardTypes"], identity)
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean))];
}

function violation(field, code, message, severity = conflictSeverities.HIGH, details = {}) {
  return { field, code, message, severity, ...details };
}

function aggregationValuesForFields(aggregation = {}, fields = []) {
  return fields.flatMap((field) => {
    const groups = aggregation.fields?.[field] || {};
    return Object.values(groups).map((group) => group.value).filter(Boolean);
  });
}

function descriptorCollidesWithProductIdentity(value, context = {}) {
  const candidate = normalizeText(value).toLowerCase();
  if (!candidate) return false;
  return aggregationValuesForFields(context.aggregation, ["product", "set", "brand", "manufacturer"])
    .map((item) => normalizeText(item).toLowerCase())
    .filter(Boolean)
    .some((identityValue) => identityValue === candidate);
}

function numberFromMetadata(metadata = {}, ...keys) {
  for (const key of keys) {
    const value = Number(metadata[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function focusedVisualParallelEvidence(item = {}, field = "") {
  if (!["surface_color", "parallel_family", "parallel_exact", "parallel", "variation"].includes(field)) return false;
  const metadata = item.metadata || {};
  const region = normalizeText(item.region || metadata.region).toUpperCase();
  const captureRole = normalizeText(metadata.capture_role).toLowerCase();
  const fieldStatus = normalizeText(metadata.field_status).toUpperCase();
  const unresolvedReason = normalizeText(metadata.field_unresolved_reason).toLowerCase();
  const confidence = Number(item.confidence || 0);
  const glareScore = numberFromMetadata(metadata, "glare_score", "glare_occlusion");
  const blurScore = numberFromMetadata(metadata, "blur_score");
  const exposureIssue = numberFromMetadata(metadata, "exposure_issue", "exposure_error", "overexposure_score", "underexposure_score");
  const whiteBalanceIssue = numberFromMetadata(metadata, "white_balance_issue", "white_balance_error", "white_balance_shift");
  const colorCorrected = metadata.color_corrected === undefined
    ? true
    : ["1", "true", "yes", "on"].includes(String(metadata.color_corrected).trim().toLowerCase());
  const hasOperatorReviewReason = /review|operator|manual|uncertain|unresolved|conflict/.test(unresolvedReason);
  const qualityAllowsPublish = (glareScore === null || glareScore <= 0.35)
    && (blurScore === null || blurScore <= 0.35)
    && (exposureIssue === null || exposureIssue <= 0.35)
    && (whiteBalanceIssue === null || whiteBalanceIssue <= 0.35)
    && colorCorrected;
  const focusedReviewWithoutBlocker = fieldStatus === "REVIEW"
    && !hasOperatorReviewReason
    && confidence >= 0.78
    && qualityAllowsPublish;
  const statusAllowsPublish = (!fieldStatus && confidence >= 0.86)
    || (["CONFIRMED", "MANUAL_CONFIRMED"].includes(fieldStatus) && confidence >= 0.86 && !hasOperatorReviewReason && qualityAllowsPublish)
    || focusedReviewWithoutBlocker;
  return normalizeSource(item.source) === "AGNES_INFERENCE"
    && captureRole === "focused_reread"
    && region.includes("CROP_AND_READ_PARALLEL")
    && statusAllowsPublish;
}

function candidateHasTaxonomyBackedFocusedExact(candidate = {}, field = "", context = {}) {
  if (!["parallel_exact", "parallel", "variation"].includes(field)) return false;
  const focused = (candidate.evidence_items || []).some((item) => focusedVisualParallelEvidence(item, field));
  if (!focused) return false;
  const compatibility = parallelSerialTaxonomyCompatibility(candidate.value, {
    aggregation: context.aggregation,
    productSchemas: context.productSchemas,
    registryRecords: context.registryRecords
  });
  return compatibility.state === "compatible";
}

function candidateHasGroundedIdentitySource(candidate = {}, field = "", context = {}) {
  return (candidate.evidence_items || []).some((item) => {
    const source = normalizeSource(item.source);
    return sourceIsSlab(item.source)
      || sourceIsOcr(item.source)
      || sourceIsRegistry(item.source)
      || (sourceIsRetrieval(item.source) && !sourceIsMarketplace(item.source))
      || (field === "surface_color" && source === "PRIMARY_FAST_VISION")
      || (["surface_color", "parallel_family"].includes(field) && focusedVisualParallelEvidence(item, field));
  }) || candidateHasTaxonomyBackedFocusedExact(candidate, field, context);
}

function groundedIdentityRule(field) {
  return {
    code: `${field}_without_grounded_source`,
    field,
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ candidate, field, context }) {
      return candidateHasGroundedIdentitySource(candidate, field, context || {})
        ? null
        : violation(field, this.code, `${field} must come from slab, printed/OCR text, registry, non-marketplace retrieval evidence, surface/family focused visual evidence, or taxonomy-backed focused exact evidence`, this.severity);
    }
  };
}

function descriptorProductCollisionRule(field) {
  return {
    code: `${field}_collides_with_product_identity`,
    field,
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ value, field, context }) {
      return descriptorCollidesWithProductIdentity(value, context)
        ? violation(field, this.code, `${field} cannot duplicate product, set, brand, or manufacturer identity`, this.severity)
        : null;
    }
  };
}

function parallelSerialTaxonomyRule(field) {
  return {
    code: `${field}_serial_denominator_mismatch`,
    field,
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ value, field, context }) {
      const compatibility = parallelSerialTaxonomyCompatibility(value, {
        aggregation: context.aggregation,
        productSchemas: context.productSchemas,
        registryRecords: context.registryRecords
      });
      return compatibility.state === "mismatch"
        ? violation(field, this.code, `${field} is not compatible with the serial denominator for this product taxonomy`, this.severity, {
          denominator: compatibility.denominator,
          allowed_denominators: compatibility.allowed_denominators,
          matched_candidates: compatibility.matched_candidates
        })
        : null;
    }
  };
}

const candidateConstraintRules = Object.freeze([
  {
    code: "invalid_serial_number",
    field: "serial_number",
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ value, field }) {
      const parsed = parseSerial(value);
      return parsed.serial && parsed.denominator !== null && !parsed.valid
        ? violation(field, this.code, "serial numerator must be less than or equal to denominator", this.severity)
        : null;
    }
  },
  {
    code: "checklist_registry_mismatch",
    field: "checklist_code",
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ value, field, context }) {
      const allowed = allowedChecklistCodes(context.productSchemas, context.registryRecords, context.identity || {});
      const normalized = normalizeChecklistCode(value);
      return allowed.length && normalized && !allowed.includes(normalized)
        ? violation(field, this.code, "checklist_code does not match available product registry", this.severity)
        : null;
    }
  },
  {
    code: "player_without_grounded_source",
    field: "players",
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ candidate, field }) {
      const hasAllowedSource = (candidate.evidence_items || []).some((item) => {
        return !sourceIsMarketplace(item.source) && normalizeSource(item.source) !== "VISUAL_GUESS";
      });
      return !hasAllowedSource
        ? violation(field, this.code, "player cannot be marketplace-only or pure visual guess evidence", this.severity)
        : null;
    }
  },
  groundedIdentityRule("surface_color"),
  groundedIdentityRule("parallel_family"),
  groundedIdentityRule("parallel"),
  groundedIdentityRule("parallel_exact"),
  groundedIdentityRule("variation"),
  parallelSerialTaxonomyRule("parallel"),
  parallelSerialTaxonomyRule("parallel_exact"),
  parallelSerialTaxonomyRule("variation"),
  groundedIdentityRule("rc"),
  groundedIdentityRule("first_bowman"),
  groundedIdentityRule("ssp"),
  groundedIdentityRule("case_hit"),
  descriptorProductCollisionRule("insert"),
  descriptorProductCollisionRule("card_type"),
  descriptorProductCollisionRule("parallel"),
  descriptorProductCollisionRule("parallel_exact"),
  descriptorProductCollisionRule("variation"),
  {
    code: "card_type_schema_mismatch",
    field: "card_type",
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ value, field, context }) {
      const allowed = allowedCardTypes(context.productSchemas, context.identity || {});
      const normalized = normalizeText(value).toLowerCase();
      return allowed.length && normalized && !allowed.includes(normalized)
        ? violation(field, this.code, "card_type does not exist in product schema", this.severity)
        : null;
    }
  }
]);

const identityConstraintRules = Object.freeze([
  {
    code: "serial_constraint_violation",
    field: "serial_number",
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ identity, field }) {
      const parsed = parseSerial(identity[field]);
      return parsed.denominator !== null && !parsed.valid
        ? violation(field, this.code, "serial numerator must be less than or equal to denominator", this.severity, {
          conflicting_values: [identity[field]]
        })
        : null;
    }
  },
  {
    code: "checklist_registry_mismatch",
    field: "checklist_code",
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ identity, field, context }) {
      const allowed = allowedChecklistCodes(context.productSchemas, context.registryRecords, identity);
      const normalized = normalizeChecklistCode(identity[field]);
      return allowed.length && normalized && !allowed.includes(normalized)
        ? violation(field, this.code, "checklist_code does not match available product registry", this.severity, {
          conflicting_values: [identity[field], ...allowed]
        })
        : null;
    }
  },
  {
    code: "card_type_schema_mismatch",
    field: "card_type",
    severity: conflictSeverities.HIGH,
    weight: 1,
    evaluate({ identity, field, context }) {
      const allowed = allowedCardTypes(context.productSchemas, identity);
      const normalized = canonicalValueKey(field, identity[field]);
      return allowed.length && normalized && !allowed.includes(normalized)
        ? violation(field, this.code, "card_type does not exist in product schema", this.severity, {
          conflicting_values: [identity[field], ...allowed]
        })
        : null;
    }
  }
]);

function severityPenalty(severity) {
  return {
    [conflictSeverities.HIGH]: 1,
    [conflictSeverities.MEDIUM]: 0.55,
    [conflictSeverities.LOW]: 0.25
  }[severity] ?? 0.5;
}

function scoreConstraintViolations(weightedViolations = []) {
  const penalty = weightedViolations.reduce((sum, item) => {
    return sum + Number(item.weight || 0) * severityPenalty(item.violation?.severity);
  }, 0);
  return Math.max(0, Number((1 - Math.min(1, penalty)).toFixed(4)));
}

function evaluateCandidateConstraintRules(candidate = {}, context = {}) {
  const field = candidate.field;
  const value = normalizeFieldValue(field, candidate.value);

  return candidateConstraintRules
    .filter((rule) => rule.field === field)
    .map((rule) => ({
      rule,
      violation: rule.evaluate({ candidate, context, field, value }),
      weight: rule.weight
    }))
    .filter((item) => item.violation);
}

function evaluateIdentityConstraintRules(identity = {}, context = {}) {
  return identityConstraintRules
    .map((rule) => ({
      rule,
      violation: rule.evaluate({ identity, context, field: rule.field }),
      weight: rule.weight
    }))
    .filter((item) => item.violation);
}

function evaluatedRuleScores(rules = [], weightedViolations = []) {
  return rules.map((rule) => {
    const violationMatch = weightedViolations.find((item) => item.rule.code === rule.code);
    const penalty = violationMatch
      ? Number((Number(rule.weight || 0) * severityPenalty(violationMatch.violation?.severity)).toFixed(4))
      : 0;

    return {
      code: rule.code,
      field: rule.field,
      weight: rule.weight,
      severity: rule.severity,
      passed: !violationMatch,
      score_penalty: penalty
    };
  });
}

export function validateCandidate(candidate = {}, context = {}) {
  const weightedViolations = evaluateCandidateConstraintRules(candidate, context);
  const structuralValidity = scoreConstraintViolations(weightedViolations);
  const rules = candidateConstraintRules.filter((rule) => rule.field === candidate.field);
  const violations = weightedViolations.map((item) => ({
    ...item.violation,
    weight: item.weight,
    score_penalty: Number((Number(item.weight || 0) * severityPenalty(item.violation?.severity)).toFixed(4))
  }));

  return {
    valid: structuralValidity > 0,
    structural_validity: structuralValidity,
    constraint_score: structuralValidity,
    constraint_score_model: "1 - min(1, sum(rule_weight * severity_penalty))",
    evaluated_rules: evaluatedRuleScores(rules, weightedViolations),
    violations
  };
}

export function validateIdentity(identity = {}, context = {}) {
  const weightedViolations = evaluateIdentityConstraintRules(identity, context);
  const constraintScore = scoreConstraintViolations(weightedViolations);

  return weightedViolations.map((item) => ({
    field: item.violation.field,
    conflict_type: String(item.violation.code || "constraint_violation").toUpperCase(),
    conflicting_values: item.violation.conflicting_values || [identity[item.violation.field]].filter(Boolean),
    severity: item.violation.severity || conflictSeverities.HIGH,
    reason: item.violation.message || "identity failed structural constraint",
    resolved: false,
    rule_weight: item.weight,
    score_penalty: Number((Number(item.weight || 0) * severityPenalty(item.violation?.severity)).toFixed(4)),
    identity_constraint_score: constraintScore,
    constraint_score_model: "1 - min(1, sum(rule_weight * severity_penalty))",
    evaluated_rules: evaluatedRuleScores(identityConstraintRules, weightedViolations)
  }));
}
