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
vm.createContext(sandbox);

const jsDir = path.join(__dirname, '..', 'js');
for (const f of ['rng.js', 'store.js', 'prompt.js', 'llm.js', 'compose.js', 'demo.js']) {
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

// 6. store：设置读写与掩码
AEG.store.saveSettings({ apiKey: 'sk-1234567890abcdef' });
check('store 设置保存', AEG.store.getSettings().apiKey === 'sk-1234567890abcdef');
check('store 掩码', AEG.store.maskKey('sk-1234567890abcdef') === '****cdef');
check('settingsReady', AEG.store.settingsReady() === true);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
