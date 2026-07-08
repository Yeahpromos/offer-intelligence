import fs from "node:fs";
import vm from "node:vm";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, label) {
  const stable = (value) => Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  const actualJson = JSON.stringify(stable(actual));
  const expectedJson = JSON.stringify(stable(expected));
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {},
  appendChild() {},
  querySelectorAll() { return []; },
  querySelector() { return null; },
  setAttribute() {},
  removeAttribute() {},
  style: {}
};

const sandbox = {
  console,
  Date,
  Math,
  Number,
  String,
  RegExp,
  Array,
  Object,
  Set,
  Map,
  JSON,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  },
  document: {
    getElementById() { return elementStub; },
    querySelectorAll() { return []; },
    querySelector() { return elementStub; },
    createElement() { return { ...elementStub }; }
  }
};
sandbox.window.document = sandbox.document;

runScript("protected_data/chatbot_data.js", sandbox);
runScript("protected_data/product_keywords.js", sandbox);
runScript("protected_data/sheet_report_data.js", sandbox);
runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assertTruthy(hooks, "app should expose test hooks in test mode");

assertEqual(
  hooks.tierRowHighlightKind("Tier 3", { "Tier Reason": "New June raw offer with orders", visualStatusColor: "red" }),
  "red",
  "generated visual status should override legacy Tier 3 green rule"
);
assertEqual(
  hooks.tierRowHighlightKind("Tier 4", { "Tier Reason": "0 orders", "Visual Status Color": "none" }),
  "",
  "explicit none should suppress legacy Tier 4 red rule"
);
assertEqual(
  hooks.tierRowHighlightKind("Tier 2", { Phase: "Stable", visual_status_color: "green" }),
  "green",
  "snake-case visual status field should override Tier 2 phase"
);
assertEqual(
  hooks.tierRowHighlightKind("Tier 2", { Phase: "Stable" }),
  "yellow",
  "Tier 2 phase should remain the fallback rule"
);
assertEqual(
  hooks.visualStatusForTierRow("Tier 1", { "Original Rank": "45", visualStatus: { color: "yellow" } }).source,
  "manual",
  "nested visual status should be treated as an explicit override"
);

function colorCounts(tierName) {
  const counts = {};
  for (const row of hooks.tierSheetRowsForDisplay(tierName)) {
    const key = hooks.tierRowHighlightKind(tierName, row) || "none";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

assertDeepEqual(colorCounts("Tier 1"), { green: 10, none: 40 }, "Tier 1 color baseline");
assertDeepEqual(colorCounts("Tier 2"), { green: 41, yellow: 3, red: 20 }, "Tier 2 color baseline");
assertDeepEqual(colorCounts("Tier 3"), { green: 185, red: 2, none: 200 }, "Tier 3 color baseline");
assertDeepEqual(colorCounts("Tier 4"), { green: 66, red: 5745 }, "Tier 4 color baseline");
assertDeepEqual(colorCounts("BLACK TIER"), { none: 10 }, "BLACK TIER color baseline");
