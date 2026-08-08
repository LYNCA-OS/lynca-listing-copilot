// Evaluation-only, asset-agnostic Composer recovery candidates.
//
// Every rule depends only on typed canonical fields, the current grammar/drop
// trace, and the 80-character budget. No asset id, reviewed title, or score is
// available to this module. That separation is what makes these mechanisms
// eligible for a real replay gate rather than an oracle count.

import { composeFromCanonicalFields } from "../../lib/listing/thin/canonical-composer.mjs";

export const COMPOSER_DOWNSTREAM_GENERALIZABLE_MECHANISMS_V1 = Object.freeze([
  "typed_grade_compaction",
  "typed_patch_relic_compaction",
  "typed_product_parent",
  "typed_product_finish_compaction",
  "exact_parallel_color_compaction"
]);

const addedDrops = (before, after) => after.filter((name) => !before.includes(name));

function structurallyAccept(before, after, restoredBracket) {
  return before.dropped.includes(restoredBracket)
    && !after.dropped.includes(restoredBracket)
    && addedDrops(before.dropped, after.dropped).length === 0
    && after.length <= 80
    && !after.truncated;
}

function compactPsaAuthenticAuto(value) {
  const match = String(value ?? "").trim().match(/^PSA\s+Authentic,\s*Auto\s+(\d+(?:\.\d+)?)$/i);
  return match ? `PSA Auto ${match[1]}` : null;
}

function compactUefaProduct(value) {
  return /^(?:Topps\s+)?UEFA Club Competitions(?:\s+\d{4}\/\d{2})?$/i.test(String(value ?? "").trim())
    ? "UEFA"
    : null;
}

function compactChromeUefaProduct(value) {
  return /^(?:Topps\s+)?Chrome UEFA Club Competitions$/i.test(String(value ?? "").trim())
    ? "Chrome"
    : null;
}

function exactColorInsideParallel(fields) {
  const color = String(fields.surface_color ?? "").trim();
  const exact = String(fields.parallel_exact ?? "").trim();
  if (!color || !exact) return null;
  const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(exact) ? color : null;
}

export function composeWithGeneralizableDownstreamRecoveryV1(sourceFields, {
  enabledMechanisms = null,
  composerFeatures
} = {}) {
  const composeOptions = composerFeatures === undefined ? {} : { features: composerFeatures };
  const baseline = composeFromCanonicalFields(sourceFields ?? {}, composeOptions);
  const fields = structuredClone(sourceFields ?? {});
  const enabled = enabledMechanisms ? new Set(enabledMechanisms) : null;
  const applied = [];
  const rejected = [];
  let current = baseline;

  const tryCandidate = (kind, restoredBracket, mutate) => {
    if (enabled && !enabled.has(kind)) return;
    const candidateFields = structuredClone(fields);
    const sourceGate = mutate(candidateFields);
    if (!sourceGate) return;
    const candidate = composeFromCanonicalFields(candidateFields, composeOptions);
    if (!structurallyAccept(current, candidate, restoredBracket)) {
      rejected.push({ kind, reason: "structural_acceptance_failed" });
      return;
    }
    Object.assign(fields, candidateFields);
    current = candidate;
    applied.push({ kind, restored_bracket: restoredBracket });
  };

  tryCandidate("typed_grade_compaction", "manufacturer", (candidateFields) => {
    const compact = compactPsaAuthenticAuto(candidateFields.grade);
    if (!compact) return false;
    candidateFields.grade = compact;
    return true;
  });

  tryCandidate("typed_patch_relic_compaction", "manufacturer", (candidateFields) => {
    const components = candidateFields.components ?? [];
    if (!components.some((value) => /^patch$/i.test(value))
      || !components.some((value) => /^relic$/i.test(value))) return false;
    candidateFields.components = components.filter((value) => !/^relic$/i.test(value));
    return true;
  });

  tryCandidate("typed_product_parent", "product", (candidateFields) => {
    const compact = compactUefaProduct(candidateFields.product);
    if (!compact) return false;
    candidateFields.product = compact;
    return true;
  });

  tryCandidate("typed_product_finish_compaction", "print_finish", (candidateFields) => {
    const product = compactChromeUefaProduct(candidateFields.product);
    const finish = String(candidateFields.parallel_exact ?? "").replace(/\bRefractors\b/gi, "Refractor");
    if (!product || finish === String(candidateFields.parallel_exact ?? "") || !finish.trim()) return false;
    candidateFields.product = product;
    candidateFields.parallel_exact = finish;
    candidateFields.print_finish = finish;
    return true;
  });

  tryCandidate("exact_parallel_color_compaction", "print_finish", (candidateFields) => {
    const color = exactColorInsideParallel(candidateFields);
    if (!color) return false;
    candidateFields.parallel_exact = color;
    candidateFields.print_finish = color;
    return true;
  });

  return {
    baseline,
    candidate: {
      ...current,
      evaluation_recovery_reasons: applied.map((action) => action.kind)
    },
    applied,
    rejected,
    fields
  };
}
