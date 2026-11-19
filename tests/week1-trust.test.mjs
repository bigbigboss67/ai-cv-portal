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
