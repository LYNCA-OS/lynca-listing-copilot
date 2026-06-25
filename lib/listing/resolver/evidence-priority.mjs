export const sourceTrustTier = Object.freeze({
  CARD_FRONT: 1,
  CARD_BACK: 1,
  SLAB_LABEL: 2,
  OFFICIAL_CHECKLIST: 3,
  OFFICIAL_PRODUCT_PAGE: 3,
  OFFICIAL_GRADING_DATA: 4,
  INTERNAL_APPROVED_HISTORY: 5,
  STRUCTURED_DATABASE: 6,
  INTERNAL_REGISTRY: 7,
  VECTOR_APPROVED_REFERENCE: 8,
  MARKETPLACE: 8,
  OPEN_WEB: 9,
  VISION_MODEL: 10,
  OCR: 10,
  OPERATOR: 1
});

export function sourcePriority(source = {}) {
  const trustTier = Number.isInteger(source.trust_tier)
    ? source.trust_tier
    : sourceTrustTier[source.source_type] || 10;
  const glarePenalty = Number(source.glare_occlusion || 0) * 2;
  const blurPenalty = Number(source.blur_score || 0) * 2;

  return trustTier + glarePenalty + blurPenalty;
}

export function bestEvidenceSource(sources = []) {
  return [...sources].sort((a, b) => sourcePriority(a) - sourcePriority(b))[0] || null;
}
