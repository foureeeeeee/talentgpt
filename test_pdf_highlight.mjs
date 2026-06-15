import { chromium } from 'playwright';

const PDF_PATH = '/tmp/test_cv_sarah_chen.pdf';
const APP_URL = 'http://localhost:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGE: ' + err.message));

  // 1. Dashboard → Create First Job
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.locator('button:has-text("Create First Job")').click();
  await sleep(400);
  console.log('✓ New job form opened');

  // 2. Fill Job Title (left column)
  await page.locator('input[placeholder*="Senior Software"]').fill('Senior Software Engineer');

  // 3. Fill Job Description
  await page.locator('textarea[placeholder*="job description"]').fill(
    'We need a Senior Software Engineer with 5+ years Python and TypeScript. ' +
    'Must have React, microservices, AWS experience. ' +
    'Team leadership and mentoring experience required.'
  );

  // 4. Fill Candidate Name
  await page.locator('input[placeholder*="Candidate name"]').fill('Sarah Chen');

  // 5. Click PDF tab to switch to PDF upload mode
  await page.locator('button:has-text("PDF")').click();
  await sleep(300);
  await page.screenshot({ path: '/tmp/ss_pdf_tab.png' });
  console.log('✓ Switched to PDF tab');

  // 6. Upload the PDF file
  const fileInput = page.locator('input[type="file"]');
  await fileInput.waitFor({ timeout: 5000 });
  await fileInput.setInputFiles(PDF_PATH);
  await sleep(3000);
  await page.screenshot({ path: '/tmp/ss_pdf_selected.png' });
  console.log('✓ PDF file selected');

  // 7. Click Add Candidate
  await page.locator('button:has-text("Add Candidate")').click();
  await sleep(800);
  await page.screenshot({ path: '/tmp/ss_candidate_added.png' });
  const sarahAdded = await page.locator('text=Sarah Chen').first().isVisible().catch(() => false);
  console.log('Sarah Chen added:', sarahAdded ? '✓' : '✗');

  // 8. Save Job Project
  await page.locator('button:has-text("Save Job Project")').click();
  await sleep(1200);
  await page.screenshot({ path: '/tmp/ss_saved.png' });
  console.log('✓ Project saved');

  // 9. Select Sarah's checkbox and run analysis
  // First find the checkbox or card for Sarah
  const sarahCheckbox = page.locator('input[type="checkbox"]').first();
  await sarahCheckbox.waitFor({ timeout: 5000 });
  await sarahCheckbox.click();
  await sleep(300);

  const runBtn = page.locator('button:has-text("Run TalentGPT Analysis")');
  await runBtn.waitFor({ timeout: 5000 });
  await runBtn.click();
  console.log('✓ Running analysis (waiting up to 45s)...');

  // 10. Wait for analysis to load
  try {
    await page.waitForSelector('button:has-text("View CV")', { timeout: 45000 });
  } catch {
    await page.screenshot({ path: '/tmp/ss_ERROR.png' });
    console.log('✗ Timed out');
    await browser.close(); return;
  }
  await sleep(2000);
  await page.screenshot({ path: '/tmp/ss_analysis.png' });
  console.log('✓ Analysis ready');

  // 11. Click View CV
  await page.locator('button:has-text("View CV")').click();
  await sleep(500);
  console.log('✓ CV panel opened');

  // 12. Wait for PDF pages to render
  let pdfOk = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await page.locator('img[alt*="Page"]').count() > 0) { pdfOk = true; break; }
    if (await page.locator('text=Could not render PDF').isVisible().catch(() => false)) break;
    if (errors.some(e => /version/i.test(e))) break;
  }
  await page.screenshot({ path: '/tmp/ss_cv_panel.png' });
  const pageCount = await page.locator('img[alt*="Page"]').count();
  console.log(`PDF rendered: ${pdfOk ? '✓' : '✗'} — ${pageCount} page(s)`);

  // 13. Click Highlight
  const hBtn = page.locator('button:has-text("Highlight"), button:has-text("refs")').first();
  if (await hBtn.isVisible().catch(() => false)) {
    await hBtn.click();
    await sleep(800);
    await page.screenshot({ path: '/tmp/ss_highlight.png' });
    const txt  = await hBtn.textContent().catch(() => '');
    const cvs  = await page.locator('canvas').count();
    console.log(`✓ Highlight clicked | Button: "${txt.trim()}" | Canvas overlays: ${cvs}`);
  } else {
    console.log('✗ Highlight button not visible');
  }

  // 14. Errors
  const relevant = errors.filter(e => /error|version|undefined|PDF/i.test(e));
  console.log('\n— Console errors —');
  relevant.length
    ? relevant.slice(0, 5).forEach(e => console.log('✗', e.slice(0, 200)))
    : console.log('✓ None');

  await browser.close();
  console.log('\n✓ Done. Screenshots: /tmp/ss_*.png');
})();
