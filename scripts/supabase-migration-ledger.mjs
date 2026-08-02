#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NORMALIZATION_PROFILE = "sql-line-endings-trailing-space-empty-tail-v1";
export const CONTROLLED_PATH_ACK = "single-migration-only-no-db-push";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultLocalDir = join(repoRoot, "supabase/migrations");
const defaultReceiptPath = join(
  repoRoot,
  "docs/operations/supabase-migration-receipt-csm-atomic-stage-packet-v1.json"
);
const defaultJsonPath = join(repoRoot, "docs/operations/supabase-migration-ledger-audit-2026-08-01.json");
const defaultMarkdownPath = join(repoRoot, "docs/operations/supabase-migration-ledger-audit-2026-08-01.md");

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeFetchedSql(value) {
  let normalized = String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd();
  normalized = normalized.replace(/(?:;\s*)+$/, ";");
  return `${normalized}\n`;
}

export function parseMigrationFilename(filename) {
  const match = /^(\d+)_([^/]+)\.sql$/.exec(filename);
  if (!match) throw new Error(`invalid_migration_filename:${filename}`);
  return { version: match[1], name: match[2] };
}

function lineCount(value) {
  return (String(value).match(/\n/g) || []).length + (String(value).endsWith("\n") ? 0 : 1);
}

function publicMigration(entry) {
  return {
    version: entry.version,
    name: entry.name,
    filename: entry.filename,
    sha256: entry.sha256,
    normalized_sha256: entry.normalizedSha256,
    bytes: entry.bytes,
    lines: entry.lines
  };
}

export async function readMigrationDirectory(directory, source) {
  const filenames = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  return Promise.all(filenames.map(async (filename) => {
    const { version, name } = parseMigrationFilename(filename);
    const content = await readFile(join(directory, filename), "utf8");
    const normalized = normalizeFetchedSql(content);
    return {
      source,
      version,
      name,
      filename,
      content,
      sha256: hash(content),
      normalizedSha256: hash(normalized),
      bytes: Buffer.byteLength(content),
      lines: lineCount(content)
    };
  }));
}

function groupBy(entries, key) {
  const grouped = new Map();
  for (const entry of entries) {
    const value = entry[key];
    const current = grouped.get(value) || [];
    current.push(entry);
    grouped.set(value, current);
  }
  return grouped;
}

export function summarizeContentDifference(local, remote) {
  const rawEqual = local.sha256 === remote.sha256;
  const normalizedEqual = local.normalizedSha256 === remote.normalizedSha256;
  const localLines = local.content.replace(/\r\n?/g, "\n").split("\n");
  const remoteLines = remote.content.replace(/\r\n?/g, "\n").split("\n");
  let prefix = 0;
  while (prefix < localLines.length && prefix < remoteLines.length
    && localLines[prefix] === remoteLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < localLines.length - prefix && suffix < remoteLines.length - prefix
    && localLines[localLines.length - 1 - suffix] === remoteLines[remoteLines.length - 1 - suffix]) suffix += 1;
  return {
    classification: rawEqual ? "byte_identical" : normalizedEqual ? "normalized_equivalent" : "content_changed",
    raw_equal: rawEqual,
    normalized_equal: normalizedEqual,
    first_differing_line: rawEqual ? null : prefix + 1,
    local_changed_line_count: rawEqual ? 0 : Math.max(0, localLines.length - prefix - suffix),
    remote_changed_line_count: rawEqual ? 0 : Math.max(0, remoteLines.length - prefix - suffix),
    local_bytes: local.bytes,
    remote_bytes: remote.bytes
  };
}

