#!/usr/bin/env node
// The 41% of "never observed" that is not a knowledge gap.
//
// Splitting the missed tokens by whether we emit that same word on OTHER cards
// separates two problems that had been counted as one. A word we have never
// produced anywhere is something the model does not know. A word we produce
// constantly and dropped here is something the model knows and failed to
// report, and those are cheap to fix if the reason is structural.
//
// `refractor` was the first: 25 misses, none of them an empty finish layer --
// the model reported the colour and filled parallel_family with the modifier.
// This asks whether the rest of the 41% has the same shape, by showing what we
// DID emit in the same semantic slot each time the word went missing.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const val = (v) => (Array.isArray(v) ? v.join(" ") : String(v ?? ""));

const FINISH = ["surface_color", "parallel_family", "parallel_exact"];
const NAME = ["card_name", "set", "product"];
const ATTR = ["attributes"];
const SLOT = { finish: FINISH, name: NAME, attr: ATTR };

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => ({ ...r, fields: parseCanonicalFields(r.raw_title).fields }));

// Vocabulary we demonstrably produce, and the slot we produce it in.
const slotOf = new Map();
for (const row of rows) {
  for (const [slot, fields] of Object.entries(SLOT)) {
    for (const f of fields) for (const w of tok(val(row.fields[f]))) {
      if (!slotOf.has(w)) slotOf.set(w, slot);
    }
  }
  for (const t of row.fields.withheld_finish_terms || []) for (const w of tok(t.value)) {
    if (!slotOf.has(w)) slotOf.set(w, "finish");
  }
}

const miss = new Map();
for (const row of rows) {
  const emitted = new Set(tok(composeFromCanonicalFields(row.fields).title));
  const anywhere = new Set();
  for (const fields of Object.values(SLOT)) for (const f of fields) for (const w of tok(val(row.fields[f]))) anywhere.add(w);
  for (const t of row.fields.withheld_finish_terms || []) for (const w of tok(t.value)) anywhere.add(w);
  for (const f of ["year", "manufacturer", "subjects", "team", "card_number", "serial", "release_variant", "descriptive_rarity"]) {
    for (const w of tok(val(row.fields[f]))) anywhere.add(w);
  }

  for (const w of new Set(tok(row.reference))) {
    if (emitted.has(w) || anywhere.has(w)) continue;
    const slot = slotOf.get(w);
    if (!slot) continue;                      // genuinely unknown vocabulary
    const rec = miss.get(w) || { word: w, slot, n: 0, saidInstead: [], slotEmpty: 0 };
    rec.n++;
    const said = SLOT[slot].map((f) => val(row.fields[f]).trim()).filter(Boolean).join(" | ");
    if (said) rec.saidInstead.push(said); else rec.slotEmpty++;
    miss.set(w, rec);
  }
}

const ranked = [...miss.values()].filter((m) => m.n >= 3).sort((a, b) => b.n - a.n);
console.log(`已掌握词汇的漏报，按词次排序（>=3 次）\n`);
console.log("词".padEnd(14) + "次数  槽位     该槽为空  该槽说了别的");
for (const m of ranked) {
  console.log(`${m.word.padEnd(14)} ${String(m.n).padStart(4)}  ${m.slot.padEnd(8)} ${String(m.slotEmpty).padStart(6)}   ${String(m.n - m.slotEmpty).padStart(6)}`);
}
console.log(`\n形态判读：该槽为空 = 真的没看到；该槽说了别的 = 看到了但归类/命名不同（schema 问题）\n`);
for (const m of ranked.slice(0, 6)) {
  if (m.n === m.slotEmpty) continue;
  console.log(`--- ${m.word} （${m.n - m.slotEmpty}/${m.n} 是「说了别的」）---`);
  for (const s of [...new Set(m.saidInstead)].slice(0, 4)) console.log(`     我们发出: ${s}`);
}
