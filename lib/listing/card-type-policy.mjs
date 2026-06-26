import { normalizeText, pushUniquePhrase } from "./renderer/title-cleanup.mjs";

export const observableComponentNames = Object.freeze([
  "auto",
  "patch",
  "relic",
  "jersey",
  "rc",
  "sketch",
  "redemption"
]);

const componentLabels = Object.freeze({
  auto: "Auto",
  patch: "Patch",
  relic: "Relic",
  jersey: "Jersey",
  rc: "RC",
  sketch: "Sketch",
  redemption: "Redemption"
});

const componentPatterns = Object.freeze({
  auto: /\b(?:auto|autos|autograph|autographs|autographed|signature|signatures|signed)\b/i,
  patch: /\bpatch\b/i,
  relic: /\b(?:relic|swatch|memorabilia|logoman)\b/i,
  jersey: /\bjersey\b/i,
  rc: /\b(?:rc|rookie|rated rookie|rookie ticket|rookie card)\b/i,
  sketch: /\bsketch\b/i,
  redemption: /\bredemption\b/i
});

function canonicalComponent(value) {
  const text = normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!text) return "";
  if (["autograph", "autographs", "signature", "signatures", "signed"].includes(text)) return "auto";
  if (["memorabilia", "swatch", "logoman"].includes(text)) return "relic";
  if (["rookie", "rookie_card", "rookie_ticket", "rated_rookie"].includes(text)) return "rc";
  return observableComponentNames.includes(text) ? text : "";
}

function componentsFromText(value) {
  const text = normalizeText(value);
  if (!text) return [];
  return observableComponentNames.filter((component) => componentPatterns[component].test(text));
}

export function normalizeObservableComponents(value) {
  const components = [];
  const add = (component) => {
    const normalized = canonicalComponent(component);
    if (normalized && !components.includes(normalized)) components.push(normalized);
  };

  if (Array.isArray(value)) {
    value.forEach(add);
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([component, enabled]) => {
      if (enabled === true) add(component);
      else if (typeof enabled === "string" && /^(true|yes|1)$/i.test(enabled)) add(component);
    });
  } else {
    componentsFromText(value).forEach(add);
  }

  return components;
}

export function observableComponentsFromResolved(resolved = {}) {
  const parts = normalizeObservableComponents(resolved.observable_components || resolved.observableComponents);
  observableComponentNames.forEach((component) => {
    if (resolved[component] === true && !parts.includes(component)) parts.push(component);
  });
  componentsFromText(resolved.card_type).forEach((component) => {
    if (!parts.includes(component)) parts.push(component);
  });
  return parts;
}

function normalizeOfficialCardType(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (/^(?:standard|regular|insert)$/i.test(text)) return "";
  if (/^(?:relic|memorabilia|patch|jersey)\s*\/\s*(?:auto|autograph|signature)$/i.test(text)) return "Auto Relic";
  if (/^(?:auto|autograph|signature)\s*\/\s*(?:relic|memorabilia|patch|jersey)$/i.test(text)) return "Auto Relic";
  if (/^(?:auto|autograph|autographed|signature|signed)$/i.test(text)) return "";
  if (/^(?:patch|relic|memorabilia|jersey|sketch|redemption|rc|rookie)$/i.test(text)) return "";
  return text;
}

function legacyOfficialCardType(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (/\b(?:auto|autograph|autographs|autographed|signature|signatures|signed|relic|patch|jersey|memorabilia|card)\b/i.test(text)) return "";
  if (!/\b(?:rookie\s+ticket|rated\s+rookie|canvas\s+creations|historic\s+ties|next\s+stop|spotlight|kaboom|color\s+blast|downtown|booklet|ticket)\b/i.test(text)) return "";
  return normalizeOfficialCardType(text);
}

export function officialCardTypeText(resolved = {}) {
  return normalizeOfficialCardType(resolved.official_card_type || resolved.officialCardType)
    || legacyOfficialCardType(resolved.card_type);
}

export function cardTypeTextParts(resolved = {}, {
  includeRc = false
} = {}) {
  const parts = [];
  pushUniquePhrase(parts, officialCardTypeText(resolved));
  const components = observableComponentsFromResolved(resolved);
  const hasAuto = components.includes("auto");
  const hasPatch = components.includes("patch");
  const hasRelicLike = components.includes("relic") || components.includes("jersey");
  const insertText = normalizeText(resolved.insert);
  const insertHasAuto = /\b(?:auto|autograph|autographs|autographed|signed|signature|signatures)\b/i.test(insertText);
  const insertHasRelic = /\b(?:patch|relic|swatch|memorabilia|jersey|logoman)\b/i.test(insertText);

  if (hasAuto && hasPatch && !(insertHasAuto && insertHasRelic)) {
    pushUniquePhrase(parts, "Auto Patch");
  } else if (hasAuto && hasRelicLike && !(insertHasAuto && insertHasRelic)) {
    pushUniquePhrase(parts, "Auto Relic");
  } else {
    if (hasAuto && !insertHasAuto) pushUniquePhrase(parts, componentLabels.auto);
    if (hasPatch && !insertHasRelic) pushUniquePhrase(parts, componentLabels.patch);
    if (components.includes("relic") && !insertHasRelic) pushUniquePhrase(parts, componentLabels.relic);
    if (components.includes("jersey") && !insertHasRelic) pushUniquePhrase(parts, componentLabels.jersey);
  }

  if (includeRc && components.includes("rc")) pushUniquePhrase(parts, componentLabels.rc);
  if (components.includes("sketch")) pushUniquePhrase(parts, componentLabels.sketch);
  if (components.includes("redemption")) pushUniquePhrase(parts, componentLabels.redemption);
  return parts;
}

export function componentBooleansFromObservableComponents(value) {
  return Object.fromEntries(observableComponentNames.map((component) => [
    component,
    normalizeObservableComponents(value).includes(component)
  ]));
}