function classifyVersion(local, remote) {
  if (!local.length) return { status: "remote_only", comparisons: [] };
  if (!remote.length) return { status: "local_only", comparisons: [] };
  if (local.length !== 1 || remote.length !== 1) {
    return { status: "ambiguous_duplicate_version", comparisons: [] };
  }
  const comparison = summarizeContentDifference(local[0], remote[0]);
  if (local[0].name !== remote[0].name) return { status: "version_name_mismatch", comparisons: [comparison] };
  if (!comparison.normalized_equal) return { status: "content_mismatch", comparisons: [comparison] };
  return {
    status: comparison.raw_equal ? "exact" : "normalized_equivalent",
    comparisons: [comparison]
  };
}

function receiptValidation(receipt, projectRef, localEntries, remoteEntries) {
  if (!receipt) return { required: false, ok: true, receipt_id: null, issues: [] };
  const issues = [];
  if (receipt.project_ref !== projectRef) issues.push("project_ref_mismatch");
  if (receipt.normalization_profile !== NORMALIZATION_PROFILE) issues.push("normalization_profile_mismatch");
  if (receipt.safety?.ddl_already_applied !== true) issues.push("receipt_missing_applied_assertion");
  if (receipt.safety?.ddl_reapply_forbidden !== true) issues.push("receipt_missing_reapply_prohibition");
  if (receipt.safety?.migration_history_repair_forbidden !== true) issues.push("receipt_missing_repair_prohibition");
  let mode = "source_mapping";
  let local = localEntries.find((entry) => entry.version === receipt.local.version && entry.name === receipt.migration_name);
  let localExpected = receipt.local;
  if (!local) {
    mode = "canonical_remote_projection";
    local = localEntries.find((entry) => entry.version === receipt.remote.version && entry.name === receipt.migration_name);
    localExpected = receipt.remote;
  }
  const remote = remoteEntries.find((entry) => entry.version === receipt.remote.version && entry.name === receipt.migration_name);
  if (!local) issues.push("local_receipt_entry_missing");
  if (!remote) issues.push("remote_receipt_entry_missing");
  for (const [side, actual, expected] of [["local", local, localExpected], ["remote", remote, receipt.remote]]) {
    if (!actual) continue;
    if (actual.filename !== expected.filename) issues.push(`${side}_filename_mismatch`);
    if (actual.sha256 !== expected.sha256) issues.push(`${side}_sha256_mismatch`);
    if (actual.normalizedSha256 !== expected.normalized_sha256) issues.push(`${side}_normalized_sha256_mismatch`);
  }
  if (local && remote && local.normalizedSha256 !== remote.normalizedSha256) {
    issues.push("receipt_content_not_normalized_equivalent");
  }
  return {
    required: true,
    ok: issues.length === 0,
    receipt_id: receipt.receipt_id,
    mode,
    issues
  };
}

