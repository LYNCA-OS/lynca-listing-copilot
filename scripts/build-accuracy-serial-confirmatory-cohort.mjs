#!/usr/bin/env node

// Pre-register the serial-format follow-up from the fresh 150 response. The
// selector uses only canonical fields, never sealed titles: it includes every
// card whose canonical serial numerator is one digit, because that is the
// exact domain of the single-digit leading-zero resolver.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const inputPath = resolve(root, "artifacts/accuracy-mechanism-confirmatory-2026-08-02/fresh-budgeted-canonical/thin-path-gpt-5.6-luna.jsonl");
const outPath = resolve(root, "artifacts/accuracy-mechanism-confirmatory-2026-08-02/serial-confirmatory.asset-ids.json");
const rows = (await readFile(inputPath, "utf8")).split(/\n+/).filter(Boolean).map(JSON.parse);
const selected = rows
  .filter((row) => row.arm === "thin_canonical_high" && /^\d\/\d+$/.test(String(row.fields?.serial || "").trim()))
  .map((row) => row.asset_id);
if (!selected.length) throw new Error("serial_confirmatory_cohort_empty");
if (new Set(selected).size !== selected.length) throw new Error("serial_confirmatory_cohort_duplicate");
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(selected, null, 2)}\n`);
console.log(JSON.stringify({ outPath, count: selected.length, selection_rule: "canonical_serial_single_digit" }, null, 2));
