#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditIndependentIdentityReviewPacket,
  buildIndependentIdentityReviewPacket
} from "../lib/listing/evaluation/independent-identity-truth.mjs";

function arg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

async function json(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function tsvCell(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/[\t\r\n]+/g, " ").trim();
}

function reviewTsv(packet = {}) {
  const columns = [
    "partition", "review_lane", "item_id", "label_status", "canonical_identity_id", "source_candidate_id",
    "year", "manufacturer", "product", "set", "subject", "card_number", "print_finish",
    "candidate_1_identity_id", "candidate_1_source_candidate_id", "candidate_1_source", "candidate_1_score",
    "candidate_2_identity_id", "candidate_2_source_candidate_id", "candidate_2_source", "candidate_2_score",
    "reviewed_by", "reviewed_at"
  ];
  const rows = (packet.items || []).map((item) => {
    const first = item.candidate_proposals?.[0] || {};
    const second = item.candidate_proposals?.[1] || {};
    return [
      item.partition, item.review_lane, item.item_id, item.label?.status, item.label?.canonical_identity_id,
      item.label?.source_candidate_id,
      item.label?.fields?.year, item.label?.fields?.manufacturer, item.label?.fields?.product,
      item.label?.fields?.set, item.label?.fields?.subject, item.label?.fields?.card_number,
      item.label?.fields?.print_finish, first.canonical_identity_id, first.source_candidate_id,
      first.source?.source_class, first.score, second.canonical_identity_id, second.source_candidate_id,
      second.source?.source_class, second.score,
      item.label?.reviewed_by, item.label?.reviewed_at
    ].map(tsvCell).join("\t");
  });
  return `${columns.join("\t")}\n${rows.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const packetPath = arg(argv, "--packet");
  const manifestPath = arg(argv, "--manifest");
  const catalogPath = arg(argv, "--catalog");
  const outputPath = resolve(arg(argv, "--out", ".local/oracle/independent-identity/review-packet.json"));
  const auditPath = resolve(arg(argv, "--audit-out", ".local/oracle/independent-identity/audit.json"));
  const tsvPath = resolve(arg(argv, "--tsv-out", outputPath.replace(/\.json$/i, ".tsv")));
  if (!packetPath || !manifestPath || !catalogPath) throw new Error("--packet, --manifest, and --catalog are required");
  const [packet, manifest, catalog] = await Promise.all([json(packetPath), json(manifestPath), json(catalogPath)]);
  const reviewPacket = buildIndependentIdentityReviewPacket(packet, manifest, catalog);
  const audit = auditIndependentIdentityReviewPacket(reviewPacket, catalog);
  await mkdir(dirname(tsvPath), { recursive: true });
  await Promise.all([
    writeJson(outputPath, reviewPacket),
    writeJson(auditPath, audit),
    writeFile(tsvPath, reviewTsv(reviewPacket))
  ]);
  console.log(JSON.stringify({ review_packet: outputPath, review_tsv: tsvPath, audit: auditPath, summary: reviewPacket.summary, gate: audit.gate }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
