#!/usr/bin/env node
// Build the catalog field vocabulary artifact.
//
//   node scripts/build-catalog-field-vocabulary.mjs [--out <path>] [--min-count 2]
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
//
// Row-level catalog retrieval cannot serve newly released cards: the row does
// not exist yet. Field vocabulary can, because the wording is shared across a
// release. This turns the 14k AUTO_PARSED_FROM_VERIFIED_TITLE rows -- weak as
// identity records, but parsed from human-verified sale titles -- into the
// primary source of new-release wording, with official checklists supplying the
// authoritative tier.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  extractFinishTerms,
  mergeVocabularyEntries,
  normalizeTerm,
  vocabularySourceTiers
} from "../lib/listing/catalog/field-vocabulary.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

const OFFICIAL_SOURCE_TYPES = new Set([
  "TOPPS_OFFICIAL_CHECKLIST",
  "PANINI_OFFICIAL_CHECKLIST",
  "UPPER_DECK_OFFICIAL_CHECKLIST",
  "LEAF_OFFICIAL_CHECKLIST",
  "FUTERA_OFFICIAL_CHECKLIST",
  "BANDAI_ONE_PIECE_OFFICIAL_CARDLIST",
  "BANDAI_DIGIMON_OFFICIAL_CARDLIST",
  "BANDAI_BATTLE_SPIRITS_OFFICIAL_CARDLIST",
  "BANDAI_DBS_MASTERS_OFFICIAL_CARD_DATABASE",
  "BANDAI_DBS_FUSION_WORLD_OFFICIAL_CARD_DATABASE",
  "WOTC_GATHERER_OFFICIAL_DATABASE"
]);

async function fetchAllRows({ baseUrl, key, pageSize = 1000 }) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL("/rest/v1/catalog_cards", baseUrl);
    url.searchParams.set("select", "canonical_title,product,set_or_insert,subset,season_year,source_id");
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url, {
      headers: { apikey: key, authorization: `Bearer ${key}` }
    });
    if (!response.ok) throw new Error(`catalog_cards read failed: ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// PostgREST caps a response at 1000 rows regardless of `limit`, and there is
// roughly one source row per imported title, so this must page like the cards
// read does. Reading only the first page silently demoted every official
// source past it to the marketplace tier.
async function fetchSources({ baseUrl, key, pageSize = 1000 }) {
  const byId = new Map();
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL("/rest/v1/catalog_sources", baseUrl);
    url.searchParams.set("select", "id,source_type");
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error(`catalog_sources read failed: ${response.status}`);
    const page = await response.json();
    for (const row of page) byId.set(row.id, row.source_type);
    if (page.length < pageSize) return byId;
  }
}

export function vocabularyEntriesFromRows(rows = [], sourceTypeById = new Map()) {
  const entries = [];
  for (const row of rows) {
    const sourceType = sourceTypeById.get(row.source_id) || "";
    const official = OFFICIAL_SOURCE_TYPES.has(sourceType);
    const tier = official ? vocabularySourceTiers.OFFICIAL : vocabularySourceTiers.VERIFIED_TITLE;
    const years = row.season_year ? [row.season_year] : [];

    // Official rows carry structured set/insert names; verified titles carry
    // the finish wording that no checklist has published yet.
    for (const [field, value] of [["product", row.product], ["insert", row.set_or_insert], ["insert", row.subset]]) {
      const term = normalizeTerm(value);
      if (term && term.length > 2) entries.push({ field, term, count: 1, tier, years });
    }
    for (const term of extractFinishTerms(row.canonical_title || "")) {
      entries.push({ field: "print_finish", term, count: 1, tier, years });
    }
  }
  return entries;
}

export async function main(argv = process.argv.slice(2)) {
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

  const minCount = Math.max(1, Number(argValue(argv, "--min-count", "2")) || 2);
  const outPath = resolve(argValue(argv, "--out", "data/catalog/vocabulary/field-vocabulary.json"));

  const [sourceTypeById, rows] = await Promise.all([
    fetchSources({ baseUrl, key }),
    fetchAllRows({ baseUrl, key })
  ]);

  const merged = mergeVocabularyEntries(vocabularyEntriesFromRows(rows, sourceTypeById));
  // Official wording is kept at any frequency; marketplace wording needs
  // corroboration so a single mis-parsed title cannot mint vocabulary.
  const kept = merged.filter((entry) => entry.official || entry.count >= minCount);

  const byField = {};
  for (const entry of kept) (byField[entry.field] ||= []).push(entry);

  const artifact = {
    schema_version: "catalog-field-vocabulary-v1",
    generated_at: new Date().toISOString(),
    source_row_count: rows.length,
    min_verified_count: minCount,
    field_summary: Object.fromEntries(Object.entries(byField).map(([field, list]) => [field, {
      term_count: list.length,
      official_term_count: list.filter((entry) => entry.official).length
    }])),
    fields: byField
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(`catalog field vocabulary written: ${outPath}`);
  console.log(`  rows=${rows.length} kept_terms=${kept.length} (dropped ${merged.length - kept.length} below threshold)`);
  for (const [field, summary] of Object.entries(artifact.field_summary)) {
    console.log(`  ${field.padEnd(14)} ${String(summary.term_count).padStart(5)} terms (${summary.official_term_count} official)`);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
