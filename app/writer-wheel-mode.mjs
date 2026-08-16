export const WRITER_EXPORT_MAX_ROWS = 250;

export function writerExportWithinLimit(rowCount, limit = WRITER_EXPORT_MAX_ROWS) {
  return Number(rowCount) >= 0 && Number(rowCount) <= Number(limit);
}

export function writerFeedbackPersisted(result = {}) {
  return String(result?.persistenceStatus || "") === "persisted";
}

export function writerFeedbackDecision({
  generatedTitle = "",
  correctedTitle = "",
  explicitReject = false
} = {}) {
  const generated = String(generatedTitle || "").trim();
  const corrected = String(correctedTitle || "").trim();
  if (explicitReject) return { ready: true, action: "REJECT", reason: "" };
  if (!corrected) return { ready: false, action: "", reason: "TITLE_REQUIRED" };
  return {
    ready: true,
    action: generated === corrected ? "ACCEPT" : "EDIT",
    reason: ""
  };
}
