#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

export function replayApplicationGuard(trace = {}) {
  let blockedYearReplacementCount = 0;
  const cards = (Array.isArray(trace.cards) ? trace.cards : []).map((card) => ({
    ...card,
    application_decisions: (Array.isArray(card.application_decisions) ? card.application_decisions : []).map((decision) => {
      const unsafeYearReplacement = cleanText(decision.source_field || decision.field) === "year"
        && decision.applied === true
        && decision.old_value !== null
        && decision.old_value !== undefined
        && cleanText(decision.application_plan_reason) === "trusted_reviewed_identity_year_fill";
      if (!unsafeYearReplacement) return decision;
      blockedYearReplacementCount += 1;
      return {
        ...decision,
        applied: false,
        applied_to_final: false,
        decision: "BLOCK",
        reason: "year_replacement_requires_current_source_authority",
        outcome: "COUNTERFACTUAL_BLOCKED_BY_APPLICATION_GUARD"
      };
    })
  }));
  return {
    ...trace,
    schema_version: "v4-chain-oracle-counterfactual-trace-v1",
    counterfactual_policy: {
      policy_id: "year-replacement-current-source-authority-v1",
      blocked_year_replacement_count: blockedYearReplacementCount
    },
    cards
  };
}

export async function main(argv = process.argv.slice(2)) {
  const input = argValue(argv, "--input");
  const output = resolve(argValue(argv, "--out", "data/eval/v4-chain-oracle/application-guard-replay.json"));
  if (!input) throw new Error("--input is required");
  const replay = replayApplicationGuard(JSON.parse(await readFile(resolve(input), "utf8")));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(replay, null, 2)}\n`);
  console.log(JSON.stringify({
    output,
    card_count: replay.cards.length,
    ...replay.counterfactual_policy
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
