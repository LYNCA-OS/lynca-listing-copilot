#!/usr/bin/env node

// Paired-harness wrapper for the narrow, evaluation-only IP candidate.
// The shared runner stays untouched because the experiment worktree contains
// unrelated in-flight changes from the earlier handoff.

import { ARM_SPECS, main } from "./run-thin-path-eval.mjs";
import {
  CANONICAL_IP_V1_PROMPT,
  CANONICAL_IP_V1_SCHEMA,
  CANONICAL_IP_V1_SCHEMA_NAME,
  CANONICAL_IP_V1_VERSION,
  buildCanonicalIpV1Request,
  extractCanonicalIpV1Payload,
  finishCanonicalIpV1
} from "../lib/listing/thin/canonical-ip-v1.mjs";

ARM_SPECS.canonical_ip_v1_high = {
  canonical: true,
  diagnostic: true,
  evalVersion: CANONICAL_IP_V1_VERSION,
  responseSchemaName: CANONICAL_IP_V1_SCHEMA_NAME,
  responseSchema: CANONICAL_IP_V1_SCHEMA,
  prompt: CANONICAL_IP_V1_PROMPT,
  buildRequest: (context) => buildCanonicalIpV1Request({ ...context, imageDetail: "high" }),
  extract: extractCanonicalIpV1Payload,
  finish: finishCanonicalIpV1,
  imageDetail: "high"
};
await main(process.argv.slice(2));
