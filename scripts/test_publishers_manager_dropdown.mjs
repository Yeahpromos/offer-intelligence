import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

function assertIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error(`${label}: missing ${JSON.stringify(fragment)}`);
  }
}

assertIncludes(
  app,
  'filters.classList.add("combobox-open");',
  "filter stacking context raised when manager menu opens",
);
assertIncludes(
  app,
  'filters.classList.remove("combobox-open");',
  "filter stacking context restored when manager menu closes",
);
assertIncludes(
  styles,
  ".publishers-page > .publishers-filters.combobox-open",
  "open manager menu stacking rule",
);
assertIncludes(styles, "z-index: 30;", "manager menu stacking level");

console.log("Publisher manager dropdown stacking checks passed");
