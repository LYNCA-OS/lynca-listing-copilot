#!/usr/bin/env node
// The reference writes a season span (2025-26) on 52 cards; we emit one on 33,
// and on 21 we emit only the opening year. The scorer splits on "-", so the
// reference carries a "26" token we never offer -- pure recall loss at no
// precision cost, IF the span can be inferred safely.
//
// The model is not truncated by us (0 parser rewrites); it simply returned a
// bare year. `ip` is empty on 146 of 148 cards, so the sport has to come from
// the team or the product, which is a hand-built domain rule -- the class that
// has been net-negative on this project before. Measured, not assumed.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tok = (v) => new Set(String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (ref, title) => {
  const w = tok(ref); const g = tok(title);
  const hits = [...w].filter((t) => g.has(t)).length;
  const recall = w.size ? hits / w.size : 0;
  const precision = g.size ? hits / g.size : 0;
  return recall + precision ? 2 * recall * precision / (recall + precision) : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

// Sports whose season crosses the calendar year.
const CROSS_SEASON = /\b(basketball|hoops|nba|nbl|hockey|nhl|soccer|football club|fc|ucc|uefa|premier|laliga|bundesliga)\b/i;
const NBA_TEAMS = /\b(lakers|celtics|spurs|bulls|knicks|warriors|heat|nets|bucks|suns|mavericks|clippers|nuggets|jazz|kings|hawks|magic|pistons|pacers|raptors|rockets|thunder|blazers|grizzlies|hornets|wizards|cavaliers|76ers|sixers|timberwolves|pelicans)\b/i;
const SOCCER = /\b(arsenal|madrid|barcelona|liverpool|chelsea|juventus|bayern|psg|milan|tottenham|manchester)\b/i;

const spanYear = (year) => {
  const m = /^((?:19|20)\d{2})$/.exec(String(year).trim());
  if (!m) return null;
  const next = String(Number(m[1]) + 1).slice(-2);
  return `${m[1]}-${next}`;
};

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => ({ ...r, parsed: parseCanonicalFields(r.raw_title).fields }));

const signals = (f) => [f.product, f.set, f.team, f.card_name].filter(Boolean).join(" ");
const ARMS = {
  cross_season_sport: (f) => (CROSS_SEASON.test(signals(f)) || NBA_TEAMS.test(signals(f)) || SOCCER.test(signals(f)))
    ? spanYear(f.year) : null,
  // The most permissive version, as an upper bound on the whole idea.
  every_bare_year: (f) => spanYear(f.year)
};

const base = rows.map((r) => score(r.reference, composeFromCanonicalFields(r.parsed).title));
console.log(`n=${rows.length}  基线 F1=${mean(base).toFixed(6)}\n`);
for (const [name, infer] of Object.entries(ARMS)) {
  let fired = 0;
  const arm = rows.map((row) => {
    const span = infer(row.parsed);
    if (!span) return score(row.reference, composeFromCanonicalFields(row.parsed).title);
    fired++;
    return score(row.reference, composeFromCanonicalFields({ ...row.parsed, year: span }).title);
  });
  const d = arm.map((v, i) => v - base[i]);
  const w = d.filter((x) => x > 1e-12).length; const l = d.filter((x) => x < -1e-12).length;
  console.log(`${name.padEnd(22)} ΔF1=${mean(arm) - mean(base) >= 0 ? "+" : ""}${(mean(arm) - mean(base)).toFixed(6)}  胜/负=${w}/${l}  触发 ${fired} 张`);
}
