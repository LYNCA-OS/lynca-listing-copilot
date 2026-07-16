import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import {
  normalizeText,
  displayCardNumber,
  phraseIncludes,
  productHierarchyText,
  pushUniquePhrase,
  renderGrade,
  serialLimitText,
  subjectText,
  titleCleanup
} from "./title-cleanup.mjs";
import { safeSurfaceColor, titleParallelText } from "../parallel-policy.mjs";
import { cardTypeTextParts, officialCardTypeText } from "../card-type-policy.mjs";

export const rendererVersion = "renderer-v3-scg";

const productConfigurationPattern = /\b(?:FOTL|First\s+Off\s+The\s+Line|Hobby|Retail|Choice|Fast\s+Break|Sapphire)\b/i;
const releaseVariantPattern = /\b(?:Horizontal|Vertical|Variation|Image\s+Variation|Photo\s+Variation|International)\b/i;
const finishWordPattern = /\b(?:Wave|Shimmer|Sparkle|Speckle|Mojo|Ice|Refractor|Prizm|Prism|Foil|Holo|Holographic|Aqua|Gold|Green|Red|Blue|Purple|Orange|Black|Silver)\b/i;

function stripProductConfigurationTerms(value = "") {
  return titleCleanup(normalizeText(value)
    .replace(/\bFirst\s+Off\s+The\s+Line\b/gi, "FOTL")
    .replace(productConfigurationPattern, " "));
}

function finishOnlyText(value = "") {
  const text = normalizeText(value);
  if (!text) return false;
  return text.replace(new RegExp(finishWordPattern.source, "gi"), " ").replace(/\s+/g, " ").trim() === "";
}

function dedupeTokenParts(parts = []) {
  const output = [];
  parts.forEach((part) => {
    const text = titleCleanup(part?.text);
    if (!text) return;
    const comparable = normalizeText(text).toLowerCase();
    const existingIndex = output.findIndex((existing) => {
      const existingComparable = normalizeText(existing.text).toLowerCase();
      return existingComparable === comparable
        || existingComparable.includes(comparable)
        || comparable.includes(existingComparable);
    });
    if (existingIndex !== -1) {
      if (text.length > output[existingIndex].text.length) output.splice(existingIndex, 1, { ...part, text });
      return;
    }
    output.push({ ...part, text });
  });
  return output;
}

export const moduleOrder = Object.freeze([
  "year",
  "product_identity",
  "subject",
  "card_name",
  "release_variant",
  "print_finish",
  "numerical_rarity",
  "descriptive_rarity",
  "card_number",
  "search_optimization",
  "grading"
]);

const moduleLabels = Object.freeze({
  year: "年份",
  product_identity: "产品层级 Product",
  subject: "人物 / 主体",
  card_name: "卡名",
  release_variant: "发行版本 Variant",
  print_finish: "印刷工艺 Finish",
  numerical_rarity: "Numbered / Print Run / 数字限编",
  descriptive_rarity: "稀有描述",
  card_number: "卡号",
  search_optimization: "搜索词 SO",
  grading: "评级"
});

function fieldHasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && value !== "" && value !== false;
}

function fieldStatus(fieldName, evidence = {}) {
  return evidence[fieldName]?.status || null;
}

function moduleStatus(fieldNames, resolved, evidence) {
  const activeFields = fieldNames.filter((fieldName) => fieldHasValue(resolved[fieldName]));
  if (!activeFields.length) return "NOT_APPLICABLE";

  const statuses = activeFields.map((fieldName) => fieldStatus(fieldName, evidence)).filter(Boolean);
  if (statuses.includes("CONFLICT")) return "CONFLICT";
  if (statuses.includes("MISSING")) return "MISSING";
  if (statuses.includes("REVIEW") || statuses.length !== activeFields.length) return "REVIEW";
  if (statuses.every((status) => status === "CONFIRMED" || status === "MANUAL_CONFIRMED")) return "CONFIRMED";
  return "REVIEW";
}

function evidenceSummary(fieldNames, resolved, evidence) {
  return fieldNames
    .filter((fieldName) => fieldHasValue(resolved[fieldName]) || evidence[fieldName])
    .map((fieldName) => {
      const field = evidence[fieldName];
      const source = field?.sources?.[0] || {};
      return {
        field: fieldName,
        status: field?.status || "REVIEW",
        source_type: source.source_type || null,
        region: source.region || null,
        observed_text: source.observed_text || null
      };
    });
}

function buildModuleToken({ text, fields = [], resolved, evidence }) {
  const cleanText = titleCleanup(text);
  if (!cleanText) return null;
  const status = moduleStatus(fields, resolved, evidence);
  return {
    text: cleanText,
    fields,
    status,
    requires_review: !["CONFIRMED", "NOT_APPLICABLE"].includes(status),
    evidence_summary: evidenceSummary(fields, resolved, evidence)
  };
}

function buildModuleTokens(parts = [], resolved, evidence) {
  const tokens = [];
  parts.forEach((part) => {
    const token = buildModuleToken({
      text: part?.text,
      fields: part?.fields || [],
      resolved,
      evidence
    });
    if (!token) return;
    if (tokens.some((existing) => normalizeText(existing.text).toLowerCase() === normalizeText(token.text).toLowerCase())) return;
    tokens.push(token);
  });
  return tokens;
}

