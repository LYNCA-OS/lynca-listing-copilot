import { createEvidenceField, normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { resolvedFieldsToLegacyFields } from "../evidence/provider-evidence-normalizer.mjs";
import { resolveGradeFields } from "../resolver/grade-resolver.mjs";
import { splitCardNumber } from "../resolver/number-resolver.mjs";
import { renderListingPresentation } from "../renderer/listing-renderer.mjs";
import { safeSurfaceColor } from "../parallel-policy.mjs";

const editableModules = Object.freeze([
  "year",
  "franchise_brand",
  "product_set",
  "product_identity",
  "subject",
  "card_type",
  "variant_parallel_rarity",
  "card_variant",
  "number_serial_grade",
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

function applyYearEdit(resolved, text) {
  const next = { ...resolved };
  const match = text.match(/\b((?:19|20)\d{2}(?:-\d{2})?)\b/);
  next.year = match ? match[1] : text || null;
  return next;
}

function applyFranchiseBrandEdit(resolved, text) {
  return {
    ...resolved,
    manufacturer: null,
    brand: text || null
  };
}

function applyProductSetEdit(resolved, text) {
  const parts = text.split(/\s*(?:·|\||,|;)\s*/).map(normalizeText).filter(Boolean);
  return {
    ...resolved,
    product: parts[0] || text || null,
    set: parts[1] || null
  };
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

function applyCardTypeEdit(resolved, text) {
  const lower = text.toLowerCase();
  return {
    ...resolved,
    card_type: text || null,
    auto: /\bauto\b|autograph|signature/.test(lower),
    patch: /\bpatch\b/.test(lower),
    relic: /\brelic\b|memorabilia|jersey/.test(lower),
    sketch: /\bsketch\b/.test(lower),
    redemption: /\bredemption\b/.test(lower)
  };
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

  return applyManualParallelConfirmation(next);
}

function applyManualParallelConfirmation(resolved) {
  const next = { ...resolved };
  const parallel = normalizeText(next.parallel);
  if (!parallel) return next;
  next.parallel_exact = parallel;
  const surfaceColor = safeSurfaceColor(parallel);
  if (surfaceColor) next.surface_color = surfaceColor;
  return next;
}

function stripRarityTokens(text) {
  return normalizeText(text
    .replace(/\b(?:rated\s+rookie|rookie\s+card|rookie|rc)\b/gi, " ")
    .replace(/\b(?:1st|first)\s+bowman\b/gi, " ")
    .replace(/\bssp\b|\bsuper\s+short\s+print\b/gi, " ")
    .replace(/\bcase\s+hit\b/gi, " ")
    .replace(/\b1\s*\/\s*1\b|\bone\s+of\s+one\b/gi, " ")
    .replace(/\s+/g, " "));
}

function applyRarityEdit(resolved, text) {
  const lower = text.toLowerCase();
  return {
    ...resolved,
    rc: /\brc\b|\brookie\b/.test(lower),
    first_bowman: /\b1st\s+bowman\b|\bfirst\s+bowman\b/.test(lower),
    ssp: /\bssp\b|super\s+short\s+print/.test(lower),
    case_hit: /case\s+hit/.test(lower),
    one_of_one: /\b1\s*\/\s*1\b|one\s+of\s+one/.test(lower)
  };
}

function applyVariantParallelRarityEdit(resolved, text) {
  const rarity = applyRarityEdit(resolved, text);
  const variantText = stripRarityTokens(text);
  const next = {
    ...rarity,
    insert: null,
    parallel: null,
    variation: null,
    subset: null
  };
  const parts = variantText.split(/\s*(?:·|\||,|;)\s*/).map(normalizeText).filter(Boolean);
  const targets = ["insert", "parallel", "variation", "subset"];
  const activeTargets = targets.filter((field) => resolved[field]);
  const editTargets = activeTargets.length ? activeTargets : (parts.length > 1 ? ["insert", "parallel", "variation", "subset"] : ["parallel"]);

  editTargets.forEach((field, index) => {
    next[field] = parts[index] || (index === 0 ? variantText || null : null);
  });

  if (!variantText) {
    next.insert = null;
    next.parallel = null;
    next.variation = null;
    next.subset = null;
  }

  return applyManualParallelConfirmation(next);
}

function extractNumberTokens(text) {
  const tokenPattern = /#?\d{1,4}\s*\/\s*\d{1,4}|#?\d{1,4}[A-Z]?|[A-Z]{1,10}[- ][A-Z0-9]{1,16}/gi;
  return [...text.matchAll(tokenPattern)].map((match) => match[0]);
}

function extractGradeText(text) {
  const match = text.match(/\b(?:PSA\/DNA|PSA|BGS|SGC|CGC|CSG|TAG|ISA|HGA)\b(?:\s+(?:AUTO\s*)?(?:\d+(?:\.\d+)?|AUTH|AUTHENTIC|ALTERED)(?:\s*\/\s*(?:\d+(?:\.\d+)?|AUTH|AUTHENTIC|ALTERED))?)?/i);
  return normalizeText(match?.[0] || "");
}

function removeGradeText(text, gradeText) {
  if (!gradeText) return text;
  return normalizeText(text.replace(gradeText, " "));
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

function applyNumberSerialGradeEdit(resolved, text) {
  const gradeText = extractGradeText(text);
  const numberText = removeGradeText(text, gradeText);
  const withNumbers = applyNumberingEdit(resolved, numberText);
  return applyGradingEdit(withNumbers, gradeText);
}

function applyModuleText(resolved, moduleKey, moduleText) {
  const text = normalizeText(moduleText);

  switch (moduleKey) {
    case "year":
      return applyYearEdit(resolved, text);
    case "franchise_brand":
      return applyFranchiseBrandEdit(resolved, text);
    case "product_set":
      return applyProductSetEdit(resolved, text);
    case "product_identity":
      return applyProductIdentityEdit(resolved, text);
    case "subject":
      return applySubjectEdit(resolved, text);
    case "card_type":
      return applyCardTypeEdit(resolved, text);
    case "variant_parallel_rarity":
      return applyVariantParallelRarityEdit(resolved, text);
    case "card_variant":
      return applyCardVariantEdit(resolved, text);
    case "number_serial_grade":
      return applyNumberSerialGradeEdit(resolved, text);
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
    year: ["year"],
    franchise_brand: ["manufacturer", "brand"],
    product_set: ["product", "set"],
    product_identity: ["year", "manufacturer", "brand", "product", "set"],
    subject: ["players", "character", "team", "artist"],
    card_type: ["card_type", "auto", "patch", "relic", "sketch", "redemption"],
    variant_parallel_rarity: ["insert", "surface_color", "parallel_family", "parallel_exact", "parallel", "variation", "subset", "rc", "first_bowman", "ssp", "case_hit", "one_of_one"],
    card_variant: ["card_type", "insert", "surface_color", "parallel_family", "parallel_exact", "parallel", "variation", "subset"],
    number_serial_grade: ["serial_number", "collector_number", "checklist_code", "grade_company", "card_grade", "auto_grade", "grade_type"],
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
