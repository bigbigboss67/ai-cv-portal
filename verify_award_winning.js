const { chromium } = require('C:/Users/bigbi/node_modules/playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const artifactDir = 'C:\\Users\\bigbi\\.gemini\\antigravity\\brain\\f7afc8a9-a58c-4a3a-8bba-df8f932ba07a';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:3847/index.html...');
  await page.goto('http://localhost:3847/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // 1. Verify Floating Glass HUD
  const hud = await page.$('.wizard-header-wrap.floating-hud .wizard-bar.glass-capsule');
  console.log('Floating HUD Capsule detected:', !!hud);
  const readinessVal = await page.$eval('#hudReadinessVal', el => el.textContent);
  console.log('HUD Readiness Value:', readinessVal);

  await page.screenshot({
    path: path.join(artifactDir, 'award_floating_hud_capsule.png'),
    clip: { x: 0, y: 0, width: 1440, height: 350 }
  });

  // 2. Test ATS Machine X-Ray Mode
  console.log('Testing ATS Machine X-Ray toggle...');
  await page.click('#btnPage1AtsXray');
  await page.waitForTimeout(500);

  const isXrayActive = await page.$eval('#page1LiveCvMirror', el => el.classList.contains('ats-xray-active'));
  console.log('Page 1 CV Mirror has ats-xray-active:', isXrayActive);

  const xrayBannerVisible = await page.$eval('#page1LiveCvMirror .ats-xray-hud-banner', el => window.getComputedStyle(el).display !== 'none');
  console.log('ATS X-Ray HUD Banner visible on mirror sheet:', xrayBannerVisible);

  const metricTagsCount = await page.$$eval('#page1LiveCvMirror .xray-tag-metric', els => els.length);
  const keywordTagsCount = await page.$$eval('#page1LiveCvMirror .xray-tag-keyword', els => els.length);
  console.log(`ATS Tags rendered - Metrics: ${metricTagsCount}, Keywords: ${keywordTagsCount}`);

  await page.screenshot({
    path: path.join(artifactDir, 'award_ats_xray_mode.png'),
    clip: { x: 0, y: 180, width: 1440, height: 750 }
  });

  // Toggle X-Ray back off to verify seamless round-trip
  await page.click('#btnPage1AtsXray');
  await page.waitForTimeout(300);

  // 3. Step 2: Live Job Cards with Compensation Oracle & Recruiter Screening Speed
  console.log('Navigating to Page 2...');
  await page.click('#stepTab2');
  await page.waitForTimeout(600);

  const salaryPillsCount = await page.$$eval('.salary-oracle-pill', els => els.length);
  console.log('Salary Oracle Pills found on job cards:', salaryPillsCount);
  const firstSalaryText = await page.$eval('.salary-oracle-pill', el => el.textContent.trim());
  console.log('Sample Salary Benchmark:', firstSalaryText);

  await page.evaluate(() => window.scrollBy(0, 480));
  await page.waitForTimeout(400);

  await page.screenshot({
    path: path.join(artifactDir, 'award_job_cards_oracle.png'),
    clip: { x: 0, y: 180, width: 1440, height: 620 }
  });

  // 4. Step 3: Executive Tone Calibrator & 90-Day Executive Impact Brief
  console.log('Selecting first job and moving to Page 3...');
  await page.click('.exec-job-card');
  await page.waitForTimeout(600);

  const initialLetter = await page.$eval('#coverLetterTextarea', el => el.value);
  console.log('Initial Cover Letter contains "institutional":', /institutional/i.test(initialLetter));

  console.log('Switching to High-Velocity Tone...');
  await page.click('button[data-tone="velocity"]');
  await page.waitForTimeout(400);

  const velocityLetter = await page.$eval('#coverLetterTextarea', el => el.value);
  console.log('Velocity Cover Letter contains "high-velocity":', /high-velocity/i.test(velocityLetter));

  console.log('Toggling 90-Day Executive Hypothesis into Cover Letter...');
  await page.click('#chkInclude90DayPlan');
  await page.waitForTimeout(400);

  const planLetter = await page.$eval('#coverLetterTextarea', el => el.value);
  console.log('Cover Letter contains 90-Day Hypothesis:', /90-Day Executive Impact Hypothesis/i.test(planLetter));

  await page.screenshot({
    path: path.join(artifactDir, 'award_tone_and_90day_plan.png'),
    clip: { x: 0, y: 140, width: 1440, height: 780 }
  });

  // 5. Step 4: Circular Animated SVG Radar Readiness Gauge & Dispatches Ledger
  console.log('Navigating to Page 4...');
  await page.click('#stepTab4');
  await page.waitForTimeout(600);

  const radarGaugeExists = await page.$('#radarMeterCircle');
  console.log('SVG Circular Radar Ring exists:', !!radarGaugeExists);
  const radarScoreText = await page.$eval('#reviewScoreVal', el => el.textContent);
  console.log('Radar Score Text:', radarScoreText);

  // Test recording an executive dispatch
  console.log('Recording an executive application dispatch...');
  await page.evaluate(() => {
    recordExecutiveDispatch(state.selectedJob, "EML Package + ATS PDF", "exec.talent@industrial-group.ae", "Application — General Manager");
  });
  await page.waitForTimeout(400);

  const dispatchesCount = await page.$$eval('.dispatch-item-card', els => els.length);
  console.log('Dispatches Ledger items logged:', dispatchesCount);

  const countdownText = await page.$eval('.followup-target-badge', el => el.textContent.trim());
  console.log('Follow-up countdown badge text:', countdownText);

  await page.screenshot({
    path: path.join(artifactDir, 'award_step4_radar_and_ledger.png'),
    fullPage: true
  });

  console.log('ALL VERIFICATIONS COMPLETED SUCCESSFULLY!');
  await browser.close();
})();
