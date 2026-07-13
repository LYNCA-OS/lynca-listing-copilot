function clamp01(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

const baseWeights = Object.freeze({
  tcg_card_code: 0.98,
  checklist_code: 0.9,
  collector_number: 0.82,
  product_code: 0.76,
  cert_number: 0.72,
  numerical_rarity: 0.2
});

export function anchorDecisionConfidence(anchor = {}, dossier = {}) {
  const observed = clamp01(anchor.confidence, 0.72);
  const directFactor = anchor.direct === true ? 1 : 0.72;
  const base = baseWeights[anchor.anchor_type] ?? 0.3;
  const context = dossier.context || {};
  const contextCount = [context.year, context.product, context.subjects?.length].filter(Boolean).length;
  const contextBoost = Math.min(0.08, contextCount * 0.025);
  return Number(Math.min(1, base * observed * directFactor + contextBoost).toFixed(4));
}

export function anchorIsDirectEnough(anchor = {}, minimum = 0.82) {
  return anchor.direct === true && clamp01(anchor.confidence, 0) >= minimum;
}

export function anchorContextDimensionCount(dossier = {}) {
  const context = dossier.context || {};
  return [context.year, context.product, context.subjects?.length].filter(Boolean).length;
}

export function anchorContextDirectDimensionCount(dossier = {}) {
  const context = dossier.context || {};
  return [context.year_direct, context.product_direct, context.subject_direct].filter(Boolean).length;
}
