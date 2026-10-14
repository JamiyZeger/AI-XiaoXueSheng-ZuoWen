/* AI 写作文：给题目或图片，直接生成一篇小学生作文（支持年级、字数要求） */
window.AEG = window.AEG || {};
(function () {

  var SYSTEM_PROMPT = [
    '你是一位经验丰富的小学语文老师，正在为小学生写一篇优秀范文。',
    '你必须只输出一个 JSON 对象，不要输出任何 JSON 之外的文字（包括不要用 markdown 代码块包裹）。',
    '',
    '【写作要求】',
    '1. 语言必须符合所给年级小学生的水平：低年级用短句、常用词；高年级可适当用修辞和细节描写。不用成人口吻，不说教。',
    '2. 结构完整：有开头、有经过、有结尾；内容真实生动，有具体的细节和动作描写。',
    '3. 严格遵守字数要求（允许上下浮动 20%）。',
    '4. 不写错别字，标点使用正确。',
    '5. 如果给了写作要求（体裁、风格、必须出现的内容等），必须满足。',
    '',
    '【看图写话（仅当用户消息带图片时）】',
    '1. 先认真观察图片，把真实看到的内容写进 imageDescription 字段（人物、景物、动作、场景，两三句话），禁止编造图中没有的内容。',
    '2. 作文内容必须与图片一致：图里有什么就写什么，合理想象但不脱离图片。',
    '3. 如果你无法看到或理解图片，不要编造：imageDescription 留空，并加上 "imageUnsupported": true。',
    '',
    '【输出 JSON 结构】',
    '{',
    '  "imageDescription": "图中真实看到的内容（看图写话必填，没有图片则省略）",',
    '  "content": "作文正文（分段用换行分隔）"',
    '}'
  ].join('\n');

  function buildSystemPrompt(settings) {
    var p = SYSTEM_PROMPT;
    if (settings && settings.extraInstructions && settings.extraInstructions.trim()) {
      p += '\n\n【老师的额外要求】\n' + settings.extraInstructions.trim();
    }
    return p;
  }

  function buildUserText(req) {
    var lines = [];
    lines.push('请以下面的要求写一篇小学生作文。');
    lines.push('年级：' + (req.grade || 3) + ' 年级');
    if (req.title) lines.push('题目：' + req.title);
    if (req.wordLimit && req.wordLimit > 0) {
      lines.push('字数：' + req.wordLimit + ' 字左右（可上下浮动 20%）');
    } else {
      lines.push('字数：按年级惯例写合适的长度即可');
    }
    if (req.requirements && req.requirements.trim()) {
      lines.push('写作要求：' + req.requirements.trim());
    }
    if (req.mode === 'image') {
      lines.push('这是一道看图写话作文题，随消息附带一张题目图片。请先看图（输出 imageDescription），作文内容要与图片一致。');
      if (!req.title) lines.push('题目请根据图片内容自拟。');
    } else if (!req.title) {
      lines.push('题目请自拟。');
    }
    lines.push('只输出 JSON 对象。');
    return lines.join('\n');
  }

  /* 从模型输出提取作文：优先 JSON（content 字段），纯文本整体兜底 */
  function extractContent(text, strict) {
    var raw = null;
    try { raw = AEG.llm.extractJson(text); } catch (e) { raw = null; }
    if (raw && typeof raw === 'object') {
      var keys = ['content', 'essay', 'text', 'composition'];
      for (var i = 0; i < keys.length; i++) {
        var v = raw[keys[i]];
        if (typeof v === 'string' && v.trim()) {
          return {
            content: v.trim(),
            imageDescription: typeof raw.imageDescription === 'string' ? raw.imageDescription.trim() : '',
            imageUnsupported: raw.imageUnsupported === true,
            fromJson: true
          };
        }
      }
    }
    if (strict) return null; // 看图写话必须有 JSON 证明看了图，不收纯文本
    var t = String(text || '')
      .replace(/^```(?:json|markdown)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    if (!t) return null;
    return { content: t, imageDescription: '', imageUnsupported: false, fromJson: false };
  }

  var COMPOSE_RETRY = '你刚才的输出不符合要求。请重新输出，只输出一个严格合法的 JSON 对象：' +
    '{ "imageDescription": "（看图写话时：图中真实看到的内容）", "content": "作文正文" }。' +
    '不要任何解释文字和 markdown 代码块；字符串内部的双引号必须写成 \\"；字符串内不要直接换行。';

  var VISION_RETRY = '你刚才没有正确读取图片。请重新输出 JSON：必须包含 imageDescription 字段，' +
    '用两三句话如实描述你在图片中看到的人物、景物、动作和场景（禁止编造）；content 是与图片内容一致的作文。' +
    '如果你确实无法看到图片，imageDescription 留空并加上 "imageUnsupported": true。只输出 JSON 对象。';

  /* req: { title, grade, wordLimit, requirements, mode: 'text'|'image', imageDataUrl }
     返回 { content, imageDescription, model, wordCount }；不支持看图时抛 visionNotice 错误 */
  function composeEssay(req, settings, opts) {
    opts = opts || {};
    var isImage = req.mode === 'image' && req.imageDataUrl;
    var model = isImage ? (settings.visionModel || settings.chatModel) : settings.chatModel;
    var userText = buildUserText(req);
    var userContent = isImage
      ? [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: req.imageDataUrl } }
      ]
      : userText;
    var baseMessages = [
      { role: 'system', content: buildSystemPrompt(settings) },
      { role: 'user', content: userContent }
    ];

    var retriedJson = false;
    var retriedVision = false;

    function run(msgs) {
      return AEG.llm.chatCompletion(settings, msgs, {
        model: model,
        maxTokens: 4000,
        signal: opts.signal,
        withImage: !!isImage
      }).then(function (data) {
        var text = AEG.llm.messageText(data);
        var truncated = data && data.choices && data.choices[0] &&
          data.choices[0].finish_reason === 'length';

        var got = extractContent(text, !!isImage);
        if (!got) {
          if (isImage && AEG.llm.visionRefused(text)) throw AEG.llm.visionError();
          if (!retriedJson) {
            retriedJson = true;
            return run(baseMessages.concat([{ role: 'user', content: COMPOSE_RETRY }]));
          }
          if (truncated) {
            throw new Error('模型输出被截断（字数要求过大或模型输出上限太小），请调低字数或换用输出上限更大的模型。');
          }
          throw new Error('模型返回的作文内容无法解析，请点“重新生成”再试一次。');
        }

        // 看图写话：必须有 imageDescription 证明模型确实看了图，否则直接提示
        if (isImage && AEG.llm.visionMissing(got)) {
          if (!retriedVision) {
            retriedVision = true;
            return run(baseMessages.concat([{ role: 'user', content: VISION_RETRY }]));
          }
          throw AEG.llm.visionError();
        }

        return {
          content: got.content,
          imageDescription: got.imageDescription,
          wordCount: got.content.replace(/\s/g, '').length,
          model: model
        };
      });
    }
    return run(baseMessages);
  }

  AEG.compose = {
    buildSystemPrompt: buildSystemPrompt,
    buildUserText: buildUserText,
    extractContent: extractContent,
    composeEssay: composeEssay
  };
})();