export async function buildMigrationLedgerAudit({
  localDir,
  remoteDir,
  projectRef,
  generatedAt,
  cliVersion,
  receipt = null,
  linkedListRemoteVersions = null
}) {
  const [localEntries, remoteEntries] = await Promise.all([
    readMigrationDirectory(localDir, "local"),
    readMigrationDirectory(remoteDir, "remote")
  ]);
  const localByVersion = groupBy(localEntries, "version");
  const remoteByVersion = groupBy(remoteEntries, "version");
  const localByName = groupBy(localEntries, "name");
  const remoteByName = groupBy(remoteEntries, "name");
  const versions = [...new Set([...localByVersion.keys(), ...remoteByVersion.keys()])].sort();
  const sharedVersions = versions.filter((version) => localByVersion.has(version) && remoteByVersion.has(version));
  const localOnlyVersions = versions.filter((version) => localByVersion.has(version) && !remoteByVersion.has(version));
  const remoteOnlyVersions = versions.filter((version) => !localByVersion.has(version) && remoteByVersion.has(version));
  const versionLedger = versions.map((version) => {
    const local = localByVersion.get(version) || [];
    const remote = remoteByVersion.get(version) || [];
    const classification = classifyVersion(local, remote);
    return {
      version,
      status: classification.status,
      local: local.map(publicMigration),
      remote: remote.map(publicMigration),
      content_comparisons: classification.comparisons
    };
  });
  const sameNameDifferentVersionMappings = [];
  for (const name of [...localByName.keys()].filter((value) => remoteByName.has(value)).sort()) {
    for (const local of localByName.get(name)) {
      for (const remote of remoteByName.get(name)) {
        if (local.version === remote.version) continue;
        sameNameDifferentVersionMappings.push({
          name,
          local_version: local.version,
          remote_version: remote.version,
          local_filename: local.filename,
          remote_filename: remote.filename,
          content: summarizeContentDifference(local, remote)
        });
      }
    }
  }
  const duplicateLocalVersions = [...localByVersion.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([version, entries]) => ({ version, files: entries.map((entry) => entry.filename) }));
  const duplicateRemoteVersions = [...remoteByVersion.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([version, entries]) => ({ version, files: entries.map((entry) => entry.filename) }));
  const ledgerExact = localByVersion.size === remoteByVersion.size
    && duplicateLocalVersions.length === 0
    && duplicateRemoteVersions.length === 0
    && versionLedger.every((entry) => entry.status === "exact" || entry.status === "normalized_equivalent");
  const listedRemoteVersions = linkedListRemoteVersions ? [...new Set(linkedListRemoteVersions)].sort() : null;
  const fetchedRemoteVersions = [...remoteByVersion.keys()].sort();
  const linkedListFetchConsistent = listedRemoteVersions === null
    ? null
    : JSON.stringify(listedRemoteVersions) === JSON.stringify(fetchedRemoteVersions);
  if (linkedListFetchConsistent === false) throw new Error("linked_list_fetch_version_mismatch");
  const validation = receiptValidation(receipt, projectRef, localEntries, remoteEntries);
  return {
    schema_version: "supabase-migration-ledger-audit-v1",
    generated_at: generatedAt,
    project_ref: projectRef,
    source: {
      supabase_cli_version: cliVersion,
      remote_history: listedRemoteVersions === null
        ? "provided local snapshot directory"
        : "supabase migration fetch --linked in an isolated temporary workdir",
      linked_list_remote_version_count: listedRemoteVersions?.length ?? null,
      linked_list_fetch_consistent: linkedListFetchConsistent,
      remote_writes_performed: false
    },
    normalization: {
      profile: NORMALIZATION_PROFILE,
      scope: "CRLF, line-tail whitespace, and repeated empty trailing SQL statements only",
      semantic_equivalence_claimed: false
    },
    summary: {
      local_file_count: localEntries.length,
      remote_file_count: remoteEntries.length,
      local_version_count: localByVersion.size,
      remote_version_count: remoteByVersion.size,
      shared_version_count: sharedVersions.length,
      local_only_version_count: localOnlyVersions.length,
      remote_only_version_count: remoteOnlyVersions.length,
      duplicate_local_version_count: duplicateLocalVersions.length,
      duplicate_remote_version_count: duplicateRemoteVersions.length,
      same_name_different_version_mapping_count: sameNameDifferentVersionMappings.length,
      ledger_exact: ledgerExact,
      db_push_allowed: ledgerExact && validation.ok && linkedListFetchConsistent === true
    },
    receipt_validation: validation,
    duplicate_versions: {
      local: duplicateLocalVersions,
      remote: duplicateRemoteVersions
    },
    same_name_different_version_mappings: sameNameDifferentVersionMappings,
    versions: versionLedger
  };
}

export function dbPushGuardDecision(audit) {
  const allowed = audit.summary.db_push_allowed;
  return allowed ? {
    ok: true,
    decision: "db_push_allowed_exact_ledger",
    db_push_allowed: true
  } : {
    ok: false,
    decision: "db_push_blocked_divergent_or_unreceipted_ledger",
    db_push_allowed: false,
    local_only_version_count: audit.summary.local_only_version_count,
    remote_only_version_count: audit.summary.remote_only_version_count,
    receipt_valid: audit.receipt_validation.ok
  };
}

