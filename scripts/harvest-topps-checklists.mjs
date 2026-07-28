#!/usr/bin/env node
// Harvest Topps checklists from the PDFs the manifest already proves.
//
//   node scripts/harvest-topps-checklists.mjs --limit 4 --out-dir /tmp/topps-cards
//   node scripts/harvest-topps-checklists.mjs --all
//
// Catalog work so far went to Panini because its selection API was the easiest
// thing to walk. Our own trade history says the volume is elsewhere: Topps
// Chrome 3,275 listings, Bowman Chrome 1,115, MTG Final Fantasy 854, Pokemon
// 454, against Panini 425. The index is strongest exactly where we trade least.
//
// Topps publishes a PDF per product, and the 66 sources in
// data/catalog/official/topps-production-sources.json are the ones an import
// has actually proved -- the other ~560 were dropped precisely because nothing
// proved them.
//
// The PDFs are tab-separated and carry a column Panini's API does not:
//
//   BASE
//   BASE CARDS
//   1<TAB>Kyler Murray<TAB>Arizona Cardinals
//
// That third column matters. 13,807 of the 14,056 auto-parsed catalog rows have
// no team, and an attempt to backfill it from titles was abandoned when the
// vocabulary proposed team="kylo ren" for a Star Wars insert. Here the team is
// stated by the manufacturer, on the same line as the card.
//
// Output matches the shape scripts/map-panini-harvest.mjs produces, so
// build-product-schemas.mjs consumes it without changes.

import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { extractPdfText } from "../lib/listing/catalog/pdf-text-extractor.mjs";

const MANIFEST = "data/catalog/official/topps-production-sources.json";
const DEFAULT_OUT = "/tmp/topps-cards";

function argValue(argv, name, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// "2025 Topps Chrome Black Football Checklist" -> year, product
export function parseSourceName(name = "") {
  const text = cleanText(name).replace(/\s*checklist\s*$/i, "");
  const year = (text.match(/^((?:19|20)\d{2}(?:-\d{2})?)/) || [])[1] || "";
  const product = cleanText(text.slice(year.length));
  return { season_year: year, product };
}

// A checklist line is a card when it starts with a card number and carries at
// least a name after it. Everything else is a set heading, a note, or the
// odds table -- headings are what tell us which set the following cards belong
// to, so they are tracked rather than discarded.
const CARD_LINE = /^([A-Za-z]{0,5}-?\d{1,5}[A-Za-z]?)\t(.+)$/;

// A dual-player card prints two names and no team:
//
//   6<TAB>Shohei Ohtani<TAB>Mookie Betts
//
// which is indistinguishable from `player<TAB>team` by position alone. Taking
// column two as the team put "aaron judge" and "cal raleigh" into Ohtani's team
// set in the constraint model, and a world engine that thinks a player is a
// team cannot narrow anything.
//
// The discriminator is roster breadth, not a team whitelist: a real team is
// shared by many players, while a co-player pairs with one. So a column-two
// value is a co-player when it is a known player name AND at most one distinct
// player in this checklist lists it as their team.
//
// `knownPlayers` must span every checklist, not just this one. A product like
// Dynamic Duals is entirely dual cards, so a name such as "Mookie Betts" never
// appears in column one there and a within-file test cannot see that it is a
// person at all -- which is exactly how it survived the first version of this
// fix and stayed in Ohtani's team set.
//
// "Japan" survives as a team because it is never a player name anywhere.
export function disambiguateTeams(rows = [], { knownPlayers = null } = {}) {
  const players = knownPlayers || new Set(rows.map((row) => norm(row.player)).filter(Boolean));
  const teamRosters = new Map();
  for (const row of rows) {
    const team = norm(row.team);
    if (!team) continue;
    if (!teamRosters.has(team)) teamRosters.set(team, new Set());
    teamRosters.get(team).add(norm(row.player));
  }
  return rows.map((row) => {
    const team = norm(row.team);
    if (!team) return row;
    const rosterSize = teamRosters.get(team)?.size || 0;
    if (players.has(team) && rosterSize <= 1) {
      // Column two named a person: keep them as a second subject, not a team.
      return { ...row, team: null, players: [row.player, row.team] };
    }
    return row;
  });
}

const norm = (value) => String(value ?? "").trim().toLowerCase();

export function parseChecklistText(text = "") {
  const rows = [];
  let currentSet = "Base";
  for (const rawLine of String(text).split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) continue;

    const card = line.match(CARD_LINE);
    if (card) {
      const parts = card[2].split("\t").map(cleanText).filter(Boolean);
      const [player, team] = parts;
      if (!player) continue;
      rows.push({
        set_or_insert: currentSet,
        card_number: cleanText(card[1]),
        player,
        team: team || null
      });
      continue;
    }

    // A heading has no tabs and no leading card number. Topps prints the set
    // name and then a descriptive line ("BASE" then "BASE CARDS"); the first is
    // the set, so a heading only replaces the current set when it is not simply
    // the previous heading with a suffix.
    if (!line.includes("\t") && line.length <= 70 && /[A-Za-z]/.test(line)) {
      const heading = cleanText(line);
      const normalized = heading.toLowerCase().replace(/\s+cards?$/i, "");
      if (normalized && normalized !== currentSet.toLowerCase()) currentSet = heading;
    }
  }
  // Frequency is only knowable once the whole checklist is parsed.
  return disambiguateTeams(rows);
}

