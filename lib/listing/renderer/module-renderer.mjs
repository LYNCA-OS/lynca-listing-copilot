import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import {
  normalizeText,
  brandIdentityText,
  productSetText,
  pushUniquePhrase,
  renderGrade,
  subjectText,
  titleCleanup
} from "./title-cleanup.mjs";
import { titleParallelText } from "../parallel-policy.mjs";

export const rendererVersion = "renderer-v2";

export const moduleOrder = Object.freeze([
  "year",
  "franchise_brand",
  "product_set",
  "subject",
  "card_type",
  "variant_parallel_rarity",
  "number_serial_grade"
]);

const moduleLabels = Object.freeze({
  year: "年份",
  franchise_brand: "系列 / 品牌",
  product_set: "产品 / Set",
  subject: "人物 / 主体",
  card_type: "卡片类型",
  variant_parallel_rarity: "版本 / Parallel / 稀有度",
  number_serial_grade: "编号 / 序列号 / 评级"
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

function buildModule({ key, text, fieldNames, resolved, evidence }) {
  const status = moduleStatus(fieldNames, resolved, evidence);

  return {
    key,
    label: moduleLabels[key] || key,
    text: titleCleanup(text),
    status,
    requires_review: !["CONFIRMED", "NOT_APPLICABLE"].includes(status),
    fields: fieldNames,
    evidence_summary: evidenceSummary(fieldNames, resolved, evidence)
  };
}

function parallelVariantText(resolved = {}) {
  return titleParallelText(resolved);
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

function normalizeCardTypeText(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (/^(?:base|standard|regular|insert)$/i.test(text)) return "";
  if (/^(?:relic|memorabilia|patch|jersey)\s*\/\s*(?:auto|autograph|signature)$/i.test(text)) return "Auto Relic";
  if (/^(?:auto|autograph|signature)\s*\/\s*(?:relic|memorabilia|patch|jersey)$/i.test(text)) return "Auto Relic";
  if (/^(?:auto|autograph|autographed|signature|signed)$/i.test(text)) return "Auto";
  return text;
}

function cardTypeText(resolved) {
  const parts = [];
  pushUniquePhrase(parts, normalizeCardTypeText(resolved.card_type));
  if (resolved.auto) pushUniquePhrase(parts, "Auto");
  if (resolved.patch) pushUniquePhrase(parts, "Patch");
  if (resolved.relic) pushUniquePhrase(parts, "Relic");
  if (resolved.sketch) pushUniquePhrase(parts, "Sketch");
  if (resolved.redemption) pushUniquePhrase(parts, "Redemption");
  return parts.join(" ");
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

function numberSerialGradeText(resolved) {
  return [
    resolved.serial_number,
    resolved.collector_number ? `#${String(resolved.collector_number).replace(/^#/, "")}` : null,
    resolved.checklist_code,
    renderGrade(resolved)
  ].map(normalizeText).filter(Boolean).join(" · ");
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
      resolved: normalized,
      evidence
    }),
    franchise_brand: buildModule({
      key: "franchise_brand",
      text: brandIdentityText(normalized),
      fieldNames: ["manufacturer", "brand"],
      resolved: normalized,
      evidence
    }),
    product_set: buildModule({
      key: "product_set",
      text: productSetText(normalized),
      fieldNames: ["product", "set"],
      resolved: normalized,
      evidence
    }),
    subject: buildModule({
      key: "subject",
      text: subjectText(normalized),
      fieldNames: ["players", "character", "team", "artist"],
      resolved: normalized,
      evidence
    }),
    card_type: buildModule({
      key: "card_type",
      text: cardTypeText(normalized),
      fieldNames: ["card_type", "auto", "patch", "relic", "sketch", "redemption"],
      resolved: normalized,
      evidence
    }),
    variant_parallel_rarity: buildModule({
      key: "variant_parallel_rarity",
      text: variantParallelRarityText(normalized),
      fieldNames: ["insert", "surface_color", "parallel_family", "parallel_exact", "parallel", "variation", "subset", "rc", "first_bowman", "ssp", "case_hit", "one_of_one"],
      resolved: normalized,
      evidence
    }),
    number_serial_grade: buildModule({
      key: "number_serial_grade",
      text: numberSerialGradeText(normalized),
      fieldNames: ["serial_number", "collector_number", "checklist_code", "grade_company", "card_grade", "auto_grade", "grade_type"],
      resolved: normalized,
      evidence
    })
  };

  return Object.fromEntries(moduleOrder.map((key) => [key, modules[key]]));
}
