import { normalizeResolvedFields, serialNumeratorDirectProvenance } from "../evidence/evidence-schema.mjs";
import { renderGenericTitle } from "./generic-title-renderer.mjs";
import { moduleOrder, renderListingModules, rendererVersion } from "./module-renderer.mjs";
import { renderPokemonTitle } from "./pokemon-title-renderer.mjs";
import { renderSportsTitle } from "./sports-title-renderer.mjs";
import { fitTitleItems } from "./title-length-policy.mjs";
import {
  normalizeComparable,
  normalizeAutoGradeToken,
  normalizeText,
  productHierarchyText,
  renderGrade,
  serialLimitText,
  subjectText,
  titleCleanup
} from "./title-cleanup.mjs";

function hasPresentationValue(value) {
  return String(value ?? "").trim() !== "";
}

function looksLikeTcg(resolved = {}) {
  const text = normalizeComparable([
    resolved.category,
    resolved.brand,
    resolved.manufacturer,
    resolved.product,
    resolved.set
  ].filter(Boolean).join(" "));
  return /\bpokemon\b|\bpokemon tcg\b|\bpokémon\b|\bone piece\b|\byu gi oh\b|\byugioh\b|\byu-gi-oh\b|\bdragon ball\b|\bdragonball\b|\btcg\b/.test(text);
}

function looksLikeSports(resolved = {}) {
  const text = normalizeComparable([
    resolved.category,
    resolved.brand,
    resolved.manufacturer,
    resolved.product,
    resolved.team
  ].filter(Boolean).join(" "));
  if (looksLikeTcg(resolved)) return false;
  if (!text) return true;
  return /sports?|nba|nfl|mlb|nhl|wnba|ufc|topps|panini|upper deck|bowman|donruss|prizm|select|flawless|immaculate|chrome/.test(text);
}

export function selectTitleRenderer(resolved = {}) {
  if (looksLikeTcg(resolved)) return "pokemon";
  if (looksLikeSports(resolved)) return "sports";
  return "generic";
}

export function renderResolvedTitle(resolved = {}, {
  maxLength = 80
} = {}) {
  const normalized = normalizeResolvedFields(resolved);
  if (isLotTitle(normalized)) return renderLotTitle(normalized, { maxLength });
  const renderer = selectTitleRenderer(normalized);
  const result = renderer === "pokemon"
    ? renderPokemonTitle(normalized, { maxLength })
    : renderer === "sports"
      ? renderSportsTitle(normalized, { maxLength })
      : renderGenericTitle(normalized, { maxLength });

  return {
    renderer,
    rendered_title: result.title,
    title_length_policy: result.policy
  };
}

function isLotTitle(resolved = {}) {
  return resolved.multi_card === true
    || Number(resolved.card_count || 0) > 1
    || /\blot\b|多张|套卡/i.test(String(resolved.lot_type || ""));
}

function lotQuantityText(resolved = {}) {
  const count = Number(resolved.card_count || 0);
  return count > 1 ? `Lot x${count}` : "Lot";
}

function lotSubjectText(resolved = {}) {
  const players = Array.isArray(resolved.players) ? resolved.players : [];
  const subjects = players.length ? players : [resolved.character].filter(Boolean);
  return subjects.slice(0, 3).map(normalizeText).filter(Boolean).join(" / ");
}

function lotDescriptionText(resolved = {}) {
  return [
    resolved.card_name,
    resolved.insert,
    resolved.surface_color,
    resolved.parallel_exact || resolved.parallel_family || resolved.parallel,
    resolved.lot_type && !/\blot\b/i.test(resolved.lot_type) ? resolved.lot_type : null
  ].map(normalizeText).filter(Boolean).reduce((parts, part) => {
    const comparable = normalizeComparable(part);
    if (!comparable) return parts;
    if (!parts.some((existing) => {
      const existingComparable = normalizeComparable(existing);
      return existingComparable === comparable
        || existingComparable.includes(comparable)
        || comparable.includes(existingComparable);
    })) parts.push(part);
    return parts;
  }, []).join(" ");
}

