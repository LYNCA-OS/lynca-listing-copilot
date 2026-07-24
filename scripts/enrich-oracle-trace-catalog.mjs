#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value) {
  return String(value ?? "").trim();
}

function values(value) {
  return Array.isArray(value) ? value.filter((entry) => clean(entry)) : (clean(value) ? [value] : []);
}

function unique(items) {
  return [...new Map(items.map((item) => [clean(item).toLowerCase(), item])).values()];
}

export function enrichOracleTraceCatalog(trace = {}, catalogRows = []) {
  const catalogById = new Map(catalogRows.map((row) => [clean(row.identity_id).toLowerCase(), row]));
  let enrichedCandidateCount = 0;
  const cards = (trace.cards || []).map((card) => ({
    ...card,
    retrieval_candidates: (card.retrieval_candidates || []).map((candidate) => {
      const row = catalogById.get(clean(candidate.identity_id).toLowerCase());
      if (!row) return candidate;
      enrichedCandidateCount += 1;
      const fields = {
        ...row.fields,
        ...candidate.fields,
        subject: unique([...values(row.fields?.subject), ...values(candidate.fields?.subject)]),
        print_finish: unique([...values(row.fields?.print_finish), ...values(candidate.fields?.print_finish), ...values(candidate.fields?.parallel_exact)]),
        serial_denominator: unique([...values(row.fields?.serial_denominator), ...values(candidate.fields?.serial_denominator)]),
        numerical_rarity: unique([
          ...values(candidate.fields?.numerical_rarity),
          ...values(row.fields?.serial_denominator).map((value) => `#/${value}`)
        ])
      };
      return { ...candidate, fields, catalog_provenance: row.provenance || null };
    })
  }));
  return {
    ...trace,
    schema_version: "v4-chain-oracle-trace-catalog-enriched-v1",
    catalog_enrichment: {
      catalog_row_count: catalogRows.length,
      enriched_candidate_count: enrichedCandidateCount
    },
    cards
  };
}

export function catalogRowsFromSnapshot(snapshot = {}) {
  return (snapshot.cards || []).map((card) => ({
    identity_id: card.id,
    fields: {
      year: card.season_year,
      manufacturer: card.manufacturer,
      product: card.product,
      set: card.set_or_insert || card.subset,
      subject: card.players,
      card_name: card.metadata?.catalog_fields?.card_name || card.metadata?.card_name || card.official_card_type,
      card_number: card.card_number || card.checklist_code,
      print_finish: unique([
        ...values(card.metadata?.catalog_fields?.parallel_exact),
        ...values(card.metadata?.catalog_fields?.parallel_name),
        ...values(card.surface_color)
      ]),
      serial_denominator: values(card.serial_denominator)
    },
    provenance: {
      source_id: card.source_id || card.source?.id || null,
      source_type: card.source?.source_type || null,
      source_name: card.source?.source_name || null,
      source_status: card.source_status || null,
      review_status: card.review_status || null,
      snapshot_schema_version: snapshot.schema_version || null,
      snapshot_generated_at: snapshot.generated_at || null
    }
  }));
}

function catalogQuery(ids) {
  const literals = ids.map((id) => `'${id}'::uuid`).join(",");
  return `
    with requested(id) as (select unnest(array[${literals}])),
    parallel as (
      select catalog_card_id,
        array_remove(array_agg(distinct coalesce(parallel_exact, parallel_family, surface_color)), null) as finishes,
        array_remove(array_agg(distinct expected_serial_denominator), null) as denominators
      from public.catalog_parallels where catalog_card_id in (select id from requested) group by catalog_card_id
    )
    select coalesce(json_agg(json_build_object(
      'identity_id', c.id,
      'fields', json_build_object(
        'year', c.season_year,
        'manufacturer', c.manufacturer,
        'product', c.product,
        'set', coalesce(c.set_or_insert, c.subset),
        'subject', case
          when cardinality(c.players) > 0 then to_jsonb(c.players)
          else coalesce(c.metadata #> '{catalog_fields,subject}', '[]'::jsonb)
        end,
        'card_number', coalesce(c.card_number, c.checklist_code),
        'print_finish', coalesce(to_jsonb(p.finishes), to_jsonb(array_remove(array[c.surface_color], null))),
        'serial_denominator', coalesce(to_jsonb(p.denominators), to_jsonb(array_remove(array[c.serial_denominator], null)))
      ),
      'provenance', json_build_object('source_id', c.source_id, 'source_status', c.source_status, 'review_status', c.review_status)
    )), '[]'::json)::text
    from public.catalog_cards c left join parallel p on p.catalog_card_id = c.id
    where c.id in (select id from requested);
  `;
}

function loadCatalogRows(trace, env = process.env) {
  const ids = unique((trace.cards || []).flatMap((card) => (
    (card.retrieval_candidates || []).map((candidate) => clean(candidate.identity_id).toLowerCase())
  )).filter((id) => uuidPattern.test(id)));
  if (!ids.length) return [];
  const databaseUrl = clean(env.DATABASE_URL || env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL);
  if (!databaseUrl) throw new Error("DATABASE_URL or POSTGRES_URL is required");
  const result = spawnSync("psql", [databaseUrl, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", catalogQuery(ids)], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`catalog snapshot query failed: ${clean(result.stderr)}`);
  return JSON.parse(clean(result.stdout) || "[]");
}

function arg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const inputPath = arg(argv, "--trace");
  const outputPath = resolve(arg(argv, "--out", ".local/oracle/catalog-enriched-trace.json"));
  if (!inputPath) throw new Error("--trace is required");
  const trace = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const snapshotPath = arg(argv, "--catalog-snapshot");
  const catalogRows = snapshotPath
    ? catalogRowsFromSnapshot(JSON.parse(await readFile(resolve(snapshotPath), "utf8")))
    : loadCatalogRows(trace, env);
  const output = enrichOracleTraceCatalog(trace, catalogRows);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ output: outputPath, ...output.catalog_enrichment }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
