/* 手绘批注符号叠加层：波浪线/下划线/圈改/删除号/增补号/改正号/对调号 */
window.AEG = window.AEG || {};
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var COLOR = {
    strength: '#185FA5',
    error: '#D85A30',
    punct: '#7F5AA8',
    suggest: '#C0392B'
  };

  function el(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* 手绘感折线：在两点间生成带抖动的路径 */
  function jitterLine(x1, y1, x2, y2, rnd, amp) {
    amp = amp || 1.2;
    var segs = Math.max(2, Math.round(Math.abs(x2 - x1) / 14) + 1);
    var d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1);
    for (var i = 1; i <= segs; i++) {
      var x = x1 + (x2 - x1) * i / segs;
      var y = y1 + (y2 - y1) * i / segs + (rnd() * 2 - 1) * amp;
      d += ' L ' + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  }

  function wavyPath(x1, x2, y, rnd) {
    var seg = 9;
    var n = Math.max(2, Math.round((x2 - x1) / seg));
    var d = 'M ' + x1.toFixed(1) + ' ' + y.toFixed(1);
    for (var i = 0; i < n; i++) {
      var xa = x1 + (x2 - x1) * i / n;
      var xb = x1 + (x2 - x1) * (i + 1) / n;
      var ym = y + (i % 2 === 0 ? -3.6 : 3.6) + (rnd() * 2 - 1) * 0.8;
      d += ' Q ' + ((xa + xb) / 2).toFixed(1) + ' ' + ym.toFixed(1) +
        ' ' + xb.toFixed(1) + ' ' + (y + (rnd() * 2 - 1) * 0.7).toFixed(1);
    }
    return d;
  }

  function handEllipse(cx, cy, rx, ry, rnd) {
    // 按切线方向布置贝塞尔控制点，画一个略不圆的手绘圈
    function pt(a) {
      return [
        cx + Math.cos(a) * rx * (1 + (rnd() * 2 - 1) * 0.05),
        cy + Math.sin(a) * ry * (1 + (rnd() * 2 - 1) * 0.05)
      ];
    }
    function ctrl(p, a, dir) {
      var tx = -rx * Math.sin(a), ty = ry * Math.cos(a);
      var k = 0.38 * dir;
      return [p[0] + tx * k + (rnd() * 2 - 1) * 1.5, p[1] + ty * k + (rnd() * 2 - 1) * 1.5];
    }
    function fmt(p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }
    // 逆时针顺序：左 → 上 → 右 → 下 → 回到左
    var a0 = Math.PI * 1.08, a1 = Math.PI * 1.52, a2 = Math.PI * 0.08, a3 = Math.PI * 0.52;
    var p0 = pt(a0), p1 = pt(a1), p2 = pt(a2), p3 = pt(a3);
    return 'M ' + fmt(p0) +
      ' C ' + fmt(ctrl(p0, a0, 1)) + ' ' + fmt(ctrl(p1, a1, -1)) + ' ' + fmt(p1) +
      ' C ' + fmt(ctrl(p1, a1, 1)) + ' ' + fmt(ctrl(p2, a2, -1)) + ' ' + fmt(p2) +
      ' C ' + fmt(ctrl(p2, a2, 1)) + ' ' + fmt(ctrl(p3, a3, -1)) + ' ' + fmt(p3) +
      ' C ' + fmt(ctrl(p3, a3, 1)) + ' ' + fmt(ctrl(p0, a0, -1)) + ' ' + fmt(p0) + ' Z';
  }

  function addPath(group, d, color, width) {
    var p = el('path', {
      d: d, fill: 'none', stroke: color,
      'stroke-width': width || 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    });
    group.appendChild(p);
    return p;
  }

  function addSuggestText(group, x, y, text, color) {
    if (!text) return;
    var t = el('text', {
      x: x.toFixed(1), y: y.toFixed(1),
      'font-size': '17', fill: color, stroke: '#FFFDF7',
      'stroke-width': '3.5', 'paint-order': 'stroke',
      'font-family': "'Ma Shan Zheng','Xingkai SC','Kaiti SC','STKaiti','KaiTi',cursive"
    });
    t.textContent = text;
    group.appendChild(t);
    return t;
  }

  function colorOf(ann) {
    if (ann.category === 'strength') return COLOR.strength;
    if (ann.type === 'punctuation') return COLOR.punct;
    return COLOR.error;
  }

  /* 主入口：在 svg 上画出全部批注 */
  function draw(svg, annotations, rects, content) {
    clear(svg);
    var w = 0, h = 0;
    for (var i = 0; i < rects.length; i++) {
      if (rects[i]) {
        w = Math.max(w, rects[i].x + rects[i].w + 120);
        h = Math.max(h, rects[i].y + rects[i].h + 40);
      }
    }
    svg.setAttribute('width', Math.max(w, 100));
    svg.setAttribute('height', Math.max(h, 100));
    svg.setAttribute('viewBox', '0 0 ' + Math.max(w, 100) + ' ' + Math.max(h, 100));

    for (var a = 0; a < annotations.length; a++) {
      var ann = annotations[a];
      if (!ann.aligned) continue;
      drawOne(svg, ann, rects);
    }
  }

  function clear(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function drawOne(svg, ann, rects) {
    var rnd = AEG.rng.seeded(ann.span.start * 7 + ann.span.end * 13 + ann.type.length);
    var color = colorOf(ann);
    var g = el('g', { 'data-ann': ann.id, class: 'mark-group' });
    var lines = ann.span.end > ann.span.start
      ? AEG.handwriting.rectsForSpan(rects, ann.span.start, ann.span.end)
      : (rects[ann.span.start] ? [{ x: rects[ann.span.start].x, x1: rects[ann.span.start].x, x2: rects[ann.span.start].x, y: rects[ann.span.start].y, top: rects[ann.span.start].y, bottom: rects[ann.span.start].y + rects[ann.span.start].h, midY: rects[ann.span.start].cy, items: [rects[ann.span.start]] }] : []);

    if (!lines.length) { return; }

    var style = ann.markStyle;

    for (var li = 0; li < lines.length; li++) {
      var ln = lines[li];
      var yBase = ln.bottom + 5;
      if (style === 'wavy') {
        addPath(g, wavyPath(ln.x1 - 2, ln.x2 + 2, yBase, rnd), color, 2.2);
      } else if (style === 'underline') {
        addPath(g, jitterLine(ln.x1 - 2, yBase, ln.x2 + 2, yBase, rnd), color, 2);
      } else if (style === 'circle') {
        var rx = (ln.x2 - ln.x1) / 2 + 7;
        var ry = (ln.bottom - ln.top) / 2 + 5;
        addPath(g, handEllipse((ln.x1 + ln.x2) / 2, ln.midY, rx, ry, rnd), color, 2);
      } else if (style === 'strike') {
        var ym = ln.midY + (rnd() * 2 - 1);
        addPath(g, jitterLine(ln.x1 - 3, ym, ln.x2 + 6, ym + (rnd() * 2 - 1), rnd, 1), color, 2);
        // 尾部回旋小勾（删除号）
        var hook = 'M ' + (ln.x2 + 6).toFixed(1) + ' ' + ym.toFixed(1) +
          ' q 6 ' + (rnd() * 4 - 2).toFixed(1) + ' 3 8';
        addPath(g, hook, color, 2);
      } else if (style === 'caret') {
        var cx = ln.x1;
        var cyTop = ln.top + 2;
        addPath(g, 'M ' + (cx - 8).toFixed(1) + ' ' + (cyTop + 2).toFixed(1) +
          ' L ' + cx.toFixed(1) + ' ' + (cyTop - 8).toFixed(1) +
          ' L ' + (cx + 8).toFixed(1) + ' ' + (cyTop + 2).toFixed(1), color, 2.2);
      } else if (style === 'box') {
        var x1 = ln.x1 - 5, x2 = ln.x2 + 5;
        var y1 = ln.top - 3, y2 = ln.bottom + 3;
        var d = 'M ' + x1.toFixed(1) + ' ' + (y1 + (rnd() * 2 - 1)).toFixed(1) +
          ' L ' + (x2 + (rnd() * 2 - 1)).toFixed(1) + ' ' + y1.toFixed(1) +
          ' L ' + x2.toFixed(1) + ' ' + (y2 + (rnd() * 2 - 1)).toFixed(1) +
          ' L ' + x1.toFixed(1) + ' ' + y2.toFixed(1) + ' Z';
        addPath(g, d, color, 2);
      } else if (style === 'transpose') {
        var xa = ln.x1, xb = ln.x2, ym2 = ln.top - 4;
        addPath(g, 'M ' + xa.toFixed(1) + ' ' + ym2.toFixed(1) +
          ' C ' + (xa + (xb - xa) * 0.35).toFixed(1) + ' ' + (ym2 - 16).toFixed(1) +
          ' ' + (xa + (xb - xa) * 0.65).toFixed(1) + ' ' + (ym2 + 10).toFixed(1) +
          ' ' + xb.toFixed(1) + ' ' + ym2.toFixed(1), color, 2);
      }
    }

    if (ann.suggestion) {
      var first = lines[0];
      var tx = first.x1;
      var ty = first.top - 8;
      if (ty < 18) ty = first.bottom + 22;
      addSuggestText(g, tx, ty, ann.suggestion, COLOR.suggest);
    }

    g.style.cursor = 'pointer';
    svg.appendChild(g);
  }

  AEG.marks = {
    draw: draw,
    clear: clear
  };
})();
