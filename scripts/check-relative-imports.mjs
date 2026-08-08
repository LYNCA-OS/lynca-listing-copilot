#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const files = execFileSync("git", ["ls-files", "*.js", "*.mjs"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => file && existsSync(file));
const missing = [];
const importPattern = /(?:import|export)\s+(?:[^'\"]*?\s+from\s+)?['\"]([^'\"]+)['\"]|import\(\s*['\"]([^'\"]+)['\"]\s*\)/g;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] || match[2];
    if (!specifier.startsWith(".")) continue;
    const target = resolve(dirname(file), specifier);
    if (![target, `${target}.js`, `${target}.mjs`, `${target}.json`].some(existsSync)) {
      missing.push(`${file}: ${specifier}`);
    }
  }
}

if (missing.length) {
  throw new Error(`Missing relative imports:\n${missing.join("\n")}`);
}
console.log(`relative import graph passed (${files.length} source files)`);
