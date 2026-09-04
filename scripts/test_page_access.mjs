import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("public/page_access.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: "public/page_access.js" });

const access = sandbox.window.OI_PAGE_ACCESS;
assert.ok(access, "page_access.js must register OI_PAGE_ACCESS");
assert.deepEqual(Array.from(access.PAGE_NAMES), [
  "offer-list-tracker",
  "payments",
  "publishers",
  "monthly-new-merchants",
  "brand-media",
  "revenue-flow",
  "google-ads",
  "sheets",
  "category",
  "tier",
  "dashboard",
  "agent"
]);
assert.equal(access.canAccessPage(0, "agent"), true);
assert.equal(access.canAccessPage(1, "google-ads"), false);
assert.equal(access.canAccessPage(2, "google-ads"), true);
assert.equal(access.canAccessPage(2, "payments"), false);
assert.equal(access.canAccessPage(3, "agent"), false);
assert.deepEqual(Array.from(access.allowedPages(2)), ["google-ads"]);
assert.equal(access.defaultPageForLevel(2), "google-ads");
assert.equal(access.defaultPageForLevel(1), "agent");
assert.deepEqual({ ...access.normalizeUser({
  id: 7,
  username: " ypadmin ",
  displayName: "Admin",
  email: "admin@example.test",
  level: 0,
  ignored: "must not cross the boundary"
}) }, {
  id: 7,
  username: "ypadmin",
  displayName: "Admin",
  email: "admin@example.test",
  level: 0
});
assert.equal(access.normalizeUser({ username: "ypadmin", level: 0, role: "admin" }), null);
assert.equal(access.normalizeUser({ username: "ypadmin", level: 0, password_hash: "not-forwarded" }), null);

console.log("PASS: page access contract");
