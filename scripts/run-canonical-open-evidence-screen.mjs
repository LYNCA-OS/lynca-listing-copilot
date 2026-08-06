#!/usr/bin/env node

// Thin wrapper around the sealed paired harness. Keeping the new arm here
// avoids touching the already-dirty shared runner while preserving its
// checkpoint, alternation, retry and scorer contracts.

import { ARM_SPECS, main } from "./run-thin-path-eval.mjs";
import {
  CANONICAL_OPEN_EVIDENCE_V1,
  CANONICAL_OPEN_EVIDENCE_V1_PROMPT,
  CANONICAL_OPEN_EVIDENCE_V1_SCHEMA,
  CANONICAL_OPEN_EVIDENCE_V1_SCHEMA_NAME,
  buildCanonicalOpenEvidenceV1Request,
  extractCanonicalOpenEvidenceV1Payload,
  finishCanonicalOpenEvidenceV1
} from "../lib/listing/thin/canonical-open-evidence-v1.mjs";

ARM_SPECS.canonical_open_evidence_v1_high = {
  canonical: true,
  diagnostic: true,
  evalVersion: CANONICAL_OPEN_EVIDENCE_V1,
  responseSchemaName: CANONICAL_OPEN_EVIDENCE_V1_SCHEMA_NAME,
  responseSchema: CANONICAL_OPEN_EVIDENCE_V1_SCHEMA,
  prompt: CANONICAL_OPEN_EVIDENCE_V1_PROMPT,
  buildRequest: (context) => buildCanonicalOpenEvidenceV1Request({
    ...context,
    imageDetail: "high"
  }),
  extract: extractCanonicalOpenEvidenceV1Payload,
  finish: finishCanonicalOpenEvidenceV1,
  imageDetail: "high"
};

await main(process.argv.slice(2));
