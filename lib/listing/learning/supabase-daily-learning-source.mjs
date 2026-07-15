import { readV4Rows } from "../v4/session/supabase-rest.mjs";

const ID_BATCH_SIZE = 100;

function cleanText(value) {
  return String(value ?? "").trim();
}

function unique(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))].sort();
}

function dateRange(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanText(date))) throw new Error("invalid_daily_learning_export_date");
  const start = `${date}T00:00:00.000Z`;
  const endDate = new Date(start);
  if (Number.isNaN(endDate.getTime()) || endDate.toISOString().slice(0, 10) !== date) {
    throw new Error("invalid_daily_learning_export_date");
  }
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  return { start, end: endDate.toISOString() };
}

function quotedPostgrestId(value) {
  return `"${cleanText(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function idFilter(ids = []) {
  return `in.(${ids.map(quotedPostgrestId).join(",")})`;
}

function rowsById(rows = []) {
  return new Map(rows.map((row) => [cleanText(row?.id), row]).filter(([id]) => id));
}

async function readAllRows({
  table,
  search = {},
  readRows,
  pageSize,
  requireExactCount
}) {
  const rows = [];
  const seenIds = new Set();
  let offset = 0;
  let expectedCount = null;
  for (let page = 0; page < 100_000; page += 1) {
    const result = await readRows({
      table,
      select: "*",
      count: "exact",
      search: {
        ...search,
        limit: String(pageSize),
        offset: String(offset)
      }
    });
    if (!result.ok) throw new Error(`daily_learning_source_read_failed:${table}:${result.error || "unknown_error"}`);
    const reportedCount = Number.isSafeInteger(result.count) && result.count >= 0 ? result.count : null;
    if (requireExactCount && reportedCount === null) {
      throw new Error(`daily_learning_source_count_required:${table}`);
    }
    if (reportedCount !== null) {
      if (expectedCount !== null && reportedCount !== expectedCount) {
        throw new Error(`daily_learning_source_changed_during_export:${table}`);
      }
      expectedCount = reportedCount;
    }
    const pageRows = Array.isArray(result.rows) ? result.rows : [];
    for (const row of pageRows) {
      const id = cleanText(row?.id);
      if (!id) throw new Error(`daily_learning_source_row_id_required:${table}`);
      if (seenIds.has(id)) throw new Error(`daily_learning_source_page_overlap:${table}:${id}`);
      seenIds.add(id);
      rows.push(row);
    }
    offset += pageRows.length;
    if (expectedCount !== null) {
      if (offset === expectedCount) return rows;
      if (offset > expectedCount || pageRows.length === 0) {
        throw new Error(`daily_learning_source_incomplete:${table}:${offset}/${expectedCount}`);
      }
      continue;
    }
    if (pageRows.length < pageSize) return rows;
  }
  throw new Error(`daily_learning_source_pagination_limit:${table}`);
}

async function readRequiredRowsByIds({ table, ids, readRows, pageSize, requireExactCount }) {
  const requested = unique(ids);
  if (!requested.length) return [];
  const rows = [];
  for (let offset = 0; offset < requested.length; offset += ID_BATCH_SIZE) {
    const batch = requested.slice(offset, offset + ID_BATCH_SIZE);
    rows.push(...await readAllRows({
      table,
      search: { id: idFilter(batch), order: "id.asc" },
      readRows,
      pageSize: Math.min(pageSize, batch.length),
      requireExactCount
    }));
  }
  const found = rowsById(rows);
  const missing = requested.filter((id) => !found.has(id));
  if (missing.length) throw new Error(`daily_learning_dependency_missing:${table}:${missing.join(",")}`);
  return requested.map((id) => found.get(id));
}

function mergeUniqueRows(primary = [], dependencies = []) {
  const merged = rowsById(primary);
  for (const row of dependencies) {
    const id = cleanText(row?.id);
    if (id && !merged.has(id)) merged.set(id, row);
  }
  return [...merged.values()].sort((left, right) => cleanText(left.id).localeCompare(cleanText(right.id)));
}

export async function loadSupabaseDailyLearningBundle({
  date,
  readRows = readV4Rows,
  pageSize = 500,
  requireExactCount = readRows === readV4Rows
} = {}) {
  const { start, end } = dateRange(date);
  const boundedPageSize = Math.max(1, Math.min(1000, Number(pageSize) || 500));
  const [dailyFeedback, dailyLearning, validations] = await Promise.all([
    readAllRows({
      table: "v4_writer_feedback_events",
      search: { and: `(received_at.gte.${start},received_at.lt.${end})`, order: "received_at.asc,id.asc" },
      readRows,
      pageSize: boundedPageSize,
      requireExactCount
    }),
    readAllRows({
      table: "v4_learning_events",
      search: { and: `(created_at.gte.${start},created_at.lt.${end})`, order: "created_at.asc,id.asc" },
      readRows,
      pageSize: boundedPageSize,
      requireExactCount
    }),
    readAllRows({
      table: "v4_sem_validation_events",
      search: { and: `(created_at.gte.${start},created_at.lt.${end})`, order: "created_at.asc,id.asc" },
      readRows,
      pageSize: boundedPageSize,
      requireExactCount
    })
  ]);
  const dailyLearningIds = new Set(unique(dailyLearning.map((row) => row.id)));
  const referencedLearningIds = unique(validations.map((row) => row.learning_event_id));
  const dependencyLearningIds = referencedLearningIds.filter((id) => !dailyLearningIds.has(id));
  const dependencyLearning = await readRequiredRowsByIds({
    table: "v4_learning_events",
    ids: dependencyLearningIds,
    readRows,
    pageSize: boundedPageSize,
    requireExactCount
  });
  const allLearning = mergeUniqueRows(dailyLearning, dependencyLearning);

  const dailyFeedbackIds = new Set(unique(dailyFeedback.map((row) => row.id)));
  const referencedFeedbackIds = unique([
    ...allLearning.map((row) => row.feedback_event_id),
    ...validations.map((row) => row.feedback_event_id)
  ]);
  const dependencyFeedbackIds = referencedFeedbackIds.filter((id) => !dailyFeedbackIds.has(id));
  const dependencyFeedback = await readRequiredRowsByIds({
    table: "v4_writer_feedback_events",
    ids: dependencyFeedbackIds,
    readRows,
    pageSize: boundedPageSize,
    requireExactCount
  });

  return {
    input_scope: "SUPABASE_DAILY_WITH_PARENT_CLOSURE",
    feedback_events: mergeUniqueRows(dailyFeedback, dependencyFeedback),
    learning_events: allLearning,
    sem_validation_events: validations,
    dependency_closure: {
      daily_feedback_events: dailyFeedback.length,
      daily_learning_events: dailyLearning.length,
      daily_sem_validation_events: validations.length,
      parent_feedback_events_loaded: dependencyFeedback.length,
      parent_learning_events_loaded: dependencyLearning.length
    }
  };
}
