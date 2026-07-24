#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auditOcrPatchUtility } from "../lib/listing/evaluation/ocr-patch-utility-audit.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const controlPath = arg("--control");
const candidatePath = arg("--candidate");
const outputPath = arg("--out");

if (!controlPath || !candidatePath) {
  throw new Error("Usage: audit-ocr-patch-utility.mjs --control <report.json> --candidate <report.json> [--out <audit.json>]");
}

const [controlReport, candidateReport] = await Promise.all([
  readFile(resolve(controlPath), "utf8").then(JSON.parse),
  readFile(resolve(candidatePath), "utf8").then(JSON.parse)
]);
const audit = auditOcrPatchUtility({ controlReport, candidateReport });
const serialized = `${JSON.stringify(audit, null, 2)}\n`;
if (outputPath) await writeFile(resolve(outputPath), serialized);
process.stdout.write(serialized);
