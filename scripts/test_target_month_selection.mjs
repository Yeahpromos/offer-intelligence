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

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy, got ${JSON.stringify(value)}`);
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
  URLSearchParams,
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
assertTruthy(hooks.targetRecords, "targetRecords hook should be exposed");
assertTruthy(hooks.preferredTargetMonth, "preferredTargetMonth hook should be exposed");

const records = hooks.targetRecords();
const months = Array.from(new Set(records.map((row) => row.Month).filter(Boolean)));
assertTruthy(months.includes("July 2026"), "July target template should remain available");
assertEqual(hooks.targetMonthHasMetrics("July 2026"), false, "July target template should be recognized as metric-empty");
assertEqual(hooks.preferredTargetMonth(records), "June 2026", "target matrix should default to the latest month with real summary metrics");
