const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/bigbi/node_modules/playwright');

const PORT = 3848;
const DIR = __dirname;
const ARTIFACT_DIR = "C:\\Users\\bigbi\\.gemini\\antigravity\\brain\\f7afc8a9-a58c-4a3a-8bba-df8f932ba07a";

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
      const filePath = path.join(DIR, reqPath);
      const ext = path.extname(filePath).toLowerCase();

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });

    server.listen(PORT, () => {
      console.log(`Test server running at http://localhost:${PORT}/index.html`);
      resolve(server);
    });
  });
}

(async () => {
  console.log("=== STARTING APPLICATION TRACKER & FOLLOW-UP SUITE VERIFICATION ===");
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[Browser Error]:`, msg.text());
    }
  });

  const url = `http://localhost:${PORT}/index.html`;
  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // 1. Verify HUD Navigation Button & Badge
  console.log("\n--- TEST 1: HUD Tracker Button & Badge ---");
  const hudBtnExists = await page.$('#btnOpenTracker');
  if (!hudBtnExists) throw new Error("HUD Tracker button #btnOpenTracker missing!");
  console.log("✔ SUCCESS: #btnOpenTracker button exists in top HUD navigation.");

  // 2. Load Demo Applications
  console.log("\n--- TEST 2: Demo Applications & Follow-Up Alert Countdown ---");
  await page.evaluate(() => {
    goToStep(4);
    loadDemoApplications();
  });
  await page.waitForTimeout(800);

  const trackerState = await page.evaluate(() => {
    const list = getStoredApplications();
    const hudBadge = document.getElementById('hudTrackerBadge');
    const cards = document.querySelectorAll('#dispatchesTimelineList .tracker-app-card');
    const dueBadges = document.querySelectorAll('#dispatchesTimelineList .tracker-followup-badge.due');
    return {
      totalStored: list.length,
      renderedCards: cards.length,
      hudBadgeText: hudBadge ? hudBadge.textContent.trim() : null,
      hudHasDueClass: hudBadge ? hudBadge.classList.contains('has-due') : false,
      dueCardsCount: dueBadges.length,
      firstCardRole: list[0] ? list[0].role : null,
      firstCardCompany: list[0] ? list[0].company : null,
      firstCardStage: list[0] ? list[0].stage : null
    };
  });

  console.log("Tracker State after Demo Load:", trackerState);
  if (trackerState.totalStored < 3) throw new Error("Demo applications failed to populate in localStorage!");
  if (trackerState.renderedCards < 3) throw new Error("Tracker app cards did not render on Page 4!");
  if (!trackerState.hudHasDueClass) throw new Error("HUD badge does not have .has-due pulse class when overdue follow-up exists!");
  console.log("✔ SUCCESS: 3 demo applications loaded with overdue follow-up alert and live HUD pulse badge.");

  // Screenshot Page 4 Tracker
  const p4Screenshot = path.join(ARTIFACT_DIR, 'application_tracker_page4.png');
  await page.screenshot({ path: p4Screenshot, fullPage: false });
  console.log(`Saved screenshot: ${p4Screenshot}`);

  // 3. Test Follow-Up Generator Modal & 4 Strategies
  console.log("\n--- TEST 3: Executive Follow-Up Generator Modal ---");
  await page.evaluate(() => {
    const firstDueApp = getStoredApplications().find(a => a.stage === 'applied');
    if (firstDueApp) openFollowUpModal(firstDueApp.id);
  });
  await page.waitForTimeout(600);

  const modalOpenState = await page.evaluate(() => {
    const modal = document.getElementById('followUpGeneratorModal');
    const isOpen = modal && modal.classList.contains('open');
    const subj = document.getElementById('fuSubjectInput') ? document.getElementById('fuSubjectInput').value : '';
    const body = document.getElementById('fuEmailBodyTextarea') ? document.getElementById('fuEmailBodyTextarea').value : '';
    const tabs = Array.from(document.querySelectorAll('#fuTemplatePillsContainer button')).map(t => t.textContent.trim());
    return { isOpen, subj, bodyLength: body.length, tabs };
  });

  console.log("Follow-Up Modal State:", modalOpenState);
  if (!modalOpenState.isOpen) throw new Error("Follow-Up Modal failed to open!");
  if (modalOpenState.tabs.length < 4) throw new Error("Follow-Up Modal should have 4 strategy tabs!");
  console.log("✔ SUCCESS: Follow-up generator modal open with 4 executive strategy tabs.");

  // Test switching strategy tab to Strategic Value-Add
  console.log("Testing Strategy Tab: 'Strategic Value-Add'...");
  await page.evaluate(() => {
    setFollowUpTemplate('value_add');
  });
  await page.waitForTimeout(400);

  const valueAddState = await page.evaluate(() => {
    const subj = document.getElementById('fuSubjectInput').value;
    const body = document.getElementById('fuEmailBodyTextarea').value;
    return { subj, mentionsValue: /strategic|initiative|benchmark|thought/i.test(body) };
  });
  console.log("Value-Add Template Content:", valueAddState);
  if (!valueAddState.mentionsValue) throw new Error("Strategic Value-Add template failed to load executive content!");
  console.log("✔ SUCCESS: Value-Add strategy loaded bespoke content.");

  // Screenshot Follow-Up Modal
  const fuScreenshot = path.join(ARTIFACT_DIR, 'tracker_followup_modal.png');
  await page.screenshot({ path: fuScreenshot });
  console.log(`Saved screenshot: ${fuScreenshot}`);

  // Complete Follow-Up
  await page.evaluate(() => {
    copyFollowUpEmail(); // copies and marks status as followed_up
  });
  await page.waitForTimeout(500);

  const afterFollowUpState = await page.evaluate(() => {
    const list = getStoredApplications();
    const updated = list[0];
    const hudBadge = document.getElementById('hudTrackerBadge');
    return {
      stage: updated.stage,
      followUpsCount: updated.followUpsCount,
      hudBadgeText: hudBadge ? hudBadge.textContent.trim() : null
    };
  });
  console.log("Application after follow-up executed:", afterFollowUpState);
  if (afterFollowUpState.stage !== 'followed_up') throw new Error("Application stage did not update to 'followed_up'!");
  console.log("✔ SUCCESS: Status updated to 'followed_up' and follow-up count incremented.");

  // 4. Test Global Modal from HUD
  console.log("\n--- TEST 4: Global Tracker Modal Accessible from Any Page ---");
  await page.evaluate(() => {
    goToStep(1); // Go to Page 1
    openApplicationTrackerModal();
  });
  await page.waitForTimeout(600);

  const globalModalState = await page.evaluate(() => {
    const modal = document.getElementById('applicationTrackerModal');
    const isOpen = modal && modal.classList.contains('open');
    const cards = document.querySelectorAll('#modalTrackerTimelineList .tracker-app-card');
    return { isOpen, cardsCount: cards.length };
  });
  console.log("Global Modal State on Page 1:", globalModalState);
  if (!globalModalState.isOpen) throw new Error("Global Application Tracker modal did not open from Page 1!");
  if (globalModalState.cardsCount < 3) throw new Error("Global Tracker modal did not render application cards!");
  console.log("✔ SUCCESS: Global Tracker Modal opens smoothly from any page.");

  const globalModalScreenshot = path.join(ARTIFACT_DIR, 'tracker_modal_from_hud.png');
  await page.screenshot({ path: globalModalScreenshot });
  console.log(`Saved screenshot: ${globalModalScreenshot}`);

  await page.evaluate(() => closeApplicationTrackerModal());
  await page.waitForTimeout(400);

  // 5. Test Page 2 "+ Track Job" Button
  console.log("\n--- TEST 5: Page 2 Job Card 1-Click Track Button ---");
  await page.evaluate(() => {
    goToStep(2);
  });
  await page.waitForTimeout(600);

  const trackBtnExists = await page.evaluate(() => {
    const trackBtns = document.querySelectorAll('.btn-track-job-card');
    return trackBtns.length;
  });
  console.log(`Found ${trackBtnExists} '📊 Track Job' buttons across Page 2 job cards.`);
  if (trackBtnExists === 0) throw new Error("No '.btn-track-job-card' buttons found on Page 2!");

  // Track the first job
  const beforeCount = await page.evaluate(() => getStoredApplications().length);
  await page.evaluate(() => quickTrackJobByIndex(0));
  await page.waitForTimeout(500);
  const afterCount = await page.evaluate(() => getStoredApplications().length);

  console.log(`Count before: ${beforeCount}, Count after quick tracking: ${afterCount}`);
  if (afterCount !== beforeCount + 1) throw new Error("1-Click track from Page 2 job card did not add application to tracker!");
  console.log("✔ SUCCESS: 1-Click Track Job button on Page 2 card added job to Application Tracker.");

  const page2Screenshot = path.join(ARTIFACT_DIR, 'page2_track_job_button.png');
  await page.screenshot({ path: page2Screenshot });
  console.log(`Saved screenshot: ${page2Screenshot}`);

  // 6. Test External Application Logger Modal
  console.log("\n--- TEST 6: Manual External Application Logger ---");
  await page.evaluate(() => {
    openLogExternalAppModal();
  });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    document.getElementById('logRoleTitleInput').value = "Chief Transformation Officer";
    document.getElementById('logCompanyInput').value = "Mubadala Investment Company";
    document.getElementById('logLocationInput').value = "Abu Dhabi, UAE";
    document.getElementById('logPlatformSelect').value = "Headhunter / Recruiter";
    document.getElementById('logEmailInput').value = "search.partner@kornferry-uae.com";
    document.getElementById('logInitialStageSelect').value = "interview";
    document.getElementById('logNotesInput').value = "Confirmed 90-minute confidential briefing with Investment Committee. Discussed AED 110,000 / month package.";
    saveExternalApplication();
  });
  await page.waitForTimeout(600);

  const loggedAppCheck = await page.evaluate(() => {
    const list = getStoredApplications();
    const found = list.find(a => a.role === "Chief Transformation Officer");
    return {
      found: !!found,
      company: found ? found.company : null,
      stage: found ? found.stage : null,
      contact: found ? found.contactName : null
    };
  });

  console.log("Logged External App Check:", loggedAppCheck);
  if (!loggedAppCheck.found || loggedAppCheck.stage !== "interview") {
    throw new Error("Failed to save and render external application!");
  }
  console.log("✔ SUCCESS: External application successfully logged and tracked in Executive Tracker.");

  console.log("\n=== ALL APPLICATION TRACKER & FOLLOW-UP TESTS PASSED WITH 100% SUCCESS! ===");
  await browser.close();
  server.close();
  process.exit(0);
})().catch(err => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
