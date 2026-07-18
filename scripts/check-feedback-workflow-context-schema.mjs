#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";
import { main } from "../lib/listing/readiness/workflow-context-schema.mjs";

export * from "../lib/listing/readiness/workflow-context-schema.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
