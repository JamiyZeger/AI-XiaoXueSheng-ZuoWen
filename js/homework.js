/* 作业纸批改：多模态识别手写文字（逐行带位置框和页码）→ 批注画回原图
   核心：把识别出的每行 bbox 映射为「字符下标→矩形」数组，与 handwriting.measure
   产出的结构同构，从而整套手绘批注（AEG.marks）可直接复用画在照片上。
   支持多张照片（多页作文）：识别时智能判断正确页序，批注按 page 画回对应照片。 */
window.AEG = window.AEG || {};
(function () {
  'use strict';

  /* ================= 识别结果归一化 ================= */

  /* bbox 数值化：4 个有限数字，钳制到 0~1000，x2>x1 / y2>y1；不合格返回 null */
  function normBbox(b) {
    if (!Array.isArray(b) || b.length < 4) return null;
    var x1 = Number(b[0]), y1 = Number(b[1]), x2 = Number(b[2]), y2 = Number(b[3]);
    if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return null;
    function clamp(v) { return Math.max(0, Math.min(1000, v)); }
    x1 = clamp(x1); y1 = clamp(y1); x2 = clamp(x2); y2 = clamp(y2);
    if (x2 < x1) { var tx = x1; x1 = x2; x2 = tx; }
    if (y2 < y1) { var ty = y1; y1 = y2; y2 = ty; }
    if (x2 - x1 < 2 || y2 - y1 < 2) return null;
    return [x1, y1, x2, y2];
  }

  /* bbox 缺失的行：页内用相邻行的框平移估计，保证识别出的文字不丢 */
  function fillMissingBboxes(lines) {
    var groups = {};
    for (var i = 0; i < lines.length; i++) {
      var p = lines[i].page || 1;
      (groups[p] = groups[p] || []).push(lines[i]);
    }
    for (var key in groups) {
      fillGroupBboxes(groups[key]);
    }
    return lines;
  }

  function fillGroupBboxes(lines) {
    var last = null;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].bbox) { last = lines[i].bbox; continue; }
      if (last) {
        var h = last[3] - last[1];
        var y1 = Math.min(998, last[1] + h), y2 = Math.min(1000, last[3] + h);
        lines[i].bbox = [last[0], y1, last[2], Math.max(y1 + 2, y2)];
        last = lines[i].bbox;
      }
    }
    var next = null;
    for (var j = lines.length - 1; j >= 0; j--) {
      if (lines[j].bbox) { next = lines[j].bbox; continue; }
      if (next) {
        var h2 = next[3] - next[1];
        var yy1 = Math.max(0, next[1] - h2), yy2 = Math.max(yy1 + 2, next[3] - h2);
        lines[j].bbox = [next[0], yy1, next[2], yy2];
        next = lines[j].bbox;
      } else {
        // 整页都缺框：兜底按行错开放置，避免重叠
        var off = 0;
        for (var k = 0; k < lines.length; k++) {
          if (!lines[k].bbox) {
            lines[k].bbox = [80, 60 + off, 920, 140 + off];
            off += 90;
          }
        }
      }
    }
    return lines;
  }

  /* 识别模型偶尔会把 bbox 以像素坐标返回（竖拍照片 y 常超过 1000）。
     某页 bbox 出现 > 1010 的数值即判为像素坐标：有照片尺寸按尺寸换算到 0~1000，
     没有尺寸按该页极值兜底换算；否则维持 0~1000 归一化坐标语义不动。
     （无尺寸时仅看纵向超界——横向超界更可能是乱值而非单位问题） */
  var PIXEL_THR = 1010;

  function looksPixelBboxes(rawList, hasSize) {
    for (var i = 0; i < rawList.length; i++) {
      var b = rawList[i];
      if (!b || b.length < 4) continue;
      if (hasSize) {
        if (Number(b[0]) > PIXEL_THR || Number(b[1]) > PIXEL_THR ||
          Number(b[2]) > PIXEL_THR || Number(b[3]) > PIXEL_THR) return true;
      } else {
        if (Number(b[1]) > PIXEL_THR || Number(b[3]) > PIXEL_THR) return true;
      }
    }
    return false;
  }

  function scalePixelGroup(items, size) {
    var maxX = 0, maxY = 0, i, b;
    for (i = 0; i < items.length; i++) {
      b = items[i].bboxRaw;
      if (!b) continue;
      maxX = Math.max(maxX, Number(b[0]), Number(b[2]));
      maxY = Math.max(maxY, Number(b[1]), Number(b[3]));
    }
    var sx = (size && size.w > 0) ? 1000 / size.w : (maxX > 0 ? 1000 / maxX : 1);
    var sy = (size && size.h > 0) ? 1000 / size.h : (maxY > 0 ? 1000 / maxY : 1);
    for (i = 0; i < items.length; i++) {
      b = items[i].bboxRaw;
      if (!b) continue;
      items[i].bboxRaw = [Number(b[0]) * sx, Number(b[1]) * sy, Number(b[2]) * sx, Number(b[3]) * sy];
    }
  }

  /* 把模型返回归一化为 { title, lines: [{ text, bbox, page }] }
     numPages = 照片张数；page 缺失/越界时沿用上一行的页码（默认 1）；
     imageSizes = 各照片实际像素尺寸 [{w,h}]（可选，用于像素 bbox 换算） */
  function normalizeRecognition(raw, numPages, imageSizes) {
    var maxPage = Math.max(1, parseInt(numPages, 10) || 1);
    var title = (raw && typeof raw.title === 'string')
      ? raw.title.replace(/[\r\n\t]+/g, ' ').trim() : '';
    var arr = (raw && Array.isArray(raw.lines)) ? raw.lines : [];
    // 第一遍：清文本、定页码、留原始 bbox
    var items = [];
    var lastPage = 1;
    for (var i = 0; i < arr.length; i++) {
      var l = arr[i] || {};
      var text = (typeof l.text === 'string') ? l.text.replace(/[\r\n\t]+/g, ' ').trim() : '';
      if (!text) continue;
      var pg = parseInt(l.page, 10);
      if (!isFinite(pg) || pg < 1 || pg > maxPage) pg = lastPage;
      lastPage = pg;
      items.push({ text: text, bboxRaw: Array.isArray(l.bbox) ? l.bbox.slice() : null, page: pg });
    }
    // 按页检测像素坐标并换算到 0~1000
    var groups = {};
    for (var j = 0; j < items.length; j++) {
      (groups[items[j].page] = groups[items[j].page] || []).push(items[j]);
    }
    for (var key in groups) {
      var g = groups[key];
      var size = Array.isArray(imageSizes) ? imageSizes[parseInt(key, 10) - 1] : null;
      var raws = [];
      for (var m = 0; m < g.length; m++) raws.push(g[m].bboxRaw);
      if (looksPixelBboxes(raws, !!size)) scalePixelGroup(g, size);
    }
    // 第二遍：单框归一化
    var lines = [];
    for (var k = 0; k < items.length; k++) {
      lines.push({ text: items[k].text, bbox: normBbox(items[k].bboxRaw), page: items[k].page });
    }
    fillMissingBboxes(lines);
    return { title: title, lines: lines };
  }

  /* 题目行剔除：首行文字与 title 一致时视为题目行，不进正文 */
  function splitTitleLine(title, lines) {
    var t = String(title || '').replace(/\s+/g, '');
    if (t && lines.length && lines[0].text.replace(/\s+/g, '') === t) {
      return { title: title, bodyLines: lines.slice(1) };
    }
    return { title: title, bodyLines: lines.slice() };
  }

  /* 按识别结果的阅读顺序重排照片，并把 page 重映射为新顺序：
     lines 已按完整作文的阅读顺序输出，各行 page 首次出现的先后 = 文章页序。
     比如照片按 2、1 的顺序放入，但识别按阅读顺序输出 page 2 的行在前，
     则重排后照片[2,1]→新第1、2页，page 字段同步改为 1、2。
     没识别出文字的照片排在最后（保持原有先后）。 */
  function reorderPages(lines, images) {
    var order = [];
    var seen = {};
    for (var i = 0; i < lines.length; i++) {
      var pg = lines[i].page || 1;
      if (!seen[pg]) { seen[pg] = true; order.push(pg); }
    }
    var n = Array.isArray(images) ? images.length : 0;
    for (var p = 1; p <= n; p++) {
      if (!seen[p]) order.push(p);
    }
    var map = {};
    for (var k = 0; k < order.length; k++) map[order[k]] = k + 1;
    var newImages = order.map(function (old) { return images[old - 1]; });
    var newLines = lines.map(function (l) {
      return { text: l.text, bbox: l.bbox, page: map[l.page || 1] || 1 };
    });
    return { images: newImages, lines: newLines, order: order };
  }

  /* 正文拼接 + 每行字符偏移（UTF-16，与 String.slice 一致） */
  function layout(bodyLines) {
    var parts = [], entries = [], offset = 0;
    for (var i = 0; i < bodyLines.length; i++) {
      var t = bodyLines[i].text;
      entries.push({ text: t, bbox: bodyLines[i].bbox, page: bodyLines[i].page || 1, offset: offset });
      parts.push(t);
      offset += t.length + 1; // +1 = 换行符
    }
    return { content: parts.join('\n'), entries: entries };
  }

  /* bbox(0~1000 归一化) → 像素矩形数组（下标 = content 的 UTF-16 偏移）
     返回结构与 handwriting.measure 相同：{x,y,w,h,cx,cy}，供 AEG.marks.draw 使用。
     行内字符按均分近似手写间距；代理对占一格、共享同一矩形。 */
  function rectsFor(entries, W, H) {
    var rects = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i], b = e.bbox;
      if (!b || !e.text) continue;
      var x1 = b[0] / 1000 * W, y1 = b[1] / 1000 * H;
      var x2 = b[2] / 1000 * W, y2 = b[3] / 1000 * H;
      var lineW = x2 - x1, lineH = y2 - y1;
      // UTF-16 逐字切格（代理对合并为一格）
      var cells = [], k = 0;
      while (k < e.text.length) {
        var code = e.text.charCodeAt(k);
        var len = (code >= 0xd800 && code <= 0xdbff && k + 1 < e.text.length) ? 2 : 1;
        cells.push({ start: k, len: len });
        k += len;
      }
      var n = cells.length;
      if (!n) continue;
      var cw = lineW / n;
      for (var c = 0; c < n; c++) {
        var cx = x1 + cw * c;
        var rect = { x: cx, y: y1, w: cw, h: lineH, cx: cx + cw / 2, cy: y1 + lineH / 2 };
        for (var u = 0; u < cells[c].len; u++) {
          rects[e.offset + cells[c].start + u] = rect;
        }
      }
    }
    return rects;
  }

  /* ================= 批注与页的归属 ================= */

  /* 某个字符位置（content 偏移）落在哪一页 */
  function pageOfOffset(entries, pos) {
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i];
      if (pos >= en.offset && pos < en.offset + en.text.length) return en.page || 1;
    }
    // 落在行间（换行符/插入锚点）：取最近的行
    var best = null, bestD = Infinity;
    for (var j = 0; j < entries.length; j++) {
      var d = Math.abs(entries[j].offset - pos);
      if (d < bestD) { bestD = d; best = entries[j]; }
    }
    return best ? (best.page || 1) : 1;
  }

  /* 一条批注可能横跨两页（罕见），返回涉及的所有页 */
  function pagesOfAnn(entries, ann) {
    var s = ann.span.start, e = ann.span.end;
    if (!(e > s)) return [pageOfOffset(entries, s)];
    var seen = {}, out = [];
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i];
      if (en.offset < e && en.offset + en.text.length > s) {
        var pg = en.page || 1;
        if (!seen[pg]) { seen[pg] = true; out.push(pg); }
      }
    }
    return out.length ? out : [pageOfOffset(entries, s)];
  }

  /* 取属于指定页的批注 */
  function annsForPage(annotations, entries, page) {
    return annotations.filter(function (ann) {
      return pagesOfAnn(entries, ann).indexOf(page) >= 0;
    });
  }

  /* ================= 识别调用 ================= */

  var RECOG_RETRY = '刚才的输出无法解析为 JSON。请重新输出，只输出一个严格合法的 JSON 对象：' +
    '形如 {"title":"题目","lines":[{"text":"这一行的文字","bbox":[x1,y1,x2,y2],"page":1}]}；' +
    '不要任何解释文字和 markdown 代码块；字符串值必须用双引号包裹；bbox 是 0~1000 的数字数组，page 是该行文字在第几张照片（1~N）。';

  /* 读取照片实际像素尺寸（识别 bbox 若是像素坐标，需要它换算成 0~1000） */
  function imageSize(url) {
    return new Promise(function (resolve) {
      if (typeof Image === 'undefined') { resolve(null); return; }
      var im = new Image();
      im.onload = function () { resolve({ w: im.naturalWidth, h: im.naturalHeight }); };
      im.onerror = function () { resolve(null); };
      im.src = url;
    });
  }

  /* 调多模态模型识别作业纸照片（支持多张）→ { title, lines, model }
     images: dataURL 字符串或数组；照片顺序可能不正确，由模型按内容/页码智能判断正确页序 */
  function recognize(images, settings, opts) {
    opts = opts || {};
    var imgs = Array.isArray(images) ? images.slice() : [images];
    imgs = imgs.filter(function (u) { return !!u; });
    if (!imgs.length) return Promise.reject(new Error('请先选择作业纸照片'));

    var model = settings.visionModel || settings.chatModel;
    var userContent = [{ type: 'text', text: AEG.prompt.buildRecognizeUserText(imgs.length) }];
    for (var i = 0; i < imgs.length; i++) {
      if (imgs.length > 1) {
        userContent.push({ type: 'text', text: '第 ' + (i + 1) + ' 张照片（共 ' + imgs.length + ' 张）：' });
      }
      userContent.push({ type: 'image_url', image_url: { url: imgs[i] } });
    }
    var baseMessages = [
      { role: 'system', content: AEG.prompt.buildRecognizeSystemPrompt() },
      { role: 'user', content: userContent }
    ];

    var retriedJson = false;

    return Promise.all(imgs.map(imageSize)).then(function (sizes) {
      function run(msgs) {
        return AEG.llm.chatCompletion(settings, msgs, {
          model: model,
          maxTokens: Math.max(4000, imgs.length * 1500),
          signal: opts.signal,
          withImage: true
        }).then(function (data) {
          var text = AEG.llm.messageText(data);
          var raw;
          try {
            raw = AEG.llm.extractJson(text);
          } catch (e) {
            // 模型拒绝看图时可能输出自然语言 → 直接提示不支持多模态
            if (AEG.llm.visionRefused(text)) throw AEG.llm.visionError();
            if (!retriedJson) {
              retriedJson = true;
              return run(baseMessages.concat([{ role: 'user', content: RECOG_RETRY }]));
            }
            throw new Error('识别结果无法解析，请再识别一次，或换几张更清晰的作业纸照片。');
          }
          var rec = normalizeRecognition(raw, imgs.length, sizes);
          if (!rec.lines.length) {
            if (AEG.llm.visionRefused(text)) throw AEG.llm.visionError();
            throw new Error('没有识别出作文文字。请换更清晰、光线充足、字迹完整的作业纸照片再试。');
          }
          // 按文章阅读顺序重排照片，page 重映射到新顺序
          var rp = reorderPages(rec.lines, imgs);
          return { title: rec.title, lines: rp.lines, pages: rp.images, order: rp.order, model: model };
        });
      }
      return run(baseMessages);
    });
  }

  /* ================= 原图批注 ================= */

  /* 在照片上画批注：
     - 坐标用 800×vh 的虚拟画布（与显示尺寸无关，随图片等比缩放）
     - rects 由 entries 的 bbox 生成，下标为 content 的 UTF-16 偏移
     - page 指定只画该页的行与批注（多页时每张照片各画各的；不传则全画）
     - 画完把 viewBox/width/height 固定回虚拟画布，CSS 负责缩放到图片大小 */
  var VIRTUAL_W = 800;

  function drawOnPhoto(svg, annotations, entries, natW, natH, content, page) {
    var W = natW || 1000, H = natH || 1000;
    var VW = VIRTUAL_W, VH = Math.max(1, Math.round(VIRTUAL_W * H / W));
    var ents = entries, anns = annotations;
    if (page) {
      ents = entries.filter(function (e) { return (e.page || 1) === page; });
      anns = annsForPage(annotations, entries, page);
    }
    var rects = rectsFor(ents, VW, VH);
    AEG.marks.draw(svg, anns, rects, content);
    svg.setAttribute('viewBox', '0 0 ' + VW + ' ' + VH);
    svg.setAttribute('width', VW);
    svg.setAttribute('height', VH);
  }

  AEG.homework = {
    recognize: recognize,
    normalizeRecognition: normalizeRecognition,
    fillMissingBboxes: fillMissingBboxes,
    splitTitleLine: splitTitleLine,
    reorderPages: reorderPages,
    layout: layout,
    rectsFor: rectsFor,
    pageOfOffset: pageOfOffset,
    pagesOfAnn: pagesOfAnn,
    annsForPage: annsForPage,
    drawOnPhoto: drawOnPhoto,
    normBbox: normBbox
  };
})();
