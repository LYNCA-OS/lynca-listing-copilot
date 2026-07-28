#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import readline from "node:readline";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export async function buildProviderContractReplayInput({ telemetryDir, outputPath }) {
  const sessionDir = resolve(telemetryDir, "v4_recognition_sessions");
  const files = (await readdir(sessionDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(sessionDir, entry.name))
    .sort();
  const results = [];
  for (const file of files) {
    const lines = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      const finalTitle = clean(row.final_title || row.l2_title);
      if (!finalTitle || !row.resolved_fields || typeof row.resolved_fields !== "object") continue;
      results.push({
        asset_id: row.asset_id || row.stable_asset_id || row.client_asset_ref || null,
        candidate_id: row.id,
        final_title: finalTitle,
        reference_title: finalTitle,
        resolved_fields: row.resolved_fields,
        rendered_fields: { fields: row.resolved_fields },
        normalized_evidence: {},
        title_render_source: "provider_contract_replay_snapshot"
      });
    }
  }
  const packet = {
    schema_version: "provider-contract-replay-input-v1",
    source_semantics: "verified local production telemetry; final title is the preservation reference, not accuracy ground truth",
    result_count: results.length,
    results
  };
  const resolvedOutput = resolve(outputPath);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(packet)}\n`, "utf8");
  return packet;
}

async function main() {
  const telemetryDir = resolve(argValue(process.argv, "--telemetry-dir", process.env.LYNCA_TELEMETRY_DIR || "../lynca-telemetry"));
  const outputPath = resolve(argValue(process.argv, "--out", "/tmp/provider-contract-replay-input.json"));
  const packet = await buildProviderContractReplayInput({ telemetryDir, outputPath });
  process.stdout.write(`${outputPath} ${packet.result_count}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
