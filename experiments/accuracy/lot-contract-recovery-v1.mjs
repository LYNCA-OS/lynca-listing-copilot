// Evaluation-only Lot grammar recovery.
//
// The production Composer stays untouched. Each mechanism can be replayed
// independently, and every emitted token is either copied from a canonical
// field or deterministically derived from lot_count.

import { composeFromCanonicalFields } from "../../lib/listing/thin/canonical-composer.mjs";

export const LOT_CONTRACT_RECOVERY_MECHANISMS_V1 = Object.freeze([
  "compact_lot_quantity",
  "manufacturer_product_set",
  "shared_observable_components",
  "shared_grading_info"
]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const tokenKey = (value) => clean(value).toLowerCase().replace(/[^a-z0-9/]+/g, "");
const textTokens = (value) => clean(value).split(/\s+/).map(tokenKey).filter(Boolean);

function containsAllTokens(haystack, needle) {
  const available = new Set(textTokens(haystack));
  return textTokens(needle).every((token) => available.has(token));
}

function combineProductAndSet(fields) {
  const product = clean(fields.product);
  const set = clean(fields.set);
  if (!set || containsAllTokens(product, set)) return product;
  const productWords = product.split(/\s+/).filter(Boolean);
  const setWords = set.split(/\s+/).filter(Boolean);
  let sharedPrefix = 0;
  while (sharedPrefix < productWords.length
    && sharedPrefix < setWords.length
    && tokenKey(productWords[sharedPrefix]) === tokenKey(setWords[sharedPrefix])) {
    sharedPrefix += 1;
  }
  return [product, setWords.slice(sharedPrefix).join(" ")].filter(Boolean).join(" ");
}

function compactLotQuantity(fields) {
  const count = clean(fields.lot_count);
  return /^\d+$/.test(count) ? `lotx${count}` : null;
}

function replaceLotQuantity(brackets, fields) {
  const text = compactLotQuantity(fields);
  if (!text) return { brackets, applied: false };
  const index = brackets.findIndex((entry) => entry.bracket === "lot");
  if (index < 0) return { brackets, applied: false };
  const next = brackets.map((entry) => ({ ...entry }));
  next[index].text = text;
  return { brackets: next, applied: true };
}

function restoreCardNamePrefixAfterCompactQuantity(brackets, fields, budget) {
  const full = clean(fields.card_name);
  if (!/^Card\s+/i.test(full)) return { brackets, applied: false };
  const index = brackets.findIndex((entry) => entry.bracket === "card_name");
  if (index < 0) return { brackets, applied: false };
  const rendered = clean(brackets[index].text);
  if (full.replace(/^Card\s+/i, "") !== rendered) return { brackets, applied: false };
  const next = brackets.map((entry) => ({ ...entry }));
  next[index].text = full;
  return renderedTitle(next).length <= budget
    ? { brackets: next, applied: true }
    : { brackets, applied: false };
}

function insertBracket(brackets, entry, beforeNames = []) {
  const index = brackets.findIndex((candidate) => beforeNames.includes(candidate.bracket));
  const next = brackets.map((candidate) => ({ ...candidate }));
  if (index < 0) next.push(entry);
  else next.splice(index, 0, entry);
  return next;
}

function renderedTitle(brackets) {
  return brackets.map((entry) => clean(entry.text)).filter(Boolean).join(" ");
}

function addSourceBracketWithinBudget(brackets, entry, beforeNames, budget) {
  const existing = renderedTitle(brackets);
  if (!entry.text || containsAllTokens(existing, entry.text)) {
    return { brackets, applied: false, rejection: "empty_or_duplicate" };
  }
  const candidate = insertBracket(brackets, entry, beforeNames);
  if (renderedTitle(candidate).length > budget) {
    return { brackets, applied: false, rejection: "character_budget" };
  }
  return { brackets: candidate, applied: true, rejection: null };
}

export function composeWithLotContractRecoveryV1(sourceFields, {
  // Every mechanism in this file is an experiment. Some have already failed
  // replay, so an omitted option must be a no-op rather than the known-loss
  // combined arm. Callers opt in to each ablation explicitly.
  enabledMechanisms = []
} = {}) {
  const baseline = composeFromCanonicalFields(sourceFields ?? {});
  const enabled = new Set(enabledMechanisms ?? []);
  if (baseline.grammar !== "lot") {
    return { baseline, candidate: baseline, applied: [], rejected: [], fields: structuredClone(sourceFields ?? {}) };
  }

  const fields = structuredClone(sourceFields ?? {});
  const applied = [];
  const rejected = [];

  if (enabled.has("manufacturer_product_set")) {
    const combined = combineProductAndSet(fields);
    if (combined && combined !== clean(fields.product)) {
      fields.product = combined;
      applied.push({ kind: "manufacturer_product_set", source_field: "set" });
    } else {
      rejected.push({ kind: "manufacturer_product_set", reason: "empty_or_duplicate_set" });
    }
  }

  // `N Card Lot` -> `lotxN` always saves exactly five characters. Keep the
  // original priority walk unchanged: spending the new slack during the same
  // mechanism can replace a retained higher-value bracket with a longer one.
  // Slack allocation is a separate typed-compaction decision.
  const requestedCompactQuantity = enabled.has("compact_lot_quantity") && compactLotQuantity(fields);
  const core = composeFromCanonicalFields(fields, { limit: 80 });
  let brackets = core.bracket_text.map((entry) => ({ ...entry }));
  const compactWouldEraseOnlyCardToken = requestedCompactQuantity
    && /^Card\s+/i.test(clean(fields.card_name))
    && core.dropped.includes("card_name");
  const compactQuantity = compactWouldEraseOnlyCardToken ? null : requestedCompactQuantity;

  if (compactWouldEraseOnlyCardToken) {
    rejected.push({
      kind: "compact_lot_quantity",
      reason: "card_token_collision_with_dropped_card_name"
    });
  }

  if (compactQuantity) {
    const compacted = replaceLotQuantity(brackets, fields);
    brackets = compacted.brackets;
    if (compacted.applied) {
      const restoredPrefix = restoreCardNamePrefixAfterCompactQuantity(brackets, fields, 80);
      brackets = restoredPrefix.brackets;
      applied.push({
        kind: "compact_lot_quantity",
        source_field: "lot_count",
        restored_card_name_prefix: restoredPrefix.applied
      });
    }
    else rejected.push({ kind: "compact_lot_quantity", reason: "lot_bracket_missing" });
  }

  if (enabled.has("shared_observable_components")) {
    const componentText = [...new Set((fields.components ?? []).map(clean).filter(Boolean))].join(" ");
    const result = addSourceBracketWithinBudget(
      brackets,
      { bracket: "observable_components", text: componentText },
      ["print_finish", "numerical_rarity", "grading_info"],
      80
    );
    brackets = result.brackets;
    if (result.applied) applied.push({ kind: "shared_observable_components", source_field: "components" });
    else rejected.push({ kind: "shared_observable_components", reason: result.rejection });
  }

  if (enabled.has("shared_grading_info")) {
    const result = addSourceBracketWithinBudget(
      brackets,
      { bracket: "grading_info", text: clean(fields.grade) },
      [],
      80
    );
    brackets = result.brackets;
    if (result.applied) applied.push({ kind: "shared_grading_info", source_field: "grade" });
    else rejected.push({ kind: "shared_grading_info", reason: result.rejection });
  }

  const title = renderedTitle(brackets);
  if (title.length > 80) {
    throw new Error(`lot_contract_candidate_over_budget:${title.length}`);
  }

  const candidate = {
    ...core,
    title,
    length: title.length,
    character_budget: 80,
    brackets: brackets.map((entry) => entry.bracket),
    bracket_text: brackets,
    evaluation_recovery_reasons: applied.map((entry) => entry.kind)
  };

  return { baseline, candidate, applied, rejected, fields };
}
