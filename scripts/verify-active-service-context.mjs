#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const contextPath = join(repoRoot, "docs/operations/active-service-context.json");
const context = JSON.parse(await readFile(contextPath, "utf8"));

assert.equal(await realpath(repoRoot), context.repository.checkout, "repository_checkout_mismatch");
assert.equal(
  execFileSync("git", ["remote", "get-url", "origin"], { cwd: repoRoot, encoding: "utf8" }).trim(),
  context.repository.origin,
  "repository_origin_mismatch"
);

async function verifyVercelLink(target) {
  const link = JSON.parse(await readFile(join(repoRoot, target.link_file), "utf8"));
  assert.equal(link.orgId, context.vercel.scope.id, `${target.project}_vercel_scope_mismatch`);
  assert.equal(link.projectId, target.project_id, `${target.project}_vercel_project_id_mismatch`);
  assert.equal(link.projectName, target.project, `${target.project}_vercel_project_name_mismatch`);
}

await verifyVercelLink(context.vercel.production);
await verifyVercelLink(context.vercel.capacity_lab);

const linkedRef = (await readFile(join(repoRoot, context.supabase.link_ref_file), "utf8")).trim();
assert.equal(linkedRef, context.supabase.project_ref, "supabase_link_ref_mismatch");
const linkedProject = JSON.parse(await readFile(join(repoRoot, context.supabase.link_metadata_file), "utf8"));
assert.equal(linkedProject.ref, context.supabase.project_ref, "supabase_metadata_ref_mismatch");
assert.equal(linkedProject.name, context.supabase.project, "supabase_project_name_mismatch");
assert.equal(linkedProject.organization_id, context.supabase.organization_id, "supabase_organization_mismatch");

const envPath = join(repoRoot, context.supabase.local_env);
const envText = await readFile(envPath, "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).flatMap((line) => {
  const separator = line.indexOf("=");
  return separator > 0 && !line.startsWith("#") ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
}));
for (const name of context.supabase.required_server_env) {
  assert.ok(String(env[name] || "").trim(), `${name.toLowerCase()}_missing`);
}
const supabaseUrl = new URL(env.SUPABASE_URL);
assert.equal(supabaseUrl.protocol, "https:", "supabase_url_protocol_mismatch");
assert.equal(supabaseUrl.hostname, `${context.supabase.project_ref}.supabase.co`, "supabase_url_ref_mismatch");
assert.equal((await stat(envPath)).mode & 0o077, 0, "local_env_permissions_too_open");

process.stdout.write(`${JSON.stringify({
  ok: true,
  repository: context.repository.origin,
  linear: `${context.linear.workspace}/${context.linear.team.name}/${context.linear.project.id}`,
  vercel: `${context.vercel.scope.slug}/${context.vercel.production.project}`,
  capacity_lab: `${context.vercel.scope.slug}/${context.vercel.capacity_lab.project}:preview`,
  supabase_project_ref: context.supabase.project_ref
})}\n`);
