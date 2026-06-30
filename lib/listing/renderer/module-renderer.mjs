import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import {
  normalizeText,
  brandIdentityText,
  phraseIncludes,
  productSetText,
  pushUniquePhrase,
  renderGrade,
  serialLimitText,
  subjectText,
  titleCleanup
} from "./title-cleanup.mjs";
import { safeSurfaceColor, titleParallelText } from "../parallel-policy.mjs";
import { cardTypeTextParts } from "../card-type-policy.mjs";

export const rendererVersion = "renderer-v2";

export const moduleOrder = Object.freeze([
  "year",
  "franchise_brand",
  "product_set",
  "subject",
  "card_name",
  "card_type",
  "variant_parallel_rarity",
  "number_serial_grade",
  "team"
]);

const moduleLabels = Object.freeze({
  year: "年份",
  franchise_brand: "系列 / 品牌",
  product_set: "产品 / Set",
  subject: "人物 / 主体",
  card_name: "卡名",
  card_type: "卡片类型",
  variant_parallel_rarity: "版本 / Parallel / 稀有度",
  number_serial_grade: "编号 / 序列号 / 评级",
  team: "球队"
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

function parallelVariantText(resolved = {}) {
  const exact = normalizeText(resolved.parallel_exact);
  if (exact) return exact;

  const parts = [];
  const color = safeSurfaceColor(resolved.surface_color);
  if (color) pushUniquePhrase(parts, color);
  if (resolved.parallel_family) pushUniquePhrase(parts, resolved.parallel_family);
  if (parts.length) return parts.join(" ");

  return titleParallelText(resolved);
}

function parallelVariantTokenParts(resolved = {}) {
  const exact = normalizeText(resolved.parallel_exact);
  if (exact) {
    return [{ text: exact, fields: ["parallel_exact"] }];
  }

  const parts = [];
  const color = safeSurfaceColor(resolved.surface_color);
  if (color) parts.push({ text: color, fields: ["surface_color"] });
  if (resolved.parallel_family) parts.push({ text: resolved.parallel_family, fields: ["parallel_family"] });
  if (parts.length) return parts;

  const fallback = titleParallelText(resolved);
  if (!fallback) return [];
  const fallbackFields = resolved.parallel
    ? ["parallel"]
    : resolved.variation
      ? ["variation"]
      : ["surface_color", "parallel_family", "parallel"];
  return [{ text: fallback, fields: fallbackFields }];
}

function cardVariantText(resolved) {
  const parts = [];
  [
    resolved.insert,
    parallelVariantText(resolved),
    resolved.variation,
    resolved.subset && !/^(?:RC|Rookie|Rookie Card)$/i.test(resolved.subset) ? resolved.subset : null
  ].forEach((part) => pushUniquePhrase(parts, part));
  return parts.join(" ");
}

function cardVariantTokenParts(resolved) {
  return [
    { text: resolved.insert, fields: ["insert"] },
    ...parallelVariantTokenParts(resolved),
    { text: resolved.variation, fields: ["variation"] },
    {
      text: resolved.subset && !/^(?:RC|Rookie|Rookie Card)$/i.test(resolved.subset || "") ? resolved.subset : null,
      fields: ["subset"]
    }
  ];
}

function cardTypeText(resolved) {
  return cardTypeTextParts(resolved, { includeRc: true }).join(" ");
}

function rarityText(resolved, variantText = "") {
  const parts = [];
  if (resolved.rc || /^RC$/i.test(resolved.subset || "")) parts.push("RC");
  if (resolved.first_bowman) parts.push("1st Bowman");
  if (resolved.ssp) parts.push("SSP");
  if (resolved.case_hit) parts.push("Case Hit");
  if (resolved.one_of_one && !phraseIncludes(variantText, "1/1")) parts.push("1/1");
  return parts.join(" ");
}

function variantParallelRarityText(resolved) {
  const variantText = cardVariantText(resolved);
  return [variantText, rarityText(resolved, variantText)].filter(Boolean).join(" ");
}

function rarityTokenParts(resolved, variantText = "") {
  return [
    { text: resolved.rc || /^RC$/i.test(resolved.subset || "") ? "RC" : null, fields: ["rc", "subset"] },
    { text: resolved.first_bowman ? "1st Bowman" : null, fields: ["first_bowman"] },
    { text: resolved.ssp ? "SSP" : null, fields: ["ssp"] },
    { text: resolved.case_hit ? "Case Hit" : null, fields: ["case_hit"] },
    { text: resolved.one_of_one && !phraseIncludes(variantText, "1/1") ? "1/1" : null, fields: ["one_of_one"] }
  ];
}

function variantParallelRarityTokenParts(resolved) {
  const variantText = cardVariantText(resolved);
  return [
    ...cardVariantTokenParts(resolved),
    ...rarityTokenParts(resolved, variantText)
  ];
}

function numberSerialGradeText(resolved) {
  const serialLimit = serialLimitText(resolved.serial_number, { oneOfOne: resolved.one_of_one });
  return [
    serialLimit,
    resolved.collector_number ? `#${String(resolved.collector_number).replace(/^#/, "")}` : null,
    resolved.checklist_code,
    renderGrade(resolved)
  ].map(normalizeText).filter(Boolean).join(" · ");
}

function numberSerialGradeTokenParts(resolved) {
  return [
    { text: serialLimitText(resolved.serial_number, { oneOfOne: resolved.one_of_one }), fields: ["serial_number"] },
    {
      text: resolved.collector_number ? `#${String(resolved.collector_number).replace(/^#/, "")}` : null,
      fields: ["collector_number"]
    },
    { text: resolved.checklist_code, fields: ["checklist_code"] },
    {
      text: renderGrade(resolved),
      fields: ["grade_company", "card_grade", "auto_grade", "grade_type"]
    }
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
    franchise_brand: buildModule({
      key: "franchise_brand",
      text: brandIdentityText(normalized),
      fieldNames: ["manufacturer", "brand"],
      tokenParts: [{ text: brandIdentityText(normalized), fields: ["manufacturer", "brand"] }],
      resolved: normalized,
      evidence
    }),
    product_set: buildModule({
      key: "product_set",
      text: productSetText(normalized),
      fieldNames: ["product", "set"],
      tokenParts: [
        { text: normalized.product, fields: ["product"] },
        { text: normalized.set, fields: ["set"] }
      ],
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
    card_type: buildModule({
      key: "card_type",
      text: cardTypeText(normalized),
      fieldNames: ["official_card_type", "observable_components", "auto", "patch", "relic", "jersey", "rc", "sketch", "redemption"],
      tokenParts: [{ text: cardTypeText(normalized), fields: ["official_card_type", "observable_components", "auto", "patch", "relic", "jersey", "rc", "sketch", "redemption"] }],
      resolved: normalized,
      evidence
    }),
    variant_parallel_rarity: buildModule({
      key: "variant_parallel_rarity",
      text: variantParallelRarityText(normalized),
      fieldNames: ["insert", "surface_color", "parallel_family", "parallel_exact", "parallel", "variation", "subset", "rc", "first_bowman", "ssp", "case_hit", "one_of_one"],
      tokenParts: variantParallelRarityTokenParts(normalized),
      resolved: normalized,
      evidence
    }),
    number_serial_grade: buildModule({
      key: "number_serial_grade",
      text: numberSerialGradeText(normalized),
      fieldNames: ["serial_number", "collector_number", "checklist_code", "grade_company", "card_grade", "auto_grade", "grade_type"],
      tokenParts: numberSerialGradeTokenParts(normalized),
      resolved: normalized,
      evidence
    }),
    team: buildModule({
      key: "team",
      text: normalized.team,
      fieldNames: ["team"],
      tokenParts: [{ text: normalized.team, fields: ["team"] }],
      resolved: normalized,
      evidence
    })
  };

  return Object.fromEntries(moduleOrder.map((key) => [key, modules[key]]));
}
