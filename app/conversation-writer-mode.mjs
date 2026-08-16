// Keep the original public mode key: the Writer Wheel is upgraded in place,
// while the short-lived `terminal` experiment remains a compatibility alias in
// the app shell.
export const CONVERSATION_WRITER_MODE = "writer";
export const WRITER_TERMINAL_LEDGER_VERSION = "writer-terminal-ledger-v1";

export const WRITER_TERMINAL_EVENTS = Object.freeze({
  INTAKE_APPENDED: "INTAKE_APPENDED",
  RECOGNITION_SETTLED: "RECOGNITION_SETTLED",
  REVIEW_PERSISTED: "REVIEW_PERSISTED",
  EXPORT_RECORDED: "EXPORT_RECORDED"
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function copied(value) {
  return JSON.parse(JSON.stringify(value));
}

function requiredText(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`writer_terminal_${name}_required`);
  return text;
}

function assetIndex(value) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 1) throw new Error("writer_terminal_asset_index_invalid");
  return index;
}

function canonicalTimestamp(value) {
  const text = requiredText(value, "occurred_at");
  const time = Date.parse(text);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== text) {
    throw new Error("writer_terminal_occurred_at_invalid");
  }
  return text;
}

function normalizeEvent(event = {}) {
  const normalized = {
    id: requiredText(event.id, "event_id"),
    type: requiredText(event.type, "event_type"),
    occurred_at: canonicalTimestamp(event.occurred_at)
  };
  if (!Object.values(WRITER_TERMINAL_EVENTS).includes(normalized.type)) {
    throw new Error("writer_terminal_event_type_invalid");
  }

  if (normalized.type === WRITER_TERMINAL_EVENTS.INTAKE_APPENDED) {
    normalized.turn_id = requiredText(event.turn_id, "turn_id");
    normalized.asset_index = assetIndex(event.asset_index);
    normalized.image_count = Number(event.image_count);
    if (normalized.image_count !== 2) throw new Error("writer_terminal_pair_requires_two_images");
  } else if (normalized.type === WRITER_TERMINAL_EVENTS.RECOGNITION_SETTLED) {
    normalized.asset_index = assetIndex(event.asset_index);
    normalized.attempt_id = requiredText(event.attempt_id, "attempt_id");
    normalized.outcome = requiredText(event.outcome, "recognition_outcome").toUpperCase();
    if (!["READY", "FAILED"].includes(normalized.outcome)) {
      throw new Error("writer_terminal_recognition_outcome_invalid");
    }
    normalized.title = String(event.title || "").trim();
    if (normalized.title.length > 80) throw new Error("writer_terminal_title_too_long");
    if (normalized.outcome === "READY" && !normalized.title) {
      throw new Error("writer_terminal_ready_title_required");
    }
    if (normalized.outcome === "FAILED" && normalized.title) {
      throw new Error("writer_terminal_failed_title_forbidden");
    }
  } else if (normalized.type === WRITER_TERMINAL_EVENTS.REVIEW_PERSISTED) {
    normalized.asset_index = assetIndex(event.asset_index);
    normalized.decision = requiredText(event.decision, "review_decision").toUpperCase();
    if (!["SAVED", "REJECTED"].includes(normalized.decision)) {
      throw new Error("writer_terminal_review_decision_invalid");
    }
    normalized.title = String(event.title || "").trim();
    if (normalized.title.length > 80) throw new Error("writer_terminal_title_too_long");
    if (normalized.decision === "SAVED" && !normalized.title) {
      throw new Error("writer_terminal_saved_title_required");
    }
    if (normalized.decision === "REJECTED" && normalized.title) {
      throw new Error("writer_terminal_rejected_title_forbidden");
    }
  } else {
    normalized.batch_id = requiredText(event.batch_id, "export_batch_id");
    normalized.asset_indexes = [...new Set((Array.isArray(event.asset_indexes) ? event.asset_indexes : []).map(assetIndex))];
    if (!normalized.asset_indexes.length) throw new Error("writer_terminal_export_assets_required");
  }
  return deepFreeze(normalized);
}

export function createWriterTerminalLedger({ sessionId } = {}) {
  return deepFreeze({
    schema_version: WRITER_TERMINAL_LEDGER_VERSION,
    session_id: requiredText(sessionId, "session_id"),
    events: []
  });
}

export function appendWriterTerminalEvent(ledger, event) {
  if (ledger?.schema_version !== WRITER_TERMINAL_LEDGER_VERSION || !Array.isArray(ledger.events)) {
    throw new Error("writer_terminal_ledger_invalid");
  }
  const normalized = normalizeEvent(event);
  if (ledger.events.some((existing) => existing.id === normalized.id)) {
    throw new Error("writer_terminal_event_id_duplicate");
  }
  if (normalized.type === WRITER_TERMINAL_EVENTS.INTAKE_APPENDED
      && ledger.events.some((existing) => existing.type === WRITER_TERMINAL_EVENTS.INTAKE_APPENDED
        && existing.asset_index === normalized.asset_index)) {
    throw new Error("writer_terminal_asset_duplicate");
  }
  if (normalized.type !== WRITER_TERMINAL_EVENTS.INTAKE_APPENDED
      && normalized.type !== WRITER_TERMINAL_EVENTS.EXPORT_RECORDED
      && !ledger.events.some((existing) => existing.type === WRITER_TERMINAL_EVENTS.INTAKE_APPENDED
        && existing.asset_index === normalized.asset_index)) {
    throw new Error("writer_terminal_asset_unknown");
  }
  if (normalized.type === WRITER_TERMINAL_EVENTS.EXPORT_RECORDED) {
    const knownAssets = new Set(ledger.events
      .filter((existing) => existing.type === WRITER_TERMINAL_EVENTS.INTAKE_APPENDED)
      .map((existing) => existing.asset_index));
    if (normalized.asset_indexes.some((index) => !knownAssets.has(index))) {
      throw new Error("writer_terminal_export_asset_unknown");
    }
  }
  return deepFreeze({
    schema_version: ledger.schema_version,
    session_id: ledger.session_id,
    events: [...ledger.events.map(copied), copied(normalized)]
  });
}

