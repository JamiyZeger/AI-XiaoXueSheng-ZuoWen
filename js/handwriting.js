/* 手写稿渲染：逐字 span（带原文 offset）+ 笔迹扰动 + 位置测量 */
window.AEG = window.AEG || {};
(function () {

  /* 把作文渲染为逐字 span；返回 { charEls: Map(idx -> element) } */
  function render(text, container) {
    container.innerHTML = '';
    var charEls = [];
    var paras = String(text).split('\n');
    var base = 0;
    for (var p = 0; p < paras.length; p++) {
      var para = paras[p];
      var line = document.createElement('div');
      line.className = 'hw-para';
      if (para.length > 0) {
        for (var k = 0; k < 2; k++) {
          var ind = document.createElement('span');
          ind.className = 'hchar hchar-indent';
          ind.textContent = '　';
          ind.setAttribute('data-idx', '-1');
          line.appendChild(ind);
        }
      }
      // 按 UTF-16 逐段迭代，保持与 String.length 偏移一致
      var i = 0;
      while (i < para.length) {
        var code = para.charCodeAt(i);
        var len = (code >= 0xd800 && code <= 0xdbff && i + 1 < para.length) ? 2 : 1;
        var ch = para.substr(i, len);
        var span = document.createElement('span');
        span.className = 'hchar';
        span.textContent = ch;
        span.setAttribute('data-idx', String(base + i));
        var r = AEG.rng.seeded(base + i);
        var rot = (r() * 2 - 1) * 1.2;
        var dy = (r() * 2 - 1) * 1.6;
        var op = 0.88 + r() * 0.12;
        span.style.transform = 'rotate(' + rot.toFixed(2) + 'deg) translateY(' + dy.toFixed(2) + 'px)';
        span.style.opacity = op.toFixed(2);
        line.appendChild(span);
        charEls[base + i] = span;
        i += len;
      }
      container.appendChild(line);
      base += para.length + 1; // +1 = 换行符
    }
    return { charEls: charEls };
  }

  /* 测量每个字符的矩形（相对 ref 元素——即 SVG 叠加层的原点），返回按 UTF-16 下标索引的数组 */
  function measure(container, ref) {
    var baseRect = (ref || container).getBoundingClientRect();
    var spans = container.querySelectorAll('.hchar[data-idx]');
    var rects = [];
    for (var i = 0; i < spans.length; i++) {
      var el = spans[i];
      var idx = parseInt(el.getAttribute('data-idx'), 10);
      if (isNaN(idx) || idx < 0) continue;
      var r = el.getBoundingClientRect();
      var rect = {
        x: r.left - baseRect.left,
        y: r.top - baseRect.top,
        w: r.width,
        h: r.height,
        cx: r.left - baseRect.left + r.width / 2,
        cy: r.top - baseRect.top + r.height / 2
      };
      // 代理对占两个 UTF-16 单位，均指向同一矩形
      var ch = el.textContent || '';
      rects[idx] = rect;
      if (ch.length === 2) rects[idx + 1] = rect;
    }
    return rects;
  }

  /* 取 [start,end) 覆盖的字符矩形，并按行分组 */
  function rectsForSpan(rects, start, end) {
    var out = [];
    if (end < start) { var t = start; start = end; end = t; }
    for (var i = start; i < end; i++) {
      if (rects[i]) out.push(rects[i]);
    }
    if (!out.length && rects[start]) out.push(rects[start]);
    // 按行（y）分组
    var lines = [];
    for (var j = 0; j < out.length; j++) {
      var r = out[j];
      var line = null;
      for (var l = 0; l < lines.length; l++) {
        if (Math.abs(lines[l].y - r.y) < 8) { line = lines[l]; break; }
      }
      if (!line) { line = { y: r.y, items: [] }; lines.push(line); }
      line.items.push(r);
    }
    for (var m = 0; m < lines.length; m++) {
      lines[m].items.sort(function (a, b) { return a.x - b.x; });
      lines[m].x1 = lines[m].items[0].x;
      lines[m].x2 = lines[m].items[lines[m].items.length - 1].x + lines[m].items[lines[m].items.length - 1].w;
      lines[m].top = Math.min.apply(null, lines[m].items.map(function (r) { return r.y; }));
      lines[m].bottom = Math.max.apply(null, lines[m].items.map(function (r) { return r.y + r.h; }));
      lines[m].midY = (lines[m].top + lines[m].bottom) / 2;
    }
    lines.sort(function (a, b) { return a.y - b.y; });
    return lines;
  }

  AEG.handwriting = {
    render: render,
    measure: measure,
    rectsForSpan: rectsForSpan
  };
})();
