/* 浏览器渲染验证：打开页面 → 跑内置示例批改 → 检查手写稿与批注层 → 截图 */
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const root = path.join(__dirname, '..');
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1360, height: 940 } });

  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

  await page.goto('file://' + path.join(root, 'index.html'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(__dirname, 'shot-home.png') });

  // 示例批改（纯文字）
  await page.click('#cardDemoText');
  await page.waitForSelector('#viewResult:not(.hidden)');
  await page.waitForTimeout(1800); // 等字体加载与坐标测量

  const info = await page.evaluate(() => {
    const svg = document.getElementById('marksLayer');
    const groups = svg.querySelectorAll('.mark-group');
    const chars = document.querySelectorAll('#hwText .hchar[data-idx]');
    const items = document.querySelectorAll('#sidePanel .ann-item');
    return {
      marksCount: groups.length,
      charCount: chars.length,
      sideCards: document.querySelectorAll('#sidePanel .rcard').length,
      annItems: items.length,
      svgSize: [svg.getAttribute('width'), svg.getAttribute('height')],
      score: (document.querySelector('.score-big') || {}).textContent || ''
    };
  });
  console.log('渲染检查:', JSON.stringify(info));
  await page.screenshot({ path: path.join(__dirname, 'shot-result-text.png'), fullPage: true });

  // 滑杆对比模式
  await page.click('#tgCompare');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'shot-compare.png') });

  // 看图写话示例
  await page.click('#navHome');
  await page.click('#cardDemoImage');
  await page.waitForSelector('#viewResult:not(.hidden)');
  await page.waitForTimeout(1800);
  const imgInfo = await page.evaluate(() => ({
    relevance: !!document.querySelector('.relevance-score'),
    marksCount: document.querySelectorAll('#marksLayer .mark-group').length
  }));
  console.log('看图写话检查:', JSON.stringify(imgInfo));
  await page.screenshot({ path: path.join(__dirname, 'shot-result-image.png'), fullPage: true });

  // AI 写作文页面
  await page.click('#navHome');
  await page.click('#cardCompose');
  await page.waitForSelector('#viewCompose:not(.hidden)');
  await page.waitForTimeout(300);
  const cmpInfo = await page.evaluate(() => {
    const words = document.getElementById('cmpWords');
    return {
      hasGrade: !!document.getElementById('cmpGrade'),
      words: words ? words.options.length : 0,
      builtin: document.querySelectorAll('#cmpBuiltinGrid .builtin-item').length,
      hasReq: !!document.getElementById('cmpReq')
    };
  });
  console.log('写作文页检查:', JSON.stringify(cmpInfo));
  await page.screenshot({ path: path.join(__dirname, 'shot-compose.png') });

  // 设置抽屉
  await page.click('#navSettings');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'shot-settings.png') });

  console.log('控制台错误:', errors.length ? errors : '无');
  await browser.close();

  const ok = info.marksCount >= 6 && info.charCount > 100 && imgInfo.relevance &&
    cmpInfo.hasGrade && cmpInfo.words >= 8 && cmpInfo.builtin >= 2 && errors.length === 0;
  console.log(ok ? 'RENDER-OK' : 'RENDER-CHECK');
  process.exit(ok ? 0 : 1);
})();
