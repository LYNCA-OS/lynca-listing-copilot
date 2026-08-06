#!/usr/bin/env node

// Build an append-only, source-versioned advisory graph from the checked-in
// official manifests. This is an asset build, not a runtime resolver: absent
// edges remain UNKNOWN and every edge carries its source fingerprint.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(".");
const OFFICIAL_DIR = resolve(ROOT, "data/catalog/official");
const OUT = resolve(ROOT, "artifacts/world-release-identity-graph-v1-2026-08-02.json");
const normal = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[®™©]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const edgeId = (edge) => sha256(JSON.stringify(edge));

function makeEdge({ manifestFile, manifest, source, record, predicate, objectType, objectValue }) {
  const manifestRaw = readFileSync(join(OFFICIAL_DIR, manifestFile));
  const sourceUrl = source.official_page_url || source.source_url || null;
  const releaseId = normal(source.source_name || manifestFile.replace(/-production-sources\.json$/, ""));
  const edge = {
    subject_type: "release",
    subject_normalized: releaseId,
    predicate,
    object_type: objectType,
    object_normalized: normal(objectValue),
    release_id: releaseId,
    valid_from: null,
    valid_to: null,
    category_or_ip: source.category || null,
    source_url: sourceUrl,
    source_sha256: sha256(manifestRaw),
    source_version: manifest.schema_version || null,
    evidence_type: "official_checklist_manifest",
    coverage_contract: "positive_support_only_absence_unknown",
    confidence: "official_manifest_unreviewed",
    adjudication_status: "advisory_only",
    literal: String(objectValue)
  };
  return { edge_id: edgeId(edge), ...edge, record_external_id: record.external_id || record.checklist_code || null };
}

function main() {
  const sources = [];
  const edges = [];
  for (const manifestFile of readdirSync(OFFICIAL_DIR).filter((file) => file.endsWith(".json")).sort()) {
    const raw = readFileSync(join(OFFICIAL_DIR, manifestFile));
    const manifest = JSON.parse(raw);
    sources.push({ file: relative(ROOT, join(OFFICIAL_DIR, manifestFile)), schema_version: manifest.schema_version || null, sha256: sha256(raw), source_count: (manifest.sources || []).length });
    for (const source of manifest.sources || []) {
      for (const record of source.required_records || []) {
        if (record.expected_import_status === "OFFICIAL_PARSE_REVIEW_REQUIRED") continue;
        const fields = [
          ["release_has_product", "product", record.product],
          ["release_has_set_or_insert", "set_or_insert", record.set_or_insert],
          ["release_has_parallel", "parallel_exact", record.parallel_exact],
          ["release_has_rarity", "rarity", record.rarity]
        ];
        for (const [predicate, objectType, objectValue] of fields) {
          if (objectValue != null && normal(objectValue).length > 1) {
            edges.push(makeEdge({ manifestFile, manifest, source, record, predicate, objectType, objectValue }));
          }
        }
      }
    }
  }
  const unique = [...new Map(edges.map((edge) => [edge.edge_id, edge])).values()];
  const summary = {
    manifests: sources.length,
    edges: unique.length,
    product_edges: unique.filter((edge) => edge.object_type === "product").length,
    set_edges: unique.filter((edge) => edge.object_type === "set_or_insert").length,
    parallel_edges: unique.filter((edge) => edge.object_type === "parallel_exact").length,
    rarity_edges: unique.filter((edge) => edge.object_type === "rarity").length,
    product_parallel_records: unique.filter((edge) => edge.predicate === "release_has_parallel" && unique.some((other) => other.release_id === edge.release_id && other.object_type === "product")).length
  };
  const graph = {
    schema_version: "source-versioned-release-identity-graph-v1",
    authority: "advisory_support_and_rank_only",
    production_promoted: false,
    prohibited_actions: ["generate_fact", "mutate_candidate", "hard_reject", "runtime_write"],
    coverage_contract: "positive_support_only_absence_unknown",
    sources,
    summary,
    edges: unique
  };
  writeFileSync(OUT, `${JSON.stringify(graph, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUT, schema_version: graph.schema_version, summary }, null, 2)}\n`);
}

main();