export function controlledMigrationDecision(audit, filename, acknowledgement) {
  const denied = (reason) => ({
    ok: false,
    decision: reason,
    db_push_allowed: false,
    controlled_single_migration_allowed: false
  });
  if (acknowledgement !== CONTROLLED_PATH_ACK) return denied("controlled_path_acknowledgement_missing");
  if (audit.source.linked_list_fetch_consistent !== true) return denied("controlled_path_requires_fresh_linked_list_and_fetch");
  if (!audit.receipt_validation.ok) return denied("receipt_validation_failed");
  const local = audit.versions.flatMap((entry) => entry.local).find((entry) => entry.filename === filename);
  if (!local) return denied("controlled_migration_not_in_local_ledger");
  const sameVersion = audit.versions.find((entry) => entry.version === local.version);
  if (sameVersion.remote.length) return denied("controlled_migration_version_already_remote");
  if (sameVersion.local.length !== 1) return denied("controlled_migration_version_not_unique");
  const sameName = audit.same_name_different_version_mappings.filter((entry) => entry.name === local.name);
  if (sameName.some((entry) => entry.content.normalized_equal)) {
    return denied("controlled_migration_already_applied_under_different_version");
  }
  if (sameName.length) return denied("controlled_migration_name_collides_with_remote_history");
  if (!/^\d{14}$/.test(local.version)) return denied("controlled_migration_version_must_be_14_digit_timestamp");
  const remoteVersions = audit.versions.filter((entry) => entry.remote.length).map((entry) => BigInt(entry.version));
  if (!remoteVersions.length || BigInt(local.version) <= remoteVersions.reduce((max, value) => value > max ? value : max)) {
    return denied("controlled_migration_not_newer_than_remote_history");
  }
  return {
    ok: true,
    decision: "controlled_single_migration_only",
    db_push_allowed: false,
    controlled_single_migration_allowed: true,
    migration: local,
    constraint: "Apply only this SQL through a reviewed single-migration runner; never invoke db push from the divergent worktree."
  };
}

function markdownList(entries) {
  return entries.length ? entries.map((entry) => `\`${entry.filename}\``).join("<br>") : "—";
}

