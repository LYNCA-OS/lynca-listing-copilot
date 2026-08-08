// Evaluation-only typed Composer search. It never reads labels/reference text
// and never changes the production Composer. Every candidate is made from the
// same canonical fields using only CSM-approved normalization, de-duplication,
// abbreviation and COS compression tiers.

import {
  DROP_ORDER,
  composeFromCanonicalFields
} from "../../lib/listing/thin/canonical-composer.mjs";
import { MARKETPLACE_PROFILES } from "../../lib/listing/thin/marketplace-composer-rules.mjs";

export const TYPED_PARETO_COMPOSER_V1 = "typed-pareto-composer-v1";

const TIER_GROUPS = Object.freeze({
  standard: Object.freeze([
    Object.freeze(["year", "manufacturer", "product", "set", "subject", "card_name",
      "release_variant", "numerical_rarity", "search_optimization", "grading_info"]),
    Object.freeze(["print_finish", "descriptive_rarity"]),
    Object.freeze(["card_number"])
  ]),
  tcg: Object.freeze([
    Object.freeze(["year", "ip", "language", "set", "subject", "card_name", "card_number",
      "numerical_rarity", "search_optimization", "special_stamp", "grading_info"]),
    Object.freeze(["descriptive_rarity", "release_variant", "print_finish"]),
    Object.freeze(["manufacturer", "product"])
  ]),
  lot: Object.freeze([
    Object.freeze(["lot", "year", "manufacturer_product_set", "subject", "card_name",
      "numerical_rarity", "search_optimization", "grading_info"]),
    Object.freeze(["release_variant", "print_finish", "descriptive_rarity"]),
    Object.freeze(["extra_subjects"])
  ])
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const titleTokens = (value) => new Set(clean(value).normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[‘’ʼ]/g, "'")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));

export function typedParetoSemanticTokens(value) {
  return titleTokens(clean(value)
    .replace(/\b(?:Autographs?|Autographed|Autos?)\b/gi, "Auto")
    .replace(/\bAuthentic\b/gi, "AUTH")
    .replace(/\b(?:Rookie Card|Rated Rookie)\b/gi, "RC")
    .replace(/\bAUTH\s*\/\s*(\d+(?:\.\d+)?)\b/gi, "AUTH $1"));
}

const semanticTokens = typedParetoSemanticTokens;

const isSuperset = (left, right) => [...right].every((value) => left.has(value));

function approvedGradeVariant(grade) {
  const match = clean(grade).match(/^(PSA|BGS)\s+(?:Authentic|AUTH)[,;]?\s*(?:Auto|Autograph)\s+(\d+(?:\.\d+)?|AUTH)$/i);
  return match ? `${match[1].toUpperCase()} AUTH/${match[2].toUpperCase()}` : null;
}

function fieldVariants(sourceFields, enabledMechanisms) {
  const variants = [{
    fields: structuredClone(sourceFields),
    normalizations: [],
    mechanisms: [],
    compaction_ledger: []
  }];
  const grade = approvedGradeVariant(sourceFields?.grade);
  if (enabledMechanisms.has("grading_auth_auto") && grade && grade !== clean(sourceFields?.grade)) {
    variants.push({
      fields: { ...structuredClone(sourceFields), grade },
      normalizations: ["grading_info:auth_auto_slash"],
      mechanisms: ["grading_auth_auto"],
      compaction_ledger: [{
        mechanism: "grading_auth_auto",
        action: "semantic_compaction",
        bracket: "grading_info",
        reason: "csm_approved_equivalent_notation",
        before: clean(sourceFields.grade),
        after: grade,
        characters_saved: clean(sourceFields.grade).length - grade.length,
        semantic_strength: "equivalent"
      }]
    });
  }
  return variants;
}

function profileSuppressing(omitted) {
  const suppress = { ...MARKETPLACE_PROFILES.ebay.suppress };
  for (const bracket of omitted) {
    if (bracket === "extra_subjects") continue;
    suppress[bracket] = ["standard", "tcg", "lot"];
  }
  return { ...MARKETPLACE_PROFILES.ebay, id: TYPED_PARETO_COMPOSER_V1, suppress };
}

function typedFieldCount(brackets, fields, trimmedSubjects) {
  let count = 0;
  for (const bracket of brackets) {
    if (bracket === "manufacturer_product_set") {
      count += [fields.manufacturer, fields.product, fields.set].filter((value) => clean(value)).length;
    } else if (bracket === "subject") {
      count += trimmedSubjects ? Math.min(1, fields.subjects?.length || 0) : fields.subjects?.length || 0;
    } else count += 1;
  }
  return count;
}