function lotSearchOptimizationText(resolved = {}) {
  return [
    resolved.rc ? "RC" : null,
    resolved.auto ? "Auto" : null,
    resolved.patch ? "Patch" : null,
    resolved.relic ? "Relic" : null,
    resolved.team && !normalizeComparable(lotSubjectText(resolved)).includes(normalizeComparable(resolved.team)) ? `(${resolved.team})` : null
  ].map(normalizeText).filter(Boolean).join(" ");
}

function renderLotTitle(resolved = {}, {
  maxLength = 80
} = {}) {
  const items = [
    { key: "lot_quantity", text: lotQuantityText(resolved), priority: 1, required: true, compactable: false },
    { key: "year", text: resolved.year, priority: 4, required: Boolean(resolved.year), compactable: false },
    { key: "product_identity", text: productHierarchyText(resolved), priority: 5, required: Boolean(productHierarchyText(resolved)), compactable: true },
    { key: "subject", text: lotSubjectText(resolved), priority: 6, required: Boolean(lotSubjectText(resolved)), compactable: true },
    { key: "description", text: lotDescriptionText(resolved), priority: 28, compactable: true },
    { key: "search_optimization", text: lotSearchOptimizationText(resolved), priority: 42, compactable: true },
    { key: "grading", text: renderGrade(resolved), priority: 72, compactable: false }
  ].filter((item) => normalizeText(item.text));
  const fitted = fitTitleItems(items, { maxLength });

  return {
    renderer: "lot",
    rendered_title: titleCleanup(fitted.title),
    title_length_policy: fitted.policy
  };
}

export function renderListingPresentation({
  resolved = {},
  evidence = {},
  maxLength = 80,
  serialNumeratorVerified = null
} = {}) {
  const normalized = normalizeResolvedFields(resolved);
  const cleanAutoGrade = normalizeAutoGradeToken(normalized.auto_grade);
  const gradeSanitized = normalized.auto_grade && !cleanAutoGrade
    ? {
      ...normalized,
      auto_grade: null,
      grade_type: normalized.card_grade ? "CARD_ONLY" : "UNKNOWN"
    }
    : cleanAutoGrade && cleanAutoGrade !== normalized.auto_grade
      ? { ...normalized, auto_grade: cleanAutoGrade }
      : normalized;
  void serialNumeratorVerified;
  // `serial_number` is the physical-copy reading; the title print-limit module
  // is `numerical_rarity`. When the provider omitted numerical_rarity but the
  // serial evidence has direct current-instance provenance (printed text, slab
  // label, focused OCR, operator, approved history - never vision-only or
  // REVIEW), backfill the current-card print run (N/D). Reference/catalog
  // candidates still cannot justify a numerator; this path only uses direct
  // current-instance evidence.
  const serialEvidence = evidence?.serial_number;
  const backfilledNumericalRarity = !hasPresentationValue(gradeSanitized.numerical_rarity)
    && hasPresentationValue(gradeSanitized.serial_number)
    && serialNumeratorDirectProvenance(serialEvidence)
    ? serialLimitText(gradeSanitized.serial_number, { oneOfOne: gradeSanitized.one_of_one })
    : "";
  const presentationResolved = backfilledNumericalRarity
    ? { ...gradeSanitized, numerical_rarity: backfilledNumericalRarity }
    : gradeSanitized;
  const modules = renderListingModules({
    resolved: presentationResolved,
    evidence
  });
  const title = renderResolvedTitle(presentationResolved, { maxLength });

  return {
    renderer_version: rendererVersion,
    renderer: title.renderer,
    module_order: moduleOrder,
    modules,
    rendered_title: title.rendered_title,
    final_title: title.rendered_title,
    title_length_policy: title.title_length_policy
  };
}
