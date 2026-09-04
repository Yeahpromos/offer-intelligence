import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const auth = fs.readFileSync("public/auth.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");

assert.match(html, /page_access\.js[^>]*><\/script>\s*<script[^>]+auth\.js/, "page access must load before auth.js");
assert.match(auth, /setAuthUser\(session\.user\)/, "session success must store the public user");
assert.match(auth, /setAuthUser\(loginResult\.user\)/, "login success must store the public user");
assert.match(auth, /if \(user\.level === 2\)/, "level 2 must have a minimal startup branch");
assert.match(auth, /window\.CHATBOT_DATA = \{ summary: \{\}, offers: \[\], paymentRecords: \[\] \}/, "level 2 must not bootstrap offers");
assert.match(auth, /window\.PRODUCT_KEYWORDS = \{ merchants: \[\] \}/, "level 2 must not bootstrap keywords");
assert.match(auth, /mountApplication\(modernAppRoot, initialPage\)/, "modern app must use the level default page");
assert.match(auth, /oi-auth-failure/, "auth shell must handle API auth failures");
assert.doesNotMatch(auth, /(?:\.\/app\.js|legacyRollback|LegacyRollback)/i, "current M7 build has no legacy runtime fallback");

function element() {
  const listeners = new Map();
  const classes = new Set();
  return {
    style: {},
    dataset: {},
    value: "",
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name)
    },
    setAttribute() {},
    removeAttribute() {},
    addEventListener: (name, callback) => listeners.set(name, callback),
    focus() {},
    replaceChildren() {},
    appendChild() {},
    listeners
  };
}

async function runAuthShell(level) {
  const requested = [];
  const elements = new Map([
    ["authShell", element()], ["appShell", element()], ["modernAppRoot", element()],
    ["modernAppError", element()], ["modernAppErrorMessage", element()], ["modernAppErrorRetry", element()],
    ["authForm", element()], ["authUsername", element()], ["authPassword", element()], ["authSubmit", element()],
    ["authStatus", element()], ["appLoadingSkeleton", element()], ["skeletonLoadingStatus", element()],
    ["skeletonLoadingPercent", element()], ["skeletonLoadingTrack", element()], ["skeletonLoadingValue", element()],
    ["skeletonLoadingNote", element()], ["modernLogoutButton", element()]
  ]);
  const domListeners = new Map();
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const window = {
    matchMedia: () => ({ matches: true }),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    localStorage: storage,
    location: { reload() {} },
    addEventListener: (name, callback) => domListeners.set(name, callback),
    dispatchEvent() {},
    CustomEvent,
    pageXOffset: 0
  };
  const document = {
    readyState: "loading",
    body: {
      classList: { add() {}, remove() {} },
      appendChild(script) {
        window.OI_MODERN_APP = {
          bootstrap(data) { window.__bootstrap = data; },
          mountApplication(_root, initialPage) { window.__initialPage = initialPage; return true; }
        };
        queueMicrotask(() => script.onload?.());
      }
    },
    defaultView: window,
    getElementById: (id) => elements.get(id) || null,
    createElement: () => ({ onload: null, onerror: null, src: "" }),
    addEventListener: (name, callback) => domListeners.set(name, callback),
    querySelectorAll: () => []
  };
  window.document = document;
  const sandbox = {
    console,
    window,
    document,
    localStorage: storage,
    fetch: async (url) => {
      const path = String(url);
      requested.push(path);
      if (path === "/api/auth/session") {
        return new Response(JSON.stringify({
          ok: true,
          user: { id: level, username: `user-${level}`, displayName: "Test user", email: "", level }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (path === "/api/ui/db/offers") {
        return new Response(JSON.stringify({ ok: true, offers: [] }), { status: 200 });
      }
      if (path === "/api/ui/db/keywords") {
        return new Response(JSON.stringify({ ok: true, merchants: [] }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
    CustomEvent,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  vm.runInNewContext(fs.readFileSync("public/page_access.js", "utf8"), sandbox, { filename: "public/page_access.js" });
  vm.runInNewContext(auth, sandbox, { filename: "public/auth.js" });
  await domListeners.get("DOMContentLoaded")();
  await new Promise((resolve) => setImmediate(resolve));
  return { requested, bootstrap: window.__bootstrap, initialPage: window.__initialPage };
}

const limited = await runAuthShell(2);
assert.deepEqual(limited.requested, ["/api/auth/session"], "level 2 must not request offers or keywords at startup");
assert.equal(limited.bootstrap.user.level, 2);
assert.equal(limited.bootstrap.chatbotData.offers.length, 0);
assert.equal(limited.initialPage, "google-ads");

const full = await runAuthShell(0);
assert.ok(full.requested.includes("/api/ui/db/offers"), "level 0 must load offers at startup");

console.log("PASS: migrated auth-shell page access checks");
