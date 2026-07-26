#!/usr/bin/env node
// Harvest the Panini checklist tree from their public selection endpoint.
//
//   node scripts/harvest-panini-checklists.mjs --activity 1 --year 2024
//   node scripts/harvest-panini-checklists.mjs --all --out data/catalog/official/panini-harvest.json
//
// Panini publishes no checklist files to enumerate -- the page is a search UI
// over an endpoint that walks a five-level tree. Unlike the Topps PDFs this
// returns structured JSON all the way down to card number and player, and its
// set names carry exactly what we are missing: "Rated Rookies RPS Autographs
// Gold", "... Ice", "... Holo".
//
// The endpoint requires Origin/Referer to match the site; without them the
// request is refused at the edge, which is what made this look browser-only.
// Two levels take numeric ids rather than names: passing program or card_set by
// name returns an empty list and looks like "no data" instead of an error.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API = "https://support.paniniamerica.net/replacement-card-selection";
const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Origin: "https://www.paniniamerica.net",
  Referer: "https://www.paniniamerica.net/",
  Accept: "application/json, text/plain, */*"
};

// The page shows twelve sports but their ids are not the menu order -- probing
// 2024 returns brands for 1, 7, 8, 9, 11 and 12 only. Rather than hard-code a
// guessed mapping, discover which ids answer and label them from the first
// brand set they return.
const ACTIVITY_ID_RANGE = 20;

export async function discoverActivities({ probeYear = "2024", delayMs = 250 } = {}) {
  const found = [];
  for (let id = 1; id <= ACTIVITY_ID_RANGE; id += 1) {
    const brands = await call({ ...empty, activity: String(id), year: String(probeYear) }, { delayMs });
    if (brands.length) found.push({ id, name: `activity_${id}`, brands: brands.map((b) => b.name) });
  }
  return found;
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(payload, { retries = 3, delayMs = 250 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ replace_wo_inventory: "1", from_frontend: "0", ...payload })
      });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const json = await response.json();
      await sleep(delayMs);
      return Array.isArray(json?.data) ? json.data : [];
    } catch (error) {
      if (attempt === retries) {
        process.stderr.write(`  ! ${JSON.stringify(payload)} -> ${error.message}\n`);
        return [];
      }
      await sleep(delayMs * attempt * 4);
    }
  }
  return [];
}

const empty = { activity: "", year: "", brand: "", program: "", card_set: "", card: "" };

export async function harvest({ activities, years, includeCards = false, delayMs = 250, onProgress = () => {} } = {}) {
  const out = [];
  for (const activity of activities) {
    for (const year of years) {
      const brands = await call({ ...empty, activity: String(activity.id), year: String(year) }, { delayMs });
      for (const brand of brands) {
        const programs = await call({ ...empty, activity: String(activity.id), year: String(year), brand: brand.name }, { delayMs });
        for (const program of programs) {
          // program must go back as its numeric id, not its name.
          const sets = await call({
            ...empty, activity: String(activity.id), year: String(year), brand: brand.name, program: String(program.id)
          }, { delayMs });
          for (const set of sets) {
            const row = {
              activity: activity.name,
              year: String(year),
              brand: brand.name,
              program: program.name,
              program_id: program.id,
              card_set: set.name,
              card_set_id: set.id
            };
            if (includeCards) {
              const cards = await call({
                ...empty, activity: String(activity.id), year: String(year), brand: brand.name,
                program: String(program.id), card_set: String(set.id)
              }, { delayMs });
              row.cards = cards.map((c) => ({ name: c.name, id: c.id }));
            }
            out.push(row);
          }
          onProgress({ activity: activity.name, year, brand: brand.name, program: program.name, sets: sets.length, total: out.length });
        }
      }
    }
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const all = argv.includes("--all");
  const activityArg = argValue(argv, "--activity", "");
  const yearArg = argValue(argv, "--year", "");
  const includeCards = argv.includes("--include-cards");
  const delayMs = Math.max(0, Number(argValue(argv, "--delay-ms", "250")) || 250);
  const outPath = resolve(argValue(argv, "--out", "data/catalog/official/panini-harvest.json"));

  const years = all && !yearArg
    ? Array.from({ length: 22 }, (_, i) => 2025 - i)
    : (yearArg ? [yearArg] : [String(new Date().getFullYear() - 1)]);

  const activities = activityArg
    ? [{ id: Number(activityArg), name: `activity_${activityArg}` }]
    : await discoverActivities({ probeYear: years[0], delayMs });
  if (!activityArg) {
    process.stderr.write(`discovered activity ids: ${activities.map((a) => a.id).join(", ")}\n`);
  }

  process.stderr.write(`panini harvest: ${activities.map((a) => a.name).join(",")} x ${years.join(",")}${includeCards ? " (with cards)" : ""}\n`);
  const rows = await harvest({
    activities, years, includeCards, delayMs,
    onProgress: (p) => process.stderr.write(`  ${p.activity} ${p.year} ${p.brand} / ${p.program}: ${p.sets} sets (running ${p.total})\n`)
  });

  const artifact = {
    schema_version: "panini-checklist-harvest-v1",
    generated_at: new Date().toISOString(),
    source: API,
    activities: activities.map((a) => a.name),
    years,
    include_cards: includeCards,
    row_count: rows.length,
    rows
  };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stderr.write(`\nwrote ${rows.length} card sets -> ${outPath}\n`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => {
    console.error(e?.message || e);
    process.exitCode = 1;
  });
}
