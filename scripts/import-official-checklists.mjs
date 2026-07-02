import { argValue, runOfficialCatalogImport } from "./official-catalog-cli.mjs";

export async function importOfficialChecklists(options = {}) {
  const argv = options.argv || process.argv.slice(2);
  return runOfficialCatalogImport({
    ...options,
    argv,
    provider: argValue(argv, "--provider", options.provider || "topps")
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  importOfficialChecklists().then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
