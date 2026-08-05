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

/**
 * The visible slice of a batch, and where it sits in the whole batch. COS-50.
 *
 * One constant was serving two different jobs: bounding the live DOM, which is
 * a real performance concern, and defining what the operator may reach, which
 * is not. A 20-card batch read as `8 / 8` and cards 9-20 could not be opened
 * until earlier cards were saved -- the batch looked truncated and non-linear
 * review was impossible.
 *
 * Bounding the render stays. This adds the second axis: WHERE the bounded
 * window sits, so every card is reachable without ever rendering all of them.
 *
 * `start` is clamped rather than rejected. A window can be left pointing past
 * the end by the batch shrinking under it -- a card being saved is the normal
 * case -- and an out-of-range window must degrade to the last full page, not
 * to an empty list the operator cannot navigate out of.
 */
export function batchReviewWindow(items = [], {
  start = 0,
  size = INTAKE_PREVIEW_CARD_WINDOW,
  focusIndex = null
} = {}) {
  const source = Array.isArray(items) ? items : [];
  const boundedSize = Math.max(1, Math.trunc(Number(size) || INTAKE_PREVIEW_CARD_WINDOW));
  const total = source.length;

  // A focused card wins over the stored scroll position: selecting card 20 has
  // to bring card 20 into view, or direct selection is not direct.
  let desiredStart = Math.trunc(Number(start) || 0);
  if (focusIndex !== null && focusIndex !== undefined) {
    const position = source.findIndex((item) => Number(item?.index) === Number(focusIndex));
    if (position >= 0 && (position < desiredStart || position >= desiredStart + boundedSize)) {
      desiredStart = Math.floor(position / boundedSize) * boundedSize;
    }
  }
  const maxStart = Math.max(0, Math.ceil(Math.max(total, 1) / boundedSize) * boundedSize - boundedSize);
  const clampedStart = Math.min(Math.max(0, desiredStart), Math.min(maxStart, Math.max(0, total - 1)));
  const normalizedStart = total ? Math.floor(clampedStart / boundedSize) * boundedSize : 0;

  const visible = source.slice(normalizedStart, normalizedStart + boundedSize);
  return {
    visible,
    start: normalizedStart,
    size: boundedSize,
    total,
    // 1-based and inclusive, because these are the numbers shown to a person.
    from: total ? normalizedStart + 1 : 0,
    to: total ? normalizedStart + visible.length : 0,
    page: total ? Math.floor(normalizedStart / boundedSize) + 1 : 0,
    pages: total ? Math.ceil(total / boundedSize) : 0,
    hasPrevious: normalizedStart > 0,
    hasNext: normalizedStart + boundedSize < total,
    remaining: Math.max(0, total - (normalizedStart + visible.length))
  };
}
