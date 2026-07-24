export const INTAKE_PREVIEW_CARD_WINDOW = 8;

export function claimNextBatchAsset(assets = [], claimedAssetIndexes = new Set()) {
  for (const asset of Array.isArray(assets) ? assets : []) {
    const index = Number(asset?.index);
    if (!Number.isFinite(index) || claimedAssetIndexes.has(index)) continue;
    claimedAssetIndexes.add(index);
    return asset;
  }
  return null;
}

export function windowIntakePreviewGroups(groups = [], limit = INTAKE_PREVIEW_CARD_WINDOW) {
  const source = Array.isArray(groups) ? groups : [];
  const boundedLimit = Math.max(1, Math.trunc(Number(limit) || INTAKE_PREVIEW_CARD_WINDOW));
  return {
    visible: source.slice(0, boundedLimit),
    remaining: Math.max(0, source.length - boundedLimit)
  };
}
