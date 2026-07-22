import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

function argValue(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

function firstJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) return null;
  return text.slice(start, end + 1);
}

function firstJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  return text.slice(start, end + 1);
}

function untrustedDataBlocks(text) {
  const source = String(text || "");
  const blocks = [];
  const closePattern = /<\/untrusted-data-[^>]+>/g;
  let closeMatch;
  while ((closeMatch = closePattern.exec(source))) {
    const beforeClose = source.slice(0, closeMatch.index);
    const openMatches = [...beforeClose.matchAll(/<untrusted-data-[^>]+>/g)];
    const open = openMatches.at(-1);
    if (!open) continue;
    const start = open.index + open[0].length;
    blocks.push(source.slice(start, closeMatch.index).trim());
  }
  return blocks;
}

function parsePossiblyWrappedJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];

  try {
    return [JSON.parse(trimmed)];
  } catch {
    const objectText = firstJsonObject(trimmed);
    if (objectText) {
      try {
        return [JSON.parse(objectText)];
      } catch {
        // Continue to fenced/array extraction below.
      }
    }

    const fenced = untrustedDataBlocks(trimmed);
    if (fenced.length) {
      return fenced.flatMap((block) => {
        try {
          return [JSON.parse(block)];
        } catch {
          return [];
        }
      });
    }

    const arrayText = firstJsonArray(trimmed);
    if (arrayText) {
      try {
        return [JSON.parse(arrayText)];
      } catch {
        return [];
      }
    }
  }

  return [];
}

function collectChunkRecords(value, chunkPrefix, chunks = new Map()) {
  if (value == null) return chunks;

  if (Array.isArray(value)) {
    for (const item of value) collectChunkRecords(item, chunkPrefix, chunks);
    return chunks;
  }

  if (typeof value === "object") {
    if (
      typeof value.chunk_id === "string"
      && value.chunk_id.startsWith(chunkPrefix)
      && typeof value.rows_b64 === "string"
    ) {
      const existing = chunks.get(value.chunk_id);
      if (!existing) {
        chunks.set(value.chunk_id, value);
      }
      return chunks;
    }

    for (const nested of Object.values(value)) {
      collectChunkRecords(nested, chunkPrefix, chunks);
    }
    return chunks;
  }

  if (typeof value !== "string" || !value.includes(chunkPrefix) || !value.includes("rows_b64")) {
    return chunks;
  }

  for (const parsed of parsePossiblyWrappedJson(value)) {
    collectChunkRecords(parsed, chunkPrefix, chunks);
  }
  return chunks;
}

function isFeedbackRow(row) {
  return Boolean(
    row
    && typeof row === "object"
    && row.id
    && (Object.hasOwn(row, "front_image_url") || Object.hasOwn(row, "front_object_path"))
    && Object.hasOwn(row, "corrected_title")
  );
}

function collectRowsJsonArrays(value, arrays = []) {
  if (value == null) return arrays;

  if (Array.isArray(value)) {
    if (value.some(isFeedbackRow)) {
      arrays.push(value);
      return arrays;
    }
    for (const item of value) collectRowsJsonArrays(item, arrays);
    return arrays;
  }

  if (typeof value === "object") {
    if (typeof value.rows_json === "string") {
      const rows = JSON.parse(value.rows_json);
      if (Array.isArray(rows)) arrays.push(rows);
    }
    for (const nested of Object.values(value)) {
      collectRowsJsonArrays(nested, arrays);
    }
    return arrays;
  }

  if (typeof value !== "string" || (!value.includes("rows_json") && !value.includes("front_image_url"))) {
    return arrays;
  }

  for (const parsed of parsePossiblyWrappedJson(value)) {
    collectRowsJsonArrays(parsed, arrays);
  }
  return arrays;
}

export function extractSupabaseMcpExportChunksFromSessionText(sessionText, {
  chunkPrefix = "LYNCA_SUPABASE_FEEDBACK_EXPORT_"
} = {}) {
  const chunks = new Map();
  for (const line of String(sessionText || "").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes(chunkPrefix)) continue;
    try {
      collectChunkRecords(JSON.parse(trimmed), chunkPrefix, chunks);
    } catch {
      collectChunkRecords(trimmed, chunkPrefix, chunks);
    }
  }
  return [...chunks.values()].sort((a, b) => String(a.chunk_id).localeCompare(String(b.chunk_id)));
}

export function extractSupabaseMcpRowsJsonArraysFromSessionText(sessionText) {
  const arrays = [];
  for (const line of String(sessionText || "").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || (!trimmed.includes("rows_json") && !trimmed.includes("front_image_url"))) continue;
    try {
      collectRowsJsonArrays(JSON.parse(trimmed), arrays);
    } catch {
      collectRowsJsonArrays(trimmed, arrays);
    }
  }
  return arrays;
}

function collectSessionLine(line, { chunkPrefix, chunks, rowsJsonArrays }) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return;
  const mightContainChunk = trimmed.includes(chunkPrefix);
  const mightContainRows = trimmed.includes("rows_json") || trimmed.includes("front_image_url");
  if (!mightContainChunk && !mightContainRows) return;
  try {
    const parsed = JSON.parse(trimmed);
    if (mightContainChunk) collectChunkRecords(parsed, chunkPrefix, chunks);
    if (mightContainRows) collectRowsJsonArrays(parsed, rowsJsonArrays);
  } catch {
    if (mightContainChunk) collectChunkRecords(trimmed, chunkPrefix, chunks);
    if (mightContainRows) collectRowsJsonArrays(trimmed, rowsJsonArrays);
  }
}

