#!/usr/bin/env node
// Offline identity stub for the independent Runtime process boundary.
//
// This file is not LYNCA-OS/lynca-runtime and must never be scored as the
// Runtime arm. It exists so CI can prove the shadow adapter spawns a process
// whose import graph is not Listing Copilot's production thin path.
// It must not import anything from this repository.

const [command, frontPath, backPath] = process.argv.slice(2);

if (process.env.INDEPENDENT_RUNTIME_STUB_EMPTY === "true") {
  process.exit(0);
}

if (command !== "identify" || !frontPath || !backPath) {
  process.stderr.write("Usage: independent-runtime-identify-stub.mjs identify <front> <back>\n");
  process.exit(2);
}

if (process.env.INDEPENDENT_RUNTIME_STUB_FAIL === "true") {
  process.stderr.write("independent_runtime_stub_forced_failure\n");
  process.exit(1);
}

const receipt = {
  schema_version: "independent-runtime-identify-stub-v1",
  not_lynca_runtime: true,
  command,
  front_path: frontPath,
  back_path: backPath,
  title: null,
  note: "Offline stub. Not a dual-consumer Runtime score."
};

process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
