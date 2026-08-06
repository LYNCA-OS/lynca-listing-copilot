#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { auditRulerAnnotationReadiness } from "../lib/listing/evaluation/ruler-annotation-readiness.mjs";

const input = resolve(process.argv[2]
  || "artifacts/second-writer-calibration-285-2026-08-02/blind-packet.json");
const packet = JSON.parse(readFileSync(input, "utf8"));
process.stdout.write(`${JSON.stringify({ input, ...auditRulerAnnotationReadiness(packet) }, null, 2)}\n`);
