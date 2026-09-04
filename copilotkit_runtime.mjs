import { createHmac, timingSafeEqual } from "node:crypto";

import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { createCopilotNodeHandler } from "@copilotkit/runtime/v2/node";

const SESSION_COOKIE = "oi_session";
const RUNTIME_BASE_PATH = "/api/copilotkit";
const AGUI_PATH = "/api/chat/agui";
const VALID_ACCESS_LEVELS = new Set([0, 1, 2]);

process.env.COPILOTKIT_TELEMETRY_DISABLED = "1";

function enabled(value, defaultValue = true) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return !new Set(["0", "false", "no", "off"]).has(String(value).trim().toLowerCase());
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return "";
}

export function validateSessionCookie(request, env = process.env) {
  if (!enabled(env.OI_AUTH_ENABLED, true)) {
    return String(env.VERCEL_ENV || "").trim().toLowerCase() !== "production";
  }
  const secret = String(env.OI_SESSION_SECRET || "").trim();
  if (!secret) return false;
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = base64url(createHmac("sha256", secret).update(payload, "ascii").digest());
  if (!secureEqual(signature, expected)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded || Array.isArray(decoded) || typeof decoded !== "object") return false;
    if (Object.keys(decoded).sort().join(",") !== ["exp", "iat", "sub", "v"].join(",")) return false;
    const subject = typeof decoded.sub === "string" ? decoded.sub.trim().toLowerCase() : "";
    return typeof decoded.v === "number"
      && typeof decoded.exp === "number"
      && typeof decoded.iat === "number"
      && decoded.v === 2
      && subject !== ""
      && subject === decoded.sub
      && Number.isInteger(decoded.exp)
      && decoded.exp > Math.floor(Date.now() / 1000)
      && Number.isInteger(decoded.iat)
      && decoded.iat > 0;
  } catch {
    return false;
  }
}

function authResponse(status, message) {
  return { ok: false, status, error: message };
}

function sessionCookieHeader(request, env) {
  if (!enabled(env.OI_AUTH_ENABLED, true) || !validateSessionCookie(request, env)) return "";
  const value = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  return value ? `${SESSION_COOKIE}=${value}` : "";
}

export async function probeAuthSession(request, env = process.env) {
  if (!enabled(env.OI_AUTH_ENABLED, true)) {
    if (String(env.VERCEL_ENV || "").trim().toLowerCase() === "production") {
      return authResponse(503, "Authentication must be enabled in production.");
    }
    return { ok: true, user: { level: 0, authDisabled: true } };
  }
  if (!String(env.OI_SESSION_SECRET || "").trim()) {
    return authResponse(503, "Authentication is not configured.");
  }
  if (!validateSessionCookie(request, env)) return authResponse(401, "Login is required.");
  const cookie = sessionCookieHeader(request, env);
  if (!cookie) return authResponse(401, "Login is required.");
  let response;
  try {
    const url = new URL("/api/auth/session", request.url);
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json", cookie }
    });
  } catch {
    return authResponse(503, "Authentication service is temporarily unavailable.");
  }
  if (response.status === 401) return authResponse(401, "Login is required.");
  if (response.status === 403) return authResponse(403, "Page access is denied.");
  if (!response.ok) return authResponse(503, "Authentication service is temporarily unavailable.");
  let payload;
  try {
    payload = await response.json();
  } catch {
    return authResponse(503, "Authentication service is temporarily unavailable.");
  }
  const level = payload?.user?.level;
  const username = payload?.user?.username;
  if (payload?.ok !== true
    || payload?.authenticated !== true
    || typeof username !== "string"
    || !username.trim()
    || !Number.isInteger(level)
    || !VALID_ACCESS_LEVELS.has(level)) {
    return authResponse(503, "Authentication service returned an invalid user.");
  }
  if (level === 2) return authResponse(403, "Page access is denied.");
  return { ok: true, user: payload.user };
}

export function internalAgentToken(env = process.env) {
  return String(env.OI_COPILOT_INTERNAL_TOKEN || env.OI_SESSION_SECRET || "").trim();
}

export function resolveAguiUrl(request, env = process.env) {
  const configured = String(env.OI_AGENT_AGUI_URL || "").trim();
  if (configured) return new URL(configured).toString();
  const deploymentHost = String(env.VERCEL_URL || "").trim();
  if (deploymentHost) return new URL(AGUI_PATH, `https://${deploymentHost}`).toString();
  const requestHost = String(request.headers.get("host") || "").trim();
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(requestHost)) {
    return new URL(AGUI_PATH, `http://${requestHost}`).toString();
  }
  throw new Error("OI_AGENT_AGUI_URL or VERCEL_URL is required outside local development");
}

export function createOfferIntelligenceRuntime(env = process.env) {
  return new CopilotRuntime({
    agents: ({ request }) => {
      const token = internalAgentToken(env);
      if (!token) throw new Error("OI_COPILOT_INTERNAL_TOKEN or OI_SESSION_SECRET is required");
      const cookie = sessionCookieHeader(request, env);
      return {
        default: new HttpAgent({
          agentId: "default",
          url: resolveAguiUrl(request, env),
          headers: {
            "X-OI-Copilot-Token": token,
            "X-OI-Agent-Authority": "python-registry",
            ...(cookie ? { cookie } : {})
          }
        })
      };
    },
    forwardHeaders: {
      allow: ["accept-language"],
      deny: ["authorization", "cookie"],
      denyPrefixes: ["x-"]
    },
    exposeMemoryRoutes: false
  });
}

export function createOfferIntelligenceHandler(env = process.env) {
  const runtime = createOfferIntelligenceRuntime(env);
  return createCopilotRuntimeHandler({
    runtime,
    basePath: RUNTIME_BASE_PATH,
    mode: "multi-route",
    activateChannels: false,
    hooks: {
      onRequest: async ({ request }) => {
        const auth = await probeAuthSession(request, env);
        if (!auth.ok) {
          throw new Response(JSON.stringify({ ok: false, error: auth.error }), {
            status: auth.status,
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
          });
        }
      },
      onResponse: ({ response }) => {
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "no-store");
        headers.set("X-OI-Agent-Authority", "python-registry");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }
    }
  });
}

export const copilotkitFetchHandler = createOfferIntelligenceHandler();
export const copilotkitNodeHandler = createCopilotNodeHandler(copilotkitFetchHandler);