export function renderMigrationLedgerMarkdown(audit) {
  const summaryRows = Object.entries(audit.summary)
    .map(([key, value]) => `| \`${key}\` | ${value} |`)
    .join("\n");
  const mappingRows = audit.same_name_different_version_mappings.length
    ? audit.same_name_different_version_mappings.map((entry) => (
      `| \`${entry.name}\` | \`${entry.local_version}\` | \`${entry.remote_version}\` | ${entry.content.classification} | ${entry.content.local_changed_line_count}/${entry.content.remote_changed_line_count} |`
    )).join("\n")
    : "| — | — | — | — | — |";
  const versionRows = audit.versions.map((entry) => {
    const comparison = entry.content_comparisons[0]?.classification || "—";
    return `| \`${entry.version}\` | ${entry.status} | ${markdownList(entry.local)} | ${markdownList(entry.remote)} | ${comparison} |`;
  }).join("\n");
  const receipt = audit.receipt_validation;
  return `# Supabase migration ledger audit — 2026-08-01

This is a secret-free, read-only audit of project \`${audit.project_ref}\`. Remote SQL was fetched into an isolated temporary directory and discarded after hashing; no SQL body, connection string, token, or password is persisted here.

## Decision

**DB push is ${audit.summary.db_push_allowed ? "ALLOWED" : "BLOCKED"}.** The ledger is ${audit.summary.ledger_exact ? "exact" : "divergent"}; receipt \`${receipt.receipt_id || "none"}\` is ${receipt.ok ? "valid" : "invalid"}.

| Metric | Value |
|---|---:|
${summaryRows}

Normalization profile: \`${audit.normalization.profile}\`. It only removes representation noise listed in the JSON audit and is not a general SQL semantic-equivalence claim.

## Pinned CSM receipt

The already-applied \`csm_atomic_stage_packet_v1\` migration is pinned as remote \`20260801094353\` ↔ local \`20260801123000\`. A controlled-path request for the local file must fail as already applied; neither DDL replay nor migration-history repair is permitted.

## Guard commands

\`node scripts/supabase-migration-ledger.mjs guard-db-push --linked\` succeeds only after a fresh linked list/fetch proves an exact ledger. On a divergent ledger, use \`guard-single --linked --migration <file> --ack ${CONTROLLED_PATH_ACK}\`; success authorizes only that reviewed file and never executes or authorizes \`db push\`.

## Same-name, different-version mappings

Changed lines are reported as local/remote counts; SQL text is intentionally omitted.

| Name | Local version | Remote version | Content summary | Changed lines |
|---|---:|---:|---|---:|
${mappingRows}

## Full version ledger

| Version | Status | Local | Remote | Content summary |
|---|---|---|---|---|
${versionRows}

## Lossless convergence path

1. Keep this 107-file worktree immutable as historical application evidence; do not rename, move, delete, repair, or replay its divergent migrations.
2. For every database operation, rebuild an isolated remote-first workdir from \`migration list/fetch --linked\`. Its fetched 86-file history is the only deployable ledger baseline.
3. Convert same-name/different-version normalized matches into signed receipts. For mismatches, compare the live schema to the intended contract; never infer unapplied DDL from a filename.
4. Express only verified schema deltas as new additive migrations with versions later than the remote maximum. The controlled guard may authorize exactly one such file; the divergent worktree may never call \`db push\`.
5. After the new migration is applied through a reviewed single-migration runner, fetch again, pin its remote receipt, and require exact remote-first ledger status before enabling ordinary pushes.
`;
}

