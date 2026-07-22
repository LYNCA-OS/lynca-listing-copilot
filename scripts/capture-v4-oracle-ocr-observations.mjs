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

function rows(value = {}) {
  if (Array.isArray(value)) return value;
  for (const key of ["results", "items", "cards"]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function deploymentProtectionHeaders(env = process.env) {
  const secret = cleanText(env.VERCEL_AUTOMATION_BYPASS_SECRET);
  return secret ? { "x-vercel-protection-bypass": secret } : {};
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...deploymentProtectionHeaders() },
    body: JSON.stringify({ username, password })
  });
  if (!response.ok) throw new Error(`oracle OCR login failed: ${response.status}`);
  const cookie = cleanText(response.headers.get("set-cookie")).split(";")[0];
  if (!cookie) throw new Error("oracle OCR login did not return a cookie");
  return cookie;
}

export async function captureV4OracleOcrObservations({ report, baseUrl, username, password } = {}) {
  const cookie = await login(cleanText(baseUrl).replace(/\/+$/, ""), username, password);
  const cards = rows(report).map((row) => ({
    query_card_id: cleanText(row.source_feedback_id || row.source_asset_id || row.asset_id),
    asset_id: cleanText(row.asset_id)
  }));
  const capturedCards = [];
  for (let offset = 0; offset < cards.length; offset += 20) {
    const response = await fetch(`${cleanText(baseUrl).replace(/\/+$/, "")}/api/v4/oracle-ocr-observations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...deploymentProtectionHeaders() },
      body: JSON.stringify({ cards: cards.slice(offset, offset + 20) })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      throw new Error(`oracle OCR capture failed: ${response.status}:${cleanText(payload.error)}`);
    }
    capturedCards.push(...(payload.cards || []));
  }
  return {
    schema_version: "v4-oracle-ocr-observations-v1",
    generated_at: new Date().toISOString(),
    cards: capturedCards
  };
}

export async function main(argv = process.argv.slice(2)) {
  const input = resolve(argValue(argv, "--input"));
  const output = resolve(argValue(argv, "--out", "data/eval/v4-chain-oracle/ocr-observations.json"));
  const baseUrl = argValue(argv, "--base-url");
  const username = argValue(argv, "--username", process.env.METAVERSE_USERNAME);
  const password = argValue(argv, "--password", process.env.METAVERSE_PASSWORD);
  if (!input || !baseUrl || !username || !password) throw new Error("--input, --base-url, username, and password are required");
  const report = JSON.parse(await readFile(input, "utf8"));
  const captured = await captureV4OracleOcrObservations({ report, baseUrl, username, password });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(captured, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    output,
    card_count: captured.cards.length,
    observation_count: captured.cards.reduce((sum, card) => sum + card.observations.length, 0),
    nonempty_observation_count: captured.cards.reduce((sum, card) => sum + card.observations.filter((row) => row.raw_text).length, 0),
    vision_unit_count: captured.cards.reduce((sum, card) => sum + card.observations.reduce((inner, row) => inner + Number(row.vision_unit_count || 0), 0), 0),
    vision_cost_estimate: captured.cards.reduce((sum, card) => sum + card.observations.reduce((inner, row) => inner + Number(row.vision_cost_estimate || 0), 0), 0)
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
