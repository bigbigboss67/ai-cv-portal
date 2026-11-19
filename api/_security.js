/**
 * Shared security helpers for Vercel serverless API routes:
 *  - SSRF URL & DNS validation (blocks loopback, RFC1918, link-local, metadata IPs)
 *  - Clerk RS256 JWT verification via JWKS (zero external dependencies)
 *  - Origin check & lightweight in-memory rate limiting
 */

const dns = require("dns");
const crypto = require("crypto");

const CLERK_JWKS_URL =
  process.env.CLERK_JWKS_URL ||
  "https://alive-orca-3295.clerk.accounts.dev/.well-known/jwks.json";
/* Clerk session tokens carry the instance URL as `iss`. Defaults to the JWKS origin. */
const CLERK_ISSUER = (process.env.CLERK_ISSUER || new URL(CLERK_JWKS_URL).origin).replace(/\/$/, "");

let jwksCache = { keys: [], fetchedAt: 0 };
const rateBuckets = new Map();

function isPrivateIp(ip) {
  const s = String(ip || "").trim().toLowerCase();
  if (!s) return true;
  if (s === "::1" || s === "::" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80")) {
    return true;
  }
  const clean = s.startsWith("::ffff:") ? s.slice(7) : s;
  const parts = clean.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function isSafePublicUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl || "").trim());
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return false;
  }
  if (isPrivateIp(host)) return false;

  try {
    const records = await dns.promises.lookup(host, { all: true });
    if (!records || !records.length) return false;
    for (const r of records) {
      if (isPrivateIp(r.address)) return false;
    }
  } catch {
    return false;
  }
  return true;
}

function isAllowedOrigin(req) {
  const origin = String(req.headers.origin || "").toLowerCase();
  const referer = String(req.headers.referer || "").toLowerCase();
  const val = origin || referer;
  if (!val) return true; // allow server-to-server / curl with explicit auth
  try {
    const host = new URL(val).hostname.toLowerCase();
    // Production, this project's own preview deployments, and local development only.
    // (Previously any *.vercel.app site was accepted.)
    return (
      host === "ai-cv-portal.vercel.app" ||
      /^ai-cv-portal-[a-z0-9-]+\.vercel\.app$/.test(host) ||
      host === "localhost" ||
      host === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

function checkRateLimit(key, maxPerWindow = 20, windowMs = 60000) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || [];
  const fresh = bucket.filter((t) => now - t < windowMs);
  if (fresh.length >= maxPerWindow) {
    rateBuckets.set(key, fresh);
    return false;
  }
  fresh.push(now);
  rateBuckets.set(key, fresh);
  if (rateBuckets.size > 500) {
    for (const [k, v] of rateBuckets.entries()) {
      if (!v.length || now - v[v.length - 1] > windowMs) rateBuckets.delete(k);
    }
  }
  return true;
}

function getClientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "");
  return (fwd.split(",")[0] || req.socket?.remoteAddress || "unknown").trim();
}

async function getJwks() {
  if (jwksCache.keys.length && Date.now() - jwksCache.fetchedAt < 3600000) {
    return jwksCache.keys;
  }
  const r = await fetch(CLERK_JWKS_URL);
  if (!r.ok) return jwksCache.keys;
  const data = await r.json();
  if (Array.isArray(data.keys)) {
    jwksCache = { keys: data.keys, fetchedAt: Date.now() };
  }
  return jwksCache.keys;
}

function b64UrlToBuf(str) {
  const b64 = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64");
}

async function verifyClerkBearer(req) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64UrlToBuf(parts[0]).toString("utf8"));
    const payload = JSON.parse(b64UrlToBuf(parts[1]).toString("utf8"));
    const nowSec = Math.floor(Date.now() / 1000);
    if (header.alg !== "RS256") return null;
    // exp is mandatory; nbf honoured when present; 30 s clock skew.
    if (!payload.exp || payload.exp < nowSec - 30) return null;
    if (payload.nbf && payload.nbf > nowSec + 30) return null;
    // Token must come from this Clerk instance.
    if (String(payload.iss || "").replace(/\/$/, "") !== CLERK_ISSUER) return null;
    // `azp` (authorized party) is the origin the token was minted for: must be ours.
    if (payload.azp && !isAllowedOrigin({ headers: { origin: payload.azp } })) return null;

    // The signing key must match by kid. No fallback to an arbitrary key.
    const keys = await getJwks();
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const pubKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const sigOk = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      pubKey,
      b64UrlToBuf(parts[2])
    );
    if (!sigOk) return null;
    return {
      sub: payload.sub || "",
      email: payload.email || payload.primary_email || "",
    };
  } catch {
    return null;
  }
}

/**
 * Shared guard for the public read-only endpoints: own origin only, plus a per-IP
 * rate limit. Returns false (response already sent) when the request is refused.
 * Note: the limiter is per function instance (in memory); a durable store comes later.
 */
function guardPublic(req, res, name, maxPerMinute = 20) {
  if (!isAllowedOrigin(req)) {
    res.status(403).json({ ok: false, error: "Forbidden origin" });
    return false;
  }
  if (!checkRateLimit(`${name}:${getClientIp(req)}`, maxPerMinute, 60000)) {
    res.status(429).json({ ok: false, error: "Rate limit exceeded. Please wait a minute." });
    return false;
  }
  return true;
}

module.exports = {
  guardPublic,
  isSafePublicUrl,
  isAllowedOrigin,
  checkRateLimit,
  getClientIp,
  verifyClerkBearer,
};
