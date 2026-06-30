import { importToppsBasketballChecklists } from "./import-topps-basketball-checklists.mjs";

export async function importOfficialChecklists(options = {}) {
  return importToppsBasketballChecklists(options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  importOfficialChecklists().then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
