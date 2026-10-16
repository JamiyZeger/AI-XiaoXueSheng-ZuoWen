/* LLM 客户端：OpenAI 兼容接口调用、JSON 提取修复、offset 校准、结果归一化 */
window.AEG = window.AEG || {};
(function () {

  function joinUrl(base, path) {
    return base.replace(/\/+$/, '') + path;
  }

  function friendlyError(status, bodyText) {
    var hint = '';
    if (status === 401 || status === 403) hint = 'API Key 无效或没有权限，请到“设置”里检查 API Key。';
    else if (status === 404) hint = '接口地址或模型名不存在，请检查 Base URL 与模型名。';
    else if (status === 429) hint = '请求太频繁或额度不足，请稍后再试或检查账户余额。';
    else if (status >= 500) hint = '模型服务暂时不可用，请稍后重试。';
    else hint = '请求被拒绝，请检查设置。';
    var detail = (bodyText || '').slice(0, 300);
    var err = new Error(hint + (detail ? '\n技术细节：' + detail : ''));
    err.status = status;
    return err;
  }

  /* ================= 看图（多模态）支持检测 ================= */

  var VISION_ERR_HINT = '当前模型不支持看图（多模态），无法根据图片批改看图写话作文。' +
    '请到“设置”里把“多模态模型”换成支持看图的模型（如 gpt-4o、qwen-vl-max、glm-4v、deepseek-vl 等）后重试；' +
    '如果对话模型本身就支持看图，也可以把“多模态模型”填成它。';

  /* API 报错文本里出现这些词，基本可断定是模型/接口不接受图片输入 */
  var IMAGE_ERR_RE = /image|vision|multimodal|image_url|图片|多模态|图像|unsupported\s+content|invalid\s+content|does\s+not\s+support|not\s+supported/i;
  /* 模型文字里说看不到图片 */
  var VISION_REFUSE_RE = /看不到图片|无法查看图片|无法看到图片|无法识别图片|无法读取图片|不能查看图片|cannot\s+see\s+the\s+image|unable\s+to\s+view|can'?t\s+see/i;

  function visionError() {
    var err = new Error(VISION_ERR_HINT);
    err.visionNotice = true;
    return err;
  }

  /* 看图写话时模型必须回填 imageDescription 作为“看过图”的证据 */
  function visionMissing(raw) {
    if (!raw || typeof raw !== 'object') return true;
    if (raw.imageUnsupported === true) return true;
    var d = raw.imageDescription;
    return !(typeof d === 'string' && d.trim().length >= 4);
  }

  /* 模型文字里说“看不到图片”一类的拒绝 */
  function visionRefused(text) {
    return VISION_REFUSE_RE.test(String(text || ''));
  }

  /* ================= JSON 提取与修复 ================= */

  /* 从 s[start]（必须是 '{'）找到配对的 '}'（字符串感知）；未闭合返回 -1 */
  function matchBrace(s, start) {
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < s.length; i++) {
      var ch = s.charAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) return i;
        }
      }
    }
    return -1;
  }

  /* 宽容修复：常见模型输出毛病逐一处理
     - 字符串内部未转义的双引号（如 "他说"你好"真棒"）→ 转义
     - 字符串内直接换行/制表/控制符 → 转义
     - // 行注释 → 去掉
     - 尾逗号 → 去掉
     - 截断导致字符串/括号未闭合 → 补齐 */
  function sanitizeJson(s) {
    var out = '';
    var inStr = false, esc = false;
    var stack = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (inStr) {
        if (esc) { out += ch; esc = false; continue; }
        if (ch === '\\') { out += ch; esc = true; continue; }
        if (ch === '"') {
          var j = i + 1;
          while (j < s.length && (s.charAt(j) === ' ' || s.charAt(j) === '\t' || s.charAt(j) === '\n' || s.charAt(j) === '\r')) j++;
          var nxt = s.charAt(j);
          if (j >= s.length || nxt === ':' || nxt === ',' || nxt === '}' || nxt === ']') {
            out += ch; inStr = false;
          } else {
            out += '\\"'; // 字符串内部的裸引号
          }
          continue;
        }
        if (ch === '\n') { out += '\\n'; continue; }
        if (ch === '\r') { out += '\\r'; continue; }
        if (ch === '\t') { out += '\\t'; continue; }
        if (ch < ' ') { out += '\\u' + ('000' + ch.charCodeAt(0).toString(16)).slice(-4); continue; }
        out += ch;
      } else {
        if (ch === '"') { inStr = true; out += ch; continue; }
        if (ch === '/' && s.charAt(i + 1) === '/') {
          while (i < s.length && s.charAt(i) !== '\n') i++;
          continue;
        }
        if (ch === '{') { stack.push('}'); out += ch; continue; }
        if (ch === '[') { stack.push(']'); out += ch; continue; }
        if (ch === '}' || ch === ']') { stack.pop(); out += ch; continue; }
        out += ch;
      }
    }
    if (inStr) out += '"';
    out = out.replace(/,\s*([}\]])/g, '$1');
    while (stack.length) out += stack.pop();
    return out;
  }

  /* 从模型输出提取 JSON 对象：逐候选扫描 + 多级修复 */
  function extractJson(text) {
    if (!text) throw new Error('模型返回为空');
    var s = String(text).trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .replace(/^\s*json\s*/i, '');

    var attempts = [];
    // 策略 1：逐个 '{' 候选取配对子串，直接解析
    var idx = s.indexOf('{');
    while (idx !== -1) {
      var end = matchBrace(s, idx);
      if (end !== -1) attempts.push(s.slice(idx, end + 1));
      else attempts.push(s.slice(idx)); // 截断：整段交给修复器补齐
      idx = s.indexOf('{', idx + 1);
      if (attempts.length > 8) break;
    }
    // 策略 2：整体（防止 JSON 前后有杂文而首尾括号误配）
    attempts.push(s);

    for (var k = 0; k < attempts.length; k++) {
      var cand = attempts[k];
      try { return JSON.parse(cand); } catch (e1) { /* next */ }
      try { return JSON.parse(sanitizeJson(cand)); } catch (e2) { /* next */ }
    }
    // 策略 3：先整体修复，再重新提取配对子串
    var fixed = sanitizeJson(s);
    var i2 = fixed.indexOf('{');
    if (i2 !== -1) {
      var e3 = matchBrace(fixed, i2);
      var c2 = e3 !== -1 ? fixed.slice(i2, e3 + 1) : fixed.slice(i2);
      try { return JSON.parse(c2); } catch (e4) { /* fallthrough */ }
    }
    throw new Error('模型返回的 JSON 无法解析');
  }

  /* 兼容 content 为字符串或分片数组（多模态风格响应） */
  function messageText(data) {
    var msg = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) return '';
    var c = msg.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      var parts = [];
      for (var i = 0; i < c.length; i++) {
        var p = c[i];
        if (typeof p === 'string') parts.push(p);
        else if (p && typeof p.text === 'string') parts.push(p.text);
      }
      return parts.join('');
    }
    return '';
  }

  /* ================= 批注对齐与归一化 ================= */

  /* 按 quote 检索校准 offset：返回 {start,end,text} 或 null。
     先精确匹配；失败再宽松匹配——□（识别不出的字）双方互为通配，忽略空白/换行差异。
     多处出现时取离 approxStart 最近的一处（start 允许是数字字符串）。 */
  function regexEscape(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function loosePositions(content, quote) {
    var parts = [];
    for (var i = 0; i < quote.length; i++) {
      var q = quote.charAt(i);
      if (q === '□') parts.push('[\\s\\S]');
      else if (/\s/.test(q)) parts.push('\\s*');
      else parts.push('(?:' + regexEscape(q) + '|□)');
    }
    var re;
    try { re = new RegExp(parts.join('\\s*'), 'g'); } catch (e) { return []; }
    var out = [], m;
    while ((m = re.exec(content)) !== null) {
      out.push({ start: m.index, end: m.index + m[0].length });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
  }

  function alignQuote(content, quote, approxStart) {
    if (!quote) return null;
    var approx = (typeof approxStart === 'number' && isFinite(approxStart)) ? approxStart
      : (isFinite(parseInt(approxStart, 10)) ? parseInt(approxStart, 10) : 0);
    var positions = [];
    var i = content.indexOf(quote);
    while (i !== -1) { positions.push({ start: i, end: i + quote.length }); i = content.indexOf(quote, i + 1); }
    if (!positions.length) positions = loosePositions(content, quote);
    if (!positions.length) return null;
    var best = positions[0], bd = Math.abs(best.start - approx);
    for (var k = 1; k < positions.length; k++) {
      var d = Math.abs(positions[k].start - approx);
      if (d < bd) { bd = d; best = positions[k]; }
    }
    return { start: best.start, end: best.end, text: content.slice(best.start, best.end) };
  }

  var MARK_DEFAULT = {
    good_phrase: 'wavy', underline: 'underline', typo: 'circle',
    punctuation: 'circle', delete: 'strike', insert: 'caret',
    replace: 'box', grammar: 'box', transpose: 'transpose'
  };
  var VALID_TYPES = ['good_phrase', 'underline', 'typo', 'grammar', 'punctuation', 'delete', 'insert', 'replace', 'transpose'];
  var VALID_MARKS = ['wavy', 'underline', 'circle', 'strike', 'caret', 'box', 'transpose'];

  /* 把模型输出归一化为 CorrectionResult 形态（含校准与降级标记） */
  function normalize(raw, meta) {
    var content = meta.content;
    var anns = [];
    var list = Array.isArray(raw.annotations) ? raw.annotations : [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i] || {};
      var type = VALID_TYPES.indexOf(a.type) >= 0 ? a.type : 'underline';
      var category = (a.category === 'strength' || a.category === 'error') ? a.category : (type === 'good_phrase' || type === 'underline' ? 'strength' : 'error');
      var markStyle = VALID_MARKS.indexOf(a.markStyle) >= 0 ? a.markStyle : (MARK_DEFAULT[type] || 'underline');
      var quote = typeof a.quote === 'string' ? a.quote : (typeof a.original === 'string' ? a.original : '');
      var span = null;
      if (type === 'insert') {
        var anchor = alignQuote(content, quote, a.start);
        if (anchor) span = { start: anchor.end, end: anchor.end, text: '' };
      } else {
        span = alignQuote(content, quote, a.start);
      }
      var aligned = !!span;
      if (!span) span = { start: 0, end: 0, text: quote || '' };
      anns.push({
        id: 'ann-' + i + '-' + Math.random().toString(36).slice(2, 7),
        type: type,
        category: category,
        markStyle: markStyle,
        span: span,
        original: quote,
        suggestion: typeof a.suggestion === 'string' ? a.suggestion : '',
        comment: typeof a.comment === 'string' ? a.comment : '',
        severity: a.severity === 'major' ? 'major' : 'minor',
        aligned: aligned
      });
    }

    var o = raw.overall || {};
    var overall = {
      score: typeof o.score === 'number' ? Math.max(0, Math.min(100, Math.round(o.score))) : 75,
      stars: typeof o.stars === 'number' ? Math.max(1, Math.min(5, Math.round(o.stars))) : 3,
      summary: typeof o.summary === 'string' ? o.summary : '整体写得不错，继续加油！',
      strengths: Array.isArray(o.strengths) ? o.strengths.map(String) : [],
      improvements: Array.isArray(o.improvements) ? o.improvements.map(String) : [],
      suggestions: Array.isArray(o.suggestions) ? o.suggestions.map(String) : []
    };

    var relevance = null;
    if (raw.relevance && typeof raw.relevance === 'object') {
      relevance = {
        score: typeof raw.relevance.score === 'number' ? raw.relevance.score : 0,
        coveredPoints: Array.isArray(raw.relevance.coveredPoints) ? raw.relevance.coveredPoints.map(String) : [],
        missedPoints: Array.isArray(raw.relevance.missedPoints) ? raw.relevance.missedPoints.map(String) : [],
        comment: typeof raw.relevance.comment === 'string' ? raw.relevance.comment : ''
      };
    }

    var anyAligned = anns.some(function (x) { return x.aligned; });
    var status = 'ok';
    if (!anns.length) status = overall.summary ? 'partial' : 'degraded';
    else if (!anyAligned) status = 'degraded';
    else if (anns.some(function (x) { return !x.aligned; })) status = 'partial';

    return {
      id: 'cr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      essayId: meta.essayId,
      mode: meta.mode,
      model: meta.model,
      promptVersion: meta.promptVersion || 'v1',
      annotations: anns,
      imageDescription: typeof raw.imageDescription === 'string' ? raw.imageDescription.trim() : '',
      imageUnsupported: raw.imageUnsupported === true,
      relevance: relevance,
      overall: overall,
      status: status,
      createdAt: new Date().toISOString()
    };
  }

  /* 解析彻底失败时的降级结果：仍给用户可看的页面 */
  function degradedResult(meta, rawText) {
    return {
      id: 'cr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      essayId: meta.essayId,
      mode: meta.mode,
      model: meta.model,
      promptVersion: meta.promptVersion || 'v1',
      annotations: [],
      relevance: null,
      overall: {
        score: 0,
        stars: 3,
        summary: '这次模型的返回没有解析成功，下面是原始内容，可以点“重新批改”再试一次。',
        strengths: [],
        improvements: [],
        suggestions: [
          '点“重新批改”重试一次（解析失败多为偶发）',
          '在“设置”里勾选“JSON 输出模式”会让输出更稳定',
          '若总是失败，可换一个对 JSON 输出支持更好的模型'
        ]
      },
      rawText: String(rawText || '').slice(0, 3000),
      status: 'degraded',
      createdAt: new Date().toISOString()
    };
  }

  /* ================= 请求 ================= */

  function chatCompletion(settings, messages, opts) {
    opts = opts || {};
    var url = joinUrl(settings.baseUrl, '/chat/completions');
    var body = {
      model: opts.model || settings.chatModel,
      temperature: (typeof settings.temperature === 'number' ? settings.temperature : 0.3),
      max_tokens: opts.maxTokens || 3000,
      messages: messages
    };
    if (settings.jsonMode) body.response_format = { type: 'json_object' };

    var controller = new AbortController();
    var timeoutMs = settings.timeoutMs || 30000;
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    if (opts.signal) {
      opts.signal.addEventListener('abort', function () { controller.abort(); });
    }

    // 两种调用形态：A 直连模型服务；B 经本地代理转发（解决 CORS）
    var fetchUrl, fetchInit;
    if (settings.useProxy && settings.proxyUrl) {
      fetchUrl = settings.proxyUrl;
      fetchInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: url, apiKey: settings.apiKey, body: body }),
        signal: controller.signal
      };
    } else {
      fetchUrl = url;
      fetchInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + settings.apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      };
    }

    return fetch(fetchUrl, fetchInit).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (t) {
        if (!res.ok) {
          // 带图请求被拒且报错与图片相关 → 直接提示模型不支持多模态
          if (opts.withImage && IMAGE_ERR_RE.test(t || '')) {
            var ve = visionError();
            ve.detail = (t || '').slice(0, 300);
            throw ve;
          }
          throw friendlyError(res.status, t);
        }
        try {
          return JSON.parse(t);
        } catch (e) {
          throw new Error('模型服务返回了无法解析的响应');
        }
      });
    }).catch(function (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        var e = new Error(opts.signal && opts.signal.aborted ? '已取消批改' : '请求超时，请在“设置”中调大超时时间或稍后重试');
        e.isCancel = !!(opts.signal && opts.signal.aborted);
        throw e;
      }
      if (err instanceof TypeError) {
        if (settings.useProxy && settings.proxyUrl) {
          throw new Error('连接本地代理失败。请先在项目目录运行 `python3 server.py` 启动本地服务，再刷新本页重试（详见 README）。');
        }
        throw new Error('网络请求失败（可能是 CORS 跨域限制，该模型服务不允许网页直连）。解决办法：在项目目录运行 `python3 server.py` 启动本地服务，用它打开的地址访问本页，然后到“设置”里勾选“通过本地代理转发”。');
      }
      throw err;
    });
  }

  function testConnection(settings) {
    return chatCompletion(settings, [
      { role: 'user', content: 'ping' }
    ], { maxTokens: 5 }).then(function (data) {
      var model = data && data.model ? data.model : settings.chatModel;
      return { ok: true, model: model };
    });
  }

  var STRICT_RETRY = '刚才的输出无法解析为 JSON。请重新输出，只输出一个严格合法的 JSON 对象：' +
    '不要任何解释文字和 markdown 代码块；字符串值必须用双引号包裹；' +
    '字符串内部的双引号必须写成 \\"；字符串内不要直接换行。';

  var IMAGE_RETRY = '你刚才没有正确读取图片。这是一道看图写话题，题目图片就在本条消息里，请重新输出 JSON：' +
    '必须包含 imageDescription 字段，用两三句话如实描述你在图片中看到的人物、景物、动作和场景（禁止编造）；' +
    'relevance 与 overall 的评价都要结合图片内容。' +
    '如果你确实无法看到图片，imageDescription 留空并加上 "imageUnsupported": true。只输出 JSON 对象。';

  function gradeEssay(submission, settings, opts) {
    opts = opts || {};
    // 看图写话：纯看图模式，或作业纸批改附带了题目图片
    var isPicture = submission.mode === 'image_prompt' ||
      (submission.mode === 'homework' && !!submission.imageDataUrl);
    var model = isPicture
      ? (settings.visionModel || settings.chatModel)
      : settings.chatModel;
    var sys = AEG.prompt.buildSystemPrompt(settings);
    var userText = AEG.prompt.buildUserText(submission);
    var userContent;
    var withImage = false;
    if (isPicture && submission.imageDataUrl) {
      userContent = [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: submission.imageDataUrl } }
      ];
      withImage = true;
    } else {
      userContent = userText;
    }
    var baseMessages = [
      { role: 'system', content: sys },
      { role: 'user', content: userContent }
    ];
    var meta = {
      content: submission.content,
      essayId: submission.id,
      mode: submission.mode,
      model: model,
      promptVersion: 'v1'
    };

    var retriedJson = false;
    var retriedVision = false;

    function run(msgs) {
      return chatCompletion(settings, msgs, {
        model: model,
        maxTokens: 4000,
        signal: opts.signal,
        withImage: withImage
      }).then(function (data) {
        var text = messageText(data);
        var truncated = data && data.choices && data.choices[0] &&
          data.choices[0].finish_reason === 'length';

        var raw;
        try {
          raw = extractJson(text);
        } catch (e) {
          // 模型在拒绝看图时可能输出自然语言而不是 JSON → 直接提示不支持看图
          if (isPicture && VISION_REFUSE_RE.test(text || '')) throw visionError();
          if (!retriedJson) {
            retriedJson = true;
            return run(baseMessages.concat([{ role: 'user', content: STRICT_RETRY }]));
          }
          if (truncated) {
            throw new Error('模型输出被截断（作文或评语过长），请精简正文后重试，或换用输出上限更大的模型。');
          }
          // 彻底失败 → 降级：保留原始返回，页面仍可用
          return degradedResult(meta, text);
        }

        // 看图写话：必须有 imageDescription 证明模型确实看了图，否则直接提示
        if (isPicture && visionMissing(raw)) {
          if (!retriedVision) {
            retriedVision = true;
            return run(baseMessages.concat([{ role: 'user', content: IMAGE_RETRY }]));
          }
          throw visionError();
        }
        return normalize(raw, meta);
      });
    }
    return run(baseMessages);
  }

  AEG.llm = {
    testConnection: testConnection,
    gradeEssay: gradeEssay,
    chatCompletion: chatCompletion,
    extractJson: extractJson,
    sanitizeJson: sanitizeJson,
    messageText: messageText,
    alignQuote: alignQuote,
    normalize: normalize,
    degradedResult: degradedResult,
    visionMissing: visionMissing,
    visionRefused: visionRefused,
    visionError: visionError
  };
})();
