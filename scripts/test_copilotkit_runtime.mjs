import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createCopilotNodeHandler } from "@copilotkit/runtime/v2/node";

import {
  createOfferIntelligenceHandler,
  probeAuthSession,
  resolveAguiUrl,
  validateSessionCookie
} from "../copilotkit_runtime.mjs";

function session(secret, payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded, "ascii").digest("base64url");
  return `${encoded}.${signature}`;
}

test("CopilotKit runtime rejects a missing production session", async () => {
  const env = { OI_AUTH_ENABLED: "1", OI_SESSION_SECRET: "test-secret", OI_AGENT_AGUI_URL: "http://127.0.0.1:9999/api/chat/agui" };
  const response = await createOfferIntelligenceHandler(env)(new Request("http://localhost/api/copilotkit/info"));
  assert.equal(response.status, 401);
});

async function withAuthSessionProbe(responsePayload, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/auth/session") {
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return originalFetch(input, init);
  };
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("CopilotKit runtime exposes the default Python-backed agent", async () => {
  const env = { OI_AUTH_ENABLED: "1", OI_SESSION_SECRET: "test-secret", OI_AGENT_AGUI_URL: "http://127.0.0.1:9999/api/chat/agui" };
  const token = session(env.OI_SESSION_SECRET, { v: 2, sub: "ypadmin", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
  const request = new Request("http://localhost/api/copilotkit/info", { headers: { cookie: `oi_session=${token}` } });
  assert.equal(validateSessionCookie(request, env), true);
  const response = await withAuthSessionProbe({ ok: true, authenticated: true, user: { username: "ypadmin", level: 0 } }, () => createOfferIntelligenceHandler(env)(request));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-oi-agent-authority"), "python-registry");
  const payload = await response.json();
  assert.ok(payload.agents.default);
  assert.equal(payload.telemetryDisabled, true);
});

test("CopilotKit runtime rejects v1 role cookies and level 2 Agent access", async () => {
  const env = { OI_AUTH_ENABLED: "1", OI_SESSION_SECRET: "test-secret", OI_AGENT_AGUI_URL: "http://127.0.0.1:9999/api/chat/agui" };
  const v1 = session(env.OI_SESSION_SECRET, { sub: "ypadmin", role: "admin", exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(validateSessionCookie(new Request("http://localhost/api/copilotkit/info", { headers: { cookie: `oi_session=${v1}` } }), env), false);
  const v2 = session(env.OI_SESSION_SECRET, { v: 2, sub: "limited", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
  const response = await withAuthSessionProbe({ ok: true, authenticated: true, user: { username: "limited", level: 2 } }, () => createOfferIntelligenceHandler(env)(
    new Request("http://localhost/api/copilotkit/info", { headers: { cookie: `oi_session=${v2}` } })
  ));
  assert.equal(response.status, 403);
});

test("CopilotKit runtime maps a failed same-origin Session probe to 401", async () => {
  const env = { OI_AUTH_ENABLED: "1", OI_SESSION_SECRET: "test-secret", OI_AGENT_AGUI_URL: "http://127.0.0.1:9999/api/chat/agui" };
  const token = session(env.OI_SESSION_SECRET, { v: 2, sub: "revoked", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false }), { status: 401 });
  try {
    const result = await probeAuthSession(new Request("http://localhost/api/copilotkit/info", { headers: { cookie: `oi_session=${token}` } }), env);
    assert.deepEqual(result, { ok: false, status: 401, error: "Login is required." });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AG-UI URL defaults to the same deployment", () => {
  const request = new Request("https://offers.example/api/copilotkit/info", { headers: { host: "offers.example" } });
  assert.equal(resolveAguiUrl(request, { VERCEL_URL: "offers.example" }), "https://offers.example/api/chat/agui");
  assert.throws(() => resolveAguiUrl(request, {}), /OI_AGENT_AGUI_URL or VERCEL_URL/);
});

test("production Node handler streams a Python AG-UI run", async (context) => {
  let upstreamHeaders;
  const upstream = createServer((request, response) => {
    upstreamHeaders = request.headers;
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const input = JSON.parse(body);
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "RUN_STARTED", threadId: input.threadId, runId: input.runId },
        { type: "TEXT_MESSAGE_START", messageId: "answer", role: "assistant" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: "verified" },
        { type: "TEXT_MESSAGE_END", messageId: "answer" },
        { type: "RUN_FINISHED", threadId: input.threadId, runId: input.runId, outcome: { type: "success" } }
      ]) response.write(Buffer.from(`data: ${JSON.stringify(event)}\n\n`));
      response.end();
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const authSecret = "test-secret";
  const authCookie = session(authSecret, { v: 2, sub: "ypadmin", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
  const runtimeEnv = {
    OI_AUTH_ENABLED: "1",
    OI_SESSION_SECRET: authSecret,
    OI_AGENT_AGUI_URL: `http://127.0.0.1:${upstream.address().port}/api/chat/agui`
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/auth/session") {
      assert.equal(init?.cache, "no-store");
      assert.equal(new Headers(init?.headers).get("cookie"), `oi_session=${authCookie}`);
      return new Response(JSON.stringify({ ok: true, authenticated: true, user: { username: "ypadmin", level: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return originalFetch(input, init);
  };
  const runtimeFetch = createOfferIntelligenceHandler(runtimeEnv);
  const runtime = createServer(createCopilotNodeHandler(runtimeFetch));
  runtime.listen(0, "127.0.0.1");
  await once(runtime, "listening");
  context.after(() => { globalThis.fetch = originalFetch; upstream.close(); runtime.close(); });
  const response = await fetch(`http://127.0.0.1:${runtime.address().port}/api/copilotkit/agent/default/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `oi_session=${authCookie}; should-not-forward=1`,
      authorization: "Bearer should-not-forward",
      "x-secret": "should-not-forward"
    },
    body: JSON.stringify({
      threadId: "thread-1",
      runId: "run-1",
      messages: [{ id: "user-1", role: "user", content: "hello" }],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {}
    })
  });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.match(stream, /TEXT_MESSAGE_CONTENT/);
  assert.match(stream, /verified/);
  assert.doesNotMatch(stream, /\[DONE\]/);
  assert.equal(upstreamHeaders["x-oi-copilot-token"], authSecret);
  assert.equal(upstreamHeaders["x-oi-agent-authority"], "python-registry");
  assert.equal(upstreamHeaders.cookie, `oi_session=${authCookie}`);
  assert.equal(upstreamHeaders.authorization, undefined);
  assert.equal(upstreamHeaders["x-secret"], undefined);
});
