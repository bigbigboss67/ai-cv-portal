import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { applyCoverLetterDirection, buildLocalizedNinetyDayBlock } from "../cover-letter.js";
import * as PK from "../posting-keywords.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// 1. Verify index.html classic script syntax
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)].filter((m) => m[2].trim().length > 0);
let classicCount = 0;
for (const m of scripts) {
  if (!(m[1] || "").includes("module")) {
    new Function(m[2]);
    classicCount++;
  }
}
assert.ok(classicCount >= 1, "Expected at least one classic script in index.html");
assert.ok(html.includes('href="portal-upgrades.css"'), "portal-upgrades.css should be linked");
assert.ok(html.includes('from "./cover-letter.js"'), "cover-letter.js should be imported");
assert.ok(html.includes('id="liveBoardStatusStrip"'), "liveBoardStatusStrip should exist");
assert.ok(html.includes('id="step3PkBreakdown"'), "step3PkBreakdown should exist");
assert.ok(html.includes('id="dachMetaStripEl"'), "dachMetaStripEl should exist");

// 2. Verify cover-letter.js RTL helper and 5-language 90-day blocks
const mockTa = {
  attrs: {},
  style: {},
  setAttribute(k, v) { this.attrs[k] = v; },
};
applyCoverLetterDirection(mockTa, "ar");
assert.equal(mockTa.attrs.dir, "rtl");
assert.equal(mockTa.style.textAlign, "right");
applyCoverLetterDirection(mockTa, "de");
assert.equal(mockTa.attrs.dir, "ltr");
assert.equal(mockTa.style.textAlign, "left");

for (const lang of ["en", "de", "ar", "fr", "es"]) {
  const block = buildLocalizedNinetyDayBlock(lang);
  assert.ok(block.trim().length > 80, `90-day block for ${lang} should be non-empty`);
}
assert.ok(buildLocalizedNinetyDayBlock("de").includes("Tage 1–30"), "German 90-day block check");
assert.ok(buildLocalizedNinetyDayBlock("ar").includes("الأيام 1–30"), "Arabic 90-day block check");

// 3. Verify posting-keywords.js deterministic keywordReport()
const pkRes = PK.keywordReport(
  { title: "General Manager", text: "Require P&L ownership, Supply Chain governance, and SAP S/4HANA." },
  { headline: "General Manager", summary: "Full P&L and Supply Chain leadership.", langs: "English, German", skills: ["P&L", "Supply Chain"], roles: [] },
  { VOCAB: ["p&l", "supply chain", "governance", "sap s/4hana"], SYN: {} }
);
assert.ok(Array.isArray(pkRes.must) && pkRes.must.length > 0, "posting-keywords keywordReport() should return must items");

// 4. Verify api/match.js exports
const matchMod = require(path.join(root, "api", "match.js"));
assert.equal(typeof matchMod.readCv, "function");
assert.equal(typeof matchMod.buildQueries, "function");
assert.equal(typeof matchMod.rankDaily, "function");

console.log(`ALL PORTAL CHECKS PASSED (classicScripts=${classicCount}, pkItems=${pkRes.must.length})`);
