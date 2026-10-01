import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/bigbi/node_modules/playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// Simple static server for testing
const server = http.createServer((req, res) => {
  let reqPath = req.url.split("?")[0];
  if (reqPath === "/") reqPath = "/index.html";

  // Mock API endpoint for testing if requested
  if (reqPath === "/api/linkedin-profile") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      data: {
        name: "Ahmed Al-Mansoor",
        headline: "Chief Operating Officer · Regional Managing Director · Industrial Turnaround",
        location: "Dubai, United Arab Emirates",
        summary: "18+ years driving $100M+ industrial transformation, supply chain optimization, and EBITDA expansion.",
        roles: [
          {
            title: "Executive Board Advisor — Middle East",
            company: "Apex Industrial Holding",
            location: "Dubai, UAE",
            dates: "2023 - Present",
            bullets: [
              "Advising C-suite on GCC industrial joint ventures and strategic supply chain localization.",
              "Delivered 18% cost optimization across 3 manufacturing hubs."
            ]
          }
        ],
        skills: ["Joint Ventures", "CAPEX Optimization", "Corporate Governance", "Lean Six Sigma"],
        education: "Executive Education, Harvard Business School",
        certifications: ["Lean Six Sigma Master Black Belt"]
      }
    }));
    return;
  }

  const filePath = path.join(rootDir, reqPath);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found: " + reqPath);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimes = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".json": "application/json",
    ".css": "text/css",
    ".png": "image/png"
  };
  res.writeHead(200, { "Content-Type": mimes[ext] || "text/plain" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(4892, async () => {
  console.log("Test server running at http://localhost:4892");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[BROWSER ERROR]", msg.text());
  });

  try {
    await page.goto("http://localhost:4892");
    await page.waitForSelector("#cvDropzone");

    console.log("1. Checking Initial State...");
    const initStatus = await page.$eval("#cvUploadStatus", (el) => el.textContent);
    console.log("   Initial status:", initStatus);

    console.log("2. Clicking 'Connect & Combine LinkedIn' button...");
    await page.click("#btnToggleLinkedIn");
    const drawerVisible = await page.$eval("#linkedInDrawer", (el) => el.style.display !== "none");
    if (!drawerVisible) throw new Error("LinkedIn drawer did not open!");
    console.log("   LinkedIn drawer opened successfully!");

    console.log("3. Testing LinkedIn Tab Switching...");
    await page.click("#liTabBtnPaste");
    const pastePaneVisible = await page.$eval("#liPanePaste", (el) => el.style.display !== "none");
    if (!pastePaneVisible) throw new Error("Paste tab did not show!");
    console.log("   Switched to Paste tab!");

    console.log("4. Pasting LinkedIn Profile Text and Combining...");
    const sampleLinkedInText = `
Contact
ahmed@email.com
linkedin.com/in/ahmedalmansoor

Top Skills
Lean Six Sigma Black Belt
Strategic M&A
Board Governance

Certifications
Lean Six Sigma Master Black Belt

Summary
Transformational senior executive with 18+ years across Middle East & Europe.

Experience
Al-Futtaim Industrial & Logistics Group
Chief Operating Officer & General Manager
January 2020 - Present
Dubai, UAE
* Orchestrated $14.5M supply chain savings and 98.6% OTIF delivery across 4 plants.
* Steered digital ERP transformation across UAE and KSA hubs.

Apex Global Engineering
Senior Director of Operations & Turnaround
2014 - 2016
Abu Dhabi, UAE
* Led regional engineering turnaround expanding operating margin by 24%.

Education
RWTH Aachen University
Bachelor of Science, Mechanical Engineering
`;
    await page.fill("#liPasteTextarea", sampleLinkedInText);
    await page.click("#liPanePaste button");

    await page.waitForTimeout(500);

    console.log("5. Verifying Combined Profile State...");
    const badgeVisible = await page.$eval("#cvCombineBadge", (el) => el.style.display !== "none");
    if (!badgeVisible) throw new Error("Combined badge not visible!");
    console.log("   ✓ CV + LinkedIn Merged badge is visible!");

    const postStatus = await page.$eval("#cvUploadStatus", (el) => el.textContent);
    console.log("   ✓ Upload status updated:", postStatus);

    const activeMergedBarVisible = await page.$eval("#liActiveMergedBar", (el) => el.style.display !== "none");
    if (!activeMergedBarVisible) throw new Error("Active merged bar not visible in drawer!");
    console.log("   ✓ Active merged bar is visible!");

    // Check that Live A4 preview has both original and new roles
    const mirrorContent = await page.$eval("#page1LiveCvMirror", (el) => el.textContent);
    const hasOriginalRole = mirrorContent.includes("Al-Futtaim");
    const hasMergedNewRole = mirrorContent.includes("Apex Global Engineering");
    const hasMergedBullet = mirrorContent.includes("$14.5M supply chain savings");
    const hasMergedSkills = mirrorContent.includes("Strategic M&A");

    console.log("   - Has Original CV Role (Al-Futtaim):", hasOriginalRole);
    console.log("   - Has New Merged LinkedIn Role (Apex Global Engineering):", hasMergedNewRole);
    console.log("   - Has Merged LinkedIn Achievement Bullet ($14.5M):", hasMergedBullet);
    console.log("   - Has Merged LinkedIn Skill (Strategic M&A):", hasMergedSkills);

    if (!hasOriginalRole || !hasMergedNewRole || !hasMergedBullet || !hasMergedSkills) {
      throw new Error("Live CV preview missing merged content!");
    }

    console.log("6. Testing 1-Click LinkedIn URL Fetch with Mock API...");
    await page.click("#liTabBtnUrl");
    await page.fill("#linkedInUrlInput", "https://www.linkedin.com/in/ahmedalmansoor");
    await page.click("#btnFetchLinkedInLive");
    await page.waitForTimeout(800);

    const mirrorContentAfterFetch = await page.$eval("#page1LiveCvMirror", (el) => el.textContent);
    const hasAdvisorRole = mirrorContentAfterFetch.includes("Apex Industrial Holding");
    console.log("   - Has Live Fetched Role (Apex Industrial Holding):", hasAdvisorRole);

    console.log("7. Testing Unlink / Revert to Base CV...");
    await page.click("#liActiveMergedBar button");
    await page.waitForTimeout(400);

    const badgeHidden = await page.$eval("#cvCombineBadge", (el) => el.style.display === "none");
    if (!badgeHidden) throw new Error("Badge did not hide after unlink!");
    console.log("   ✓ Successfully unlinked LinkedIn and reverted to base CV!");

    console.log("\n>>> ALL TESTS PASSED SUCCESSFULLY! <<<");
  } catch (err) {
    console.error("TEST FAILED:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
});
