// Week-1 trust & security regressions: no guessed recipients, strict token checks,
// own-origin only. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);
const boards = require("../api/_boards.js");
const sec = require("../api/_security.js");

test("no recipient is guessed for employers when nothing is published", () => {
  for (const job of [
    { company: "Emirates National Industrial Corp", source: "indeed", title: "General Manager" },
    { company: "Confidential", source: "linkedin", title: "GM" },
    { company: "Acme Holding", url: "https://careers.acme-holding.com/job/1", source: "bayt" },
    { company: "Aramco", source: "linkedin", title: "COO" },
  ]) {
    const r = boards.resolveJobRecipientEmail(job);
    assert.equal(r.email, "", JSON.stringify(job));
  }
});

test("headhunter sources map only to their own published inbox", () => {
  const r = boards.resolveJobRecipientEmail({ company: "via Michael Page", source: "michaelpage" });
  assert.equal(r.email, "clientmiddleeast@michaelpage.ae");
});

test("an address printed in the posting wins and is labelled as extracted", () => {
  const r = boards.resolveJobRecipientEmail({ company: "Acme", source: "michaelpage", text: "Send your CV to jobs@acme.ae by Friday." });
  assert.equal(r.email, "jobs@acme.ae");
  assert.match(r.via, /extracted/i);
});

test("previously guessed or fabricated stored addresses are dropped", () => {
  assert.equal(boards.resolveJobRecipientEmail({ to: "hr@acme.ae", emailVia: "Scraped Live from Company Website (acme.ae)" }).email, "hr@acme.ae");
  assert.equal(boards.resolveJobRecipientEmail({ to: "careers@acme.ae", emailVia: "Corporate HR Mailbox (acme.ae)" }).email, "");
  assert.equal(boards.resolveJobRecipientEmail({ to: "executive.talent@linkedin-mena.com", emailVia: "Executive Talent Desk" }).email, "");
});

test("employer table holds only the five headhunter inboxes, no careers@ guesses", () => {
  assert.equal(boards.KNOWN_EMPLOYER_EMAILS.length, 5);
  assert.ok(boards.KNOWN_EMPLOYER_EMAILS.every((e) => !/^careers@/.test(e.email)));
});

test("origin check: own production, own previews, localhost only", () => {
  const ok = (origin) => sec.isAllowedOrigin({ headers: { origin } });
  assert.equal(ok("https://ai-cv-portal.vercel.app"), true);
  assert.equal(ok("https://ai-cv-portal-git-week1-team.vercel.app"), true);
  assert.equal(ok("http://localhost:3000"), true);
  assert.equal(ok("https://evil.vercel.app"), false);
  assert.equal(ok("https://ai-cv-portal.vercel.app.evil.com"), false);
});

/* ---- JWT verification against a local key pair served as the JWKS ---- */
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256", use: "sig" };
const ISS = "https://alive-orca-3295.clerk.accounts.dev";
const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function sign(payload, header = { alg: "RS256", kid: "test-kid", typ: "JWT" }) {
  const head = b64u(header) + "." + b64u(payload);
  const sig = crypto.sign("RSA-SHA256", Buffer.from(head), privateKey).toString("base64url");
  return head + "." + sig;
}
const now = () => Math.floor(Date.now() / 1000);
const req = (t) => ({ headers: { authorization: "Bearer " + t } });

test("JWT: valid token passes; bad iss, missing exp, unknown kid, foreign azp fail", async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
  t.after(() => { globalThis.fetch = realFetch; });

  const base = { sub: "user_1", iss: ISS, exp: now() + 300, azp: "https://ai-cv-portal.vercel.app" };
  assert.equal((await sec.verifyClerkBearer(req(sign(base))))?.sub, "user_1");
  assert.equal(await sec.verifyClerkBearer(req(sign({ ...base, iss: "https://other.clerk.accounts.dev" }))), null);
  const { exp, ...noExp } = base;
  assert.equal(await sec.verifyClerkBearer(req(sign(noExp))), null);
  assert.equal(await sec.verifyClerkBearer(req(sign({ ...base, exp: now() - 120 }))), null);
  assert.equal(await sec.verifyClerkBearer(req(sign(base, { alg: "RS256", kid: "unknown", typ: "JWT" }))), null);
  assert.equal(await sec.verifyClerkBearer(req(sign({ ...base, azp: "https://evil.example" }))), null);
  assert.equal(await sec.verifyClerkBearer(req(sign(base, { alg: "none", kid: "test-kid" }))), null);
});