function buildModule({ key, text, fieldNames, resolved, evidence, tokenParts }) {
  const status = moduleStatus(fieldNames, resolved, evidence);
  const tokens = buildModuleTokens(tokenParts || [{ text, fields: fieldNames }], resolved, evidence);

  return {
    key,
    label: moduleLabels[key] || key,
    text: titleCleanup(text),
    status,
    requires_review: !["CONFIRMED", "NOT_APPLICABLE"].includes(status),
    fields: fieldNames,
    tokens,
    evidence_summary: evidenceSummary(fieldNames, resolved, evidence)
  };
}

function releaseVariantTokenParts(resolved = {}) {
  const parts = [];
  const variation = stripProductConfigurationTerms(resolved.variation);
  if (variation && releaseVariantPattern.test(variation)) parts.push({ text: variation, fields: ["variation"] });
  return parts;
}

function printFinishTokenParts(resolved = {}) {
  const exact = stripProductConfigurationTerms(resolved.parallel_exact);
  if (exact) return [{ text: exact, fields: ["parallel_exact"] }];
  const parts = [];
  const variation = stripProductConfigurationTerms(resolved.variation);
  const insert = stripProductConfigurationTerms(resolved.insert);
  const color = safeSurfaceColor(resolved.surface_color);
  if (color) parts.push({ text: color, fields: ["surface_color"] });
  const legacy = normalizeText(resolved.parallel);
  if (legacy && !/\b(?:horizontal|vertical|variation|image variation|photo variation|international)\b/i.test(legacy)) {
    parts.push({ text: legacy, fields: ["parallel"] });
  }
  const fallback = titleParallelText(resolved);
  if (!parts.length && fallback) parts.push({ text: fallback, fields: ["surface_color", "parallel_family", "parallel"] });
  const variationFinishWords = variation.match(new RegExp(finishWordPattern.source, "gi")) || [];
  if (variationFinishWords.length) parts.push({ text: variationFinishWords.join(" "), fields: ["variation"] });
  const insertFinishWords = insert.match(new RegExp(finishWordPattern.source, "gi")) || [];
  if (insertFinishWords.length) parts.push({ text: insertFinishWords.join(" "), fields: ["insert"] });
  const family = normalizeText(resolved.parallel_family);
  if (family) parts.push({ text: family, fields: ["parallel_family"] });
  return dedupeTokenParts(parts);
}

function releaseVariantText(resolved) {
  const parts = [];
  const insert = stripProductConfigurationTerms(resolved.insert);
  [
    finishOnlyText(insert) ? null : insert,
    releaseVariantTokenParts(resolved).map((token) => token.text).join(" "),
    resolved.subset && !/^(?:RC|Rookie|Rookie Card)$/i.test(resolved.subset) ? resolved.subset : null
  ].forEach((part) => pushUniquePhrase(parts, part));
  return parts.join(" ");
}

function releaseVariantModuleTokenParts(resolved) {
  const insert = stripProductConfigurationTerms(resolved.insert);
  return [
    { text: finishOnlyText(insert) ? null : insert, fields: ["insert"] },
    ...releaseVariantTokenParts(resolved),
    {
      text: resolved.subset && !/^(?:RC|Rookie|Rookie Card)$/i.test(resolved.subset || "") ? resolved.subset : null,
      fields: ["subset"]
    }
  ];
}

function releaseCardTypeText(resolved) {
  return officialCardTypeText(resolved);
}

function numericalRarityText(resolved) {
  return serialLimitText(resolved, { oneOfOne: resolved.one_of_one })
    || (resolved.one_of_one ? "1/1" : "");
}

function descriptiveRarityText(resolved) {
  const parts = [];
  if (resolved.ssp) parts.push("SSP");
  if (resolved.case_hit) parts.push("Case Hit");
  return parts.join(" ");
}

function descriptiveRarityTokenParts(resolved) {
  return [
    { text: resolved.ssp ? "SSP" : null, fields: ["ssp"] },
    { text: resolved.case_hit ? "Case Hit" : null, fields: ["case_hit"] }
  ];
}

function searchOptimizationText(resolved) {
  return searchOptimizationTokenParts(resolved)
    .map((part) => part.text)
    .filter(Boolean)
    .join(" ");
}

function searchOptimizationTokenParts(resolved) {
  return [
    { text: resolved.rc || /^RC$/i.test(resolved.subset || "") ? "RC" : null, fields: ["rc", "subset"] },
    { text: resolved.first_bowman ? "1st Bowman" : null, fields: ["first_bowman"] },
    ...cardTypeTextParts(resolved)
      .filter((text) => /^(?:Auto|Patch|Relic|Jersey|Auto Relic|Auto Patch|Patch Auto|Sketch|Redemption)$/i.test(text))
      .map((text) => ({ text, fields: ["observable_components", "auto", "patch", "relic", "jersey", "sketch", "redemption"] })),
    {
      text: resolved.team && !phraseIncludes(subjectText(resolved), resolved.team) ? resolved.team : null,
      fields: ["team"]
    }
  ];
}

