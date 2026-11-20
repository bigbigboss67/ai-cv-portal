// Adzuna and Jooble readers, against mocked responses (no real keys needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const boards = require("../api/_boards.js");

function mockFetch(t, respond) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const { status = 200, body } = respond(String(url), opts);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}

test("Adzuna: URL, keys and fields; predicted salaries are not shown", async (t) => {
  const calls = mockFetch(t, () => ({
    body: {
      results: [
        { id: "1", title: "Geschäftsführer (m/w/d)", company: { display_name: "Acme GmbH" }, location: { display_name: "München, Bayern" },
          redirect_url: "https://www.adzuna.de/land/ad/1", created: "2026-11-18T08:00:00Z", description: "Leitung …",
          salary_min: 120000, salary_max: 150000, salary_is_predicted: 0 },
        { id: "2", title: "General Manager", company: { display_name: "Beta AG" }, location: { display_name: "Wien" },
          redirect_url: "https://www.adzuna.at/land/ad/2", created: "2026-11-17T08:00:00Z", description: "…",
          salary_min: 90000, salary_max: 90000, salary_is_predicted: 1 },
      ],
    },
  }));
  const jobs = await boards.fetchAdzuna({ appId: "id1", appKey: "key1", country: "de", what: "Geschäftsführer" });
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, "https://api.adzuna.com/v1/api/jobs/de/search/1");
  assert.equal(u.searchParams.get("app_id"), "id1");
  assert.equal(u.searchParams.get("app_key"), "key1");
  assert.equal(u.searchParams.get("what"), "Geschäftsführer");
  assert.deepEqual(
    jobs.map((j) => [j.title, j.company, j.location, j.posted, j.salary, j.src]),
    [
      ["Geschäftsführer (m/w/d)", "Acme GmbH", "München, Bayern", "2026-11-18", "120,000 – 150,000 / year", "adzuna"],
      ["General Manager", "Beta AG", "Wien", "2026-11-17", "", "adzuna"],
    ]
  );
});

test("Adzuna: refuses countries it does not cover (UAE)", async () => {
  await assert.rejects(boards.fetchAdzuna({ appId: "a", appKey: "b", country: "ae", what: "gm" }), /does not cover/);
});

test("Jooble: POST to the country domain with the key in the path; fields mapped", async (t) => {
  const calls = mockFetch(t, () => ({
    body: {
      totalCount: 1,
      jobs: [{ id: 99, title: "Managing Director", location: "Dubai", snippet: "<b>Lead</b> the GCC business", salary: "60,000 - 80,000 AED",
        source: "jooble", type: "Full-time", link: "ae.jooble.org/jdp/99", company: "Gamma LLC", updated: "2026-11-19T10:00:00.000" }],
    },
  }));
  const jobs = await boards.fetchJooble({ key: "k-ae", domain: "ae", keywords: "managing director", location: "United Arab Emirates" });
  assert.equal(calls[0].url, "https://ae.jooble.org/api/k-ae");
  assert.equal(calls[0].opts.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].opts.body), { keywords: "managing director", location: "United Arab Emirates", page: "1" });
  assert.equal(jobs[0].url, "https://ae.jooble.org/jdp/99");
  assert.equal(jobs[0].salary, "60,000 - 80,000 AED");
  assert.equal(jobs[0].posted, "2026-11-19");
  assert.equal(jobs[0].text, "Lead the GCC business");
  assert.equal(jobs[0].src, "jooble");
});

test("Jooble: US key uses jooble.org; a rejected key surfaces as an HTTP error", async (t) => {
  const calls = mockFetch(t, () => ({ status: 403, body: {} }));
  await assert.rejects(boards.fetchJooble({ key: "bad", domain: "us", keywords: "ceo", location: "New York" }), /HTTP 403/);
  assert.equal(calls[0].url, "https://jooble.org/api/bad");
});
