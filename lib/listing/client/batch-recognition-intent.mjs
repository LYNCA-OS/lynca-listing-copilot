export const INTAKE_PREVIEW_CARD_WINDOW = 8;

export function groupIntakeFileSlots(files = [], mode = "pair") {
  const source = Array.isArray(files) ? files : Array.from(files || []);
  const groupSize = mode === "single" ? 1 : 2;
  const groups = [];
  for (let index = 0; index < source.length; index += groupSize) {
    groups.push({
      index: Math.floor(index / groupSize) + 1,
      files: source.slice(index, index + groupSize)
    });
  }
  return groups;
}

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
