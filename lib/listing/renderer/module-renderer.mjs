import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import {
  normalizeText,
  productIdentityText,
  pushUniquePhrase,
  renderGrade,
  subjectText,
  titleCleanup
} from "./title-cleanup.mjs";

export const rendererVersion = "renderer-v1";

export const moduleOrder = Object.freeze([
  "product_identity",
  "subject",
  "card_variant",
  "numbering",
  "attributes",
  "grading"
]);

const moduleLabels = Object.freeze({
  product_identity: "产品身份",
  subject: "人物 / 主体",
  card_variant: "卡片类型与版本",
  numbering: "编号",
  attributes: "签名 / 实物 / 特殊属性",
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

function cardVariantText(resolved) {
  const parts = [];
  [
    resolved.card_type,
    resolved.insert,
    resolved.parallel,
    resolved.variation,
    resolved.subset && !/^(?:RC|Rookie|Rookie Card)$/i.test(resolved.subset) ? resolved.subset : null
  ].forEach((part) => pushUniquePhrase(parts, part));
  return parts.join(" ");
}

function numberingText(resolved) {
  return [
    resolved.serial_number,
    resolved.collector_number ? `#${String(resolved.collector_number).replace(/^#/, "")}` : null,
    resolved.checklist_code
  ].map(normalizeText).filter(Boolean).join(" · ");
}

function attributesText(resolved) {
  const parts = [];
  if (resolved.rc || /^RC$/i.test(resolved.subset || "")) parts.push("RC");
  if (resolved.first_bowman) parts.push("1st Bowman");
  if (resolved.ssp) parts.push("SSP");
  if (resolved.case_hit) parts.push("Case Hit");
  if (resolved.auto) parts.push("Auto");
  if (resolved.patch) parts.push("Patch");
  if (resolved.relic) parts.push("Relic");
  if (resolved.sketch) parts.push("Sketch");
  if (resolved.redemption) parts.push("Redemption");
  if (resolved.one_of_one) parts.push("1/1");
  return parts.join(" ");
}

export function renderListingModules({
  resolved = {},
  evidence = {}
} = {}) {
  const normalized = normalizeResolvedFields(resolved);
  const modules = {
    product_identity: buildModule({
      key: "product_identity",
      text: [normalized.year, productIdentityText(normalized)].filter(Boolean).join(" "),
      fieldNames: ["year", "manufacturer", "brand", "product", "set"],
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
    card_variant: buildModule({
      key: "card_variant",
      text: cardVariantText(normalized),
      fieldNames: ["card_type", "insert", "parallel", "variation", "subset"],
      resolved: normalized,
      evidence
    }),
    numbering: buildModule({
      key: "numbering",
      text: numberingText(normalized),
      fieldNames: ["serial_number", "collector_number", "checklist_code"],
      resolved: normalized,
      evidence
    }),
    attributes: buildModule({
      key: "attributes",
      text: attributesText(normalized),
      fieldNames: ["rc", "first_bowman", "ssp", "case_hit", "auto", "patch", "relic", "sketch", "redemption", "one_of_one"],
      resolved: normalized,
      evidence
    }),
    grading: buildModule({
      key: "grading",
      text: renderGrade(normalized),
      fieldNames: ["grade_company", "card_grade", "auto_grade", "grade_type"],
      resolved: normalized,
      evidence
    })
  };

  return Object.fromEntries(moduleOrder.map((key) => [key, modules[key]]));
}
