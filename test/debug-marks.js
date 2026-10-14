/* 调试 v2：重建 demo 批注 span，输出每条的分行落位（chars,x1,x2,top,bottom） */
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const root = path.join(__dirname, '..');
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1360, height: 940 } });
  await page.goto('file://' + path.join(root, 'index.html'));
  await page.waitForTimeout(600);
  await page.click('#cardDemoText');
  await page.waitForSelector('#viewResult:not(.hidden)');
  await page.waitForTimeout(1500);

  const dump = await page.evaluate(() => {
    const container = document.getElementById('hwText');
    const paperRect = document.getElementById('paper').getBoundingClientRect();
    const demo = AEG.demo.buildDemoResult({ id: 'd', content: AEG.demo.sampleEssay.content }, 'text');

    function lineGroups(start, end) {
      const items = [];
      for (let i = start; i < end; i++) {
        const el = container.querySelector('.hchar[data-idx="' + i + '"]');
        if (!el) continue;
        const r = el.getBoundingClientRect();
        items.push({ x: r.left - paperRect.left, y: r.top - paperRect.top, w: r.width, h: r.height, ch: el.textContent });
      }
      const groups = [];
      items.forEach((r) => {
        let g = groups.find((gg) => Math.abs(gg.y - r.y) < 8);
        if (!g) { g = { y: r.y, items: [] }; groups.push(g); }
        g.items.push(r);
      });
      return groups.map((g) => {
        const xs = g.items.map((r) => r.x).sort((a, b) => a - b);
        return {
          chars: g.items.map((r) => r.ch).join(''),
          x1: Math.round(xs[0]),
          x2: Math.round(xs[xs.length - 1] + 44),
          top: Math.round(Math.min(...g.items.map((r) => r.y))),
          bottom: Math.round(Math.max(...g.items.map((r) => r.y + r.h)))
        };
      });
    }

    return demo.annotations.map((a) => ({
      type: a.type,
      markStyle: a.markStyle,
      orig: a.original,
      span: a.span,
      groups: a.aligned ? lineGroups(a.span.start, a.span.end) : []
    }));
  });

  dump.forEach((d) => {
    console.log('--- ' + d.markStyle + ' |「' + d.orig + '」 span=[' + d.span.start + ',' + d.span.end + ')');
    (d.groups.length ? d.groups : [{ chars: '(插入点或未落位)', x1: '-', x2: '-', top: '-', bottom: '-' }]).forEach((g) => {
      console.log(`    行段: "${g.chars}" x1=${g.x1} x2=${g.x2} top=${g.top} bottom=${g.bottom}`);
    });
  });

  await browser.close();
})();
