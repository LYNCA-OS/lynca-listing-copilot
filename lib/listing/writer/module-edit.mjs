import { createEvidenceField, normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { resolvedFieldsToLegacyFields } from "../evidence/provider-evidence-normalizer.mjs";
import { resolveGradeFields } from "../resolver/grade-resolver.mjs";
import { splitCardNumber } from "../resolver/number-resolver.mjs";
import { renderListingPresentation } from "../renderer/listing-renderer.mjs";

const editableModules = Object.freeze([
  "product_identity",
  "subject",
  "card_variant",
  "numbering",
  "attributes",
  "grading"
]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function valuesEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function diffFields(before, after, fieldNames) {
  return fieldNames
    .filter((field) => !valuesEqual(before[field], after[field]))
    .map((field) => ({
      field,
      from: before[field] ?? null,
      to: after[field] ?? null,
      change_type: "OPERATOR_CORRECTION"
    }));
}

function operatorEvidence(value, moduleKey, moduleText) {
  return createEvidenceField({
    value,
    normalizedValue: value,
    status: "MANUAL_CONFIRMED",
    confidence: 1,
    sources: [
      {
        source_type: "OPERATOR",
        image_id: null,
        side: null,
        capture_role: "writer_module_edit",
        region: moduleKey,
        observed_text: moduleText,
        glare_occlusion: null,
        blur_score: null,
        trust_tier: 1
      }
    ],
    unresolvedReason: null
  });
}

function markManualEvidence(evidence, fieldChanges, resolved, moduleKey, moduleText) {
  const next = { ...(evidence || {}) };

  fieldChanges.forEach((change) => {
    next[change.field] = operatorEvidence(resolved[change.field] ?? null, moduleKey, moduleText);
  });

  return next;
}

function applyProductIdentityEdit(resolved, text) {
  const next = { ...resolved };
  const match = text.match(/^((?:19|20)\d{2}(?:-\d{2})?)\s+(.+)$/);
  if (match) {
    next.year = match[1];
    const rest = normalizeText(match[2]);
    const brand = normalizeText(next.brand || next.manufacturer);
    if (brand && rest.toLowerCase().startsWith(`${brand.toLowerCase()} `)) {
      next.product = normalizeText(rest.slice(brand.length));
    } else if (brand && rest.toLowerCase() === brand.toLowerCase()) {
      next.product = null;
    } else {
      next.product = rest || null;
    }
    return next;
  }

  next.product = text || null;
  return next;
}

function applySubjectEdit(resolved, text) {
  const next = { ...resolved };
  const parts = text.split(/\s*\/\s*/).map(normalizeText).filter(Boolean);

  if (Array.isArray(next.players) && next.players.length > 0 || parts.length > 1) {
    next.players = parts;
    if (parts.length > 0) next.character = null;
    return next;
  }

  if (next.character && parts.length <= 1) {
    next.character = parts[0] || null;
    return next;
  }

  next.players = parts;
  return next;
}

function applyCardVariantEdit(resolved, text) {
  const next = { ...resolved };
  const parts = text.split(/\s*(?:·|\||,|;)\s*/).map(normalizeText).filter(Boolean);
  const targets = ["card_type", "insert", "parallel", "variation", "subset"];
  const activeTargets = targets.filter((field) => resolved[field]);
  const editTargets = activeTargets.length ? activeTargets : ["insert"];

  editTargets.forEach((field, index) => {
    next[field] = parts[index] || (index === 0 ? text || null : null);
  });

  return next;
}

function extractNumberTokens(text) {
  const tokenPattern = /#?\d{1,4}\s*\/\s*\d{1,4}|#?\d{1,4}[A-Z]?|[A-Z]{1,10}[- ][A-Z0-9]{1,16}/gi;
  return [...text.matchAll(tokenPattern)].map((match) => match[0]);
}

function applyNumberingEdit(resolved, text) {
  const next = {
    ...resolved,
    serial_number: null,
    collector_number: null,
    checklist_code: null
  };

  extractNumberTokens(text).forEach((token) => {
    const split = splitCardNumber(token);
    Object.entries(split).forEach(([field, value]) => {
      if (value && !next[field]) next[field] = value;
    });
  });

  return next;
}

function applyAttributesEdit(resolved, text) {
  const lower = text.toLowerCase();

  return {
    ...resolved,
    rc: /\brc\b|\brookie\b/.test(lower),
    first_bowman: /\b1st\s+bowman\b|\bfirst\s+bowman\b/.test(lower),
    ssp: /\bssp\b|super\s+short\s+print/.test(lower),
    case_hit: /case\s+hit/.test(lower),
    auto: /\bauto\b|autograph|signature/.test(lower),
    patch: /\bpatch\b/.test(lower),
    relic: /\brelic\b|memorabilia/.test(lower),
    sketch: /\bsketch\b/.test(lower),
    redemption: /\bredemption\b/.test(lower),
    one_of_one: /\b1\s*\/\s*1\b|one\s+of\s+one/.test(lower)
  };
}

function applyGradingEdit(resolved, text) {
  if (!text) {
    return {
      ...resolved,
      grade_company: null,
      card_grade: null,
      auto_grade: null,
      grade_type: "UNKNOWN"
    };
  }

  return resolveGradeFields({
    resolved,
    legacyFields: {
      grade_company: resolved.grade_company,
      grade: text,
      title: text
    }
  }).resolved;
}

function applyModuleText(resolved, moduleKey, moduleText) {
  const text = normalizeText(moduleText);

  switch (moduleKey) {
    case "product_identity":
      return applyProductIdentityEdit(resolved, text);
    case "subject":
      return applySubjectEdit(resolved, text);
    case "card_variant":
      return applyCardVariantEdit(resolved, text);
    case "numbering":
      return applyNumberingEdit(resolved, text);
    case "attributes":
      return applyAttributesEdit(resolved, text);
    case "grading":
      return applyGradingEdit(resolved, text);
    default:
      throw new Error(`Unsupported writer module: ${moduleKey}`);
  }
}

function moduleFieldNames(moduleKey) {
  return {
    product_identity: ["year", "manufacturer", "brand", "product", "set"],
    subject: ["players", "character", "team", "artist"],
    card_variant: ["card_type", "insert", "parallel", "variation", "subset"],
    numbering: ["serial_number", "collector_number", "checklist_code"],
    attributes: ["rc", "first_bowman", "ssp", "case_hit", "auto", "patch", "relic", "sketch", "redemption", "one_of_one"],
    grading: ["grade_company", "card_grade", "auto_grade", "grade_type"]
  }[moduleKey] || [];
}

export function applyWriterModuleEdit({
  resolved = {},
  evidence = {},
  moduleKey,
  moduleText,
  maxLength = 80
} = {}) {
  if (!editableModules.includes(moduleKey)) {
    throw new Error(`Unsupported writer module: ${moduleKey || ""}`);
  }

  const before = normalizeResolvedFields(resolved);
  const after = normalizeResolvedFields(applyModuleText(before, moduleKey, moduleText));
  const fieldChanges = diffFields(before, after, moduleFieldNames(moduleKey));
  const correctedEvidence = markManualEvidence(evidence, fieldChanges, after, moduleKey, moduleText);
  const presentation = renderListingPresentation({
    resolved: after,
    evidence: correctedEvidence,
    maxLength
  });

  return {
    corrected_resolved: after,
    corrected_evidence: correctedEvidence,
    field_changes: fieldChanges,
    fields: Object.fromEntries(
      Object.entries(resolvedFieldsToLegacyFields(after)).filter(([, value]) => value !== null && value !== undefined)
    ),
    ...presentation
  };
}
