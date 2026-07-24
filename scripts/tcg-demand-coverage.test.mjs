import assert from "node:assert/strict";
import {
  buildTcgDemandCoverage,
  classifyTcgDemandRow,
  extractTcgDemandCardCode,
  normalizeTcgCardCode,
  tcgDemandCoverageContract
} from "../lib/listing/catalog/tcg-demand-coverage-contract.mjs";

assert.equal(tcgDemandCoverageContract.writes_database, false);
assert.equal(tcgDemandCoverageContract.changes_catalog_decisions, false);
assert.deepEqual(classifyTcgDemandRow({ canonical_title: "2024 MTG Black Lotus" }), {
  status: "CLASSIFIED",
  family: "magic"
});
assert.deepEqual(classifyTcgDemandRow({ canonical_title: "1991 Hoops Magic Johnson #101" }), {
  status: "OUT_OF_SCOPE",
  family: null
});
assert.deepEqual(classifyTcgDemandRow({ canonical_title: "Dragon Ball Super Fusion World FB01-001" }), {
  status: "CLASSIFIED",
  family: "dragon_ball_fusion_world"
});
assert.equal(normalizeTcgCardCode("BT7079", "dragon_ball_masters"), "BT7-079");
assert.equal(normalizeTcgCardCode("BT31001_SPR", "dragon_ball_masters"), "BT31-001");
assert.equal(normalizeTcgCardCode("BT32001", "dragon_ball_masters"), null);
assert.deepEqual(extractTcgDemandCardCode({
  canonical_title: "Dragon Ball Super BT7079 Skillful Majin Buu"
}, "dragon_ball_masters"), {
  status: "MEASURABLE",
  origin: "TITLE_DIAGNOSTIC",
  card_code: "BT7-079"
});
assert.deepEqual(extractTcgDemandCardCode({
  canonical_title: "Dragon Ball Super BT20-098 and BT21-001 lot"
}, "dragon_ball_masters"), {
  status: "AMBIGUOUS",
  origin: "TITLE_DIAGNOSTIC",
  card_code: null
});

const sources = [
  { id: "reviewed-1", source_type: "INTERNAL_CORRECTED_TITLE", source_status: "REVIEWED_INTERNAL" },
  { id: "reviewed-2", source_type: "INTERNAL_CORRECTED_TITLE", source_status: "REVIEWED_INTERNAL" },
  { id: "reviewed-3", source_type: "INTERNAL_CORRECTED_TITLE", source_status: "REVIEWED_INTERNAL" },
  { id: "reviewed-rejected", source_type: "INTERNAL_CORRECTED_TITLE", source_status: "REVIEWED_INTERNAL" },
  { id: "dbs-official", source_type: "BANDAI_DBS_MASTERS_OFFICIAL_CARD_DATABASE", source_status: "OFFICIAL_CHECKLIST_RAW" },
  { id: "one-piece-discovered", source_type: "BANDAI_ONE_PIECE_OFFICIAL_CARDLIST", source_status: "OFFICIAL_SOURCE_DISCOVERED" }
];
const report = buildTcgDemandCoverage({
  sources,
  generatedAt: "2026-07-24T00:00:00.000Z",
  cards: [
    { id: "demand-1", source_id: "reviewed-1", source_status: "REVIEWED_INTERNAL", canonical_title: "Dragon Ball Super BT7079 Skillful Majin Buu" },
    { id: "demand-2", source_id: "reviewed-2", source_status: "REVIEWED_INTERNAL", canonical_title: "Dragon Ball Super BT20-098 and BT21-001 lot" },
    { id: "demand-3", source_id: "reviewed-3", source_status: "REVIEWED_INTERNAL", canonical_title: "One Piece OP01-120 Shanks" },
    { id: "rejected-demand", source_id: "reviewed-rejected", source_status: "REVIEWED_INTERNAL", review_status: "REJECTED", canonical_title: "Pokemon TCG Pikachu" },
    { id: "official-1", source_id: "dbs-official", source_status: "OFFICIAL_CHECKLIST_RAW", card_number: "BT7-079", checklist_code: "BT7-079_SPR" }
  ]
});

assert.equal(report.schema_version, "tcg-demand-coverage-v1");
assert.equal(report.summary.reviewed_internal_card_count, 3);
assert.equal(report.summary.classified_tcg_demand_count, 3);
assert.equal(report.summary.measurable_card_code_anchor_count, 2);
assert.equal(report.summary.card_code_match_count, 1);
assert.equal(report.summary.title_diagnostic_card_code_anchor_count, 2);
assert.equal(report.summary.ambiguous_card_code_anchor_count, 1);
const dragonBall = report.families.find((row) => row.family === "dragon_ball_masters");
assert.equal(dragonBall.directory_redundancy_state, "WRITER_AND_OFFICIAL");
assert.equal(dragonBall.coverage_state, "OFFICIAL_CARD_CODE_ANCHORS_COVERED");
assert.equal(dragonBall.card_code_match_rate, 1);
const onePiece = report.families.find((row) => row.family === "one_piece");
assert.equal(onePiece.source_operational_stage, "DISCOVERED");
assert.equal(onePiece.directory_redundancy_state, "WRITER_ONLY");
assert.equal(onePiece.coverage_state, "OFFICIAL_SOURCE_NOT_DECISION_ACTIVE");
assert.deepEqual(onePiece.unmatched_card_code_prefix_breakdown, [{ prefix: "OP01", count: 1 }]);
assert.equal(JSON.stringify(report).includes("Skillful Majin Buu"), false);
assert.equal(report.invariants.raw_writer_titles_emitted, false);

console.log("tcg demand coverage tests passed");
