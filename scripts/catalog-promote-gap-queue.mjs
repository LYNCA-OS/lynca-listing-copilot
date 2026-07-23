// Legacy-named gap-queue review packet builder.
//
// The gap queue is a CANDIDATE pool, not a data source: rows are single-model
// output with zero human confirmation. Recognition consensus plus an eBay
// seller title is not independent ground truth and must not write catalog
// products, sets, cards, or parallels. This command therefore emits a review
// packet only:
//   machine half — the printed code read consistently across >= minRuns
//                  recognition runs (pre-aggregated in the input export)
//   market hint  — an eBay seller title that contains the same player, and a
//                  compatible year when both sides carry one
// Every row stays outside the catalog until a real reviewed-internal workflow
// confirms it. The old direct SQL promotion behavior is intentionally retired.
//
// Usage:
//   node scripts/catalog-promote-gap-queue.mjs \
//     --gap data/eval/catalog-promotion/gap-stable-20260709.json \
//     --labels data/eval/ebay-reference/ebay-c100-sealed-labels-20260707.jsonl \
//     --out data/eval/catalog-promotion/review-packet-20260709.json
//
// Emits JSON only. It never emits executable SQL.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function foldDiacritics(value) {
  return cleanText(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function playersFrom(row) {
  try {
    const parsed = JSON.parse(row.players || "[]");
    if (Array.isArray(parsed)) return parsed.map(cleanText).filter(Boolean);
  } catch {
    // fall through
  }
  return cleanText(row.players) ? [cleanText(row.players)] : [];
}

function startYear(value) {
  return (cleanText(value).match(/(19|20)\d{2}/) || [""])[0];
}

function titleYear(title) {
  return (cleanText(title).match(/(19|20)\d{2}(?:-\d{2})?/) || [""])[0];
}

function sportFor(row, sellerTitle) {
  const haystack = foldDiacritics(`${row.product || ""} ${row.set_name || ""} ${sellerTitle}`);
  if (/wwe|wrestl/.test(haystack)) return "wrestling";
  if (/basketball|prizm basketball|nba|hoops|mosaic basketball/.test(haystack)) return "basketball";
  if (/football|nfl|gridiron/.test(haystack)) return "football";
  if (/baseball|bowman|topps chrome|mlb|dynasty/.test(haystack)) return "baseball";
  if (/soccer|fifa|world cup/.test(haystack)) return "soccer";
  return "other";
}

export function evaluateGapRow(row, sellerTitle, { minRuns = 2 } = {}) {
  const players = playersFrom(row);
  const code = cleanText(row.code);
  const title = cleanText(sellerTitle);
  if (!code) return { review_candidate: false, reason: "no_printed_code" };
  if (Number(row.runs || 0) < minRuns) return { review_candidate: false, reason: "insufficient_run_consensus" };
  if (!players.length) return { review_candidate: false, reason: "no_players" };
  if (!title) return { review_candidate: false, reason: "no_marketplace_title" };

  const foldedTitle = foldDiacritics(title);
  const playerAgreed = players.some((player) => {
    const parts = foldDiacritics(player).split(" ").filter((part) => part.length > 1);
    return parts.length > 0 && parts.every((part) => foldedTitle.includes(part));
  });
  if (!playerAgreed) return { review_candidate: false, reason: "player_not_in_marketplace_title" };

  const modelYear = startYear(row.year);
  const humanYear = startYear(titleYear(title));
  if (modelYear && humanYear && modelYear !== humanYear) {
    return { review_candidate: false, reason: `year_conflict_model_${modelYear}_title_${humanYear}` };
  }
  const year = cleanText(row.year) || titleYear(title);
  if (!year) return { review_candidate: false, reason: "no_year_from_either_source" };

  // The product line is part of identity: a row without a recognizable
  // product (or whose only "product" is really an insert/subset name) stays
  // in the queue for a human. Set-name fallback is allowed only when the set
  // text itself names a real product line.
  const productLinePattern = /prizm|bowman|chrome|mosaic|select|optic|donruss|flawless|national treasures|contenders|hoops|dynasty|topps|encased|status|eminence|immaculate|obsidian|spectra|phoenix|absolute|certified|leaf|fleer|upper deck|wwe/i;
  const productText = cleanText(row.product) || "";
  const setText = cleanText(row.set_name) || "";
  if (!productText && !productLinePattern.test(setText)) {
    return { review_candidate: false, reason: "no_recognizable_product_line" };
  }

  return {
    review_candidate: true,
    year,
    year_source: cleanText(row.year) ? "recognition_consensus" : "marketplace_title",
    product_source: productText ? "recognition_consensus" : "set_name_fallback",
    players
  };
}

export async function main(argv = process.argv) {
  const gapPath = argValue(argv, "--gap");
  const labelsPath = argValue(argv, "--labels");
  const outPath = argValue(argv, "--out", "data/eval/catalog-promotion/review-packet.json");
  const minRuns = Number(argValue(argv, "--min-runs", "2"));
  if (!gapPath || !labelsPath) throw new Error("--gap and --labels are required");

  const gapRows = JSON.parse(await readFile(gapPath, "utf8"));
  const labels = new Map();
  for (const line of (await readFile(labelsPath, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    labels.set(row.case_id || row.key, cleanText(row.title));
  }

  const reviewCandidates = [];
  const rejected = [];
  for (const row of gapRows) {
    const caseId = String(row.asset_id || "").replace(/^ebay_image_only_/, "");
    const sellerTitle = labels.get(caseId) || "";
    const verdict = evaluateGapRow(row, sellerTitle, { minRuns });
    if (!verdict.review_candidate) {
      rejected.push({ asset_id: row.asset_id, code: row.code, reason: verdict.reason });
      continue;
    }
    const players = verdict.players;
    const product = cleanText(row.product || row.set_name || "").replace(/^(19|20)\d{2}(-\d{2})?\s+/, "") || "Unknown Product";
    reviewCandidates.push({
      sport: sportFor(row, sellerTitle),
      year: verdict.year,
      year_source: verdict.year_source,
      manufacturer: cleanText(row.manufacturer) || null,
      product,
      set_or_insert: cleanText(row.set_name) && cleanText(row.set_name) !== product ? cleanText(row.set_name) : null,
      players,
      team: cleanText(row.team) || null,
      card_number: cleanText(row.collector_number || row.code),
      checklist_code: cleanText(row.checklist_code) || null,
      canonical_title: `${verdict.year} ${product} ${players.join(" / ")} #${cleanText(row.code)}`,
      asset_id: row.asset_id,
      runs: Number(row.runs || 0),
      seller_title: sellerTitle
    });
  }

  const packet = {
    schema_version: "catalog-gap-review-packet-v1",
    generated_at: new Date().toISOString(),
    source_type: "MARKETPLACE_REFERENCE",
    catalog_write_allowed: false,
    independent_ground_truth: false,
    required_next_action: "REVIEWED_INTERNAL_CONFIRMATION",
    candidate_count: reviewCandidates.length,
    rejected_count: rejected.length,
    candidates: reviewCandidates.map((candidate) => ({
      ...candidate,
      candidate_status: "REVIEW_REQUIRED",
      catalog_write_allowed: false,
      provenance: {
        recognition_consensus: true,
        marketplace_title: true,
        reviewed_internal: false
      }
    })),
    rejected
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  process.stderr.write(`review_candidates=${reviewCandidates.length} rejected=${rejected.length}\n`);
  for (const reject of rejected) {
    process.stderr.write(`  REJECT ${reject.asset_id} code=${reject.code} reason=${reject.reason}\n`);
  }
  process.stderr.write(`review packet written to ${outPath}\n`);
  return { packet, reviewCandidates, rejected, outPath };
}

if (process.argv[1] && process.argv[1].endsWith("catalog-promote-gap-queue.mjs")) {
  main().catch((error) => {
    console.error(`catalog-promote-gap-queue failed: ${error.message}`);
    process.exit(1);
  });
}
