#!/usr/bin/env node
// Prove the boundary check FAILS when it should.
//
// The assertion this replaced passed for weeks while both sides named a
// decommissioned project -- a check that agrees with a stale record is
// indistinguishable from a check that works. So this drives the verifier
// against a temporary checkout state where the experiment tree IS linked to
// production, and requires it to refuse.
import assert from "node:assert";
import { execFile } from "node:child_process";
import { access, copyFile, readFile, realpath, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const REF = "supabase/.temp/project-ref";
const META = "supabase/.temp/linked-project.json";
const context = JSON.parse(await readFile("docs/operations/active-service-context.json", "utf8"));

// The verifier this exercises asserts that the checkout it runs in IS the
// PRODUCTION working copy, and reads Supabase CLI link state from
// `supabase/.temp/`, which is untracked. Neither holds in the experiment
// checkout and neither can ever hold on a CI runner, so running it there tests
// nothing and reports a boundary violation that does not exist.
//
// It also read `context.supabase.cli_link_expectation.forbidden_ref`, removed
// on 2026-08-03 by "remove the decommissioned project ref from every code
// path". The negative case no longer needs a named forbidden ref: the verifier
// requires the linked ref to EQUAL the canonical one, so any other ref is the
// refusal case.
const inProductionCheckout = await realpath(process.cwd())
  .then((cwd) => cwd === context.repository.production_checkout, () => false);
const linkStatePresent = await Promise.all([
  access(REF).then(() => true, () => false),
  access(META).then(() => true, () => false)
]).then((present) => present.every(Boolean));
if (!inProductionCheckout || !linkStatePresent) {
  console.log("verify-active-service-context: SKIP — "
    + (inProductionCheckout ? "Supabase CLI link state is absent" : "not the production checkout"));
  process.exit(0);
}
const forbidden = `${context.supabase.project_ref}-not-this-one`;

const verify = () => run("node", ["scripts/verify-active-service-context.mjs"]);

// Baseline: the checkout as it stands must pass.
await verify();

await copyFile(REF, `${REF}.testbak`);
await copyFile(META, `${META}.testbak`);
try {
  // Simulate someone running `supabase link` against production from here.
  await writeFile(REF, `${forbidden}\n`);
  await writeFile(META, JSON.stringify({
    ref: forbidden, name: context.supabase.project,
    organization_id: context.supabase.organization_id, organization_slug: context.supabase.organization_id
  }));
  let refused = false;
  try { await verify(); } catch (error) {
    refused = /supabase_link_ref_mismatch|experiment_checkout_linked_to_production/.test(String(error.stderr || error));
  }
  assert.ok(refused, "verifier must refuse when this checkout is linked to production");
} finally {
  await copyFile(`${REF}.testbak`, REF);
  await copyFile(`${META}.testbak`, META);
  await run("rm", ["-f", `${REF}.testbak`, `${META}.testbak`]);
}

// And it must still pass once the state is restored -- a check that fails
// always is no better than one that passes always.
await verify();
console.log("verify-active-service-context: 边界检查在该失败时确实失败，恢复后仍通过");
