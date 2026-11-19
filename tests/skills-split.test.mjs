// CV skills parsing: commas inside a skill phrase must not split it.
// splitSkillLine lives inline in index.html, so it is read from there.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const a = html.indexOf("    function splitSkillLine(line) {");
const b = html.indexOf("    function parseRawTextIntoCv(", a);
const splitSkillLine = new Function(html.slice(a, b) + "\nreturn splitSkillLine;")();

const cases = [
  // phrases: kept whole
  ["Market intelligence, analysis and penetration", ["Market intelligence, analysis and penetration"]],
  ["Contract development, team management and training", ["Contract development, team management and training"]],
  ["Strong IT and AI proficiencies.", ["Strong IT and AI proficiencies"]],
  ["MS Office 365, Claude AI, building portals with Claude code", ["MS Office 365, Claude AI, building portals with Claude code"]],
  ["Strategische Planung und Umsetzung, Controlling", ["Strategische Planung und Umsetzung, Controlling"]],
  // plain lists: split
  ["Negotiation, Budgeting, Team leadership", ["Negotiation", "Budgeting", "Team leadership"]],
  ["P&L Ownership, M&A Integration, Board Reporting", ["P&L Ownership", "M&A Integration", "Board Reporting"]],
  ["Verhandlungsführung, Budgetplanung, Teamführung", ["Verhandlungsführung", "Budgetplanung", "Teamführung"]],
  // slashes never split; bullets, pipes and semicolons always do
  ["ERP/SAP, CAPEX/OPEX control", ["ERP/SAP", "CAPEX/OPEX control"]],
  ["Strategy • Operations • Turnaround", ["Strategy", "Operations", "Turnaround"]],
  ["Lean Six Sigma | Supply Chain; Procurement", ["Lean Six Sigma", "Supply Chain", "Procurement"]],
];

for (const [input, want] of cases) {
  test(`splitSkillLine: ${input}`, () => assert.deepEqual(splitSkillLine(input), want));
}