function cardNumberText(resolved) {
  const semanticCardNumber = normalizeText(resolved.tcg_card_number || resolved.card_number).replace(/^#/, "");
  return [
    semanticCardNumber ? `#${semanticCardNumber}` : resolved.collector_number ? `#${displayCardNumber(resolved.collector_number, resolved)}` : null,
    resolved.checklist_code
  ].map(normalizeText).filter(Boolean).join(" · ");
}

function cardNumberTokenParts(resolved) {
  const semanticCardNumber = normalizeText(resolved.tcg_card_number || resolved.card_number).replace(/^#/, "");
  return [
    {
      text: semanticCardNumber ? `#${semanticCardNumber}` : resolved.collector_number ? `#${displayCardNumber(resolved.collector_number, resolved)}` : null,
      fields: semanticCardNumber ? [resolved.tcg_card_number ? "tcg_card_number" : "card_number"] : ["collector_number"]
    },
    { text: resolved.checklist_code, fields: ["checklist_code"] }
  ];
}

export function renderListingModules({
  resolved = {},
  evidence = {}
} = {}) {
  const normalized = normalizeResolvedFields(resolved);
  const modules = {
    year: buildModule({
      key: "year",
      text: normalized.year,
      fieldNames: ["year"],
      tokenParts: [{ text: normalized.year, fields: ["year"] }],
      resolved: normalized,
      evidence
    }),
    product_identity: buildModule({
      key: "product_identity",
      text: productHierarchyText(normalized),
      fieldNames: ["manufacturer", "brand", "product", "set"],
      tokenParts: [{ text: productHierarchyText(normalized), fields: ["manufacturer", "brand", "product", "set"] }],
      resolved: normalized,
      evidence
    }),
    subject: buildModule({
      key: "subject",
      text: subjectText(normalized),
      fieldNames: ["players", "character", "artist"],
      tokenParts: [{ text: subjectText(normalized), fields: ["players", "character", "artist"] }],
      resolved: normalized,
      evidence
    }),
    card_name: buildModule({
      key: "card_name",
      text: normalized.card_name,
      fieldNames: ["card_name"],
      tokenParts: [{ text: normalized.card_name, fields: ["card_name"] }],
      resolved: normalized,
      evidence
    }),
    release_variant: buildModule({
      key: "release_variant",
      text: [releaseCardTypeText(normalized), releaseVariantText(normalized)].filter(Boolean).join(" "),
      fieldNames: ["official_card_type", "insert", "variation", "subset"],
      tokenParts: [
        { text: releaseCardTypeText(normalized), fields: ["official_card_type"] },
        ...releaseVariantModuleTokenParts(normalized)
      ],
      resolved: normalized,
      evidence
    }),
    print_finish: buildModule({
      key: "print_finish",
      text: printFinishTokenParts(normalized).map((part) => part.text).join(" "),
      fieldNames: ["surface_color", "parallel_exact", "parallel_family", "parallel", "variation", "insert"],
      tokenParts: printFinishTokenParts(normalized),
      resolved: normalized,
      evidence
    }),
    numerical_rarity: buildModule({
      key: "numerical_rarity",
      text: numericalRarityText(normalized),
      fieldNames: ["print_run_number", "print_run_numerator", "print_run_denominator", "numbered_to", "numerical_rarity", "serial_number", "serial_denominator", "one_of_one", "suspicious_print_run"],
      tokenParts: [{ text: numericalRarityText(normalized), fields: ["print_run_number", "print_run_numerator", "print_run_denominator", "numbered_to", "numerical_rarity", "serial_number", "serial_denominator", "one_of_one", "suspicious_print_run"] }],
      resolved: normalized,
      evidence
    }),
    descriptive_rarity: buildModule({
      key: "descriptive_rarity",
      text: descriptiveRarityText(normalized),
      fieldNames: ["ssp", "case_hit"],
      tokenParts: descriptiveRarityTokenParts(normalized),
      resolved: normalized,
      evidence
    }),
    card_number: buildModule({
      key: "card_number",
      text: cardNumberText(normalized),
      fieldNames: ["tcg_card_number", "card_number", "collector_number", "checklist_code"],
      tokenParts: cardNumberTokenParts(normalized),
      resolved: normalized,
      evidence
    }),
    search_optimization: buildModule({
      key: "search_optimization",
      text: searchOptimizationText(normalized),
      fieldNames: ["rc", "first_bowman", "observable_components", "auto", "patch", "relic", "jersey", "sketch", "redemption", "team"],
      tokenParts: searchOptimizationTokenParts(normalized),
      resolved: normalized,
      evidence
    }),
    grading: buildModule({
      key: "grading",
      text: renderGrade(normalized),
      fieldNames: ["grade_company", "card_grade", "auto_grade", "grade_type"],
      tokenParts: [{ text: renderGrade(normalized), fields: ["grade_company", "card_grade", "auto_grade", "grade_type"] }],
      resolved: normalized,
      evidence
    })
  };

  return Object.fromEntries(moduleOrder.map((key) => [key, modules[key]]));
}
