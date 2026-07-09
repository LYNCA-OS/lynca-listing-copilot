// Generates docs/ENV_FLAGS.md: every env var referenced in api/ and lib/,
// with the files that read it. Run after adding/removing flags:
//   node scripts/generate-env-flag-inventory.mjs
// The inventory is the first step of config-debt reaping: a flag nobody can
// locate is a flag nobody can retire.

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* walk(path);
    } else if (/\.(mjs|js)$/.test(entry.name)) {
      yield path;
    }
  }
}

const flagPattern = /env\.([A-Z][A-Z0-9_]{2,})/g;
const usage = new Map();
for (const root of ["api", "lib"]) {
  for await (const file of walk(root)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(flagPattern)) {
      const flag = match[1];
      if (!usage.has(flag)) usage.set(flag, new Set());
      usage.get(flag).add(file);
    }
  }
}

const flags = [...usage.keys()].sort();
const lines = [
  "# Environment Flag Inventory",
  "",
  `Generated ${new Date().toISOString().slice(0, 10)} by scripts/generate-env-flag-inventory.mjs — do not edit by hand.`,
  "",
  `Total: ${flags.length} flags. Reaping rule: a kill switch that has stayed in one`,
  "position for a quarter is not a switch, it is dead weight — inline its value",
  "and delete the flag.",
  "",
  "| Flag | Read by |",
  "|---|---|",
  ...flags.map((flag) => `| \`${flag}\` | ${[...usage.get(flag)].sort().join("<br>")} |`)
];
await writeFile("docs/ENV_FLAGS.md", lines.join("\n") + "\n", "utf8");
process.stderr.write(`docs/ENV_FLAGS.md written: ${flags.length} flags\n`);
