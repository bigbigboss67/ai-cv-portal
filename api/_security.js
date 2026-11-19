/**
 * Shared security helpers for Vercel serverless API routes:
 *  - SSRF URL & DNS validation (blocks loopback, RFC1918, link-local, metadata IPs)
 *  - Clerk RS256 JWT verification via JWKS (zero external dependencies)
 *  - Origin check & lightweight in-memory rate limiting
 */

const dns = require("dns");
const net = require("net");
const http = require("http");
const https = require("https");
const crypto = require("crypto");

const CLERK_JWKS_URL =
  process.env.CLERK_JWKS_URL ||
  "https://alive-orca-3295.clerk.accounts.dev/.well-known/jwks.json";
/* Clerk session tokens carry the instance URL as `iss`. Defaults to the JWKS origin. */
const CLERK_ISSUER = (process.env.CLERK_ISSUER || new URL(CLERK_JWKS_URL).origin).replace(/\/$/, "");

let jwksCache = { keys: [], fetchedAt: 0 };
const rateBuckets = new Map();

/* Non-public address space, checked with Node's own IP parser (net.BlockList), so
   alternate spellings ("0:0:0:0:0:0:0:1", "::ffff:7f00:1", bracketed IPv6) cannot slip
   through as "public". IPv4-mapped / NAT64 / 6to4 / Teredo IPv6 ranges are blocked whole
   because they can embed a private IPv4 address. */
const BLOCKED_V4 = new net.BlockList();
const BLOCKED_V6 = new net.BlockList(); // separate: a v6 list also matches IPv4 via ::ffff:0:0/96
for (const [addr, len] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) BLOCKED_V4.addSubnet(addr, len, "ipv4");
for (const [addr, len] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
]) BLOCKED_V6.addSubnet(addr, len, "ipv6");

/** True when `ip` is an IP literal in non-public space. Hostnames return false
 *  (they are checked after DNS resolution). Empty input is treated as unsafe. */
function isPrivateIp(ip) {
  const s = String(ip || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!s) return true;
  const fam = net.isIP(s);
  if (fam === 4) return BLOCKED_V4.check(s, "ipv4");
  if (fam === 6) return BLOCKED_V6.check(s, "ipv6");
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
  const bare = host.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) return !isPrivateIp(bare);

  try {
    const records = await dns.promises.lookup(bare, { all: true });
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

/* DNS lookup used for the actual connection: every resolved address must be public,
   and the socket connects to the address that was checked (no DNS-rebinding window
   between "validate" and "connect"). */
function pinnedLookup(hostname, options, callback) {
  if (typeof options === "function") { callback = options; options = {}; }
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return callback(err);
    if (!addrs.length || addrs.some((x) => isPrivateIp(x.address))) {
      const e = new Error("Blocked private or reserved address");
      e.code = "EBLOCKED";
      return callback(e);
    }
    if (options && options.all) return callback(null, addrs);
    callback(null, addrs[0].address, addrs[0].family);
  });
}

function requestOnce(u, { timeoutMs, maxBytes, accept, userAgent }) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      {
        method: "GET",
        lookup: pinnedLookup,
        timeout: timeoutMs,
        headers: { "user-agent": userAgent || "Mozilla/5.0", accept: accept || "text/html,text/plain;q=0.9", "accept-encoding": "identity" },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location });
        }
        const type = String(res.headers["content-type"] || "");
        if (type && !/text\/|html|xml|json/i.test(type)) {
          res.destroy();
          return reject(new Error("Unsupported content type: " + type.split(";")[0]));
        }
        // Read at most maxBytes, then stop: nothing beyond the cap is buffered.
        const chunks = [];
        let size = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve({ status, body: Buffer.concat(chunks).toString("utf8"), truncated: size >= maxBytes });
        };
        res.on("data", (c) => {
          if (done) return;
          const room = maxBytes - size;
          if (c.length >= room) {
            chunks.push(c.subarray(0, room));
            size = maxBytes;
            res.destroy();
            finish();
          } else {
            chunks.push(c);
            size += c.length;
          }
        });
        res.on("end", finish);
        res.on("error", (e) => (done ? null : reject(e)));
      }
    );
    req.on("timeout", () => req.destroy(new Error("Upstream timeout")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Fetch a public page as text: http(s) only, every hop validated, DNS pinned to the
 * checked address, body streamed and capped at maxBytes.
 */
async function safeFetchText(rawUrl, { maxBytes = 1500000, timeoutMs = 10000, maxHops = 4, accept, userAgent } = {}) {
  let target = String(rawUrl || "").trim();
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!(await isSafePublicUrl(target))) {
      const e = new Error("Blocked unsafe or private network URL.");
      e.code = "EBLOCKED";
      throw e;
    }
    const u = new URL(target);
    const r = await requestOnce(u, { timeoutMs, maxBytes, accept, userAgent });
    if (r.location) {
      target = new URL(r.location, u).href;
      continue;
    }
    return r;
  }
  const e = new Error("Too many redirects");
  e.code = "EHOPS";
  throw e;
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
  safeFetchText,
  isPrivateIp,
  guardPublic,
  isSafePublicUrl,
  isAllowedOrigin,
  checkRateLimit,
  getClientIp,
  verifyClerkBearer,
};
