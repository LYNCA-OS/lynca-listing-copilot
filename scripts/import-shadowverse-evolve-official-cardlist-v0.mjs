import { runOfficialCatalogImport, printReport } from "./official-catalog-cli.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  runOfficialCatalogImport({ provider: "shadowverse_evolve" }).then(printReport).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
