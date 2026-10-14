/* Prompt 组装：System + User（含输出 JSON 契约） */
window.AEG = window.AEG || {};
(function () {

  var SYSTEM_PROMPT = [
    '你是一位经验丰富、语气亲切的小学语文老师，正在认真批改学生的作文。',
    '你必须只输出一个 JSON 对象，不要输出任何 JSON 之外的文字（包括不要用 markdown 代码块包裹）。',
    '',
    '【批注规则】',
    '1. 好词好句（category="strength"）：用词生动、比喻/拟人恰当、细节描写好、开头结尾巧妙的词句，2~4 条，markStyle 用 "wavy"（波浪线）或 "underline"（下划线）。每条 comment 用一两句话告诉小朋友好在哪里。',
    '2. 错误类（category="error"）：包含错别字（type="typo"）、语法或搭配不当（type="grammar"）、标点误用（type="punctuation"）、多余内容删除（type="delete"）、漏字增补（type="insert"）、用词替换（type="replace"）、语序对调（type="transpose"）。错误标注总数不超过 5 条，同类问题只标最典型的 1~2 处，其余写进 overall.improvements。',
    '3. 每条批注必须有 quote 字段：从原文中原样复制的片段，必须一字不差（含标点）。type="insert" 时，quote 填插入位置前面紧挨着的原文片段（作为锚点）。',
    '4. start 字段给出该片段在原文中的大致字符位置（从 0 开始，估算即可，系统会自动校准）。',
    '5. comment 必须是小朋友能听懂的话：先肯定，再建议，不使用"很差""不及格"等打击性词语。',
    '6. 除 delete 外的错误类批注必须给出 suggestion 字段（修改后的正确写法）；type="insert" 的 suggestion 是要补进去的文字。',
    '7. 好词好句的条数不应少于错误标注的条数。',
    '',
    '【markStyle 取值】',
    '- 好词好句：wavy 或 underline',
    '- 错别字/标点误用：circle',
    '- 删除：strike',
    '- 增补：caret',
    '- 替换/语法改正：box',
    '- 语序对调：transpose',
    '',
    '【整体评价 overall】',
    '- score：0~100 的整数，按年级标准给分',
    '- stars：1~5 的整数（5 星约等于 90~100 分）',
    '- summary：一句话总评，以鼓励为主',
    '- strengths：数组 2~3 条，写得好的地方',
    '- improvements：数组 1~2 条，可以更好的地方',
    '- suggestions：数组 2~3 条具体可执行的建议（例如"结尾再写一句你的心情"），不说空话',
    '',
    '【看图写话（仅当用户消息带图片时）】',
    '1. 先认真观察图片，把你真实看到的内容写进 imageDescription 字段（人物、景物、动作、场景、时间线索，两三句话）。这是你看过图片的依据，禁止编造图中没有的内容。',
    '2. 再基于图片内容批改，输出 relevance 对象评估是否切题：',
    '- score：0~10 切题分',
    '- coveredPoints：数组，学生写到的图中要素',
    '- missedPoints：数组，图中有但学生漏写的要素',
    '- comment：一句鼓励加一句提示',
    '3. overall 的 summary 与 suggestions 也要结合图片内容来写（例如指出漏写了图中的哪个细节），不要写与图片无关的套话。',
    '4. 如果你无法看到或理解图片，不要编造：把 imageDescription 留空，并加上 "imageUnsupported": true，其余正常输出。',
    '没有图片时不要输出 relevance 和 imageDescription 字段。',
    '',
    '【输出 JSON 结构】',
    '{',
    '  "annotations": [',
    '    {',
    '      "type": "good_phrase|underline|typo|grammar|punctuation|delete|insert|replace|transpose",',
    '      "category": "strength|error",',
    '      "markStyle": "wavy|underline|circle|strike|caret|box|transpose",',
    '      "quote": "原样复制的原文片段",',
    '      "start": 0,',
    '      "suggestion": "修改后的正确写法（delete 可省略）",',
    '      "comment": "点评说明",',
    '      "severity": "minor|major"',
    '    }',
    '  ],',
    '  "imageDescription": "图中真实看到的内容（看图写话必填，没有图片则省略）",',
    '  "imageUnsupported": false,',
    '  "relevance": { "score": 8, "coveredPoints": ["..."], "missedPoints": ["..."], "comment": "..." },',
    '  "overall": {',
    '    "score": 88, "stars": 4, "summary": "...",',
    '    "strengths": ["..."], "improvements": ["..."], "suggestions": ["..."]',
    '  }',
    '}'
  ].join('\n');

  var SCHEMA_HINT = {
    type: 'object',
    properties: {
      annotations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['good_phrase', 'underline', 'typo', 'grammar', 'punctuation', 'delete', 'insert', 'replace', 'transpose'] },
            category: { type: 'string', enum: ['strength', 'error', 'suggestion'] },
            markStyle: { type: 'string', enum: ['wavy', 'underline', 'circle', 'strike', 'caret', 'box', 'transpose'] },
            quote: { type: 'string' },
            start: { type: 'integer' },
            suggestion: { type: 'string' },
            comment: { type: 'string' },
            severity: { type: 'string', enum: ['minor', 'major'] }
          },
          required: ['type', 'category', 'markStyle', 'quote', 'comment']
        }
      },
      imageDescription: { type: 'string' },
      imageUnsupported: { type: 'boolean' },
      relevance: {
        type: 'object',
        properties: {
          score: { type: 'number' },
          coveredPoints: { type: 'array', items: { type: 'string' } },
          missedPoints: { type: 'array', items: { type: 'string' } },
          comment: { type: 'string' }
        }
      },
      overall: {
        type: 'object',
        properties: {
          score: { type: 'number' },
          stars: { type: 'number' },
          summary: { type: 'string' },
          strengths: { type: 'array', items: { type: 'string' } },
          improvements: { type: 'array', items: { type: 'string' } },
          suggestions: { type: 'array', items: { type: 'string' } }
        },
        required: ['score', 'stars', 'summary']
      }
    },
    required: ['annotations', 'overall']
  };

  function buildSystemPrompt(settings) {
    var p = SYSTEM_PROMPT;
    if (settings && settings.extraInstructions && settings.extraInstructions.trim()) {
      p += '\n\n【老师的额外要求】\n' + settings.extraInstructions.trim();
    }
    return p;
  }

  function buildUserText(submission) {
    var lines = [];
    lines.push('请批改下面这篇小学生作文。');
    lines.push('年级：' + submission.grade + ' 年级');
    lines.push('体裁/题目：' + (submission.title || '（无标题）'));
    if (submission.mode === 'image_prompt') {
      lines.push('这是看图写话作文，随消息附带一张题目图片。请先认真看图，把看到的内容写进 imageDescription，再结合图片内容批改并评估是否切题；整体评价也要以图片内容为依据。');
    }
    lines.push('');
    lines.push('【作文正文开始】');
    lines.push(submission.content);
    lines.push('【作文正文结束】');
    lines.push('');
    lines.push('注意：quote 与 start 都以上面【作文正文】内的文字为准（不含"【作文正文开始】"这行）。');
    return lines.join('\n');
  }

  AEG.prompt = {
    buildSystemPrompt: buildSystemPrompt,
    buildUserText: buildUserText,
    schemaHint: SCHEMA_HINT
  };
})();
