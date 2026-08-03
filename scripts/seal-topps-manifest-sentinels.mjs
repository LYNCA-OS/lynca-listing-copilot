#!/usr/bin/env node
// Give every registered Topps source the sentinels the manifest contract
// requires, derived from what that source actually imported.
//
//   node scripts/seal-topps-manifest-sentinels.mjs           (dry run)
//   node scripts/seal-topps-manifest-sentinels.mjs --apply
//
// official-manifest-contract.mjs requires minimum_card_count and at least one
// required_record per source. Those are the guard against a silent import
// failure: when Topps reformats a PDF or the CDN starts serving an error page,
// the import still "succeeds" and quietly yields nothing, and only a declared
// expectation catches it. register-topps-harvest.mjs registered 204 sources
// without them, which both fails the suite and leaves those sources unguarded.
//
// The thresholds here are read back from the rows each source produced, so they
// are a REGRESSION guard, not evidence that the first import was correct: they
// assert "this source previously yielded at least N cards including this exact
// record", and fire when that stops being true. A source that imported nothing
// gets no sentinel and is reported, because inventing one would assert a
// coverage claim no import supports.
//
// The floor is set below the observed count so ordinary checklist revisions do
// not trip it; a real failure drops to zero, not by ten percent.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const MANIFEST = "data/catalog/official/topps-production-sources.json";
const FLOOR_RATIO = 0.5;

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function postgrest(base, key, path) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!response.ok) throw new Error(`http_${response.status}: ${(await response.text()).slice(0, 160)}`);
  return response.json();
}

export function sentinelFor({ cardCount, sample }) {
  if (!cardCount || !sample) return null;
  const record = {
    card_number: cleanText(sample.card_number),
    subject: cleanText(Array.isArray(sample.players) ? sample.players[0] : sample.players),
    product: cleanText(sample.product)
  };
  if (!record.card_number || !record.subject || !record.product) return null;
  return {
    minimum_card_count: Math.max(1, Math.floor(cardCount * FLOOR_RATIO)),
    required_records: [record]
  };
}

export async function main(argv = process.argv.slice(2)) {
  // No fallback ref: the literal that stood here named a project that was
  // decommissioned in the Sydney -> Singapore move, so an unset SUPABASE_URL
  // failed as DNS noise instead of as a misconfiguration.
  const base = cleanText(process.env.SUPABASE_URL);
  if (!base) throw new Error("SUPABASE_URL is required: there is no default project");
  const key = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const apply = argv.includes("--apply");
  // A source that never imported has no evidence behind it. Registering it
  // anyway claims coverage the catalog does not have, so drop it and let it be
  // re-added when an import actually proves it.
  const prune = argv.includes("--prune");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

  const manifest = JSON.parse(await readFile(resolve(MANIFEST), "utf8"));
  const sources = manifest.sources || [];
  const pending = sources.filter((s) => !s.minimum_card_count || !Array.isArray(s.required_records) || !s.required_records.length);
  console.log(`sources ${sources.length}, missing sentinels ${pending.length}`);

  // source_url -> source id
  const registered = new Map();
  for (let offset = 0; ; offset += 1000) {
    const page = await postgrest(base, key, `catalog_sources?select=id,source_url&limit=1000&offset=${offset}`);
    for (const row of page) registered.set(cleanText(row.source_url), row.id);
    if (page.length < 1000) break;
  }

  let sealed = 0;
  const unimported = [];
  for (const source of pending) {
    const id = registered.get(cleanText(source.source_url));
    if (!id) { unimported.push({ name: source.source_name, reason: "source_not_registered_in_database" }); continue; }

    const counted = await fetch(`${base}/rest/v1/catalog_cards?select=id&source_id=eq.${id}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" }
    });
    const cardCount = Number(cleanText(counted.headers.get("content-range")).split("/")[1] || 0);
    if (!cardCount) { unimported.push({ name: source.source_name, reason: "no_rows_imported" }); continue; }

    const [sample] = await postgrest(
      base, key,
      `catalog_cards?select=card_number,players,product&source_id=eq.${id}`
      + `&card_number=not.is.null&product=not.is.null&limit=1`
    );
    const sentinel = sentinelFor({ cardCount, sample });
    if (!sentinel) { unimported.push({ name: source.source_name, reason: "no_row_carries_a_full_record" }); continue; }

    Object.assign(source, sentinel);
    sealed += 1;
  }

  console.log(`  ${apply ? "sealed" : "would seal"}: ${sealed}`);
  console.log(`  cannot seal: ${unimported.length}`);
  for (const row of unimported.slice(0, 10)) console.log(`    ${row.reason.padEnd(34)} ${row.name}`);
  if (unimported.length > 10) console.log(`    ... and ${unimported.length - 10} more`);

  if (prune) {
    const drop = new Set(unimported.map((row) => row.name));
    manifest.sources = sources.filter((source) => !drop.has(source.source_name));
    console.log(`  pruned ${sources.length - manifest.sources.length} unproven sources -> ${manifest.sources.length} remain`);
  }
  if (apply) {
    await writeFile(resolve(MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`  written -> ${MANIFEST}`);
  }
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
