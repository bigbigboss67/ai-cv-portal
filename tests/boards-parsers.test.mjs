// Board readers: jobs.ch result cards and the AHK UAE job page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const boards = require("../api/_boards.js");

test("jobs.ch card text splits into title, place, contract, employer and age", () => {
  const c = boards.parseJobsChCard(
    "3 weeks ago General Manager Place of work : Bern Workload : 100% Contract type : Permanent position Hotelis SA (Bern) Is this job relevant to you?"
  );
  assert.deepEqual(c, {
    age: "3 weeks ago",
    title: "General Manager",
    place: "Bern",
    workload: "100%",
    contract: "Permanent position",
    company: "Hotelis SA (Bern)",
  });
  const d = boards.parseJobsChCard(
    "Last week General Manager TORMAX Distribution EMEA (m/w) Place of work : Bülach Workload : 100% Contract type : Permanent position TORMAX Easy apply Is this job relevant to you?"
  );
  assert.equal(d.title, "General Manager TORMAX Distribution EMEA (m/w)");
  assert.equal(d.company, "TORMAX");
  assert.equal(d.age, "Last week");
});

test("AHK reader keeps postings and drops site menu links and PDF labels", () => {
  const html = `
    <a href="/en/membership/member-directory">Member Directory</a>
    <a href="/en/about-us/board">Board of Directors &amp; Honorary Advisory Board</a>
    <a href="/en/services/trade-fairs">Your Partner for International Trade Fair Participation</a>
    <a href="/fileadmin/jobs/research-manager.pdf">Filetype: pdf Research Manager (Part Time Role) (m/f/d) Filesize: 217.30 kb</a>
    <a href="/en/jobs/interim-gm">Interim General Manager (m/f/d) Middle East</a>
    <a href="/en/jobs/md-gcc">Managing Director (m/f/d) GCC</a>`;
  const titles = boards.parseAhk(html).map((j) => j.title);
  assert.deepEqual(titles, [
    "Research Manager (Part Time Role) (m/f/d)",
    "Interim General Manager (m/f/d) Middle East",
    "Managing Director (m/f/d) GCC",
  ]);
});
