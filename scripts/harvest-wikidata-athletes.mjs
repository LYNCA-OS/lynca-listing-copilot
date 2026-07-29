#!/usr/bin/env node
// Harvest career team history from Wikidata.
//
//   node scripts/harvest-wikidata-athletes.mjs --names-file /tmp/subjects.txt
//   node scripts/harvest-wikidata-athletes.mjs --names "Kobe Bryant,Tom Brady"
//
// The world engine could answer the team for 49% of our highest-volume
// subjects and no more. Measured against production, the misses split into two
// causes and both are the same missing thing:
//
//   subject_not_in_model        Kobe, Jordan, Messi, Haaland, Saka. Panini
//                               checklists do not print a team, and Topps --
//                               which does -- is mostly baseball and football.
//   multiple_teams_in_career    Ohtani, Brady, Trae Young, LeBron. The year
//                               was read off the card and still could not
//                               choose, because player_team_years spans only
//                               2024-2026 while 49% of the cards we see are
//                               older than 2024.
//
// Neither is card knowledge. That Kobe Bryant played for the Lakers from 1996
// to 2016 is ordinary world knowledge, it is already written down, and it does
// not need a manufacturer to publish anything. Wikidata states it as P54
// (member of sports team) with P580/P582 start and end qualifiers, plus P641
// for the sport.
//
// Intervals, not year lists: "Lakers 1996-2016" is one row covering twenty-one
// seasons. A career fits in a few rows, which is why this stays a small table.
//
// P641 also closes the third gap. `sport` is currently populated on 0 of 4,695
// production sessions, so the enumerator can never answer EMPTY, and 39 Mickey
// Mouse cards were counted as missing a team rather than as having none.
//
// Ambiguity is preserved, never resolved by guessing. Two NFL players are named
// Josh Allen; a name matching several people yields several candidates and the
// enumerator must say UNKNOWN rather than pick.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ENDPOINT = "https://query.wikidata.org/sparql";
const DEFAULT_OUT = "/tmp/wikidata-athletes";
// Wikidata asks for a descriptive User-Agent and reasonable request rates.
const USER_AGENT = "lynca-listing-copilot/1.0 (trading-card catalog research)";
// Measured, not chosen: a 40-name batch fails with UND_ERR_CONNECT_TIMEOUT --
// the connection is refused before the query is even read -- while individual
// names return in 0.5-1.6s. Wikidata throttles at the connection level, so the
// answer is smaller batches with room between them, not a longer timeout.
const BATCH = 8;
const POLITE_MS = 2_000;
const ATTEMPTS = 4;

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const year = (value) => {
  const match = cleanText(value).match(/^(-?\d{4})/);
  return match ? Number(match[1]) : null;
};

// A card lists a person by the name printed on it, so the label is the join
// key. Escaped rather than interpolated raw: a quote in a name would otherwise
// break the query.
const sparqlString = (value) => `"${cleanText(value).replace(/["\\]/g, "\\$&")}"@en`;

// Exact label matching does not survive contact with real names. Matching
// `rdfs:label` against a name we title-cased ourselves missed LeBron James
// ("Lebron"), Christian McCaffrey ("Mccaffrey"), CeeDee Lamb, Ken Griffey Jr.,
// Patrick Mahomes II and Luka Dončić -- 13 of 59 subjects, and every one of
// them a name no casing rule can reconstruct.
//
// Wikidata's own entity search handles casing, diacritics, suffixes and
// alternate labels. It takes one name per call rather than a VALUES batch,
// which is the price of actually matching people.
export function buildSearchQuery(name = "") {
  return `SELECT ?name ?player ?playerLabel ?teamLabel ?start ?end ?sportLabel WHERE {
  BIND(${sparqlString(name)} AS ?name)
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:api "EntitySearch" .
    bd:serviceParam wikibase:endpoint "www.wikidata.org" .
    bd:serviceParam mwapi:search "${cleanText(name).replace(/["\\]/g, "\\$&")}" .
    bd:serviceParam mwapi:language "en" .
    ?player wikibase:apiOutputItem mwapi:item .
  }
  ?player p:P54 ?membership .
  ?membership ps:P54 ?team .
  OPTIONAL { ?membership pq:P580 ?start . }
  OPTIONAL { ?membership pq:P582 ?end . }
  OPTIONAL { ?player wdt:P641 ?sport . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 200`;
}

