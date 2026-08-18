import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = join(root, ".env.example");
const localPath = join(root, ".env.local");

const placeholderSecrets = Object.freeze({
  METAVERSE_AUTH_SECRET: "replace-with-a-long-random-secret",
  CRON_SECRET: "replace-with-a-long-random-cron-secret",
  LISTING_IMAGE_VERIFICATION_SECRET: ""
});

function parseEnvKeys(source) {
  const keys = new Set();
  for (const line of String(source || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    keys.add(trimmed.slice(0, index).trim());
  }
  return keys;
}

function replaceAssignment(source, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const assignment = `${key}=${value}`;
  return pattern.test(source) ? source.replace(pattern, assignment) : `${source.trimEnd()}\n${assignment}\n`;
}

if (!existsSync(examplePath)) {
  throw new Error("missing .env.example");
}

const created = !existsSync(localPath);
if (created) {
  copyFileSync(examplePath, localPath);
}

let contents = readFileSync(localPath, "utf8");
const exampleKeys = parseEnvKeys(readFileSync(examplePath, "utf8"));
const localKeys = parseEnvKeys(contents);
const missingKeys = [...exampleKeys].filter((key) => !localKeys.has(key));
if (missingKeys.length > 0) {
  console.warn(`local env is missing keys from .env.example: ${missingKeys.join(", ")}`);
}

let replaced = 0;
for (const [key, placeholder] of Object.entries(placeholderSecrets)) {
  const match = contents.match(new RegExp(`^${key}=(.*)$`, "m"));
  const current = match ? match[1] : "";
  if (current !== placeholder) continue;
  contents = replaceAssignment(contents, key, randomBytes(32).toString("base64url"));
  replaced += 1;
}

if (created || replaced > 0) {
  writeFileSync(localPath, contents);
}

console.log(
  created
    ? `created .env.local from .env.example (${replaced} local secrets generated)`
    : replaced > 0
      ? `updated .env.local (${replaced} placeholder secrets generated)`
      : ".env.local already present"
);
