#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(".");
const LEDGER_PATH = resolve(ROOT, "docs/evaluation/combined-precision-loss-ledger-150-2026-08-02.json");
const DATASET_PATH = resolve("/Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-image-only.json");
const OUT_DIR = resolve(ROOT, "artifacts/second-writer-calibration-285-2026-08-02");
const PACKET_PATH = resolve(OUT_DIR, "blind-packet.json");
const SCORING_PATH = resolve(OUT_DIR, "hidden-scoring-map.json");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const ledgerBody = readFileSync(LEDGER_PATH, "utf8");
  const datasetBody = readFileSync(DATASET_PATH, "utf8");
  const ledger = JSON.parse(ledgerBody);
  const dataset = JSON.parse(datasetBody);
  const byId = new Map((dataset.items || []).map((item) => [item.asset_id, item]));
  const cards = [];
  const scoring = [];
  for (const card of ledger.cards || []) {
    const source = byId.get(card.asset_id);
    if (!source) throw new Error(`calibration_asset_missing:${card.asset_id}`);
    const disputes = (card.reference_absent_tokens || []).map((entry) => {
      const disputeId = `${card.asset_id}:${entry.id.split(":").at(-1)}`;
      const evidence = [
        ...(entry.candidate_fact_evidence || []),
        ...(entry.exhaustive_printed_evidence || [])
      ].map((fact) => ({
        value: fact.value || null,
        kind: fact.kind || null,
        basis: fact.basis || null,
        region: fact.region || null,
        image: fact.image || null
      }));
      scoring.push({
        dispute_id: disputeId,
        asset_id: card.asset_id,
        expected_reference_token: entry.token,
        expected_primary: entry.classification?.primary || null,
        expected_truth: entry.classification?.truth || null
      });
      return {
        dispute_id: disputeId,
        field: entry.field || null,
        field_value: entry.field_value || null,
        bracket: entry.bracket || null,
        semantic_category: entry.semantic_category || null,
        model_evidence: evidence,
        reviewer_options: ["VISIBLE_TRUE", "VISIBLE_FALSE", "OPTIONAL_TITLE", "REQUIRED_TITLE", "UNKNOWN"]
      };
    });
    if (disputes.length) {
      cards.push({
        asset_id: card.asset_id,
        card_ordinal: card.card_ordinal,
        grammar: card.grammar,
        images: (source.images || []).slice(0, 2),
        disputes
      });
    }
  }
  const disputeCount = cards.reduce((sum, card) => sum + card.disputes.length, 0);
  if (cards.length !== 117 || disputeCount !== 285) throw new Error(`calibration_count_mismatch:${cards.length}/${disputeCount}`);
  const packet = {
    schema_version: "second-writer-blind-calibration-packet-v1",
    authority: "human_review_required",
    production_promoted: false,
    writer_a_title_hidden: true,
    reference_title_hidden: true,
    instructions: [
      "Review the original card images without seeing Writer A's title or the sealed reference title.",
      "Judge only the disputed field/value/evidence in the context of the visible card.",
      "Use VISIBLE_TRUE only when the card visibly supports the value; use OPTIONAL_TITLE or REQUIRED_TITLE for title preference separately.",
      "Use UNKNOWN when the image does not settle the fact. Do not infer from biography or general world knowledge.",
      "A third reviewer should adjudicate explicit disagreements after Writer B completes the packet."
    ],
    source: {
      ledger_path: LEDGER_PATH,
      ledger_sha256: sha256(ledgerBody),
      image_dataset_path: DATASET_PATH,
      image_dataset_sha256: sha256(datasetBody),
      cards: cards.length,
      disputes: disputeCount
    },
    cards
  };
  writeFileSync(PACKET_PATH, `${JSON.stringify(packet, null, 2)}\n`);
  writeFileSync(SCORING_PATH, `${JSON.stringify({
    schema_version: "second-writer-blind-calibration-scoring-map-v1",
    packet_sha256: sha256(JSON.stringify(packet)),
    scoring
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ packet: PACKET_PATH, scoring_map: SCORING_PATH, cards: cards.length, disputes: disputeCount }, null, 2)}\n`);
}

main();
