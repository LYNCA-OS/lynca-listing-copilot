import { execFileSync } from "node:child_process";

export const listingEvalKeychain = Object.freeze({
  account: "listing-copilot-eval",
  username_service: "LISTING_COPILOT_EVAL_USERNAME",
  password_service: "LISTING_COPILOT_EVAL_PASSWORD",
  vercel_bypass_service: "VERCEL_AUTOMATION_BYPASS_SECRET"
});

function clean(value) {
  return String(value || "").trim();
}

function defaultKeychainReader(service, account) {
  if (process.platform !== "darwin") return "";
  try {
    return clean(execFileSync("security", [
      "find-generic-password", "-w", "-a", account, "-s", service
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return "";
  }
}

export function resolveListingEvalCredentials(env = process.env, {
  keychainReader = defaultKeychainReader
} = {}) {
  const fromKeychain = (service) => keychainReader(service, listingEvalKeychain.account);
  const username = clean(env.METAVERSE_USERNAME) || fromKeychain(listingEvalKeychain.username_service);
  const password = clean(env.METAVERSE_PASSWORD) || fromKeychain(listingEvalKeychain.password_service);
  const bypass = clean(env.VERCEL_AUTOMATION_BYPASS_SECRET)
    || fromKeychain(listingEvalKeychain.vercel_bypass_service);
  return {
    username,
    password,
    env: {
      ...env,
      ...(username ? { METAVERSE_USERNAME: username } : {}),
      ...(password ? { METAVERSE_PASSWORD: password } : {}),
      ...(bypass ? { VERCEL_AUTOMATION_BYPASS_SECRET: bypass } : {})
    },
    sources: {
      username: clean(env.METAVERSE_USERNAME) ? "environment" : username ? "keychain" : "missing",
      password: clean(env.METAVERSE_PASSWORD) ? "environment" : password ? "keychain" : "missing",
      vercel_bypass: clean(env.VERCEL_AUTOMATION_BYPASS_SECRET) ? "environment" : bypass ? "keychain" : "missing"
    }
  };
}