// Group flat card rows into the set-grained shape map-panini-harvest.mjs emits.
export function toHarvestShape(rows = [], { season_year, product, sport }) {
  const bySet = new Map();
  for (const row of rows) {
    const key = row.set_or_insert;
    if (!bySet.has(key)) bySet.set(key, []);
    bySet.get(key).push({
      card_number: row.card_number,
      player: row.player,
      team: row.team,
      ...(row.players ? { players: row.players } : {})
    });
  }
  return [...bySet.entries()].map(([set_or_insert, cards]) => ({
    sport,
    season_year,
    manufacturer: "Topps",
    brand: "Topps",
    product,
    set_or_insert,
    cards
  }));
}

export async function main(argv = process.argv.slice(2)) {
  const outDir = argValue(argv, "--out-dir", DEFAULT_OUT);
  const limit = argv.includes("--all") ? Infinity : (Number(argValue(argv, "--limit", "4")) || 4);
  const filter = cleanText(argValue(argv, "--match", "")).toLowerCase();

  const manifest = JSON.parse(readFileSync(resolve(MANIFEST), "utf8"));
  let sources = (manifest.sources || []).filter((source) => /\.pdf(\?|$)/i.test(source.source_url));
  if (filter) sources = sources.filter((source) => source.source_name.toLowerCase().includes(filter));
  sources = sources.slice(0, limit === Infinity ? undefined : limit);

  await mkdir(resolve(outDir), { recursive: true });
  console.log(`sources to harvest: ${sources.length}\n`);

  let totalCards = 0;
  const failures = [];
  for (const source of sources) {
    const { season_year, product } = parseSourceName(source.source_name);
    try {
      const response = await fetch(source.source_url, { signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      // extractPdfText returns { text, page_count }, not a string.
      const extracted = await extractPdfText(buffer);
      const rows = parseChecklistText(extracted?.text ?? extracted);
      const shaped = toHarvestShape(rows, { season_year, product, sport: source.category || "unknown" });
      const cards = rows.length;
      totalCards += cards;

      const slug = source.source_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      await writeFile(resolve(outDir, `${slug}.json`), `${JSON.stringify({
        schema_version: "topps-checklist-harvest-v1",
        generated_at: new Date().toISOString(),
        source_name: source.source_name,
        source_url: source.source_url,
        season_year,
        product,
        sport: source.category || "unknown",
        set_count: shaped.length,
        card_count: cards,
        rows: shaped
      })}\n`, "utf8");

      const withTeam = rows.filter((row) => row.team).length;
      console.log(`  ${String(cards).padStart(5)} cards  ${String(shaped.length).padStart(3)} sets  team ${Math.round(100 * withTeam / (cards || 1))}%  ${source.source_name.slice(0, 46)}`);
    } catch (error) {
      failures.push({ source: source.source_name, reason: String(error?.message || error).slice(0, 80) });
      console.log(`  ${"FAILED".padStart(5)}                        ${source.source_name.slice(0, 46)}`);
    }
  }

  console.log(`\ntotal ${totalCards.toLocaleString()} cards from ${sources.length - failures.length}/${sources.length} sources -> ${outDir}`);
  for (const failure of failures) console.log(`  failed: ${failure.source} -- ${failure.reason}`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
