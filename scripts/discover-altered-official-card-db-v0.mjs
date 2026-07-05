import { runOfficialCatalogDiscovery, printReport } from "./official-catalog-cli.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  runOfficialCatalogDiscovery({ provider: "altered" }).then(printReport).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
