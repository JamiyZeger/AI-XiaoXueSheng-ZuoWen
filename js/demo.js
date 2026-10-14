/* 内置示例：示例作文、示例批改结果（无需 API Key 即可预览）、示例题目图 */
window.AEG = window.AEG || {};
(function () {

  var SAMPLE_ESSAY = {
    title: '一个快乐的星期天',
    grade: 3,
    content: [
      '星期天的早上，阳光洒在湖面上，亮晶晶的。我和爸爸来到公园里放风筝。',
      '我的风筝是一只大蜻蜓，它飞的很高很高，好像要碰到白云了。我跑的满头大汗，但是心里开心极了。',
      '天上的小鸟叽叽喳喳的叫着，好像在为我加油。风筝越飞越高，我高兴的跳了起来，大声喊："我的风筝飞的最高！"',
      '今天真是快乐的一天啊'
    ].join('\n')
  };

  /* 示例批改：quote+start 会由 alignQuote 自动校准 */
  function buildDemoResult(essay, mode) {
    var content = essay.content;
    function spanOf(quote) {
      var i = content.indexOf(quote);
      return i >= 0 ? { start: i, end: i + quote.length, text: quote } : { start: 0, end: 0, text: quote };
    }
    function ann(type, category, markStyle, quote, suggestion, comment, severity) {
      var span = type === 'insert'
        ? { start: spanOf(quote).end, end: spanOf(quote).end, text: '' }
        : spanOf(quote);
      return {
        id: 'demo-' + Math.random().toString(36).slice(2, 8),
        type: type, category: category, markStyle: markStyle,
        span: span, original: quote,
        suggestion: suggestion || '', comment: comment,
        severity: severity || 'minor', aligned: span.end > span.start || type === 'insert'
      };
    }

    var annotations = [
      ann('good_phrase', 'strength', 'wavy', '阳光洒在湖面上，亮晶晶的', '',
        '画面写得真美！"亮晶晶"让湖面一下子有了光。'),
      ann('good_phrase', 'strength', 'wavy', '好像要碰到白云了', '',
        '这个夸张用得好，风筝飞得高的样子一下子就出来了。'),
      ann('good_phrase', 'strength', 'underline', '好像在为我加油', '',
        '把小鸟当成人来写，很有趣。'),
      ann('grammar', 'error', 'box', '飞的很高', '飞得很高', '跑得、飞得、跳得要用"得"哦，"的"后面一般跟东西。'),
      ann('grammar', 'error', 'box', '跑的满头大汗', '跑得满头大汗', '同样是"得"字朋友：跑得怎么样？'),
      ann('grammar', 'error', 'box', '高兴的跳了起来', '高兴得跳了起来', '这里也是"得"，记住"动词+得+样子"。'),
      ann('punctuation', 'error', 'circle', '今天真是快乐的一天啊', '今天真是快乐的一天啊。',
        '一整句话说完啦，句末记得用句号。')
    ];

    var result = {
      id: 'demo-' + Date.now().toString(36),
      essayId: essay.id || 'demo-essay',
      mode: mode,
      model: 'demo（内置示例）',
      promptVersion: 'demo',
      annotations: annotations,
      overall: {
        score: 88,
        stars: 4,
        summary: '你把放风筝的过程写得很清楚，还用上了两个漂亮的想象句，真棒！',
        strengths: ['按事情发展的顺序写，读起来很清楚', '会用"好像"写想象，句子很生动'],
        improvements: ['"的、得、地"三个小伙伴还容易弄混'],
        suggestions: ['结尾再写一句你的心情，文章会更打动人', '写完后读一遍，检查"得"字用对了没有']
      },
      status: 'ok',
      createdAt: new Date().toISOString()
    };

    if (mode === 'image_prompt') {
      result.imageDescription = '图里是一个小男孩在草地上放风筝，天上有小鸟在飞，旁边还有一位大人（像是爸爸）在帮忙。';
      result.relevance = {
        score: 8,
        coveredPoints: ['小男孩', '放风筝', '草地/公园', '天上的小鸟'],
        missedPoints: ['图里还有爸爸在旁边帮忙'],
        comment: '主要的事情都写到啦！再看看图里还有谁，也可以写进作文里。'
      };
    }
    return result;
  }

  /* 内置示例题目图（SVG，使用时栅格化为 PNG dataURL） */
  var SAMPLE_IMAGES = [
    {
      id: 'demo-img-kite',
      title: '放风筝的小男孩',
      category: 'event',
      elements: ['小男孩', '蜻蜓风筝', '草地', '白云', '小鸟', '爸爸'],
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">',
        '<rect width="640" height="400" fill="#CDE8FA"/>',
        '<circle cx="540" cy="70" r="38" fill="#FFD966"/>',
        '<ellipse cx="180" cy="80" rx="70" ry="26" fill="#FFFFFF"/>',
        '<ellipse cx="240" cy="66" rx="44" ry="20" fill="#FFFFFF"/>',
        '<ellipse cx="430" cy="120" rx="60" ry="22" fill="#FFFFFF"/>',
        '<rect y="290" width="640" height="110" fill="#9CCB7A"/>',
        '<path d="M0 290 Q 160 262 320 290 T 640 288 L 640 300 L 0 300 Z" fill="#8BBE6B"/>',
        '<path d="M170 210 L 200 160 L 230 210 L 200 240 Z" fill="#E2704B"/>',
        '<path d="M170 210 L 230 210 M 200 160 L 200 240" stroke="#B85436" stroke-width="3"/>',
        '<path d="M200 240 Q 190 262 178 278" stroke="#7A6A55" stroke-width="2.5" fill="none"/>',
        '<circle cx="150" cy="252" r="16" fill="#F6C89A"/>',
        '<path d="M134 248 a 16 16 0 0 1 32 0 Z" fill="#4A3B2F"/>',
        '<rect x="136" y="268" width="28" height="40" rx="10" fill="#4C7ED9"/>',
        '<path d="M138 306 L 132 336 M 162 306 L 170 336" stroke="#3A3A55" stroke-width="7" stroke-linecap="round"/>',
        '<path d="M136 278 L 112 262 M 164 278 L 188 268" stroke="#F6C89A" stroke-width="7" stroke-linecap="round"/>',
        '<circle cx="252" cy="262" r="15" fill="#F6C89A"/>',
        '<path d="M237 258 a 15 15 0 0 1 30 0 Z" fill="#5B4A3A"/>',
        '<rect x="238" y="277" width="28" height="38" rx="10" fill="#79A55C"/>',
        '<path d="M240 313 L 234 340 M 264 313 L 270 340" stroke="#3A3A55" stroke-width="7" stroke-linecap="round"/>',
        '<path d="M238 288 L 216 272" stroke="#F6C89A" stroke-width="7" stroke-linecap="round"/>',
        '<path d="M330 130 q 12 -10 24 0 M 372 112 q 12 -10 24 0 M 420 148 q 12 -10 24 0" stroke="#35507A" stroke-width="3.5" fill="none"/>',
        '<circle cx="80" cy="330" r="12" fill="#E8A0BF"/><circle cx="560" cy="336" r="12" fill="#E8A0BF"/>',
        '<circle cx="120" cy="352" r="10" fill="#F2C14E"/><circle cx="600" cy="316" r="10" fill="#F2C14E"/>',
        '</svg>'
      ].join('')
    },
    {
      id: 'demo-img-snow',
      title: '堆雪人的孩子',
      category: 'event',
      elements: ['小女孩', '雪人', '围巾', '帽子', '下雪', '房子'],
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">',
        '<rect width="640" height="400" fill="#DCEBF7"/>',
        '<rect y="280" width="640" height="120" fill="#FFFFFF"/>',
        '<rect x="420" y="170" width="150" height="110" fill="#C97B5D"/>',
        '<path d="M410 172 L 495 118 L 580 172 Z" fill="#8C5B45"/>',
        '<rect x="470" y="210" width="40" height="70" fill="#7A4B38"/>',
        '<circle cx="230" cy="210" r="52" fill="#FFFFFF"/>',
        '<circle cx="230" cy="140" r="36" fill="#FFFFFF"/>',
        '<rect x="196" y="98" width="68" height="12" fill="#5B4A3A"/>',
        '<rect x="210" y="62" width="40" height="40" fill="#5B4A3A"/>',
        '<circle cx="216" cy="136" r="4.5" fill="#333333"/>',
        '<circle cx="244" cy="136" r="4.5" fill="#333333"/>',
        '<path d="M228 148 L 232 156 L 236 148 Z" fill="#E2704B"/>',
        '<path d="M204 158 q 26 16 52 0" stroke="#333333" stroke-width="3" fill="none"/>',
        '<path d="M186 196 L 140 150 M 274 196 L 318 150" stroke="#7A4B38" stroke-width="6" stroke-linecap="round"/>',
        '<rect x="196" y="168" width="68" height="14" rx="7" fill="#D85A30"/>',
        '<circle cx="360" cy="256" r="15" fill="#F6C89A"/>',
        '<path d="M345 252 a 15 15 0 0 1 30 0 Z" fill="#4A3B2F"/>',
        '<rect x="346" y="271" width="28" height="38" rx="10" fill="#4C7ED9"/>',
        '<path d="M348 307 L 342 338 M 372 307 L 378 338" stroke="#3A3A55" stroke-width="7" stroke-linecap="round"/>',
        '<path d="M346 282 L 322 268 M 374 282 L 398 272" stroke="#F6C89A" stroke-width="7" stroke-linecap="round"/>',
        '<circle cx="100" cy="80" r="6" fill="#FFFFFF"/><circle cx="160" cy="130" r="5" fill="#FFFFFF"/><circle cx="320" cy="70" r="6" fill="#FFFFFF"/>',
        '<circle cx="520" cy="90" r="5" fill="#FFFFFF"/><circle cx="600" cy="150" r="6" fill="#FFFFFF"/><circle cx="80" cy="200" r="5" fill="#FFFFFF"/>',
        '<circle cx="560" cy="330" r="11" fill="#B8D9F0"/>',
        '</svg>'
      ].join('')
    }
  ];

  /* SVG 字符串 → PNG dataURL（供多模态模型读取） */
  function svgToDataUrl(svgString) {
    return new Promise(function (resolve, reject) {
      var blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 400;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 640, 400);
        URL.revokeObjectURL(url);
        try { resolve(canvas.toDataURL('image/png')); }
        catch (e) { reject(e); }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('示例图片加载失败'));
      };
      img.src = url;
    });
  }

  AEG.demo = {
    sampleEssay: SAMPLE_ESSAY,
    sampleImages: SAMPLE_IMAGES,
    buildDemoResult: buildDemoResult,
    svgToDataUrl: svgToDataUrl
  };
})();
