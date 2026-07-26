#!/usr/bin/env node
// Turn a harvested "<name>\t<url>" list into Topps manifest entries.
//
//   node scripts/register-topps-harvest.mjs <harvest.tsv>
//
// The index page is Cloudflare-protected, so links are harvested through a real
// browser; the Shopify CDN that serves the files is open, so the importer can
// fetch them directly once they are registered.
//
// Two rules are load-bearing:
//   * every source_name must contain the word "checklist". The importer's link
//     allowlist tests /\bchecklist\b/ against the name and the href, and \b does
//     not match after the underscore in "_Checklist.pdf" -- so registering by
//     the site's link text alone left sources failing validation and silently
//     falling back to fetching the blocked index page.
//   * .xls/.xlsx sources are skipped: the extractor requires the `xlsx` package,
//     which is not a declared dependency, and one such source aborts the batch.

import { readFileSync, writeFileSync } from "node:fs";

const CDN_PREFIX = "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/";
const MANIFEST = "data/catalog/official/topps-production-sources.json";

function categoryFor(name) {
  const n = name.toLowerCase();
  if (/basketball|hoops|nbl|g.league|bowman university|cactus jack|mcdonald|motif/.test(n)) return "basketball";
  if (/football|resurgence|signature class/.test(n)) return "football";
  if (/baseball|bowman|heritage|stadium club|pro debut|sterling|tier one|tribute|inception|museum|definitive|dynasty|pristine|diamond icons|allen|archives|luminaries|complete sets|brooklyn/.test(n)) return "baseball";
  if (/ufc|wwe|knockout|boxing|exalted/.test(n)) return "combat";
  if (/uefa|ucc|uwcl|bundesliga|premier league|manchester|mls|euro/.test(n)) return "soccer";
  if (/formula 1|f1/.test(n)) return "racing";
  if (/tennis/.test(n)) return "tennis";
  if (/nhl|hockey/.test(n)) return "hockey";
  if (/olympic/.test(n)) return "olympics";
  return "entertainment";
}

const harvestPath = process.argv[2];
if (!harvestPath) {
  console.error("Usage: register-topps-harvest.mjs <harvest.tsv>");
  process.exit(1);
}

const rows = readFileSync(harvestPath, "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean)
  .map((line) => {
    const [name, href] = line.split("\t");
    return {
      name: String(name || "").replace(/®/g, "").replace(/\s+/g, " ").trim(),
      url: String(href || "").trim().replace(/^~/, CDN_PREFIX).replace(/\\+$/, "")
    };
  })
  .filter((r) => r.name && /^https?:\/\//.test(r.url));

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const known = new Set((manifest.sources || []).map((s) => s.source_url));

let added = 0;
let skippedSpreadsheet = 0;
for (const row of rows) {
  if (/\.xlsx?(\?|$)/i.test(row.url)) { skippedSpreadsheet += 1; continue; }
  if (known.has(row.url)) continue;
  const sourceName = /\bchecklist\b/i.test(row.name) ? row.name : `${row.name} Checklist`;
  manifest.sources.push({
    source_name: sourceName,
    source_url: row.url,
    official_page_url: "https://www.topps.com/pages/checklists",
    source_type: "TOPPS_OFFICIAL_CHECKLIST",
    category: categoryFor(row.name)
  });
  known.add(row.url);
  added += 1;
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`harvested=${rows.length} added=${added} skipped_spreadsheet=${skippedSpreadsheet} total_sources=${manifest.sources.length}`);
