/* 只截手写稿元素，检查批注符号视觉效果 */
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const root = path.join(__dirname, '..');
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1600 } });
  await page.goto('file://' + path.join(root, 'index.html'));
  await page.waitForTimeout(600);
  await page.click('#cardDemoText');
  await page.waitForSelector('#viewResult:not(.hidden)');
  await page.waitForTimeout(1500);
  const el = await page.$('#paper');
  await el.screenshot({ path: path.join(__dirname, 'shot-paper.png') });
  console.log('paper 截图完成');
  await browser.close();
})();
