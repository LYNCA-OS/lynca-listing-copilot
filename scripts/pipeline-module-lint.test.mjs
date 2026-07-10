// Pipeline extraction guard: every identifier CALLED inside a
// lib/listing/pipeline/ module must be defined in that module, imported by
// it, or be a JS builtin. Extraction slices repeatedly left runtime-only
// tendrils (auditParallelText, resolveKnowledgeEntry) that node --check and
// import-time evaluation cannot catch; this turns them into offline failures.

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const builtins = new Set([
  "String", "Number", "Boolean", "Array", "Object", "JSON", "Math", "Date",
  "Set", "Map", "WeakMap", "WeakSet", "RegExp", "Promise", "Error", "TypeError",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
  "decodeURIComponent", "structuredClone", "URL", "URLSearchParams",
  "AbortController", "Headers", "fetch", "setTimeout", "clearTimeout",
  "Buffer", "crypto", "Symbol", "Proxy", "Reflect", "Intl", "BigInt",
  "queueMicrotask", "TextEncoder", "TextDecoder", "console", "process"
]);

const dir = new URL("../lib/listing/pipeline/", import.meta.url);
const files = (await readdir(dir)).filter((file) => file.endsWith(".mjs"));
assert.ok(files.length >= 5, "pipeline directory unexpectedly small");

const problems = [];
for (const file of files) {
  const source = await readFile(new URL(file, dir), "utf8");
  const stripped = source
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/`(?:[^`\\]|\\.)*`/gs, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    // regex literals (heuristic: after punctuation/keyword position)
    .replace(/(^|[=(,:\[!&|?+\n\s])\/(?:[^\/\\\n]|\\.)+\/[gimsuy]*/g, "$1 null ");

  const defined = new Set([
    // function parameters (arrow + classic), destructured or plain
    ...[...stripped.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)]
      .flatMap((m) => [...m[1].matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0])),
    ...[...stripped.matchAll(/\(([^)]*)\)\s*=>/g)]
      .flatMap((m) => [...m[1].matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0])),
    ...[...stripped.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)].map((m) => m[1]),

    ...[...stripped.matchAll(/(?:^|\s)function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    ...[...stripped.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1])
  ]);
  for (const importBlock of stripped.matchAll(/import\s*(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)) {
    if (importBlock[1]) defined.add(importBlock[1]);
    for (const name of (importBlock[2] || "").split(",")) {
      const clean = name.replace(/\s+as\s+.*/, "").trim() || name.split(" as ").pop()?.trim();
      const bound = name.includes(" as ") ? name.split(" as ").pop().trim() : clean;
      if (bound) defined.add(bound);
    }
  }

  // identifiers invoked as bare calls: `name(` not preceded by `.`/`new ` handled below
  for (const call of stripped.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = call[2];
    if (defined.has(name) || builtins.has(name)) continue;
    if (["if", "for", "while", "switch", "catch", "return", "typeof", "await", "new", "in", "of", "function", "async", "import", "delete", "void", "throw", "do", "else", "case", "yield"].includes(name)) continue;
    problems.push(`${file}: ${name}() is not defined or imported`);
  }
}

assert.deepEqual([...new Set(problems)], [], `pipeline modules reference undefined identifiers:\n${[...new Set(problems)].join("\n")}`);
console.log(`pipeline-module-lint.test.mjs OK (${files.length} modules)`);