function parseArgs(argv) {
  const [command = "help", ...tokens] = argv;
  const values = { command };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new Error(`unexpected_argument:${token}`);
    const key = token.slice(2).replaceAll("-", "_");
    if (["linked", "write", "check"].includes(key)) values[key] = true;
    else {
      const value = tokens[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing_value:${token}`);
      values[key] = value;
      index += 1;
    }
  }
  return values;
}

function supabaseOutput(args, cwd) {
  const result = spawnSync("supabase", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`supabase_read_failed:${args.slice(0, 2).join("_")}:exit_${result.status}`);
  return result.stdout;
}

function parseListedRemoteVersions(output) {
  return String(output).split(/\r?\n/).flatMap((line) => {
    const columns = line.split("|");
    if (columns.length < 3) return [];
    const remote = columns[1].trim();
    return /^\d+$/.test(remote) ? [remote] : [];
  });
}

async function fetchLinkedHistory(localDir, expectedProjectRef) {
  const linkedRoot = dirname(dirname(localDir));
  const linkDir = join(linkedRoot, "supabase/.temp");
  const linkedRef = (await readFile(join(linkDir, "project-ref"), "utf8")).trim();
  if (linkedRef !== expectedProjectRef) throw new Error("linked_project_ref_mismatch");
  const listed = parseListedRemoteVersions(supabaseOutput(["migration", "list", "--linked"], linkedRoot));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "lynca-supabase-ledger-"));
  try {
    await mkdir(join(temporaryRoot, "supabase"), { recursive: true });
    await cp(linkDir, join(temporaryRoot, "supabase/.temp"), { recursive: true });
    supabaseOutput(["migration", "fetch", "--linked", "--yes", "--workdir", temporaryRoot], linkedRoot);
    return {
      directory: join(temporaryRoot, "supabase/migrations"),
      linkedListRemoteVersions: listed,
      cleanup: async () => rm(temporaryRoot, { recursive: true, force: true })
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function cliVersion() {
  return supabaseOutput(["--version"], repoRoot).trim();
}

async function loadReceipt(pathname) {
  return JSON.parse(await readFile(pathname, "utf8"));
}

async function resolveRemoteSource(args, localDir, projectRef) {
  if (args.remote_dir && args.linked) throw new Error("choose_remote_dir_or_linked");
  if (args.remote_dir) {
    return { directory: resolve(args.remote_dir), linkedListRemoteVersions: null, cleanup: async () => {} };
  }
  if (!args.linked) throw new Error("remote_source_required_use_--linked_or_--remote-dir");
  return fetchLinkedHistory(localDir, projectRef);
}

async function existingGeneratedAt(jsonPath) {
  try {
    return JSON.parse(await readFile(jsonPath, "utf8")).generated_at;
  } catch {
    return null;
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") {
    process.stdout.write("usage: supabase-migration-ledger.mjs <audit|guard-db-push|guard-single> (--linked|--remote-dir DIR) [options]\n");
    return;
  }
  const localDir = resolve(args.local_dir || defaultLocalDir);
  const receiptPath = resolve(args.receipt || defaultReceiptPath);
  const receipt = await loadReceipt(receiptPath);
  const projectRef = args.project_ref || receipt.project_ref;
  const jsonPath = resolve(args.json_out || defaultJsonPath);
  const markdownPath = resolve(args.markdown_out || defaultMarkdownPath);
  const generatedAt = args.generated_at
    || (args.check ? await existingGeneratedAt(jsonPath) : null)
    || new Date().toISOString();
  const remoteSource = await resolveRemoteSource(args, localDir, projectRef);
  try {
    const audit = await buildMigrationLedgerAudit({
      localDir,
      remoteDir: remoteSource.directory,
      projectRef,
      generatedAt,
      cliVersion: cliVersion(),
      receipt,
      linkedListRemoteVersions: remoteSource.linkedListRemoteVersions
    });
    if (args.command === "guard-db-push") {
      const decision = dbPushGuardDecision(audit);
      process.stdout.write(`${JSON.stringify(decision)}\n`);
      if (!decision.ok) process.exitCode = 1;
      return;
    }
    if (args.command === "guard-single") {
      if (!args.migration) throw new Error("--migration_required");
      const migrationPath = await realpath(resolve(args.migration));
      if (await realpath(dirname(migrationPath)) !== await realpath(localDir)) {
        throw new Error("controlled_migration_outside_local_directory");
      }
      const decision = controlledMigrationDecision(audit, basename(migrationPath), args.ack);
      process.stdout.write(`${JSON.stringify(decision)}\n`);
      if (!decision.ok) process.exitCode = 1;
      return;
    }
    if (args.command !== "audit") throw new Error(`unknown_command:${args.command}`);
    const json = `${JSON.stringify(audit, null, 2)}\n`;
    const markdown = renderMigrationLedgerMarkdown(audit);
    if (args.check) {
      const [existingJson, existingMarkdown] = await Promise.all([
        readFile(jsonPath, "utf8"), readFile(markdownPath, "utf8")
      ]);
      if (json !== existingJson || markdown !== existingMarkdown) throw new Error("migration_ledger_artifacts_stale");
    } else if (args.write) {
      await Promise.all([mkdir(dirname(jsonPath), { recursive: true }), mkdir(dirname(markdownPath), { recursive: true })]);
      await Promise.all([writeFile(jsonPath, json), writeFile(markdownPath, markdown)]);
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      ledger_exact: audit.summary.ledger_exact,
      db_push_allowed: audit.summary.db_push_allowed,
      local_files: audit.summary.local_file_count,
      remote_files: audit.summary.remote_file_count,
      local_only_versions: audit.summary.local_only_version_count,
      remote_only_versions: audit.summary.remote_only_version_count,
      receipt_valid: audit.receipt_validation.ok,
      artifacts: args.write || args.check ? [relative(repoRoot, jsonPath), relative(repoRoot, markdownPath)] : []
    })}\n`);
  } finally {
    await remoteSource.cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
