import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../package.json", import.meta.url), "utf8");
assert.doesNotThrow(() => JSON.parse(source), "package.json must remain valid JSON");

const lines = source.split(/\r?\n/u);
const scriptsStart = lines.findIndex((line) => /^  "scripts": \{$/u.test(line));
assert.ok(scriptsStart >= 0, "package.json must contain a scripts object");
const scriptsEnd = lines.findIndex((line, index) => index > scriptsStart && /^  \},$/u.test(line));
assert.ok(scriptsEnd > scriptsStart, "package.json scripts object must have a closing boundary");

const seen = new Set();
const duplicates = new Set();
for (const line of lines.slice(scriptsStart + 1, scriptsEnd)) {
  const match = line.match(/^    "((?:\\.|[^"\\])+)":/u);
  if (!match) continue;
  const key = JSON.parse(`"${match[1]}"`);
  if (seen.has(key)) duplicates.add(key);
  seen.add(key);
}

assert.deepEqual(
  [...duplicates].sort(),
  [],
  `package.json scripts contains duplicate keys: ${[...duplicates].sort().join(", ")}`
);

console.log("package.json script key uniqueness tests passed");