export function projectWriterTerminal(ledger) {
  if (ledger?.schema_version !== WRITER_TERMINAL_LEDGER_VERSION || !Array.isArray(ledger.events)) {
    throw new Error("writer_terminal_ledger_invalid");
  }
  const turns = new Map();
  const cards = new Map();
  const exports = [];
  for (const event of ledger.events) {
    if (event.type === WRITER_TERMINAL_EVENTS.INTAKE_APPENDED) {
      if (!turns.has(event.turn_id)) turns.set(event.turn_id, []);
      turns.get(event.turn_id).push(event.asset_index);
      cards.set(event.asset_index, {
        asset_index: event.asset_index,
        turn_id: event.turn_id,
        recognition_attempts: [],
        review: null
      });
    } else if (event.type === WRITER_TERMINAL_EVENTS.RECOGNITION_SETTLED) {
      const card = cards.get(event.asset_index);
      card.recognition_attempts.push({
        attempt_id: event.attempt_id,
        outcome: event.outcome,
        title: event.title
      });
    } else if (event.type === WRITER_TERMINAL_EVENTS.REVIEW_PERSISTED) {
      cards.get(event.asset_index).review = { decision: event.decision, title: event.title };
    } else {
      exports.push({ batch_id: event.batch_id, asset_indexes: [...event.asset_indexes] });
    }
  }
  return deepFreeze({
    session_id: ledger.session_id,
    turns: [...turns.entries()].map(([id, asset_indexes]) => ({
      id,
      asset_indexes: [...asset_indexes].sort((left, right) => left - right)
    })),
    cards: [...cards.values()].sort((left, right) => left.asset_index - right.asset_index),
    exports
  });
}

function finalTitleForTerminalCard(card) {
  if (card.review?.decision === "REJECTED") return "";
  if (card.review?.decision === "SAVED") return card.review.title;
  const latestReadyRecognition = [...card.recognition_attempts]
    .reverse()
    .find((attempt) => attempt.outcome === "READY");
  return latestReadyRecognition?.title || "";
}

export function selectWriterTerminalExportRows(ledger) {
  return deepFreeze(projectWriterTerminal(ledger).cards.flatMap((card) => {
    const title = finalTitleForTerminalCard(card);
    return title ? [{ asset_index: card.asset_index, final_title: title }] : [];
  }));
}

export function writerTerminalExportReadiness(ledger) {
  const cards = projectWriterTerminal(ledger).cards;
  const rows = cards.flatMap((card) => {
    const title = finalTitleForTerminalCard(card);
    return title ? [{ asset_index: card.asset_index, final_title: title }] : [];
  });
  const rejected = cards
    .filter((card) => card.review?.decision === "REJECTED")
    .map((card) => card.asset_index);
  const settled = new Set([...rows.map((row) => row.asset_index), ...rejected]);
  const unresolved = cards
    .map((card) => card.asset_index)
    .filter((index) => !settled.has(index));
  return deepFreeze({
    ready: cards.length > 0 && rows.length > 0 && unresolved.length === 0,
    card_count: cards.length,
    export_count: rows.length,
    rejected_count: rejected.length,
    rejected_asset_indexes: rejected,
    unresolved_asset_indexes: unresolved,
    rows
  });
}

/**
 * The conversation is a projection of the asset ledger, never its owner.
 * Grouping by intake turn makes "10 cards, then 20 cards" render as two user
 * turns while all 30 assets keep their stable global indexes and export order.
 */
export function groupConversationAssets(assets = []) {
  const turns = new Map();
  for (const asset of Array.isArray(assets) ? assets : []) {
    const index = Number(asset?.index);
    if (!Number.isFinite(index)) continue;
    const turnId = String(asset?.intakeTurnId || "legacy-turn");
    if (!turns.has(turnId)) turns.set(turnId, []);
    turns.get(turnId).push(asset);
  }
  return [...turns.entries()].map(([id, turnAssets]) => {
    const sorted = [...turnAssets].sort((left, right) => Number(left.index) - Number(right.index));
    return Object.freeze({
      id,
      assets: Object.freeze(sorted),
      image_count: sorted.reduce((total, asset) => total + (Array.isArray(asset.images) ? asset.images.length : 0), 0),
      first_asset_index: sorted[0]?.index ?? null,
      last_asset_index: sorted.at(-1)?.index ?? null
    });
  });
}

export function conversationLedgerSummary({ assets = [], results = [] } = {}) {
  const resultIndexes = new Set((Array.isArray(results) ? results : [])
    .map((result) => Number(result?.index))
    .filter(Number.isFinite));
  const validAssets = (Array.isArray(assets) ? assets : [])
    .filter((asset) => Number.isFinite(Number(asset?.index)));
  return Object.freeze({
    turns: groupConversationAssets(validAssets).length,
    assets: validAssets.length,
    completed: validAssets.filter((asset) => resultIndexes.has(Number(asset.index))).length
  });
}
