#!/usr/bin/env node
// Measure what can actually be recovered from the thin
// AUTO_PARSED_FROM_VERIFIED_TITLE rows, before writing anything.
//
//   node scripts/measure-thin-row-backfill.mjs --out /tmp/thin-backfill.json
//
// These rows carry a full canonical_title but almost nothing else: 96% have no
// set_or_insert and 98% no team. The title is the only evidence, so a field is
// only recoverable when the title contains wording that an official checklist
// already attests -- inventing wording from a marketplace title is how the
// catalog acquired its "peyton manning lava" entries in the first place.
//
// Two exclusions are load-bearing:
//   * 29% of the rows are multi-card lots ("... /175 /199 /250 lotx3"), whose
//     title describes several different cards. Parsing one identity out of them
//     manufactures a catalog row that matches nothing.
//   * card_number is not recoverable at all: exactly one row in 14,056 carries
//     a "#NN" pattern. These titles simply do not print card numbers.
//
// This script only measures and proposes. It writes no rows.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const PAGE = 1_000;

// Sports where a team is part of the card's identity. Everything else (TCG,
// entertainment, non-sports) stores something else in that column entirely.
const TEAM_SPORTS = new Set(["football", "basketball", "baseball", "hockey", "soccer"]);

function argValue(argv, name, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const norm = (value) => cleanText(value).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function isMultiCardLot(title = "") {
  return /\blotx\s*\d/i.test(String(title));
}

// Sealed product is not a card. "2025 Topps Baseball Series 1 & 2 Base Set
// 1-703 Complete Factory Box #1" is a box, and giving it a set_or_insert turns
// a product listing into a catalog identity that no single card can match.
export function isSealedProduct(title = "") {
  return /\b(?:complete factory box|factory box|factory set|sealed (?:box|case|pack)|hobby box|blaster box|booster box|\d+\s*packs?)\b/i
    .test(String(title));
}

// PostgREST caps a response at 1000 rows whatever `limit` says, so every read
// here has to page or it silently truncates.
async function fetchAll(base, key, path, { select, filter = "", pageSize = PAGE } = {}) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = `${base}/rest/v1/${path}?select=${encodeURIComponent(select)}${filter}`
      + `&limit=${pageSize}&offset=${offset}`;
    const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error(`${path} http_${response.status}: ${(await response.text()).slice(0, 200)}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

// A phrase is only usable if an official checklist attests it, and single words
// are too weak to attest a set ("Gold" alone matches half the corpus).
export function attestedPhrases(officialRows = [], field = "set_or_insert", { minWords = 2 } = {}) {
  const counts = new Map();
  for (const row of officialRows) {
    const phrase = norm(row[field]);
    if (!phrase) continue;
    if (phrase.split(" ").length < minWords) continue;
    counts.set(phrase, (counts.get(phrase) || 0) + 1);
  }
  return counts;
}

// Longest attested phrase contained in the title wins; a longer phrase is a
// more specific claim than any of the shorter ones inside it.
export function bestPhraseMatch(title = "", phrases = new Map()) {
  const haystack = ` ${norm(title)} `;
  let best = "";
  for (const phrase of phrases.keys()) {
    if (phrase.length <= best.length) continue;
    if (haystack.includes(` ${phrase} `)) best = phrase;
  }
  return best;
}

export async function main(argv = process.argv.slice(2)) {
  // No fallback ref: the literal that stood here named a project that was
  // decommissioned in the Sydney -> Singapore move, so an unset SUPABASE_URL
  // failed as DNS noise instead of as a misconfiguration.
  const base = cleanText(argValue(argv, "--url", process.env.SUPABASE_URL));
  if (!base) throw new Error("SUPABASE_URL or --url is required: there is no default project");
  const key = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const outPath = argValue(argv, "--out", "");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

  process.stderr.write("reading thin rows...\n");
  const thin = await fetchAll(base, key, "catalog_cards", {
    select: "id,canonical_title,players,team,set_or_insert,card_number,product,season_year,sport",
    filter: "&source_status=eq.AUTO_PARSED_FROM_VERIFIED_TITLE"
  });
  process.stderr.write(`  ${thin.length} thin rows\n`);

  process.stderr.write("reading official vocabulary...\n");
  const official = await fetchAll(base, key, "catalog_cards", {
    select: "set_or_insert,team,sport",
    filter: "&source_status=eq.OFFICIAL_CHECKLIST_RAW"
  });
  process.stderr.write(`  ${official.length} official rows\n`);

  const setPhrases = attestedPhrases(official, "set_or_insert", { minWords: 2 });
  // The team column on non-sports products holds character names, so an
  // unrestricted vocabulary proposes team="kylo ren" for a Star Wars insert.
  // Teams are only meaningful within the sports that have them, on both sides.
  const teamPhrases = attestedPhrases(
    official.filter((row) => TEAM_SPORTS.has(cleanText(row.sport).toLowerCase())),
    "team",
    { minWords: 2 }
  );
  process.stderr.write(`  attested: ${setPhrases.size} set phrases, ${teamPhrases.size} team phrases\n`);

  const lots = thin.filter((row) => isMultiCardLot(row.canonical_title));
  const sealed = thin.filter((row) => !isMultiCardLot(row.canonical_title) && isSealedProduct(row.canonical_title));
  const eligible = thin.filter((row) => !isMultiCardLot(row.canonical_title) && !isSealedProduct(row.canonical_title));

  const proposals = [];
  for (const row of eligible) {
    const proposed = {};
    if (!cleanText(row.set_or_insert)) {
      const match = bestPhraseMatch(row.canonical_title, setPhrases);
      if (match) proposed.set_or_insert = match;
    }
    if (Object.keys(proposed).length) {
      proposals.push({ id: row.id, canonical_title: row.canonical_title, sport: row.sport, proposed });
    }
  }

  const setFills = proposals.filter((p) => p.proposed.set_or_insert).length;
  const teamFills = proposals.filter((p) => p.proposed.team).length;
  const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "0.0");

  console.log(`\nthin rows                     ${thin.length}`);
  console.log(`  multi-card lots (excluded)  ${lots.length}  (${pct(lots.length, thin.length)}%)`);
  console.log(`  sealed product (excluded)   ${sealed.length}  (${pct(sealed.length, thin.length)}%)`);
  console.log(`  eligible                    ${eligible.length}`);
  console.log(`\nrows with at least one fill   ${proposals.length}  (${pct(proposals.length, eligible.length)}% of eligible)`);
  console.log(`  set_or_insert               ${setFills}  (${pct(setFills, eligible.length)}%)`);

  console.log(`\nsample proposals:`);
  for (const p of proposals.slice(0, 15)) {
    const parts = Object.entries(p.proposed).map(([k, v]) => `${k}="${v}"`).join(" ");
    console.log(`  ${p.canonical_title.slice(0, 74).padEnd(76)} ${parts}`);
  }

  if (outPath) {
    await mkdir(dirname(resolve(outPath)), { recursive: true });
    await writeFile(resolve(outPath), `${JSON.stringify({
      schema_version: "thin-row-backfill-proposal-v1",
      generated_at: new Date().toISOString(),
      thin_row_count: thin.length,
      excluded_multi_card_lots: lots.length,
      excluded_sealed_product: sealed.length,
      eligible_count: eligible.length,
      proposals
    })}\n`, "utf8");
    console.log(`\nwrote ${proposals.length} proposals -> ${outPath}  (nothing written to the database)`);
  }
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
