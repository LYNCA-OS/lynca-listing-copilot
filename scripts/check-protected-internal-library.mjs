#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const root = resolve(homedir(), "lynca-eval-root");
const repositorySourcePath = resolve("data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json");
const sourcePath = resolve(root, "data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json");
const datasetPath = resolve(root, "data/eval/reviewed-title-blind/reviewed-title-image-only.json");
const labelsPath = resolve(root, "data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl");
const repositorySourceBytes = await readFile(repositorySourcePath);
const sourceBytes = await readFile(sourcePath);
const repositorySource = JSON.parse(repositorySourceBytes);
const source = JSON.parse(sourceBytes);
const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const labels = (await readFile(labelsPath, "utf8")).split(/\r?\n/).filter(Boolean).map(JSON.parse);
const sourceItems = source.items || source.records || [];

if (sourceItems.length !== 255 || dataset.items?.length !== 255 || labels.length !== 255) {
  throw new Error(`protected image-backed library mismatch: source=${sourceItems.length}, dataset=${dataset.items?.length || 0}, labels=${labels.length}`);
}
if (JSON.stringify(repositorySource) !== JSON.stringify(source)) {
  throw new Error("repository and evaluation-root writer source copies differ");
}
if (dataset.items.some((item) => item.canonical_title || Object.keys(item.source_titles || {}).length)) {
  throw new Error("blind evaluation dataset leaks reviewed titles");
}
console.log("protected image-backed library passed (255 source mappings, 255 blind items, 255 sealed labels)");
