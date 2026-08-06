#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  LOSSLESS_TITLE_SEM_PARSER_VERSION,
  losslessTitleDerivedSem
} from "../lib/listing/csm/title-derived-sem-v2.mjs";

const result = losslessTitleDerivedSem(
  "2025-26 Donruss Road to FIFA World Cup 26' Lionel Messi Future Stars 03/10"
);
assert.equal(result.parser_version, LOSSLESS_TITLE_SEM_PARSER_VERSION);
assert.equal(result.coverage.silently_dropped_tokens, 0);
assert.equal(
  result.coverage.typed_tokens + result.coverage.preserved_unassigned_tokens,
  result.coverage.total_tokens
);
assert.ok(result.token_ledger.some((token) => token.text === "03/10"));
assert.ok(result.unassigned_spans.some((span) => /Road to FIFA World Cup/i.test(span.text)));
assert.ok(result.unassigned_spans.every((span) => span.permission === "EVIDENCE_ONLY"));

const unknown = losslessTitleDerivedSem("2025 Topps Disney Mirrored Horizontal Graphite lotx3");
for (const word of ["Disney", "Mirrored", "Horizontal", "Graphite", "lotx3"]) {
  assert.ok(unknown.token_ledger.some((token) => token.text.toLowerCase() === word.toLowerCase()), `${word} must survive`);
}

process.stdout.write("lossless title SEM v2: ok\n");