function tierVector(grammar, kept) {
  return TIER_GROUPS[grammar].map((tier) => tier.filter((bracket) => kept.has(bracket)).length);
}

function compareVector(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function dominates(left, right) {
  const dimensions = [...left.tier_vector, left.typed_field_count, left.useful_token_count, left.length];
  const other = [...right.tier_vector, right.typed_field_count, right.useful_token_count, right.length];
  return dimensions.every((value, index) => value >= other[index])
    && dimensions.some((value, index) => value > other[index]);
}

function compareCandidate(left, right) {
  return compareVector(left.tier_vector, right.tier_vector)
    || left.typed_field_count - right.typed_field_count
    || left.useful_token_count - right.useful_token_count
    || left.length - right.length
    || right.normalizations.join("|").localeCompare(left.normalizations.join("|"))
    || right.title.localeCompare(left.title);
}

function dropLedger(grammar, available, kept, baselineKept) {
  const tierFor = new Map(TIER_GROUPS[grammar].flatMap((tier, index) => (
    tier.map((bracket) => [bracket, index + 1])
  )));
  return available.filter((bracket) => !kept.has(bracket)).map((bracket) => ({
    mechanism: "cos_priority_budget",
    action: "drop_bracket",
    bracket,
    cos_tier: tierFor.get(bracket) || null,
    reason: "character_budget",
    baseline_also_dropped: !baselineKept.has(bracket)
  }));
}

const numericClaims = (value) => clean(value).match(/\d+/g) || [];
const containsClaims = (whole, required) => {
  const counts = new Map();
  for (const value of whole) counts.set(value, (counts.get(value) || 0) + 1);
  for (const value of required) {
    const remaining = counts.get(value) || 0;
    if (!remaining) return false;
    counts.set(value, remaining - 1);
  }
  return true;
};

export function composeTypedParetoV1(sourceFields, {
  limit = 80,
  enabledMechanisms = ["grading_auth_auto"]
} = {}) {
  const enabled = new Set(enabledMechanisms);
  const fields = structuredClone(sourceFields ?? {});
  const baseline = composeFromCanonicalFields(fields, { limit });
  const grammar = baseline.grammar;
  const baselineKept = new Set(baseline.brackets);
  if (grammar === "lot" && (fields.subjects?.length || 0) > 1
      && !baseline.dropped.includes("extra_subjects")) {
    baselineKept.add("extra_subjects");
  }
  const baselineSemantic = semanticTokens(baseline.title);
  const full = composeFromCanonicalFields(fields, { limit: 10_000 });
  const fullNumeric = numericClaims(full.title);
  const baselineNumeric = numericClaims(baseline.title);
  const available = [...new Set([
    ...full.brackets,
    ...((fields.subjects?.length || 0) > 1 && grammar === "lot" ? ["extra_subjects"] : [])
  ])];
  const droppable = DROP_ORDER[grammar].filter((bracket) => available.includes(bracket));
  const candidates = [];

  for (const variant of fieldVariants(fields, enabled)) {
    for (let mask = 0; mask < (2 ** droppable.length); mask += 1) {
      const omitted = droppable.filter((_, index) => (mask & (2 ** index)) !== 0);
      const trimmedSubjects = omitted.includes("extra_subjects");
      const candidateFields = trimmedSubjects
        ? { ...variant.fields, subjects: (variant.fields.subjects || []).slice(0, 1) }
        : variant.fields;
      const composed = composeFromCanonicalFields(candidateFields, {
        limit: 10_000,
        profile: profileSuppressing(omitted)
      });
      if (composed.length > limit || composed.truncated) continue;
      const kept = new Set(composed.brackets);
      if (grammar === "lot" && (variant.fields.subjects?.length || 0) > 1 && !trimmedSubjects) {
        kept.add("extra_subjects");
      }
      const semantic = semanticTokens(composed.title);
      const candidateNumeric = numericClaims(composed.title);
      const restored = [...kept].filter((bracket) => !baselineKept.has(bracket));
      const compactionLedger = variant.compaction_ledger.filter((entry) => (
        composed.brackets.includes(entry.bracket)
      ));
      candidates.push({
        title: composed.title,
        length: composed.length,
        brackets: composed.brackets,
        bracket_text: composed.bracket_text,
        omitted,
        normalizations: [...new Set([...variant.normalizations, ...composed.normalization_reasons])],
        mechanisms: [...variant.mechanisms],
        tier_vector: tierVector(grammar, kept),
        typed_field_count: typedFieldCount(composed.brackets, variant.fields, trimmedSubjects),
        useful_token_count: semantic.size,
        preserves_baseline_tokens: isSuperset(semantic, baselineSemantic),
        preserves_baseline_brackets: isSuperset(kept, baselineKept),
        preserves_numeric_semantics: containsClaims(candidateNumeric, baselineNumeric)
          && containsClaims(fullNumeric, candidateNumeric),
        reason_ledger: [
          ...compactionLedger,
          ...restored.map((bracket) => ({
            mechanism: "pareto_restore",
            action: "restore_bracket",
            bracket,
            reason: compactionLedger.length
              ? "space_reclaimed_by_semantic_compaction"
              : "pareto_budget_frontier",
            semantic_strength: "source_visible"
          })),
          ...dropLedger(grammar, available, kept, baselineKept)
        ]
      });
    }
  }

  // The canonical result remains the fail-closed candidate even when its
  // protected tail required the Composer's truncation backstop. The exhaustive
  // renderer above intentionally rejects truncated candidates, so without this
  // explicit row an unusually dense protected identity could leave no safe
  // frontier at all.
  candidates.push({
    title: baseline.title,
    length: baseline.length,
    brackets: baseline.brackets,
    bracket_text: baseline.bracket_text,
    omitted: baseline.dropped,
    normalizations: baseline.normalization_reasons,
    mechanisms: [],
    tier_vector: tierVector(grammar, baselineKept),
    typed_field_count: typedFieldCount(baseline.brackets, fields,
      baseline.dropped.includes("extra_subjects")),
    useful_token_count: baselineSemantic.size,
    preserves_baseline_tokens: true,
    preserves_baseline_brackets: true,
    preserves_numeric_semantics: true,
    reason_ledger: dropLedger(grammar, available, baselineKept, baselineKept)
  });

  const byTitle = new Map();
  for (const candidate of candidates) {
    const previous = byTitle.get(candidate.title);
    if (!previous || compareCandidate(candidate, previous) > 0) {
      byTitle.set(candidate.title, candidate);
    }
  }
  const unique = [...byTitle.values()];
  const frontier = unique.filter((candidate) => !unique.some((other) => (
    other !== candidate && dominates(other, candidate)
  )));
  const safeCandidates = unique.filter((candidate) => (
    candidate.preserves_baseline_tokens
      && candidate.preserves_baseline_brackets
      && candidate.preserves_numeric_semantics
  ));
  const safeFrontier = safeCandidates.filter((candidate) => !safeCandidates.some((other) => (
    other !== candidate && dominates(other, candidate)
  )));
  const selected = [...safeFrontier].sort((left, right) => compareCandidate(right, left))[0];
  if (!selected) throw new Error("typed_pareto_baseline_candidate_missing");

  return {
    version: TYPED_PARETO_COMPOSER_V1,
    baseline,
    candidate: {
      ...selected,
      grammar,
      marketplace: MARKETPLACE_PROFILES.ebay.id,
      changed: selected.title !== baseline.title,
      selection_reason: selected.title === baseline.title
        ? "baseline_is_pareto_optimal_under_enabled_safe_compactions"
        : "adds_source_visible_fields_without_displacing_stronger_baseline_semantics",
      restored_vs_baseline: [
        ...selected.brackets,
        ...(selected.omitted.includes("extra_subjects") ? [] : available.filter((name) => name === "extra_subjects"))
      ].filter((bracket) => !baselineKept.has(bracket)),
      displaced_vs_baseline: [...baselineKept].filter((bracket) => (
        !selected.brackets.includes(bracket)
        && !(bracket === "extra_subjects" && !selected.omitted.includes("extra_subjects"))
      )),
      drop_ledger: selected.reason_ledger.filter((row) => row.action === "drop_bracket")
    },
    candidate_count: unique.length,
    frontier,
    // Keep the unconstrained frontier for diagnosis, but never use it as an
    // attainable oracle. A candidate dominated only by an unsafe title can be
    // absent from `frontier` and still belong to the safe Pareto boundary.
    safe_frontier: safeFrontier
  };
}
