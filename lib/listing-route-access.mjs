export const PROTECTED_APP_PATHS = Object.freeze([
  "/",
  "/index",
  "/index.html",
  "/app",
  "/app/",
  "/app/index",
  "/app/index.html"
]);

const protectedAppPaths = new Set(PROTECTED_APP_PATHS);

export function isProtectedAppPath(pathname) {
  return protectedAppPaths.has(String(pathname || ""));
}
