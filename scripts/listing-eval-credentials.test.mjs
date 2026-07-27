import assert from "node:assert/strict";

import { listingEvalKeychain, resolveListingEvalCredentials } from "./listing-eval-credentials.mjs";

const reads = [];
const keychainReader = (service, account) => {
  reads.push({ service, account });
  if (service === listingEvalKeychain.username_service) return "keychain-user";
  if (service === listingEvalKeychain.password_service) return "keychain-password";
  if (service === listingEvalKeychain.vercel_bypass_service) return "keychain-bypass";
  return "";
};

const fallback = resolveListingEvalCredentials({}, { keychainReader });
assert.equal(fallback.username, "keychain-user");
assert.equal(fallback.password, "keychain-password");
assert.equal(fallback.env.VERCEL_AUTOMATION_BYPASS_SECRET, "keychain-bypass");
assert.deepEqual(fallback.sources, {
  username: "keychain",
  password: "keychain",
  vercel_bypass: "keychain"
});
assert.equal(reads.every((row) => row.account === listingEvalKeychain.account), true);

const explicit = resolveListingEvalCredentials({
  METAVERSE_USERNAME: "env-user",
  METAVERSE_PASSWORD: "env-password",
  VERCEL_AUTOMATION_BYPASS_SECRET: "env-bypass"
}, { keychainReader: () => { throw new Error("must not read keychain"); } });
assert.equal(explicit.username, "env-user");
assert.equal(explicit.password, "env-password");
assert.equal(explicit.env.VERCEL_AUTOMATION_BYPASS_SECRET, "env-bypass");
assert.deepEqual(explicit.sources, {
  username: "environment",
  password: "environment",
  vercel_bypass: "environment"
});

console.log("listing eval credential resolution tests passed");
