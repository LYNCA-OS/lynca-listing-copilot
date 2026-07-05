import { runOfficialCatalogImport, printReport } from "./official-catalog-cli.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  runOfficialCatalogImport({ provider: "dragon_ball_masters" }).then(printReport).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
