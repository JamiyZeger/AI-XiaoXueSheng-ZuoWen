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

  // 作业纸批改页面（多页 + 看图写话入口）
  await page.click('#navHome');
  await page.click('#cardHomework');
  await page.waitForSelector('#viewHomework:not(.hidden)');
  await page.waitForTimeout(300);
  const hwInfo = await page.evaluate(() => ({
    hasUpload: !!document.getElementById('btnHwUpload'),
    hasFile: !!document.getElementById('hwFile'),
    fileMultiple: document.getElementById('hwFile').hasAttribute('multiple'),
    hasThumbs: !!document.getElementById('hwThumbs'),
    hasPromptImg: !!document.getElementById('hwPromptFile') && !!document.getElementById('btnHwPromptImg'),
    hasRun: !!document.getElementById('btnHwRun'),
    hasGradeSel: !!document.getElementById('hwGrade'),
    noConfirmView: !document.getElementById('viewHomeworkText'),
    hasPhotoStack: !!document.getElementById('photoStack'),
    hasSide: !!document.getElementById('hwSidePanel')
  }));
  console.log('作业纸页检查:', JSON.stringify(hwInfo));
  await page.screenshot({ path: path.join(__dirname, 'shot-homework.png') });

  // drawOnPhoto：多页批注按 page 归属，各画各的
  const drawInfo = await page.evaluate(() => {
    const NS = 'http://www.w3.org/2000/svg';
    const mk = () => {
      const s = document.createElementNS(NS, 'svg');
      document.body.appendChild(s);
      return s;
    };
    const entries = [
      { text: '第一页内容。', bbox: [75, 100, 875, 200], page: 1, offset: 0 },
      { text: '第二页内容。', bbox: [75, 100, 875, 200], page: 2, offset: 7 }
    ];
    const content = '第一页内容。\n第二页内容。';
    const anns = [
      { id: 'p1', aligned: true, category: 'strength', type: 'good_phrase',
        markStyle: 'wavy', span: { start: 0, end: 3, text: '第一页' }, suggestion: '', comment: '' },
      { id: 'p2', aligned: true, category: 'error', type: 'typo',
        markStyle: 'circle', span: { start: 7, end: 10, text: '第二页' }, suggestion: '改', comment: '' }
    ];
    const svg1 = mk(), svg2 = mk();
    AEG.homework.drawOnPhoto(svg1, anns, entries, 800, 600, content, 1);
    AEG.homework.drawOnPhoto(svg2, anns, entries, 800, 600, content, 2);
    const out = {
      page1Marks: svg1.querySelectorAll('.mark-group').length,
      page2Marks: svg2.querySelectorAll('.mark-group').length,
      page1OnlyOwn: !svg1.querySelector('[data-ann="p2"]') && !!svg1.querySelector('[data-ann="p1"]'),
      page2OnlyOwn: !svg2.querySelector('[data-ann="p1"]') && !!svg2.querySelector('[data-ann="p2"]'),
      viewBox: svg1.getAttribute('viewBox'),
      page2HasSuggest: !!svg2.querySelector('text')
    };
    document.body.removeChild(svg1);
    document.body.removeChild(svg2);
    return out;
  });
  console.log('原图批注检查:', JSON.stringify(drawInfo));

  // 作业纸批改结果页：种一条两页历史记录，从历史打开走真实渲染路径
  await page.evaluate(() => {
    const mkPhoto = (label) => {
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 600;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FDFBF4'; ctx.fillRect(0, 0, 800, 600);
      ctx.strokeStyle = '#C9B99A'; ctx.strokeRect(20, 20, 760, 560);
      ctx.fillStyle = '#333'; ctx.font = '30px sans-serif';
      ctx.fillText(label, 100, 300);
      return canvas.toDataURL('image/jpeg', 0.8);
    };
    const photo1 = mkPhoto('第一页作文内容');
    const photo2 = mkPhoto('第二页作文内容');
    const essay = {
      id: 'essay-hw-test', mode: 'homework', title: '我的好朋友',
      content: '我有一个好朋友。\n他叫小明。', grade: 3, wordCount: 13,
      createdAt: new Date().toISOString(),
      hwEntries: [
        { text: '我有一个好朋友。', bbox: [75, 420, 875, 540], page: 1, offset: 0 },
        { text: '他叫小明。', bbox: [75, 620, 875, 740], page: 2, offset: 9 }
      ],
      hwPages: [photo1, photo2],
      imageDataUrl: ''
    };
    const correction = {
      id: 'cr-hw-test', essayId: 'essay-hw-test', mode: 'homework', model: 'test-vision',
      promptVersion: 'v1', status: 'ok', createdAt: new Date().toISOString(),
      annotations: [
        { id: 'hw-a1', type: 'good_phrase', category: 'strength', markStyle: 'wavy', aligned: true,
          span: { start: 0, end: 4, text: '我有一个' }, original: '我有一个', suggestion: '', comment: '开头不错' },
        { id: 'hw-a2', type: 'typo', category: 'error', markStyle: 'circle', aligned: true,
          span: { start: 9, end: 12, text: '他叫小' }, original: '他叫小', suggestion: '他叫小', comment: '注意书写' }
      ],
      overall: { score: 90, stars: 5, summary: '写得不错', strengths: ['语句通顺'], improvements: ['注意书写'], suggestions: ['多用好词'] }
    };
    localStorage.setItem('aeg.essays.v1', JSON.stringify([essay]));
    localStorage.setItem('aeg.corrections.v1', JSON.stringify([correction]));
  });
  await page.click('#navHistory');
  await page.waitForTimeout(300);
  await page.click('[data-open="cr-hw-test"]');
  await page.waitForSelector('#viewHomeworkResult:not(.hidden)');
  await page.waitForTimeout(800);
  const hwResultInfo = await page.evaluate(() => {
    const wraps = document.querySelectorAll('#photoStack .photo-wrap');
    const svgs = document.querySelectorAll('#photoStack svg.photo-marks');
    let marks = 0, p1 = 0, p2 = 0;
    svgs.forEach((s, i) => {
      const n = s.querySelectorAll('.mark-group').length;
      marks += n;
      if (i === 0) p1 = n;
      if (i === 1) p2 = n;
    });
    return {
      photoCount: wraps.length,
      marks,
      page1Marks: p1,
      page2Marks: p2,
      badges: document.querySelectorAll('#photoStack .photo-badge').length,
      sideCards: document.querySelectorAll('#hwSidePanel .rcard').length,
      annItems: document.querySelectorAll('#hwSidePanel .ann-item').length,
      photoLoaded: !!document.querySelector('#photoStack .photo-img').naturalWidth,
      viewBox: svgs[0] ? svgs[0].getAttribute('viewBox') : ''
    };
  });
  console.log('作业纸结果页检查:', JSON.stringify(hwResultInfo));
  await page.screenshot({ path: path.join(__dirname, 'shot-homework-result.png'), fullPage: true });

  // 设置抽屉
  await page.click('#navSettings');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'shot-settings.png') });

  console.log('控制台错误:', errors.length ? errors : '无');
  await browser.close();

  const ok = info.marksCount >= 6 && info.charCount > 100 && imgInfo.relevance &&
    cmpInfo.hasGrade && cmpInfo.words >= 8 && cmpInfo.builtin >= 2 &&
    hwInfo.hasUpload && hwInfo.fileMultiple && hwInfo.hasThumbs && hwInfo.hasPromptImg &&
    hwInfo.hasRun && hwInfo.hasGradeSel && hwInfo.noConfirmView && hwInfo.hasPhotoStack &&
    drawInfo.page1Marks === 1 && drawInfo.page2Marks === 1 && drawInfo.page1OnlyOwn &&
    drawInfo.page2OnlyOwn && drawInfo.viewBox === '0 0 800 600' && drawInfo.page2HasSuggest &&
    hwResultInfo.photoCount === 2 && hwResultInfo.marks === 2 && hwResultInfo.page1Marks === 1 &&
    hwResultInfo.page2Marks === 1 && hwResultInfo.badges === 2 &&
    hwResultInfo.sideCards >= 1 && hwResultInfo.annItems >= 2 &&
    hwResultInfo.photoLoaded && hwResultInfo.viewBox === '0 0 800 600' &&
    errors.length === 0;
  console.log(ok ? 'RENDER-OK' : 'RENDER-CHECK');
  process.exit(ok ? 0 : 1);
})();
