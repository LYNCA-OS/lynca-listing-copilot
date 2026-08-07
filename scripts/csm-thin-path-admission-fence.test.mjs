// COS-20's per-field admission, fenced by the import graph.
//
// The decision says catalog and vector admission is OFF by default and may be
// enabled only for one named canonical field after a frozen positive
// evaluation. The implementation says something else in one place:
//
//   lib/listing/pipeline/provider-options.mjs
//   envFlag(env, "ENABLE_CATALOG_ASSIST_DEFAULT", true)
//
// A default of `true` in a module the production path never loads is harmless
// today and is exactly the kind of thing that stops being harmless quietly --
// one import, and a superseded pipeline's default becomes production policy
// without any decision being made.
//
// "Unreachable" is a claim about the import graph, so it is checked against the
// import graph rather than asserted in a comment. This walks the real
// production entry points and fails if any of them can reach the retired
// pipeline, the catalog, or vector retrieval by any path.
//
// This is a FENCE, not the missing implementation. COS-20 clauses 3 and 4 --
// per-field admission with a frozen evaluation gate -- still have nothing to
// point at, and the founder-decision verifier says so every run.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The production CSM thin path, both endpoints.
const ENTRY_POINTS = [
  "api/csm-listing-title.js",
  "api/csm-listing-title-ingest.js",
  // The client too. Admission is a server decision, but the browser bundle is
  // where a catalog module would be imported for a display convenience and
  // quietly ship the capability with it.
  "app/listing-copilot.js"
];

// Directories the production path must not be able to reach. Each is a
// capability COS-20 puts behind a per-field gate that does not exist yet.
const FENCED = [
  { prefix: "lib/listing/catalog/", why: "catalog admission is OFF by default (COS-20)" },
  { prefix: "lib/listing/retrieval/", why: "vector retrieval admission is OFF by default (COS-20)" },
  { prefix: "lib/listing/candidates/", why: "multi-call candidate scoring was measured negative and removed" },
  // NOT the whole of `lib/listing/pipeline/`. The first version of this fence
  // fenced the directory and reported two breaches: `pipeline/text.mjs` and
  // `pipeline/subject-identity.mjs`, reached through the session store. Both
  // are string helpers with no admission behaviour, so the fence was wrong, not
  // the code. Named files only.
  { prefix: "lib/listing/pipeline/provider-options.mjs", why: "ENABLE_CATALOG_ASSIST_DEFAULT defaults to true here (COS-20)" },
  { prefix: "lib/listing/pipeline/provider-prompt.mjs", why: "the 825-token pipeline prompt was measured negative and replaced" }
];

const importPattern = /(?:^|\n)\s*(?:import[\s\S]*?from|export[\s\S]*?from|import)\s*["']([^"']+)["']/g;

async function importsOf(absolutePath) {
  let source;
  try {
    source = await readFile(absolutePath, "utf8");
  } catch {
    return [];
  }
  const specifiers = [];
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    // Only repo-relative imports can reach a fenced directory; bare specifiers
    // are node builtins and dependencies.
    if (specifier.startsWith(".")) specifiers.push(resolve(dirname(absolutePath), specifier));
  }
  return specifiers;
}

const seen = new Set();
const violations = [];
const queue = ENTRY_POINTS.map((entry) => ({ path: resolve(repoRoot, entry), via: [entry] }));

while (queue.length) {
  const { path, via } = queue.shift();
  if (seen.has(path)) continue;
  seen.add(path);
  const relativePath = relative(repoRoot, path);
  const fenced = FENCED.find((rule) => relativePath.startsWith(rule.prefix));
  if (fenced) {
    violations.push(`${fenced.why}\n        reached by: ${via.join(" -> ")}`);
    continue;
  }
  for (const next of await importsOf(path)) {
    queue.push({ path: next, via: [...via, relative(repoRoot, next)] });
  }
}

assert.deepEqual(violations, [],
  `the production CSM thin path can reach a fenced capability:\n      ${violations.join("\n      ")}`);

// The walker must be able to fail. A fence that cannot detect a breach is a
// comment: this asserts the crawler actually follows relative imports several
// levels deep from a real entry point rather than stopping at the first file.
assert.ok(seen.size > 20, `import walk covered only ${seen.size} modules — the crawler is not walking`);

// And the thing being fenced is still there, defaulting to true. If this ever
// stops matching, the fence is guarding a hazard that no longer exists and
// this test should be re-read rather than deleted.
const providerOptions = await readFile(
  resolve(repoRoot, "lib/listing/pipeline/provider-options.mjs"), "utf8");
assert.match(providerOptions, /ENABLE_CATALOG_ASSIST_DEFAULT["']?,\s*true/,
  "provider-options no longer defaults catalog assist to true — re-read this fence");

console.log(`CSM thin path admission fence: ok (${seen.size} modules walked, 0 fenced reachable)`);
