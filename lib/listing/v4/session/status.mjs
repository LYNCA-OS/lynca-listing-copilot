export const v4SessionStatuses = Object.freeze({
  CREATED: "CREATED",
  PREINGESTED: "PREINGESTED",
  OBSERVING: "OBSERVING",
  CANDIDATES_READY: "CANDIDATES_READY",
  DRAFT_READY: "DRAFT_READY",
  WRITER_REVIEW: "WRITER_REVIEW",
  ACCEPTED: "ACCEPTED",
  EDITED: "EDITED",
  REJECTED: "REJECTED",
  LEARNING_CAPTURED: "LEARNING_CAPTURED",
  FAILED: "FAILED"
});

export function normalizeV4Status(value, fallback = v4SessionStatuses.CREATED) {
  const normalized = String(value || "").trim().toUpperCase();
  return Object.values(v4SessionStatuses).includes(normalized) ? normalized : fallback;
}
