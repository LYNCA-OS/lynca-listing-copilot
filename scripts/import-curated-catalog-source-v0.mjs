import { runOfficialCatalogImport, printReport, argValue } from "./official-catalog-cli.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  const provider = argValue(process.argv.slice(2), "--provider", "");
  if (!provider) {
    console.error("missing_required_arg: --provider");
    process.exitCode = 1;
  } else {
    runOfficialCatalogImport({ provider }).then(printReport).catch((error) => {
      console.error(error?.message || error);
      process.exitCode = 1;
    });
  }
}
