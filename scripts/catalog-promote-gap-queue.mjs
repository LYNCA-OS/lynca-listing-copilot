// Dual-agreement gap-queue promotion pump.
//
// The gap queue is a CANDIDATE pool, not a data source: rows are single-model
// output with zero human confirmation. A row may enter the catalog only when
// two independent sources agree on identity:
//   machine half — the printed code read consistently across >= minRuns
//                  recognition runs (pre-aggregated in the input export)
//   human half   — a human-written title (sealed seller label or writer
//                  feedback) that contains the same player, and a compatible
//                  year when both sides carry one
// Everything else stays in the queue for human review. Promoted rows carry
// identity fields only, review_status REVIEW_REQUIRED (revocable), and full
// provenance in metadata.
//
// Usage:
//   node scripts/catalog-promote-gap-queue.mjs \
//     --gap data/eval/catalog-promotion/gap-stable-20260709.json \
//     --labels data/eval/ebay-reference/ebay-c100-sealed-labels-20260707.jsonl \
//     --out data/eval/catalog-promotion/promotion-20260709.sql
//
// Emits idempotent SQL (products find-or-create + cards insert-if-absent);
// apply it with service-role credentials. Rejected rows are listed with
// reasons on stderr so the human queue keeps full visibility.

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

function sqlQuote(value) {
  if (value === null || value === undefined || cleanText(String(value)) === "") return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
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
  if (!code) return { promote: false, reason: "no_printed_code" };
  if (Number(row.runs || 0) < minRuns) return { promote: false, reason: "insufficient_run_consensus" };
  if (!players.length) return { promote: false, reason: "no_players" };
  if (!title) return { promote: false, reason: "no_human_title" };

  const foldedTitle = foldDiacritics(title);
  const playerAgreed = players.some((player) => {
    const parts = foldDiacritics(player).split(" ").filter((part) => part.length > 1);
    return parts.length > 0 && parts.every((part) => foldedTitle.includes(part));
  });
  if (!playerAgreed) return { promote: false, reason: "player_not_in_human_title" };

  const modelYear = startYear(row.year);
  const humanYear = startYear(titleYear(title));
  if (modelYear && humanYear && modelYear !== humanYear) {
    return { promote: false, reason: `year_conflict_model_${modelYear}_title_${humanYear}` };
  }
  const year = cleanText(row.year) || titleYear(title);
  if (!year) return { promote: false, reason: "no_year_from_either_source" };

  // The product line is part of identity: a row without a recognizable
  // product (or whose only "product" is really an insert/subset name) stays
  // in the queue for a human. Set-name fallback is allowed only when the set
  // text itself names a real product line.
  const productLinePattern = /prizm|bowman|chrome|mosaic|select|optic|donruss|flawless|national treasures|contenders|hoops|dynasty|topps|encased|status|eminence|immaculate|obsidian|spectra|phoenix|absolute|certified|leaf|fleer|upper deck|wwe/i;
  const productText = cleanText(row.product) || "";
  const setText = cleanText(row.set_name) || "";
  if (!productText && !productLinePattern.test(setText)) {
    return { promote: false, reason: "no_recognizable_product_line" };
  }

  return {
    promote: true,
    year,
    year_source: cleanText(row.year) ? "recognition_consensus" : "seller_title",
    product_source: productText ? "recognition_consensus" : "set_name_fallback",
    players
  };
}

