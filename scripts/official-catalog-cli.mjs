import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildOfficialCatalogImportReport,
  createOfficialCatalogSourceAdapter,
  discoverOfficialCatalogSource
} from "../lib/listing/catalog/official-catalog-source-adapter.mjs";
import { extractPdfText } from "../lib/listing/catalog/pdf-text-extractor.mjs";

export function argValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1]) values.push(argv[index + 1]);
  }
  return values;
}

export function argValue(argv, name, fallback = "") {
  return argValues(argv, name)[0] || fallback;
}

export function hasFlag(argv, name) {
  return argv.includes(name);
}

export async function writeJson(path = "", value = {}) {
  if (!path) return;
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

export function sourceUrlsFromArgs(argv = []) {
  const urls = argValues(argv, "--source-url");
  const names = argValues(argv, "--source-name");
  return urls.map((href, index) => ({
    href,
    text: names[index] || names[0] || ""
  }));
}

export async function runOfficialCatalogDiscovery({
  provider,
  argv = process.argv.slice(2),
  fetchImpl = globalThis.fetch
} = {}) {
  const outPath = argValue(argv, "--out", "");
  const adapter = createOfficialCatalogSourceAdapter({ provider, fetchImpl, pdfExtractor: extractPdfText });
  const report = await discoverOfficialCatalogSource({
    provider,
    fetchImpl,
    indexUrl: argValue(argv, "--index-url", adapter.profile.default_index_url),
    category: argValue(argv, "--category", adapter.profile.default_category)
  });
  await writeJson(outPath, report);
  return report;
}

export async function runOfficialCatalogImport({
  provider,
  argv = process.argv.slice(2),
  fetchImpl = globalThis.fetch
} = {}) {
  const outPath = argValue(argv, "--out", "");
  const adapter = createOfficialCatalogSourceAdapter({ provider, fetchImpl, pdfExtractor: extractPdfText });
  const report = await buildOfficialCatalogImportReport({
    provider,
    fetchImpl,
    pdfExtractor: extractPdfText,
    indexUrl: argValue(argv, "--index-url", adapter.profile.default_index_url),
    category: argValue(argv, "--category", adapter.profile.default_category),
    sourceUrls: sourceUrlsFromArgs(argv),
    outPath
  });
  const output = {
    ...report,
    dry_run: !hasFlag(argv, "--apply"),
    apply_supported: false,
    apply_note: "Official importer v0 writes staging reports only. Supabase apply remains limited to the reviewed Topps staging path until source-specific parsing is validated."
  };
  await writeJson(outPath, output);
  return output;
}

export function printReport(report = {}) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
