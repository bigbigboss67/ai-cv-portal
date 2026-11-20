// Job details panel: reader responses are shown as prose, and a language is only
// claimed when the posting asks for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { unwrapReaderResponse } = require("../api/job-detail.js");

test("reader JSON envelope is unwrapped to title + content, Markdown emphasis removed", () => {
  const env = JSON.stringify({
    code: 200,
    status: 20000,
    data: { title: "Contract General Manager - Naukrigulf", content: "Job Description\n\n* Contract Leadership\n\n**Knowledge:**\n\n* SLA/KPI management" },
  });
  const out = unwrapReaderResponse(env);
  assert.ok(!out.includes('"code"'), "no JSON left");
  assert.ok(out.startsWith("Contract General Manager - Naukrigulf\n\nJob Description"));
  assert.ok(out.includes("• Contract Leadership"));
  assert.ok(out.includes("Knowledge:") && !out.includes("**"));
});

test("plain Markdown from the reader passes through (tidied)", () => {
  assert.equal(unwrapReaderResponse("Title\n\n* one\n* two"), "Title\n\n• one\n• two");
});

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const a = html.indexOf("    function detectJobLanguageRequirement(job) {");
const b = html.indexOf("    function getFilteredJobs() {", a);
const detect = new Function(html.slice(a, b) + "\nreturn detectJobLanguageRequirement;")();

for (const [name, job, want] of [
  ["site language menu is not a requirement", { title: "Contract General Manager", text: "Home العربية English Jobs in Abu Dhabi." }, "english"],
  ["Arabic required", { title: "General Manager", text: "Fluent Arabic and English required." }, "arabic"],
  ["Arabic-speaking preferred", { title: "GM", text: "Arabic-speaking candidates preferred." }, "arabic"],
  ["company / place names are not a language", { title: "Managing Director (GCC)", company: "AHK", text: "Reporting to Germany HQ." }, "english"],
  ["ad written in German", { title: "Geschäftsführer (m/w/d)", text: "Ihre Aufgaben: Leitung" }, "german"],
  ["German skills asked in an English ad", { title: "Operations Director", text: "Business-level German is essential." }, "german"],
  ["'Chinese market' is not a language", { title: "Regional GM", text: "Expand into the Chinese market." }, "english"],
  ["French required", { title: "Directeur", text: "Native French speaker." }, "french"],
]) {
  test(`language: ${name}`, () => assert.equal(detect(job).lang, want));
}