export function buildQuery(names = []) {
  return `SELECT ?name ?player ?playerLabel ?teamLabel ?start ?end ?sportLabel WHERE {
  VALUES ?name { ${names.map(sparqlString).join(" ")} }
  ?player rdfs:label ?name .
  ?player p:P54 ?membership .
  ?membership ps:P54 ?team .
  OPTIONAL { ?membership pq:P580 ?start . }
  OPTIONAL { ?membership pq:P582 ?end . }
  OPTIONAL { ?player wdt:P641 ?sport . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

async function runQuery(query, { fetchImpl = fetch, attempts = ATTEMPTS } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
        headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(90_000)
      });
      if (response.status === 429 || response.status >= 500) throw new Error(`sparql http_${response.status}`);
      if (!response.ok) throw new Error(`sparql http_${response.status}`);
      const body = await response.json();
      return body?.results?.bindings || [];
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      // A refused connection means backing off, not retrying immediately.
      await sleep(Math.min(20_000, 3_000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

// One row per (person, team, interval). The person's entity id is kept so two
// people sharing a name stay distinguishable -- there are two NFL Josh Allens,
// and collapsing them would invent a career neither of them had.
export function shapeRows(bindings = []) {
  const byName = new Map();
  for (const row of bindings) {
    const value = (key) => cleanText(row?.[key]?.value);
    const name = value("name");
    const team = value("teamLabel");
    if (!name || !team) continue;
    if (!byName.has(name)) byName.set(name, { name, entities: new Map() });
    const entity = value("player");
    const entry = byName.get(name);
    if (!entry.entities.has(entity)) {
      entry.entities.set(entity, { entity, sport: value("sportLabel") || null, teams: [] });
    }
    const person = entry.entities.get(entity);
    if (!person.sport && value("sportLabel")) person.sport = value("sportLabel");
    person.teams.push({ team, start: year(value("start")), end: year(value("end")) });
  }
  return [...byName.values()].map((entry) => ({
    name: entry.name,
    ambiguous: entry.entities.size > 1,
    people: [...entry.entities.values()]
  }));
}

export function chunk(items = [], size = BATCH) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const outDir = argValue(argv, "--out-dir", DEFAULT_OUT);
  const namesFile = argValue(argv, "--names-file", "");
  const inline = argValue(argv, "--names", "");

  let names = [];
  if (namesFile) {
    const text = await readFile(resolve(namesFile), "utf8");
    // Accepts a bare name per line, or the `name|count|sport|year` shape the
    // production export produces.
    names = text.split("\n").map((line) => cleanText(line.split("|")[0])).filter(Boolean);
  } else if (inline) {
    names = inline.split(",").map(cleanText).filter(Boolean);
  }
  // A card prints "Kobe Bryant", not "kobe bryant"; Wikidata labels are cased.
  // Entity search is case- and diacritic-tolerant, so the name goes as printed.
  names = [...new Set(names)];
  if (!names.length) throw new Error("--names-file or --names is required");

  await mkdir(resolve(outDir), { recursive: true });
  console.log(`subjects to look up: ${names.length}\n`);

  const all = [];
  let failures = 0;
  let unmatched = 0;
  for (const [index, name] of names.entries()) {
    try {
      const shaped = shapeRows(await runQuery(buildSearchQuery(name)));
      if (shaped.length) {
        all.push(...shaped);
        const people = shaped[0].people.length;
        const teams = shaped[0].people.reduce((sum, person) => sum + person.teams.length, 0);
        console.log(`  ${String(index + 1).padStart(3)}/${names.length}  ${name.slice(0, 26).padEnd(26)} ${people} person(s), ${teams} intervals`);
      } else {
        unmatched += 1;
        console.log(`  ${String(index + 1).padStart(3)}/${names.length}  ${name.slice(0, 26).padEnd(26)} no athlete match`);
      }
    } catch (error) {
      failures += 1;
      console.log(`  ${String(index + 1).padStart(3)}/${names.length}  ${name.slice(0, 26).padEnd(26)} FAILED ${String(error?.message || error).slice(0, 30)}`);
    }
    if (index < names.length - 1) await sleep(POLITE_MS);
  }

  const file = resolve(outDir, "athletes.json");
  await writeFile(file, `${JSON.stringify({
    schema_version: "wikidata-athlete-careers-v1",
    generated_at: new Date().toISOString(),
    source: "wikidata:P54/P580/P582/P641",
    requested: names.length,
    matched: all.length,
    rows: all
  })}\n`, "utf8");

  const teams = all.reduce((sum, row) => sum + row.people.reduce((n, p) => n + p.teams.length, 0), 0);
  const withSport = all.filter((row) => row.people.some((p) => p.sport)).length;
  console.log(`\nmatched ${all.length}/${names.length} subjects, ${teams} team-intervals, ${withSport} with a sport`);
  console.log(`ambiguous names: ${all.filter((row) => row.ambiguous).length}`);
  if (failures) console.log(`failed batches: ${failures}`);
  console.log(`-> ${file}`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