export async function main(argv = process.argv) {
  const gapPath = argValue(argv, "--gap");
  const labelsPath = argValue(argv, "--labels");
  const outPath = argValue(argv, "--out", "data/eval/catalog-promotion/promotion.sql");
  const minRuns = Number(argValue(argv, "--min-runs", "2"));
  if (!gapPath || !labelsPath) throw new Error("--gap and --labels are required");

  const gapRows = JSON.parse(await readFile(gapPath, "utf8"));
  const labels = new Map();
  for (const line of (await readFile(labelsPath, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    labels.set(row.case_id || row.key, cleanText(row.title));
  }

  const promoted = [];
  const rejected = [];
  for (const row of gapRows) {
    const caseId = String(row.asset_id || "").replace(/^ebay_image_only_/, "");
    const sellerTitle = labels.get(caseId) || "";
    const verdict = evaluateGapRow(row, sellerTitle, { minRuns });
    if (!verdict.promote) {
      rejected.push({ asset_id: row.asset_id, code: row.code, reason: verdict.reason });
      continue;
    }
    const players = verdict.players;
    const product = cleanText(row.product || row.set_name || "").replace(/^(19|20)\d{2}(-\d{2})?\s+/, "") || "Unknown Product";
    promoted.push({
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

  const productValues = [...new Map(promoted.map((card) => [
    `${card.product}::${card.year}`,
    `  (${sqlQuote(card.sport)}, ${sqlQuote(card.year)}, ${sqlQuote(card.manufacturer)}, ${sqlQuote(card.product)})`
  ])).values()].join(",\n");

  const cardValues = promoted.map((card) => [
    sqlQuote(card.sport), sqlQuote(card.year), sqlQuote(card.manufacturer), sqlQuote(card.product),
    sqlQuote(card.set_or_insert),
    `array[${card.players.map(sqlQuote).join(",")}]`,
    sqlQuote(card.team), sqlQuote(card.card_number), sqlQuote(card.checklist_code),
    sqlQuote(card.canonical_title), sqlQuote(card.asset_id), String(card.runs), sqlQuote(card.year_source)
  ].join(", ")).map((row) => `  (${row})`).join(",\n");

  const sql = `-- dual_agreement_auto_v1 gap-queue promotion (generated ${new Date().toISOString()})
insert into catalog_products (sport, season_year, manufacturer, product, source_status, review_status, metadata)
select v.sport, v.season_year, v.manufacturer, v.product, 'AUTO_PARSED_FROM_VERIFIED_TITLE', 'REVIEW_REQUIRED',
       jsonb_build_object('promotion','dual_agreement_auto_v1','promoted_at', now())
from (values
${productValues}
) v(sport, season_year, manufacturer, product)
where not exists (
  select 1 from catalog_products p
  where p.product = v.product and coalesce(p.season_year,'') = v.season_year
);

with card_rows as (
  select * from (values
${cardValues}
  ) v(sport, season_year, manufacturer, product, set_or_insert, players, team, card_number, checklist_code, canonical_title, asset_id, consensus_runs, year_source)
)
insert into catalog_cards (
  product_id, sport, season_year, manufacturer, brand, product, set_or_insert,
  players, team, card_number, checklist_code, observable_components,
  canonical_title, source_status, review_status, metadata
)
select distinct on (c.canonical_title)
  p.id, c.sport, c.season_year, c.manufacturer, c.manufacturer, c.product, c.set_or_insert,
  c.players, c.team, c.card_number, c.checklist_code, '{}'::text[],
  c.canonical_title, 'AUTO_PARSED_FROM_VERIFIED_TITLE', 'REVIEW_REQUIRED',
  jsonb_build_object(
    'promotion', 'dual_agreement_auto_v1',
    'agreement_sources', jsonb_build_array('multi_run_recognition_consensus', 'seller_title_player_year'),
    'source_asset_id', c.asset_id,
    'consensus_runs', c.consensus_runs,
    'year_source', c.year_source,
    'promoted_at', now(),
    'identity_fields_only', true
  )
from card_rows c
join catalog_products p
  on p.product = c.product and coalesce(p.season_year,'') = c.season_year
where not exists (
  select 1 from catalog_cards cc
  where cc.players && c.players
    and catalog_years_compatible(c.season_year, cc.season_year)
    and (
      upper(coalesce(cc.checklist_code,'')) = upper(coalesce(c.checklist_code, c.card_number))
      or upper(coalesce(cc.card_number,'')) = upper(coalesce(c.card_number, c.checklist_code))
    )
)
order by c.canonical_title, p.created_at desc
returning id, canonical_title;
`;

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, sql, "utf8");
  process.stderr.write(`promoted=${promoted.length} rejected=${rejected.length}\n`);
  for (const reject of rejected) {
    process.stderr.write(`  REJECT ${reject.asset_id} code=${reject.code} reason=${reject.reason}\n`);
  }
  process.stderr.write(`sql written to ${outPath}\n`);
  return { promoted, rejected, outPath };
}

if (process.argv[1] && process.argv[1].endsWith("catalog-promote-gap-queue.mjs")) {
  main().catch((error) => {
    console.error(`catalog-promote-gap-queue failed: ${error.message}`);
    process.exit(1);
  });
}