/* ---- Security-review follow-ups: IP parsing, DNS pinning, byte cap, auth on /api/read ---- */
import dns from "node:dns";

test("isPrivateIp: alternate spellings of private addresses are caught; public ones pass", () => {
  for (const ip of ["127.0.0.1", "0:0:0:0:0:0:0:1", "[::1]", "::ffff:7f00:1", "::ffff:127.0.0.1", "10.0.0.1",
    "169.254.169.254", "100.64.0.1", "172.16.5.4", "192.168.1.1", "fd00::1", "fe80::1", "0.0.0.0", ""]) {
    assert.equal(sec.isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111", "example.com"]) {
    assert.equal(sec.isPrivateIp(ip), false, ip);
  }
});

test("isSafePublicUrl rejects numeric / bracketed loopback spellings", async () => {
  for (const u of ["http://2130706433/", "http://0x7f.1/", "http://127.1/", "http://[::1]/", "http://[::ffff:7f00:1]/",
    "http://[0:0:0:0:0:0:0:1]/", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd"]) {
    assert.equal(await sec.isSafePublicUrl(u), false, u);
  }
});

test("safeFetchText: DNS rebinding between check and connect is blocked", async (t) => {
  const realLookup = dns.lookup;
  const realPromLookup = dns.promises.lookup;
  // The validation lookup sees a public address; the connection lookup gets loopback.
  dns.promises.lookup = async () => [{ address: "93.184.215.14", family: 4 }];
  dns.lookup = (host, opts, cb) => (typeof opts === "function" ? opts : cb)(null, [{ address: "127.0.0.1", family: 4 }]);
  t.after(() => { dns.lookup = realLookup; dns.promises.lookup = realPromLookup; });
  await assert.rejects(sec.safeFetchText("http://rebind.example/"), (e) => e.code === "EBLOCKED");
});

test("safeFetchText: body is capped while streaming", { skip: !!process.env.OFFLINE }, async () => {
  const r = await sec.safeFetchText("https://example.com/", { maxBytes: 200, timeoutMs: 10000 });
  assert.ok(r.body.length <= 200, `got ${r.body.length}`);
  assert.equal(r.truncated, true);
});

test("/api/read refuses requests without a signed-in session", async () => {
  const handler = require("../api/read.js");
  const result = await new Promise((resolve) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); }, send() { resolve({ code: this.code }); } };
    handler({ method: "GET", query: { url: "https://example.com/" }, headers: { origin: "https://ai-cv-portal.vercel.app" }, socket: {} }, res);
  });
  assert.equal(result.code, 401);
});

/* ---- Second review follow-ups: ports, extra reserved ranges, total deadline ---- */
import http from "node:http";

test("non-web ports and extra reserved ranges are refused", async () => {
  for (const u of ["http://example.com:25/", "https://example.com:6379/", "http://example.com:8080/"]) {
    assert.equal(await sec.isSafePublicUrl(u), false, u);
  }
  assert.equal(await sec.isSafePublicUrl("https://example.com:443/"), true);
  for (const ip of ["192.88.99.1", "::7f00:1", "fec0::1"]) assert.equal(sec.isPrivateIp(ip), true, ip);
});

test("per-hop deadline cuts off a server that trickles bytes", async (tt) => {
  // One byte every 100 ms keeps a socket idle timeout from ever firing.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    const iv = setInterval(() => res.write("x"), 100);
    req.on("close", () => clearInterval(iv));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  tt.after(() => server.close());
  const u = new URL(`http://127.0.0.1:${server.address().port}/`);
  const started = Date.now();
  await assert.rejects(
    sec._requestOnce(u, { timeoutMs: 5000, deadline: Date.now() + 700, maxBytes: 1e6 }),
    (e) => e.code === "ETIMEOUT"
  );
  const took = Date.now() - started;
  assert.ok(took >= 600 && took < 2000, `cut off after ${took} ms (deadline 700 ms)`);
});
