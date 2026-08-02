#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const graph = JSON.parse(readFileSync("artifacts/world-release-identity-graph-v1-2026-08-02.json", "utf8"));
assert.equal(graph.schema_version, "source-versioned-release-identity-graph-v1");
assert.equal(graph.authority, "advisory_support_and_rank_only");
assert.equal(graph.production_promoted, false);
assert.ok(graph.edges.length > 0);
assert.ok(graph.edges.every((edge) => edge.edge_id && edge.source_sha256 && edge.source_version));
assert.ok(graph.edges.every((edge) => edge.coverage_contract === "positive_support_only_absence_unknown"));
assert.ok(graph.edges.every((edge) => edge.adjudication_status === "advisory_only"));
assert.equal(new Set(graph.edges.map((edge) => edge.edge_id)).size, graph.edges.length);
assert.ok(graph.summary.parallel_edges < graph.summary.product_edges);
console.log("source-versioned release identity graph v1 tests passed");