export async function extractSupabaseMcpPayloadsFromSessionLines(lines, {
  chunkPrefix = "LYNCA_SUPABASE_FEEDBACK_EXPORT_"
} = {}) {
  const chunks = new Map();
  const rowsJsonArrays = [];
  for await (const line of lines) {
    collectSessionLine(line, { chunkPrefix, chunks, rowsJsonArrays });
  }
  return {
    chunks: [...chunks.values()].sort((a, b) => String(a.chunk_id).localeCompare(String(b.chunk_id))),
    rowsJsonArrays
  };
}

async function streamSessionLines(session) {
  const input = createReadStream(session, { encoding: "utf8" });
  return createInterface({ input, crlfDelay: Infinity });
}

export function mergeSupabaseFeedbackRows(rowArrays = []) {
  const rowsById = new Map();
  for (const rows of rowArrays) {
    for (const row of rows) {
      const id = String(row?.id || "").trim();
      if (!id || rowsById.has(id)) continue;
      rowsById.set(id, row);
    }
  }
  return [...rowsById.values()].sort((a, b) => (
    timestampMs(b.created_at) - timestampMs(a.created_at)
    || String(a.id || "").localeCompare(String(b.id || ""))
  ));
}

function timestampMs(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function createdAtBounds(rows = []) {
  let first = null;
  let last = null;
  let firstTime = Infinity;
  let lastTime = -Infinity;
  for (const row of rows) {
    const time = timestampMs(row?.created_at);
    if (!time) continue;
    if (time < firstTime) {
      firstTime = time;
      first = row.created_at;
    }
    if (time > lastTime) {
      lastTime = time;
      last = row.created_at;
    }
  }
  return { first, last };
}

export function mergeRowsFromSupabaseMcpChunks(chunks = []) {
  const chunkSummaries = [];
  const rowArrays = [];

  for (const chunk of chunks) {
    const raw = Buffer.from(String(chunk.rows_b64 || ""), "base64").toString("utf8");
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) {
      throw new Error(`Decoded ${chunk.chunk_id} did not produce a row array.`);
    }

    chunkSummaries.push({
      chunk_id: chunk.chunk_id,
      row_count: Number(chunk.row_count ?? rows.length),
      decoded_row_count: rows.length
    });
    rowArrays.push(rows);
  }

  return {
    rows: mergeSupabaseFeedbackRows(rowArrays),
    chunk_summaries: chunkSummaries
  };
}

async function writeJson(writeFileImpl, filePath, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (filePath) {
    await writeFileImpl(filePath, text);
  } else {
    process.stdout.write(text);
  }
}

export async function runExtractSupabaseMcpRowsFromSession({
  argv = process.argv.slice(2),
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  sessionLinesImpl = null
} = {}) {
  const session = argValue(argv, "--session") || argValue(argv, "-s");
  const output = argValue(argv, "--output") || argValue(argv, "-o") || "data/recognition/reports/supabase-feedback-rows-mcp.json";
  const reportOutput = argValue(argv, "--report-output") || "";
  const chunkPrefix = argValue(argv, "--chunk-prefix", "LYNCA_SUPABASE_FEEDBACK_EXPORT_");
  const expectedRows = Number(argValue(argv, "--expected-rows", "0"));
  const expectedChunks = Number(argValue(argv, "--expected-chunks", "0"));

  if (!session) {
    throw new Error("Missing --session Codex JSONL file.");
  }

  const lines = sessionLinesImpl
    ? await sessionLinesImpl(session)
    : readFileImpl === readFile
      ? await streamSessionLines(session)
      : String(await readFileImpl(session, "utf8")).split(/\n/);
  const extracted = await extractSupabaseMcpPayloadsFromSessionLines(lines, { chunkPrefix });
  const chunks = extracted.chunks;
  if (expectedChunks && chunks.length !== expectedChunks) {
    throw new Error(`Expected ${expectedChunks} chunks for ${chunkPrefix}, found ${chunks.length}.`);
  }

  const rowsJsonArrays = chunks.length ? [] : extracted.rowsJsonArrays;
  if (!chunks.length && !rowsJsonArrays.length) {
    throw new Error(`No Supabase MCP export chunks found for prefix ${chunkPrefix}, and no rows_json payloads were found.`);
  }

  const { rows, chunk_summaries: chunkSummaries } = chunks.length
    ? mergeRowsFromSupabaseMcpChunks(chunks)
    : { rows: mergeSupabaseFeedbackRows(rowsJsonArrays), chunk_summaries: [] };
  if (expectedRows && rows.length !== expectedRows) {
    throw new Error(`Expected ${expectedRows} unique rows for ${chunkPrefix}, found ${rows.length}.`);
  }

  const text = `${JSON.stringify(rows, null, 2)}\n`;
  await writeFileImpl(output, text);

  const bounds = createdAtBounds(rows);
  const summary = {
    schema_version: "supabase-mcp-session-export-report-v1",
    session,
    chunk_prefix: chunkPrefix,
    source_mode: chunks.length ? "rows_b64_chunks" : "rows_json_payload",
    chunk_count: chunks.length,
    rows_json_payload_count: rowsJsonArrays.length,
    row_count: rows.length,
    first_created_at: bounds.first,
    last_created_at: bounds.last,
    chunk_summaries: chunkSummaries
  };

  if (reportOutput) {
    await writeJson(writeFileImpl, reportOutput, summary);
  }

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runExtractSupabaseMcpRowsFromSession().then((summary) => {
    console.error(`Extracted ${summary.row_count} Supabase MCP rows from ${summary.chunk_count} chunks.`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
