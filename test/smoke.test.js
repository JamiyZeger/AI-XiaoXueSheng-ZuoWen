/* 纯逻辑冒烟测试：demo offset、alignQuote、JSON 提取修复、normalize 归一化 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {
  console,
  Date, Math, JSON, String, Array, Object, Number, Promise, Error, TypeError, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} }
};
sandbox.window = sandbox; // 浏览器里 window 即全局对象，脚本依赖 window.AEG === AEG
sandbox.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};
sandbox.globalThis = sandbox;

// 极简假 DOM：够 marks.draw 画 SVG 节点用（纯逻辑测试不需要真实渲染）
function fakeEl(name) {
  const el = {
    nodeName: name, attrs: {}, children: [], style: {}, textContent: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    }
  };
  Object.defineProperty(el, 'firstChild', { get() { return this.children[0] || null; } });
  return el;
}
sandbox.document = { createElementNS: (ns, name) => fakeEl(name) };

vm.createContext(sandbox);

const jsDir = path.join(__dirname, '..', 'js');
for (const f of ['rng.js', 'store.js', 'prompt.js', 'llm.js', 'compose.js', 'homework.js', 'handwriting.js', 'marks.js', 'demo.js']) {
  vm.runInContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), sandbox, { filename: f });
}

const AEG = sandbox.window.AEG;
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra || ''); }
}

// 1. demo 批改结果的 span 必须与原文完全一致
const sample = AEG.demo.sampleEssay;
const demoResult = AEG.demo.buildDemoResult({ id: 'x', content: sample.content }, 'text');
check('demo 结果包含批注', demoResult.annotations.length >= 5, demoResult.annotations.length);
let spanOk = true, spanDetail = '';
for (const a of demoResult.annotations) {
  const slice = sample.content.slice(a.span.start, a.span.end);
  if (a.type !== 'insert' && slice !== a.span.text) { spanOk = false; spanDetail = a.type + ':' + slice + '≠' + a.span.text; }
}
check('demo 批注 offset 与原文一致', spanOk, spanDetail);

// 2. alignQuote 多处出现时按就近校准
// '小明说你好。小红说你好。' 中 "你好" 出现在下标 3 与 9；approx=12 时应命中 9
const c = '小明说你好。小红说你好。';
const hit = AEG.llm.alignQuote(c, '你好', 12);
check('alignQuote 就近匹配', hit && hit.start === 9, JSON.stringify(hit));
const hit2 = AEG.llm.alignQuote(c, '你好', 0);
check('alignQuote 偏近起点匹配', hit2 && hit2.start === 3, JSON.stringify(hit2));
check('alignQuote 找不到返回 null', AEG.llm.alignQuote(c, '不存在的句子', 0) === null);

// 3. extractJson：代码块包裹 / 前后杂文 / 尾逗号
check('extractJson 裸 JSON', AEG.llm.extractJson('{"a":1}').a === 1);
check('extractJson 代码块', AEG.llm.extractJson('```json\n{"a":2}\n```').a === 2);
check('extractJson 带杂文', AEG.llm.extractJson('好的，结果如下：{"a":3} 请查收').a === 3);
check('extractJson 尾逗号修复', AEG.llm.extractJson('{"a":4,}').a === 4);
let threw = false;
try { AEG.llm.extractJson('完全不是 JSON'); } catch (e) { threw = true; }
check('extractJson 非 JSON 抛错', threw);

// 3b. 解析鲁棒性：裸引号 / 字符串内换行 / 注释 / 截断补齐 / 多候选
check('extractJson 字符串内裸引号',
  AEG.llm.extractJson('{"comment":"他说"你好"真棒"}').comment === '他说"你好"真棒');
check('extractJson 字符串内真实换行',
  AEG.llm.extractJson('{"a":"line1\nline2"}').a === 'line1\nline2');
check('extractJson 行注释', AEG.llm.extractJson('{"a":1, // 注释\n"b":2}').b === 2);
check('extractJson 截断补齐', AEG.llm.extractJson('{"overall":{"score":88').overall.score === 88);
check('extractJson 多候选取首个可解析',
  AEG.llm.extractJson('说明 {不完整 完整结果: {"a":5}').a === 5);
check('sanitizeJson 裸引号转义可解析',
  JSON.parse(AEG.llm.sanitizeJson('{"q":"他说"你好"，真棒"}')).q === '他说"你好"，真棒');
check('sanitizeJson 尾逗号', JSON.parse(AEG.llm.sanitizeJson('{"a":1,}')).a === 1);

// 3c. messageText 兼容 content 分片数组
check('messageText 字符串', AEG.llm.messageText({ choices: [{ message: { content: '你好' } }] }) === '你好');
check('messageText 分片数组', AEG.llm.messageText({ choices: [{ message: { content: [{ text: '你' }, { text: '好' }, '啊'] } }] }) === '你好啊');
check('messageText 缺失返回空', AEG.llm.messageText({}) === '');

// 3d. degradedResult 降级结果
const deg = AEG.llm.degradedResult({ essayId: 'e', mode: 'text', model: 'm', promptVersion: 'v1' }, 'x'.repeat(5000));
check('degradedResult 状态与空批注', deg.status === 'degraded' && deg.annotations.length === 0);
check('degradedResult rawText 截断 3000', deg.rawText.length === 3000, deg.rawText.length);
check('degradedResult 含重试建议', deg.overall.suggestions.length >= 1);

// 4. normalize：quote 对齐、insert 锚点、失配降级
const raw = {
  annotations: [
    { type: 'good_phrase', category: 'strength', markStyle: 'wavy', quote: '阳光洒在湖面上', start: 5, comment: '好' },
    { type: 'insert', category: 'error', markStyle: 'caret', quote: '今天真是快乐的一天啊', start: 80, suggestion: '。', comment: '加句号' },
    { type: 'typo', category: 'error', markStyle: 'circle', quote: '不存在的内容', start: 3, suggestion: 'x', comment: '失配' }
  ],
  overall: { score: 88, stars: 4, summary: '不错', strengths: ['a'], improvements: ['b'], suggestions: ['c'] }
};
const norm = AEG.llm.normalize(raw, { content: sample.content, essayId: 'e', mode: 'text', model: 'm', promptVersion: 'v1' });
check('normalize 生成 3 条批注', norm.annotations.length === 3, norm.annotations.length);
check('normalize 首条对齐成功', norm.annotations[0].aligned === true && sample.content.slice(norm.annotations[0].span.start, norm.annotations[0].span.end) === '阳光洒在湖面上');
check('normalize insert 落在锚点末尾', norm.annotations[1].aligned === true && norm.annotations[1].span.start === norm.annotations[1].span.end && norm.annotations[1].span.start === sample.content.indexOf('今天真是快乐的一天啊') + '今天真是快乐的一天啊'.length);
check('normalize 失配标记 aligned=false', norm.annotations[2].aligned === false);
check('normalize 状态 partial', norm.status === 'partial', norm.status);
check('normalize overall 完整', norm.overall.score === 88 && norm.overall.stars === 4);

// 5. prompt 组装
const sys = AEG.prompt.buildSystemPrompt({ extraInstructions: '按四年级标准' });
check('System Prompt 含 JSON 契约', sys.indexOf('"annotations"') >= 0 && sys.indexOf('quote') >= 0);
check('System Prompt 附加要求生效', sys.indexOf('按四年级标准') >= 0);
const userText = AEG.prompt.buildUserText({ title: '题目', grade: 3, content: '正文', mode: 'text' });
check('User Prompt 含正文与年级', userText.indexOf('正文') >= 0 && userText.indexOf('3 年级') >= 0);

// 5b. 看图写话：prompt 契约与读图校验
check('System Prompt 含 imageDescription 契约',
  sys.indexOf('imageDescription') >= 0 && sys.indexOf('imageUnsupported') >= 0);
check('System Prompt 要求评价结合图片', sys.indexOf('结合图片内容') >= 0);
const picUserText = AEG.prompt.buildUserText({ title: '题目', grade: 2, content: '正文', mode: 'image_prompt' });
check('看图 User Prompt 要求先看图再批改',
  picUserText.indexOf('imageDescription') >= 0 && picUserText.indexOf('图片') >= 0);
check('visionMissing 缺描述判缺失', AEG.llm.visionMissing({}) === true);
check('visionMissing 空描述判缺失', AEG.llm.visionMissing({ imageDescription: '   ' }) === true);
check('visionMissing 有描述判正常', AEG.llm.visionMissing({ imageDescription: '一个男孩在放风筝' }) === false);
check('visionMissing 显式不支持判缺失', AEG.llm.visionMissing({ imageDescription: 'x', imageUnsupported: true }) === true);

// 5c. normalize 透传读图描述
const rawPic = {
  imageDescription: '一个男孩在草地上放风筝',
  relevance: { score: 8, coveredPoints: ['风筝'], missedPoints: [], comment: '好' },
  overall: { score: 85, stars: 4, summary: '不错', strengths: [], improvements: [], suggestions: [] },
  annotations: []
};
const normPic = AEG.llm.normalize(rawPic, { content: sample.content, essayId: 'e', mode: 'image_prompt', model: 'm', promptVersion: 'v1' });
check('normalize 透传 imageDescription', normPic.imageDescription === '一个男孩在草地上放风筝');
check('normalize 透传 relevance', normPic.relevance && normPic.relevance.score === 8);

// 5d. 写作文：prompt 契约、要求组装、内容提取
const csys = AEG.compose.buildSystemPrompt({});
check('写作文 System Prompt 含 JSON 契约', csys.indexOf('"content"') >= 0 && csys.indexOf('imageDescription') >= 0);
check('写作文 System Prompt 含字数纪律', csys.indexOf('字数要求') >= 0);
const ctext = AEG.compose.buildUserText({ title: '我的好朋友', grade: 2, wordLimit: 200, mode: 'text' });
check('写作文 User 含题目年级字数', ctext.indexOf('我的好朋友') >= 0 && ctext.indexOf('2 年级') >= 0 && ctext.indexOf('200 字左右') >= 0);
const ctextImg = AEG.compose.buildUserText({ grade: 3, wordLimit: 0, mode: 'image' });
check('看图写作 User 要求先看图', ctextImg.indexOf('imageDescription') >= 0 && ctextImg.indexOf('自拟') >= 0);
const gotJson = AEG.compose.extractContent('{"imageDescription":"草地上一个男孩","content":"春天来了。"}');
check('extractContent 取 JSON content', gotJson && gotJson.content === '春天来了。' && gotJson.fromJson === true);
check('extractContent 透传 imageDescription', gotJson.imageDescription === '草地上一个男孩');
const gotAlt = AEG.compose.extractContent('{"essay":"备用键名的作文。"}');
check('extractContent 兼容 essay 键', gotAlt && gotAlt.content === '备用键名的作文。');
const gotPlain = AEG.compose.extractContent('```markdown\n春天来了，小草绿了。\n```');
check('extractContent 纯文本兜底', gotPlain && gotPlain.content === '春天来了，小草绿了。' && gotPlain.fromJson === false);
check('extractContent 严格模式拒收纯文本', AEG.compose.extractContent('就是一篇作文', true) === null);

// 5e. 作业纸批改：识别 prompt 契约（含多页）
const hwSys = AEG.prompt.buildRecognizeSystemPrompt();
check('识别 Prompt 含 bbox 契约', hwSys.indexOf('bbox') >= 0 && hwSys.indexOf('0~1000') >= 0);
check('识别 Prompt 要求忠实识别', hwSys.indexOf('错别字') >= 0 && hwSys.indexOf('□') >= 0);
check('识别 Prompt 含 JSON 结构', hwSys.indexOf('"lines"') >= 0 && hwSys.indexOf('"title"') >= 0);
check('识别 Prompt 含多页契约', hwSys.indexOf('"page"') >= 0 && hwSys.indexOf('照片顺序不一定正确') >= 0);
const hwUser = AEG.prompt.buildRecognizeUserText(1);
check('识别 User 含识别要求', hwUser.indexOf('手写') >= 0 && hwUser.indexOf('JSON') >= 0);
const hwUser3 = AEG.prompt.buildRecognizeUserText(3);
check('多页识别 User 提示智能排序', hwUser3.indexOf('3 张') >= 0 && hwUser3.indexOf('智能判断') >= 0);

// 5f. 作业纸：识别结果归一化
const HW = AEG.homework;
const rec = HW.normalizeRecognition({
  title: '我的好朋友',
  lines: [
    { text: '我的好朋友', bbox: [100, 20, 500, 60] },
    { text: '我有一个好朋友。', bbox: [50, 80, 950, 130] },
    { text: '他叫小明。', bbox: [2000, -30, 50, 200] },   // 乱序/越界 bbox → 钳制交换
    { text: '   ', bbox: [0, 0, 10, 10] },                 // 空行 → 丢弃
    { text: '我们天天一起玩。' }                             // 缺 bbox → 估计补齐
  ]
});
check('normalizeRecognition 保留题目', rec.title === '我的好朋友');
check('normalizeRecognition 丢空行', rec.lines.length === 4, rec.lines.length);
check('normalizeRecognition bbox 越界钳制', rec.lines[1].bbox[0] === 50 && rec.lines[1].bbox[3] === 130);
check('normalizeRecognition 乱序 bbox 交换修正',
  rec.lines[2].bbox[0] < rec.lines[2].bbox[2] && rec.lines[2].bbox[1] >= 0 && rec.lines[2].bbox[2] <= 1000);
check('normalizeRecognition 补缺失 bbox', !!rec.lines[3].bbox && rec.lines[3].bbox[3] > rec.lines[3].bbox[1]);
check('normBbox 非法返回 null', HW.normBbox([1, 2, 3]) === null && HW.normBbox('x') === null && HW.normBbox([1, 1, 1, 1]) === null);

// 5g. 作业纸：题目行剔除与正文布局
const split = HW.splitTitleLine(rec.title, rec.lines);
check('题目行从正文剔除', split.bodyLines.length === 3 && split.bodyLines[0].text === '我有一个好朋友。');
const noSplit = HW.splitTitleLine('别的题目', rec.lines);
check('题目不一致时保留首行', noSplit.bodyLines.length === 4);
const lay = HW.layout(split.bodyLines);
check('layout 拼接正文', lay.content === '我有一个好朋友。\n他叫小明。\n我们天天一起玩。');
check('layout 行偏移正确',
  lay.entries[0].offset === 0 && lay.entries[1].offset === 9 && lay.entries[2].offset === 15);

// 5h. 作业纸：bbox → 字符矩形映射（供 marks 复用）
const rects = HW.rectsFor(lay.entries, 800, 1200);
check('rects 覆盖所有正文字符', !!rects[0] && !!rects[9] && !!rects[lay.content.length - 1]);
check('rects 不含换行位', !rects[8] && !rects[14]); // 下标 8 / 14 是换行符
const r0 = rects[0], e0 = lay.entries[0].bbox;
check('rects 坐标落在行框内',
  Math.abs(r0.y - e0[1] / 1000 * 1200) < 0.01 && Math.abs(r0.y + r0.h - e0[3] / 1000 * 1200) < 0.01);
check('rects 行内均分且居中', Math.abs(r0.cx - (r0.x + r0.w / 2)) < 0.001 && r0.w > 0);
const lay2 = HW.layout([{ text: '😀好', bbox: [0, 0, 300, 100] }]);
const rects2 = HW.rectsFor(lay2.entries, 300, 100);
check('rects 代理对共享矩形', rects2[0] === rects2[1] && !!rects2[2] && rects2[2] !== rects2[0]);

// 5i. 作业纸多页：page 归一化、页归属、按页过滤
const recMp = HW.normalizeRecognition({
  title: '我的一天',
  lines: [
    { text: '第一页第一行。', bbox: [50, 80, 950, 130], page: 1 },
    { text: '第一页第二行。', bbox: [50, 150, 950, 200] },        // page 缺失 → 沿用上一行
    { text: '第二页第一行。', bbox: [50, 80, 950, 130], page: 2 },
    { text: '第二页第二行。', bbox: [50, 150, 950, 200], page: 9 } // 越界 → 沿用上一行
  ]
}, 2);
check('page 缺失沿用上一行', recMp.lines[1].page === 1);
check('page 越界钳制沿用', recMp.lines[3].page === 2);
check('多页 page 保留', recMp.lines[2].page === 2);
const splitMp = HW.splitTitleLine(recMp.title, recMp.lines);
const layMp = HW.layout(splitMp.bodyLines);
check('多页 layout 保留 page', layMp.entries[0].page === 1 && layMp.entries[2].page === 2);
check('多页 layout 偏移连续', layMp.entries[2].offset === layMp.entries[1].offset + layMp.entries[1].text.length + 1);
check('pageOfOffset 命中页', HW.pageOfOffset(layMp.entries, 2) === 1 && HW.pageOfOffset(layMp.entries, layMp.entries[2].offset + 1) === 2);
const annP1 = { span: { start: 0, end: 4, text: '第一页' } };
const annP2 = { span: { start: layMp.entries[2].offset, end: layMp.entries[2].offset + 3, text: '第二页' } };
check('pagesOfAnn 归属页', HW.pagesOfAnn(layMp.entries, annP1)[0] === 1 && HW.pagesOfAnn(layMp.entries, annP2)[0] === 2);
check('annsForPage 按页过滤', HW.annsForPage([annP1, annP2], layMp.entries, 1).length === 1 &&
  HW.annsForPage([annP1, annP2], layMp.entries, 2).length === 1);
const insAnn = { span: { start: layMp.entries[2].offset, end: layMp.entries[2].offset, text: '' } };
check('插入批注锚点归页', HW.pagesOfAnn(layMp.entries, insAnn)[0] === 2);
// 跨页批注归两页
const crossAnn = {
  span: {
    start: layMp.entries[1].offset,
    end: layMp.entries[2].offset + 2,
    text: ''
  }
};
check('跨页批注归两页', HW.pagesOfAnn(layMp.entries, crossAnn).length === 2);

// 5j. 作业纸多页：按阅读顺序重排照片
const imgs = ['照片A', '照片B', '照片C'];
// 照片按 A、B、C 放入，但文章顺序是 B 先、A 次、C 无文字
const rp = HW.reorderPages([
  { text: 'B页第一行。', bbox: [0, 0, 900, 60], page: 2 },
  { text: 'B页第二行。', bbox: [0, 80, 900, 140], page: 2 },
  { text: 'A页第一行。', bbox: [0, 0, 900, 60], page: 1 }
], imgs);
check('reorderPages 照片按阅读顺序重排', rp.images[0] === '照片B' && rp.images[1] === '照片A');
check('reorderPages 无文字页排最后', rp.images[2] === '照片C');
check('reorderPages page 重映射', rp.lines[0].page === 1 && rp.lines[2].page === 2);
check('reorderPages order 记录旧页序', rp.order.join(',') === '2,1,3');
const rp1 = HW.reorderPages([{ text: 'x', bbox: [0, 0, 900, 60], page: 1 }], ['单页']);
check('reorderPages 单页不动', rp1.images[0] === '单页' && rp1.lines[0].page === 1);

// 5k. 批注错位回归：像素 bbox 防护 / quote 容错对齐 / 行尾增补号 / 落位覆盖
// 5k-1 识别模型误用像素坐标（>1000）时应按照片尺寸换算成 0~1000，而不是钳制丢位
const recPix = HW.normalizeRecognition({
  title: '我的一天',
  lines: [
    { text: '第一行文字。', bbox: [60, 120, 900, 200], page: 1 },
    { text: '第二行文字。', bbox: [60, 1050, 900, 1130], page: 1 } // 像素 y 超 1000，钳制会毁掉这行
  ]
}, 1, [{ w: 960, h: 1280 }]);
check('像素 bbox 按照片尺寸换算',
  Math.abs(recPix.lines[0].bbox[1] - 93.75) < 0.5 && Math.abs(recPix.lines[1].bbox[3] - 882.8) < 0.5,
  JSON.stringify(recPix.lines.map(function (l) { return l.bbox; })));
check('像素 bbox 行序保持', recPix.lines[1].bbox[1] > recPix.lines[0].bbox[3]);

// 5k-2 没有照片尺寸时：按该页 bbox 极值兜底归一，行序与相对位置不塌
const recPix2 = HW.normalizeRecognition({
  title: 'x',
  lines: [
    { text: '第一行。', bbox: [60, 120, 900, 200], page: 1 },
    { text: '第二行。', bbox: [60, 1050, 900, 1130], page: 1 }
  ]
});
check('像素 bbox 无尺寸按极值归一',
  Math.abs(recPix2.lines[1].bbox[2] - 1000) < 0.5 && Math.abs(recPix2.lines[1].bbox[3] - 1000) < 0.5 && recPix2.lines[1].bbox[1] < 999,
  JSON.stringify(recPix2.lines.map(function (l) { return l.bbox; })));
check('像素 bbox 无尺寸行序保持', recPix2.lines[1].bbox[1] > recPix2.lines[0].bbox[3]);

// 5k-3 归一化坐标（0~1000）不得被误判成像素
const recNorm = HW.normalizeRecognition({
  title: 'x',
  lines: [
    { text: '第一行。', bbox: [60, 120, 900, 200], page: 1 },
    { text: '第二行。', bbox: [60, 700, 900, 780], page: 1 }
  ]
}, 1, [{ w: 960, h: 1280 }]);
check('归一化 bbox 原样保留', recNorm.lines[0].bbox[1] === 120 && recNorm.lines[1].bbox[3] === 780,
  JSON.stringify(recNorm.lines.map(function (l) { return l.bbox; })));

// 5k-4 quote 与识别文字有认不出的字（□）时也要能对齐
const hitSq = AEG.llm.alignQuote('他叫小□。我们一起玩。', '他叫小明。', 0);
check('alignQuote □ 通配命中', hitSq && hitSq.start === 0 && hitSq.end === 5, JSON.stringify(hitSq));
const hitSq2 = AEG.llm.alignQuote('他叫小明。我们一起玩。', '他叫小□。', 0);
check('alignQuote quote 含 □ 命中', hitSq2 && hitSq2.start === 0 && hitSq2.end === 5, JSON.stringify(hitSq2));

// 5k-5 quote 与原文只差空白/换行时也要能对齐
const hitWs = AEG.llm.alignQuote('阳光洒在\n湖面上，真美。', '阳光洒在湖面上', 0);
check('alignQuote 忽略空白差异', hitWs && hitWs.start === 0 && hitWs.end === 8, JSON.stringify(hitWs));

// 5k-6 模型把 start 给成字符串时也要按就近校准（重复短语场景）
const rawDup = {
  annotations: [
    { type: 'underline', category: 'strength', markStyle: 'wavy', quote: '你好', start: '12', comment: '还行' }
  ],
  overall: { score: 80, stars: 4, summary: 'ok', strengths: [], improvements: [], suggestions: [] }
};
const normDup = AEG.llm.normalize(rawDup, { content: c, essayId: 'e', mode: 'text', model: 'm' });
check('normalize start 字符串按就近校准',
  normDup.annotations[0].aligned === true && normDup.annotations[0].span.start === 9,
  JSON.stringify(normDup.annotations[0].span));

// 5k-7 行尾插入批注（锚点在换行位）也要画出增补号
const layIns = HW.layout([
  { text: '今天真开心', bbox: [100, 100, 500, 160] },
  { text: '明天也开心。', bbox: [100, 200, 500, 260] }
]);
const rectsIns = HW.rectsFor(layIns.entries, 800, 600);
const insSvg = sandbox.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
AEG.marks.draw(insSvg, [{
  id: 'ins-1', aligned: true, type: 'insert', category: 'error', markStyle: 'caret',
  span: { start: 5, end: 5, text: '' }, suggestion: '。', comment: '加句号'
}], rectsIns, layIns.content);
check('行尾插入批注画出增补号', insSvg.children.length === 1, insSvg.children.length);
const insSvg2 = sandbox.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
AEG.marks.draw(insSvg2, [{
  id: 'ins-2', aligned: true, type: 'insert', category: 'error', markStyle: 'caret',
  span: { start: 2, end: 2, text: '' }, suggestion: '，', comment: '加逗号'
}], rectsIns, layIns.content);
check('行中插入批注照常画出', insSvg2.children.length === 1, insSvg2.children.length);

// 5k-8 批注落位回归：span 覆盖的矩形必须落在目标字符格内
const layOne = HW.layout([{ text: '今天天气很好。', bbox: [100, 100, 500, 160] }]);
const rectsOne = HW.rectsFor(layOne.entries, 800, 600);
const grpOne = AEG.handwriting.rectsForSpan(rectsOne, 2, 4);
check('批注落位覆盖目标字符格',
  grpOne.length === 1 && grpOne[0].x1 >= rectsOne[2].x - 0.01 && grpOne[0].x2 <= rectsOne[3].x + rectsOne[3].w + 0.01,
  JSON.stringify(grpOne));

// 6. store：设置读写与掩码
AEG.store.saveSettings({ apiKey: 'sk-1234567890abcdef' });
check('store 设置保存', AEG.store.getSettings().apiKey === 'sk-1234567890abcdef');
check('store 掩码', AEG.store.maskKey('sk-1234567890abcdef') === '****cdef');
check('settingsReady', AEG.store.settingsReady() === true);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
