#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { evaluatePilotGold } from "../lib/listing/evaluation/typed-gold-annotation-pilot.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.split(/=(.*)/s).slice(0, 2)));
const load = async (key, fallback) => JSON.parse(await readFile(resolve(args[key] || fallback), "utf8"));
const packet = await load("--packet", "artifacts/typed-gold-pilot20-2026-08-09/packet.json");
const receipt = await load("--receipt", "docs/evaluation/typed-gold-pilot20-receipt-2026-08-09.json");
const optional = async (key) => args[key] ? JSON.parse(await readFile(resolve(args[key]), "utf8")) : null;
const result = evaluatePilotGold({
  packet, receipt,
  reviewerA: await optional("--reviewer-a"),
  reviewerB: await optional("--reviewer-b"),
  adjudication: await optional("--adjudication")
});
console.log(JSON.stringify(result, null, 2));
if (result.gold_eligible !== true) process.exitCode = 2;
