function defaultFinalTitle(result = {}) {
  return String(
    result.correctedTitle
    ?? result.final_title
    ?? result.rendered_title
    ?? result.title
    ?? ""
  ).trim();
}

export const WRITER_EXPORT_MAX_ROWS = 250;

export function writerExportWithinLimit(rowCount, limit = WRITER_EXPORT_MAX_ROWS) {
  return Number(rowCount) >= 0 && Number(rowCount) <= Number(limit);
}

export function writerFeedbackPersisted(result = {}) {
  return String(result?.persistenceStatus || "") === "persisted";
}

export function writerExportRowsReady({
  assets = [],
  results = [],
  processing = false,
  exporting = false,
  finalTitleForResult = defaultFinalTitle,
  isTitlePending = (result) => result?.writerTitlePending === true
} = {}) {
  if (!assets.length || processing || exporting) return false;
  const resultsByIndex = new Map(results.map((result) => [Number(result.index), result]));
  return assets.every((asset) => {
    const result = resultsByIndex.get(Number(asset.index));
    return Boolean(
      result
      && result.feedbackStatus === "saved"
      && writerFeedbackPersisted(result)
      && finalTitleForResult(result)
      && !isTitlePending(result)
    );
  });
}

export function nextWriterOutstandingIndex({
  assets = [],
  results = [],
  currentIndex = 0
} = {}) {
  const resultsByIndex = new Map(results.map((result) => [Number(result.index), result]));
  const outstanding = assets
    .filter((asset) => {
      const result = resultsByIndex.get(Number(asset.index));
      return !writerFeedbackPersisted(result);
    })
    .sort((left, right) => Number(left.index) - Number(right.index));
  if (!outstanding.length) return null;
  return (outstanding.find((asset) => Number(asset.index) > Number(currentIndex)) || outstanding[0]).index;
}

export function preferredWriterOutstandingIndex({
  assets = [],
  results = [],
  currentIndex = null,
  isTitlePending = (result) => result?.writerTitlePending === true
} = {}) {
  const resultsByIndex = new Map(results.map((result) => [Number(result.index), result]));
  const outstanding = assets
    .filter((asset) => !writerFeedbackPersisted(resultsByIndex.get(Number(asset.index))))
    .sort((left, right) => Number(left.index) - Number(right.index));
  if (!outstanding.length) return null;

  const ready = outstanding.filter((asset) => {
    const result = resultsByIndex.get(Number(asset.index));
    return Boolean(result && !isTitlePending(result) && result.feedbackStatus !== "saving");
  });
  const current = ready.find((asset) => Number(asset.index) === Number(currentIndex));
  if (current) return current.index;
  const nextReady = ready.find((asset) => Number(asset.index) > Number(currentIndex)) || ready[0];
  if (nextReady) return nextReady.index;

  return (outstanding.find((asset) => Number(asset.index) > Number(currentIndex)) || outstanding[0]).index;
}
