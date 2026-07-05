import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCommercialReviewPacket } from "../lib/listing/recognition/commercial-review-packet.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

async function readJsonFile(path, label) {
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) throw new Error(`${label} not found: ${resolvedPath}`);
  try {
    return JSON.parse(await readFile(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function writeJson(path, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (!path) {
    process.stdout.write(text);
    return;
  }
  const resolvedPath = resolve(path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, text);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/build-commercial-review-packet.mjs --input <recognition-candidates.json> --out <review-packet.json> [--limit 100]",
    "",
    "Corrected titles are writer-reviewed title ground truth. They are never written as field-level ground truth without field evidence."
  ].join("\n");
}

export async function runBuildCommercialReviewPacket({
  argv = process.argv.slice(2),
  now = () => new Date()
} = {}) {
  const input = argValue(argv, "--input") || argValue(argv, "-i") || "data/recognition/manifests/supabase-feedback-candidates.json";
  const out = argValue(argv, "--out") || argValue(argv, "-o") || "";
  const limit = Number(argValue(argv, "--limit", "0"));

  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    process.stdout.write(`${usage()}\n`);
    return { exitCode: 0, packet: null };
  }

  const manifest = await readJsonFile(input, "Recognition candidate manifest");
  const packet = createCommercialReviewPacket(manifest, {
    now,
    limit: Number.isFinite(limit) ? limit : 0
  });
  await writeJson(out, packet);

  return {
    exitCode: 0,
    packet
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBuildCommercialReviewPacket().then(({ packet }) => {
    if (packet) {
      console.error(`Commercial review packet tasks: ${packet.summary.task_count}`);
      console.error("Corrected titles were exported as reviewed title ground truth and field-review hints.");
    }
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
