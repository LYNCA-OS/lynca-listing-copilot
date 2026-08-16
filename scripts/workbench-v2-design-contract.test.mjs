import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, js, themeController, packageJson] = await Promise.all([
  readFile("app/index.html", "utf8"),
  readFile("app/workbench-v2.css", "utf8"),
  readFile("app/listing-copilot.js", "utf8"),
  readFile("app/theme-controller.js", "utf8"),
  readFile("package.json", "utf8")
]);

assert.match(html, /href="\/app\/workbench-v2\.css"/, "production workbench must load the isolated v2 visual layer");
assert.doesNotMatch(html, /href="\/app\/commercial-ui\.css"/, "the retired workbench skin must not stack under v2");
assert.match(themeController, /DEFAULT_THEME = "foundation-navy"/, "Foundation Navy must be the default skin");
assert.match(themeController, /STORAGE_KEY = "lynca-listing-theme-v2"/, "existing users must migrate to the reviewed default skin once");
assert.match(css, /--duration-queue: 190ms/, "queue continuity must stay below the 300ms UI budget");
assert.match(css, /--ease-in-out: cubic-bezier\(0\.77, 0, 0\.175, 1\)/, "layout motion must use the reviewed strong curve");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, "movement must have a reduced-motion equivalent");
assert.doesNotMatch(css, /transition:\s*all\b/, "workbench motion must never animate unspecified properties");
assert.doesNotMatch(css, /scale\(0\)/, "nothing in the workbench may appear from zero scale");
assert.match(js, /saveTitleFeedback\(saveButton, \{ animate: false \}\)/, "keyboard submission must remain instant");
assert.match(js, /batchReviewWindow\(reviewAssets/, "Queue Overview must retain its bounded attention window");
assert.equal((html.match(/<button class="workspace-mode-tab/g) || []).length, 2,
  "the workbench must expose only Queue Overview and Writer Terminal");
assert.doesNotMatch(js, /function renderWriterWheel|saveWriterTitleAndAdvance/,
  "the superseded Writer Wheel interaction must not remain reachable");
assert.doesNotMatch(packageJson, /"motion"\s*:/, "deterministic queue motion must not add a runtime animation dependency");

console.log("workbench v2 design contract tests passed");
