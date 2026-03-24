// Playwright test: upload testing-1.png to Image-to-Excel tool, capture preview & download xlsx
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
  const imgPath = '/Users/persiapantubel/Desktop/claude/full-setup/projects/1app/testing-1.png';
  const downloadDir = path.resolve(__dirname, 'test-output');
  fs.mkdirSync(downloadDir, { recursive: true });

  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  // Capture page console logs for debugging
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('COL_DEBUG') || text.includes('OCR') || text.includes('Error')) {
      console.log(`[PAGE] ${msg.type().toUpperCase()}: ${text}`);
    }
  });

  console.log('Navigating to Image-to-Excel page...');
  await page.goto('http://localhost:3000/tools/image-to-excel');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(downloadDir, 'img-1-loaded.png') });

  // Upload image file
  console.log('Uploading testing-1.png...');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(imgPath);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(downloadDir, 'img-2-after-upload.png') });

  // Find and click Convert/Extract button
  console.log('Looking for Extract/Convert button...');
  const extractBtn = page.locator('button').filter({ hasText: /extract|convert|process/i }).first();
  const btnText = await extractBtn.textContent().catch(() => 'not found');
  console.log(`Found button: "${btnText}"`);
  await extractBtn.click();

  // Wait for OCR processing — this takes a while (language model download + 2x OCR pass)
  console.log('Processing... (waiting up to 3 minutes for OCR)');
  await page.screenshot({ path: path.join(downloadDir, 'img-3-processing.png') });

  // Wait for preview table or download button to appear
  // OCR can take 4-5 minutes on first run (language model download + 2x passes on large image)
  console.log('Waiting up to 6 minutes for OCR to complete...');
  try {
    await page.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll('button, a'));
      return buttons.some(b => /download|xlsx/i.test(b.textContent || ''));
    }, { timeout: 360000 });
    console.log('Preview/Download appeared!');
  } catch {
    console.log('Timeout — taking screenshot of current state');
  }

  await page.screenshot({ path: path.join(downloadDir, 'img-4-preview.png'), fullPage: true });

  // Capture preview table data
  console.log('\n=== EXTRACTED TABLE PREVIEW ===');
  const tableRows = await page.locator('table tr').all().catch(() => []);
  for (const row of tableRows) {
    const cells = await row.locator('td, th').allTextContents();
    if (cells.some(c => c.trim())) {
      console.log(cells.map(c => c.trim().substring(0, 40)).join(' | '));
    }
  }

  // Also capture any text inputs that show extracted values
  const inputEls = await page.locator('input[type="text"]').all().catch(() => []);
  if (inputEls.length > 0) {
    console.log(`\n=== EDITABLE CELLS (${inputEls.length} total, showing first 20) ===`);
    for (let i = 0; i < Math.min(20, inputEls.length); i++) {
      const v = await inputEls[i].inputValue().catch(() => '');
      console.log(`  [${i}]: ${v}`);
    }
  }

  // Confidence score
  const confText = await page.locator('text=/confidence|%/i').first().textContent().catch(() => null);
  if (confText) console.log(`\nConfidence: ${confText}`);

  // Download xlsx
  console.log('\nAttempting xlsx download...');
  const downloadBtn = page.locator('button, a').filter({ hasText: /download|xlsx/i }).first();
  const downloadBtnText = await downloadBtn.textContent().catch(() => null);
  if (downloadBtnText) {
    console.log(`Clicking download: "${downloadBtnText}"`);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      downloadBtn.click(),
    ]);
    if (download) {
      const xlsxPath = path.join(downloadDir, 'testing-1-result.xlsx');
      await download.saveAs(xlsxPath);
      const size = fs.statSync(xlsxPath).size;
      console.log(`Downloaded: ${xlsxPath} (${(size / 1024).toFixed(1)} KB)`);
    } else {
      console.log('No download event captured');
    }
  } else {
    console.log('No download button found — taking final screenshot');
  }

  await page.screenshot({ path: path.join(downloadDir, 'img-5-final.png'), fullPage: true });
  console.log('\nScreenshots saved to test-output/');

  await browser.close();
}

main().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
