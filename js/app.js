/* 应用主流程：视图切换、设置、写作、批改、手写稿+批注展示、历史 */
window.AEG = window.AEG || {};
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var state = {
    view: 'home',
    mode: 'text',
    submission: null,
    result: null,
    imageDataUrl: '',
    hwImageDataUrls: [],
    hwPromptImage: '',
    hwRec: null,
    abortController: null,
    showStrength: true,
    showError: true,
    compareMode: false,
    comparePct: 100
  };

  /* ================= 工具 ================= */

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return iso; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      document.body.removeChild(a);
    }, 200);
  }

  /* ================= 视图切换 ================= */

  function show(view) {
    state.view = view;
    var views = {
      home: 'viewHome', write: 'viewWrite', loading: 'viewLoading', result: 'viewResult',
      history: 'viewHistory', compose: 'viewCompose', composeResult: 'viewComposeResult',
      homework: 'viewHomework', hwResult: 'viewHomeworkResult'
    };
    for (var k in views) $(views[k]).classList.toggle('hidden', k !== view);
    window.scrollTo(0, 0);
    if (view === 'home') renderRecent();
    if (view === 'history') renderHistory();
    refreshWarnBar();
  }

  function refreshWarnBar() {
    $('warnBar').classList.toggle('hidden', AEG.store.settingsReady());
  }

  /* ================= 设置 ================= */

  function openSettings() {
    var s = AEG.store.getSettings();
    $('stBaseUrl').value = s.baseUrl || '';
    $('stApiKey').value = s.apiKey || '';
    $('stChatModel').value = s.chatModel || '';
    $('stVisionModel').value = s.visionModel || '';
    $('stTemp').value = s.temperature;
    $('stTimeout').value = s.timeoutMs;
    $('stExtra').value = s.extraInstructions || '';
    $('stJsonMode').checked = !!s.jsonMode;
    $('stUseProxy').checked = !!s.useProxy;
    var proxyDefault = s.proxyUrl;
    if (!proxyDefault) {
      // 若本页就是本地服务(server.py)提供的，自动预填同源代理地址
      var isLocal = location.protocol === 'http:' &&
        (location.hostname === '127.0.0.1' || location.hostname === 'localhost');
      proxyDefault = isLocal ? location.origin + '/api/llm' : 'http://127.0.0.1:8787/api/llm';
    }
    $('stProxyUrl').value = proxyDefault;
    $('testStatus').classList.add('hidden');
    $('drawerMask').classList.remove('hidden');
    $('settingsDrawer').classList.remove('hidden');
  }
  function closeSettings() {
    $('drawerMask').classList.add('hidden');
    $('settingsDrawer').classList.add('hidden');
    refreshWarnBar();
  }
  function collectSettings() {
    return {
      baseUrl: $('stBaseUrl').value.trim(),
      apiKey: $('stApiKey').value.trim(),
      chatModel: $('stChatModel').value.trim(),
      visionModel: $('stVisionModel').value.trim(),
      temperature: parseFloat($('stTemp').value),
      timeoutMs: parseInt($('stTimeout').value, 10) || 30000,
      extraInstructions: $('stExtra').value.trim(),
      jsonMode: $('stJsonMode').checked,
      useProxy: $('stUseProxy').checked,
      proxyUrl: $('stProxyUrl').value.trim() || 'http://127.0.0.1:8787/api/llm'
    };
  }
  function saveSettings() {
    var s = collectSettings();
    if (!s.baseUrl || !s.apiKey || !s.chatModel) {
      toast('Base URL、API Key、模型名都要填哦');
      return;
    }
    AEG.store.saveSettings(s);
    toast('设置已保存');
    refreshWarnBar();
    closeSettings();
  }
  function testSettings() {
    var s = collectSettings();
    var box = $('testStatus');
    box.className = 'test-status wait';
    box.textContent = '正在连接模型服务……';
    box.classList.remove('hidden');
    AEG.llm.testConnection(s).then(function (r) {
      box.className = 'test-status ok';
      box.textContent = '连接成功，模型响应正常：' + r.model;
    }).catch(function (err) {
      box.className = 'test-status err';
      box.textContent = '连接失败：' + err.message;
    });
  }

  /* ================= 写作页 ================= */

  var draftTimer = null;
  function openWrite(mode) {
    state.mode = mode || 'text';
    $('writeTitle').textContent = state.mode === 'image_prompt' ? '看图写话' : '纯文字批改';
    $('imgPanel').classList.toggle('hidden', state.mode !== 'image_prompt');
    if (state.mode === 'image_prompt') renderBuiltinGrid($('builtinGrid'), setImage);
    show('write');
  }

  function updateWordCount() {
    $('wordCount').textContent = String($('inContent').value.length);
  }
  function saveDraft() {
    try {
      localStorage.setItem('aeg.draft.v1', JSON.stringify({
        mode: state.mode,
        title: $('inTitle').value,
        grade: $('inGrade').value,
        content: $('inContent').value,
        imageDataUrl: state.imageDataUrl
      }));
    } catch (e) { /* 存储满则忽略 */ }
  }
  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem('aeg.draft.v1') || 'null');
      if (!d) return;
      $('inTitle').value = d.title || '';
      $('inGrade').value = d.grade || '3';
      $('inContent').value = d.content || '';
      if (d.imageDataUrl) setImage(d.imageDataUrl);
      updateWordCount();
    } catch (e) { /* ignore */ }
  }

  function setImage(dataUrl) {
    state.imageDataUrl = dataUrl || '';
    var img = $('imgPreview');
    if (state.imageDataUrl) {
      img.src = state.imageDataUrl;
      img.classList.remove('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
    }
  }

  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 1280;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = function () { reject(new Error('图片读取失败')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('图片读取失败')); };
      reader.readAsDataURL(file);
    });
  }

  function renderBuiltinGrid(gridEl, onPick) {
    var grid = gridEl || $('builtinGrid');
    grid.innerHTML = '';
    AEG.demo.sampleImages.forEach(function (item) {
      var div = document.createElement('div');
      div.className = 'builtin-item';
      div.innerHTML = '<img alt="' + esc(item.title) + '" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(item.svg) + '">' +
        '<div class="cap">' + esc(item.title) + '</div>';
      div.onclick = function () {
        AEG.demo.svgToDataUrl(item.svg).then(function (url) {
          onPick(url);
          toast('已选用示例图：' + item.title);
        }).catch(function () {
          onPick('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(item.svg));
        });
      };
      grid.appendChild(div);
    });
  }

  /* ================= 写作文流程 ================= */

  function setComposeImage(dataUrl) {
    state.composeImageDataUrl = dataUrl || '';
    var img = $('cmpImgPreview');
    if (state.composeImageDataUrl) {
      img.src = state.composeImageDataUrl;
      img.classList.remove('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
    }
  }

  function openCompose() {
    renderBuiltinGrid($('cmpBuiltinGrid'), setComposeImage);
    show('compose');
  }

  function composeNow() {
    if (!AEG.store.settingsReady()) {
      toast('先到“设置”里配置 API Key / 地址 / 模型名');
      openSettings();
      return;
    }
    var title = $('cmpTitle').value.trim();
    var imageDataUrl = state.composeImageDataUrl || '';
    if (!title && !imageDataUrl) {
      toast('给一个题目，或者一幅图，至少填一样');
      return;
    }
    var req = {
      title: title,
      grade: parseInt($('cmpGrade').value, 10) || 3,
      wordLimit: parseInt($('cmpWords').value, 10) || 0,
      requirements: $('cmpReq').value.trim(),
      mode: imageDataUrl ? 'image' : 'text',
      imageDataUrl: imageDataUrl
    };
    state.composeReq = req;
    var btn = $('btnCompose');
    btn.disabled = true;
    btn.textContent = '生成中…';
    AEG.compose.composeEssay(req, AEG.store.getSettings(), {})
      .then(function (result) {
        btn.disabled = false;
        btn.textContent = '开始写作文';
        state.composeResult = result;
        renderComposeResult();
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = '开始写作文';
        if (err && err.visionNotice) {
          alert(err.message);
          return;
        }
        toast(err && err.message ? err.message.split('\n')[0] : '生成失败');
      });
  }

  function renderComposeResult() {
    var req = state.composeReq, r = state.composeResult;
    $('cmpResultTitle').textContent = (req.title || '自拟题目') + ' · 作文写好了';
    $('cmpResultLead').textContent = req.grade + ' 年级 · 目标 ' +
      (req.wordLimit ? req.wordLimit + ' 字左右' : '字数不限') + ' · 实际 ' + r.wordCount + ' 字';

    AEG.handwriting.render(r.content, $('hwComposeText'));

    var html = '';
    html += '<div class="rcard"><h4>生成信息</h4><ul>' +
      '<li>年级：' + req.grade + ' 年级</li>' +
      '<li>目标字数：' + (req.wordLimit ? req.wordLimit + ' 字左右' : '不限') + '</li>' +
      '<li>实际字数：' + r.wordCount + ' 字</li>' +
      (req.requirements ? '<li>写作要求：' + esc(req.requirements) + '</li>' : '') +
      '</ul></div>';
    if (r.imageDescription) {
      html += '<div class="rcard"><h4>AI 读图内容</h4>' +
        '<div class="summary">' + esc(r.imageDescription) + '</div>' +
        '<div class="summary" style="margin-top:6px;color:#888780">作文内容基于以上图片内容生成</div></div>';
    }
    html += '<div class="rcard"><h4>下一步</h4><ul>' +
      '<li>不满意？点“重新生成”换一版</li>' +
      '<li>点“用它批改”，AI 老师会在手写稿上画批注、写评语</li>' +
      '</ul></div>';
    $('composeSide').innerHTML = html;

    show('composeResult');
  }

  function useForGrade() {
    var req = state.composeReq, r = state.composeResult;
    if (!req || !r) return;
    openWrite(req.mode === 'image' ? 'image_prompt' : 'text');
    $('inTitle').value = req.title || '';
    $('inGrade').value = String(req.grade);
    $('inContent').value = r.content;
    if (req.mode === 'image' && req.imageDataUrl) setImage(req.imageDataUrl);
    updateWordCount();
    gradeNow();
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制到剪贴板'); } catch (e) { toast('复制失败，请手动选择文字复制'); }
    document.body.removeChild(ta);
  }

  function copyComposeText() {
    var r = state.composeResult;
    if (!r) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(r.content).then(function () { toast('已复制到剪贴板'); })
        .catch(function () { fallbackCopy(r.content); });
    } else {
      fallbackCopy(r.content);
    }
  }

  /* ================= 作业纸批改流程 ================= */

  function openHomework() {
    renderHwThumbs();
    show('homework');
  }

  /* 多页照片缩略图：可排序（↑↓）、可单张删除 */
  function renderHwThumbs() {
    var box = $('hwThumbs');
    box.innerHTML = '';
    state.hwImageDataUrls.forEach(function (url, i) {
      var d = document.createElement('div');
      d.className = 'hw-thumb';
      d.innerHTML = '<img src="' + url + '" alt="第 ' + (i + 1) + ' 张">' +
        '<span class="pg">第 ' + (i + 1) + ' 张</span>' +
        '<div class="ops">' +
        '<button class="mini" data-up="' + i + '" title="上移"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="mini" data-down="' + i + '" title="下移"' + (i === state.hwImageDataUrls.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="mini del" data-del="' + i + '" title="删除">✕</button>' +
        '</div>';
      box.appendChild(d);
    });
    var ups = box.querySelectorAll('[data-up]');
    var downs = box.querySelectorAll('[data-down]');
    var dels = box.querySelectorAll('[data-del]');
    function wire(list, attr, fn) {
      for (var i = 0; i < list.length; i++) {
        list[i].onclick = function () {
          fn(parseInt(this.getAttribute(attr), 10));
        };
      }
    }
    wire(ups, 'data-up', function (i) { moveHwPage(i, -1); });
    wire(downs, 'data-down', function (i) { moveHwPage(i, 1); });
    wire(dels, 'data-del', function (i) {
      state.hwImageDataUrls.splice(i, 1);
      renderHwThumbs();
    });
  }

  function moveHwPage(i, dir) {
    var a = state.hwImageDataUrls;
    var j = i + dir;
    if (j < 0 || j >= a.length) return;
    var t = a[i]; a[i] = a[j]; a[j] = t;
    renderHwThumbs();
  }

  function setHwPromptImage(dataUrl) {
    state.hwPromptImage = dataUrl || '';
    var img = $('hwPromptPreview');
    if (state.hwPromptImage) {
      img.src = state.hwPromptImage;
      img.classList.remove('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
    }
  }

  /* 识别 + 批改一步到位：跳过文字确认，直接出原图批改结果 */
  function hwRunNow() {
    if (!AEG.store.settingsReady()) {
      toast('先到“设置”里配置 API Key / 地址 / 模型名');
      openSettings();
      return;
    }
    if (!state.hwImageDataUrls.length) {
      toast('先选作业纸照片（可以一次选几张）');
      return;
    }
    var btn = $('btnHwRun');
    btn.disabled = true;
    btn.textContent = '识别并批改中…（约 20~60 秒）';
    startLoadingAnim();
    show('loading');
    state.abortController = new AbortController();
    var settings = AEG.store.getSettings();

    AEG.homework.recognize(state.hwImageDataUrls, settings, { signal: state.abortController.signal })
      .then(function (rec) {
        state.hwRec = rec;
        // 照片按文章阅读顺序自动重排（page 已同步重映射）
        if (rec.pages && rec.pages.length) {
          state.hwImageDataUrls = rec.pages.slice();
          renderHwThumbs();
        }
        var split = AEG.homework.splitTitleLine(rec.title, rec.lines);
        var lay = AEG.homework.layout(split.bodyLines);
        if (!lay.content) throw new Error('识别文字为空，无法批改');
        var sub = {
          id: 'essay-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
          mode: 'homework',
          title: split.title || '',
          content: lay.content,
          grade: parseInt($('hwGrade').value, 10) || 3,
          wordCount: lay.content.length,
          createdAt: new Date().toISOString(),
          hwEntries: lay.entries,
          hwPages: state.hwImageDataUrls.slice(),
          // 看图写话：题目图片（可选），批改时随消息带给模型
          imageDataUrl: state.hwPromptImage || ''
        };
        state.submission = sub;
        // 原图较大：优先连图保存（历史回看可显示原图），配额不足则不存图降级
        if (!AEG.store.saveEssay(sub)) AEG.store.saveEssay(stripImage(sub));
        return AEG.llm.gradeEssay(sub, settings, { signal: state.abortController.signal })
          .then(function (result) {
            stopLoadingAnim();
            AEG.store.saveCorrection(result);
            openResult(sub, result);
          });
      })
      .catch(function (err) {
        stopLoadingAnim();
        show('homework');
        if (err && err.visionNotice) {
          alert(err.message);
          return;
        }
        toast(err && err.message ? err.message.split('\n')[0] : '识别/批改失败');
        if (err && err.message && err.message.indexOf('CORS') >= 0) {
          alert(err.message);
        }
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = '识别并批改';
      });
  }

  /* 重新批改：用已识别的文字再批一次（不重新识别） */
  function hwRegradeNow() {
    var sub = state.submission;
    if (!sub || sub.mode !== 'homework') return;
    startLoadingAnim();
    show('loading');
    state.abortController = new AbortController();
    AEG.llm.gradeEssay(sub, AEG.store.getSettings(), { signal: state.abortController.signal })
      .then(function (result) {
        stopLoadingAnim();
        AEG.store.saveCorrection(result);
        openResult(sub, result);
      })
      .catch(function (err) {
        stopLoadingAnim();
        show('hwResult');
        if (err && err.visionNotice) {
          alert(err.message);
          return;
        }
        toast(err && err.message ? err.message.split('\n')[0] : '批改失败');
      });
  }

  /* 取作业纸照片页列表（兼容旧记录的单图字段） */
  function hwPagesOf(sub) {
    if (sub.hwPages && sub.hwPages.length) return sub.hwPages.slice();
    if (sub.hwImageDataUrl) return [sub.hwImageDataUrl];
    return [];
  }

  /* 批改前/后：统一显示或隐藏全部页的批注层 */
  function setPhotoMarksVisible(visible) {
    var svgs = $('photoStack').querySelectorAll('svg.photo-marks');
    for (var i = 0; i < svgs.length; i++) {
      svgs[i].style.display = visible ? '' : 'none';
    }
  }

  /* 原图 + SVG 批注叠加渲染（多页：每张照片一个批注层，批注按 page 归属） */
  function renderPhotoMarks() {
    var sub = state.submission, r = state.result;
    if (!sub || !sub.hwEntries) return;
    var pages = hwPagesOf(sub);
    if (!pages.length) return;
    var stack = $('photoStack');
    stack.innerHTML = '';
    var filtered = r.annotations.filter(function (a) {
      if (a.category === 'strength') return state.showStrength;
      return state.showError;
    });
    pages.forEach(function (url, pi) {
      var page = pi + 1;
      var wrap = document.createElement('div');
      wrap.className = 'photo-wrap';
      var img = document.createElement('img');
      img.className = 'photo-img';
      img.alt = '作业纸照片 第 ' + page + ' 张';
      img.src = url;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'photo-marks');
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      wrap.appendChild(img);
      wrap.appendChild(svg);
      if (pages.length > 1) {
        var badge = document.createElement('span');
        badge.className = 'photo-badge';
        badge.textContent = '第 ' + page + ' 页';
        wrap.appendChild(badge);
      }
      stack.appendChild(wrap);
      var draw = function () {
        AEG.homework.drawOnPhoto(svg, filtered, sub.hwEntries,
          img.naturalWidth || 1000, img.naturalHeight || 1000, sub.content, page);
        if ($('hwTgBefore').classList.contains('on')) svg.style.display = 'none';
      };
      if (img.complete && img.naturalWidth) draw();
      else img.onload = draw;
    });
  }

  /* 把全部页的批注合成到照片上，竖向拼成一张 PNG 下载 */
  function saveAnnotatedPhoto() {
    var sub = state.submission;
    var wraps = $('photoStack').querySelectorAll('.photo-wrap');
    if (!sub || !wraps.length) { toast('照片还没加载好'); return; }
    var items = [];
    for (var i = 0; i < wraps.length; i++) {
      items.push({
        img: wraps[i].querySelector('img'),
        svg: wraps[i].querySelector('svg.photo-marks')
      });
    }
    if (!items[0].img.naturalWidth) { toast('照片还没加载好'); return; }

    var maxW = 0, totalH = 0;
    items.forEach(function (it) {
      var w = it.img.naturalWidth, h = it.img.naturalHeight;
      if (w > maxW) maxW = w;
    });
    items.forEach(function (it) {
      totalH += Math.round(maxW * it.img.naturalHeight / it.img.naturalWidth);
    });
    var canvas = document.createElement('canvas');
    canvas.width = maxW;
    canvas.height = totalH;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, maxW, totalH);

    var idx = 0, y = 0;
    function next() {
      if (idx >= items.length) {
        canvas.toBlob(function (blob) {
          if (!blob) { toast('批注图导出失败'); return; }
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = '作业纸批改-' + Date.now() + '.png';
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            URL.revokeObjectURL(a.href);
            document.body.removeChild(a);
          }, 200);
          toast('批注图已保存');
        }, 'image/png');
        return;
      }
      var it = items[idx];
      var w = it.img.naturalWidth, h = it.img.naturalHeight;
      var dw = maxW, dh = Math.round(maxW * h / w);
      ctx.drawImage(it.img, 0, y, dw, dh);
      var clone = it.svg.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      var svgStr = new XMLSerializer().serializeToString(clone);
      var overlay = new Image();
      overlay.onload = function () {
        ctx.drawImage(overlay, 0, y, dw, dh);
        y += dh;
        idx++;
        next();
      };
      overlay.onerror = function () {
        y += dh;
        idx++;
        next();
      };
      overlay.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    }
    next();
  }

  /* ================= 批改流程 ================= */

  function buildSubmission() {
    var content = $('inContent').value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
    if (!content) { toast('先把作文正文写进来吧'); return null; }
    var sub = {
      id: 'essay-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      mode: state.mode,
      title: $('inTitle').value.trim(),
      content: content,
      grade: parseInt($('inGrade').value, 10) || 3,
      wordCount: content.length,
      createdAt: new Date().toISOString()
    };
    if (state.mode === 'image_prompt') {
      if (!state.imageDataUrl) { toast('看图写话要先选一张题目图片哦'); return null; }
      sub.imageDataUrl = state.imageDataUrl;
      sub.imageId = 'img-' + Date.now().toString(36);
    }
    return sub;
  }

  var stepTimer = null;
  function startLoadingAnim() {
    var steps = $('loadingSteps').children;
    var i = 0;
    for (var k = 0; k < steps.length; k++) steps[k].className = '';
    steps[0].className = 'active';
    clearInterval(stepTimer);
    stepTimer = setInterval(function () {
      if (i < steps.length - 1) {
        steps[i].className = 'done';
        i++;
        steps[i].className = 'active';
      }
    }, 2600);
  }
  function stopLoadingAnim() {
    clearInterval(stepTimer);
  }

  function gradeNow() {
    if (!AEG.store.settingsReady()) {
      toast('先到“设置”里配置 API Key / 地址 / 模型名');
      openSettings();
      return;
    }
    var sub = buildSubmission();
    if (!sub) return;
    state.submission = sub;
    AEG.store.saveEssay(stripImage(sub));
    saveDraft();
    startLoadingAnim();
    show('loading');
    state.abortController = new AbortController();
    AEG.llm.gradeEssay(sub, AEG.store.getSettings(), { signal: state.abortController.signal })
      .then(function (result) {
        stopLoadingAnim();
        AEG.store.saveCorrection(result);
        openResult(sub, result);
      })
      .catch(function (err) {
        stopLoadingAnim();
        show('write');
        if (err && err.visionNotice) {
          // 模型不支持看图（多模态）：直接弹窗提示，不埋进 toast
          alert(err.message);
          return;
        }
        toast(err && err.message ? err.message.split('\n')[0] : '批改失败');
        if (err && err.message && err.message.indexOf('CORS') >= 0) {
          alert(err.message);
        }
      });
  }

  function stripImage(sub) {
    // 图片体积大，历史里不存原图，只留引用信息
    var copy = {};
    for (var k in sub) copy[k] = sub[k];
    if (copy.imageDataUrl) copy.imageDataUrl = '';
    if (copy.hwImageDataUrl) copy.hwImageDataUrl = '';
    if (copy.hwPages) copy.hwPages = [];
    return copy;
  }

  function runDemo(mode) {
    var sample = AEG.demo.sampleEssay;
    var sub = {
      id: 'demo-essay-' + mode,
      mode: mode,
      title: sample.title,
      content: sample.content,
      grade: sample.grade,
      wordCount: sample.content.length,
      createdAt: new Date().toISOString()
    };
    var go = function () {
      state.submission = sub;
      var result = AEG.demo.buildDemoResult(sub, mode);
      openResult(sub, result);
      toast('这是内置示例批改，不消耗 API 额度');
    };
    if (mode === 'image_prompt') {
      var img = AEG.demo.sampleImages[0];
      AEG.demo.svgToDataUrl(img.svg).then(function (url) {
        sub.imageDataUrl = url;
        go();
      }).catch(function () {
        sub.imageDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(img.svg);
        go();
      });
    } else {
      go();
    }
  }

  /* ================= 结果页 ================= */

  function openResult(submission, result) {
    state.submission = submission;
    state.result = result;
    var isHwPhoto = submission.mode === 'homework' && hwPagesOf(submission).length > 0;
    var titleEl = isHwPhoto ? $('hwResultTitle') : $('resultTitle');
    var leadEl = isHwPhoto ? $('hwResultLead') : $('resultLead');
    titleEl.textContent = (submission.title || '无标题') + (isHwPhoto ? ' · 作业纸批改结果' : ' · 批改结果');
    var lead = submission.grade + ' 年级 · ' + submission.wordCount + ' 字 · ' + fmtTime(result.createdAt);
    if (submission.mode === 'homework') {
      var nPages = hwPagesOf(submission).length;
      if (nPages > 1) lead = nPages + ' 张照片 · ' + lead;
      if (submission.imageDataUrl) lead += ' · 看图写话';
    }
    if (result.model.indexOf('demo') >= 0) lead += ' · 内置示例';
    if (result.status === 'degraded') lead += ' · 本次仅给出整体评价（结构化批注降级）';
    else if (result.status === 'partial') lead += ' · 部分批注未能精确落位';
    leadEl.textContent = lead;

    state.showStrength = true;
    state.showError = true;
    state.compareMode = false;

    if (isHwPhoto) {
      $('hwCkStrength').checked = true;
      $('hwCkError').checked = true;
      $('hwTgBefore').classList.remove('on');
      $('hwTgAfter').classList.add('on');
      show('hwResult');
      renderPhotoMarks();
    } else {
      $('ckStrength').checked = true;
      $('ckError').checked = true;
      $('tgBefore').classList.remove('on');
      $('tgAfter').classList.add('on');
      $('tgCompare').classList.remove('on');
      $('cmpSliderWrap').classList.add('hidden');
      show('result');
      renderHandwritingAndMarks();
    }
    renderSidePanel();
  }

  function renderHandwritingAndMarks() {
    var sub = state.submission, result = state.result;
    var container = $('hwText');
    AEG.handwriting.render(sub.content, container);

    var redraw = function () {
      // 以 SVG 叠加层的坐标原点为基准测量，保证批注与文字坐标同源
      var rects = AEG.handwriting.measure(container, $('marksLayer'));
      var filtered = result.annotations.filter(function (a) {
        if (a.category === 'strength') return state.showStrength;
        return state.showError;
      });
      AEG.marks.draw($('marksLayer'), filtered, rects, sub.content);
      applyCompareClip();
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(redraw).catch(redraw);
    } else {
      setTimeout(redraw, 120);
    }
  }

  function applyCompareClip() {
    var svg = $('marksLayer');
    if (state.compareMode) {
      svg.style.clipPath = 'inset(0 ' + (100 - state.comparePct) + '% 0 0)';
    } else {
      svg.style.clipPath = '';
    }
  }

  var TYPE_LABEL = {
    good_phrase: '好词好句', underline: '好词好句', typo: '错别字',
    grammar: '语法/搭配', punctuation: '标点', delete: '删去',
    insert: '增补', replace: '替换', transpose: '语序'
  };

  /* 结果页与作业纸批改页共用侧栏/批注层逻辑，按当前视图取对应元素 */
  function marksLayerEls() {
    if (state.view === 'hwResult') {
      var svgs = $('photoStack').querySelectorAll('svg.photo-marks');
      return Array.prototype.slice.call(svgs);
    }
    return [$('marksLayer')];
  }
  function sidePanelEl() {
    return state.view === 'hwResult' ? $('hwSidePanel') : $('sidePanel');
  }

  function renderSidePanel() {
    var r = state.result;
    var html = '';

    html += '<div class="rcard"><h4>整体评价</h4>' +
      '<div class="score-row"><span class="score-big">' + r.overall.score + '</span>' +
      '<span class="stars">' + '★★★★★'.slice(0, r.overall.stars) + '☆☆☆☆☆'.slice(0, 5 - r.overall.stars) + '</span></div>' +
      '<div class="summary">' + esc(r.overall.summary) + '</div></div>';

    if (r.imageDescription) {
      html += '<div class="rcard"><h4>AI 读图内容</h4>' +
        '<div class="summary">' + esc(r.imageDescription) + '</div>' +
        '<div class="summary" style="margin-top:6px;color:#888780">以上评价均基于图片内容给出</div></div>';
    }

    if (r.relevance) {
      html += '<div class="rcard"><h4>切题评估（看图写话）</h4>' +
        '<div class="relevance-score">' + r.relevance.score + ' <span style="font-size:13px;color:#888780">/ 10 切题分</span></div>' +
        '<div style="margin-top:8px">' +
        r.relevance.coveredPoints.map(function (p) { return '<span class="pill hit">✓ ' + esc(p) + '</span>'; }).join('') +
        r.relevance.missedPoints.map(function (p) { return '<span class="pill miss">○ ' + esc(p) + '</span>'; }).join('') +
        '</div><div class="summary" style="margin-top:8px">' + esc(r.relevance.comment) + '</div></div>';
    }

    if (r.overall.strengths.length) {
      html += '<div class="rcard"><h4>写得好的地方</h4><ul>' +
        r.overall.strengths.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
    }
    if (r.overall.improvements.length) {
      html += '<div class="rcard"><h4>可以更好的地方</h4><ul>' +
        r.overall.improvements.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
    }

    var strengths = r.annotations.filter(function (a) { return a.category === 'strength'; });
    var errors = r.annotations.filter(function (a) { return a.category !== 'strength'; });

    if (strengths.length) {
      html += '<div class="rcard"><h4>好词好句（' + strengths.length + '）</h4>' +
        strengths.map(function (a) { return annHtml(a); }).join('') + '</div>';
    }
    if (errors.length) {
      html += '<div class="rcard"><h4>修改建议（' + errors.length + '）</h4>' +
        errors.map(function (a) { return annHtml(a); }).join('') + '</div>';
    }

    if (r.overall.suggestions.length) {
      html += '<div class="rcard"><h4>下一步建议</h4><ul>' +
        r.overall.suggestions.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
    }

    if (r.rawText) {
      html += '<div class="rcard"><h4>模型原始返回（未能解析）</h4>' +
        '<pre class="raw-text">' + esc(r.rawText) + '</pre></div>';
    }

    sidePanelEl().innerHTML = html;

    var items = sidePanelEl().querySelectorAll('.ann-item');
    for (var i = 0; i < items.length; i++) {
      items[i].onclick = onAnnCardClick;
    }
  }

  function annHtml(a) {
    var isErr = a.category !== 'strength';
    var fix = '';
    if (a.suggestion) {
      fix = '<div class="fix"><span class="from">' + esc(a.original) + '</span> → <span class="to">' + esc(a.suggestion) + '</span></div>';
    } else if (a.original) {
      fix = '<div class="fix">「' + esc(a.original) + '」</div>';
    }
    return '<div class="ann-item' + (isErr ? ' err' : '') + '" data-ann="' + esc(a.id) + '">' +
      '<div class="head"><span class="type-chip">' + esc(TYPE_LABEL[a.type] || a.type) + '</span>' +
      (a.aligned ? '' : '<span class="badge-unaligned">未精确落位</span>') + '</div>' +
      fix + '<div class="cmt">' + esc(a.comment) + '</div></div>';
  }

  function onAnnCardClick(e) {
    var card = e.currentTarget;
    var id = card.getAttribute('data-ann');
    var items = sidePanelEl().querySelectorAll('.ann-item');
    for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
    card.classList.add('active');
    var layers = marksLayerEls();
    var groups = [];
    var target = null;
    for (var li = 0; li < layers.length; li++) {
      var gs = layers[li].querySelectorAll('.mark-group');
      for (var g = 0; g < gs.length; g++) {
        groups.push(gs[g]);
        var isTarget = gs[g].getAttribute('data-ann') === id;
        gs[g].classList.toggle('active', isTarget);
        gs[g].classList.toggle('dim', !isTarget);
        if (isTarget && !target) target = gs[g];
      }
    }
    if (target) {
      var y = target.getBoundingClientRect().top + window.scrollY - 160;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
    setTimeout(function () {
      for (var g2 = 0; g2 < groups.length; g2++) groups[g2].classList.remove('dim', 'active');
    }, 2600);
  }

  /* ================= 誊清稿 ================= */

  function adoptCorrections() {
    var sub = state.submission, r = state.result;
    var edits = r.annotations
      .filter(function (a) { return a.aligned && a.category !== 'strength' && (a.suggestion || a.type === 'delete'); })
      .map(function (a) { return { s: a.span.start, e: a.span.end, rep: a.type === 'delete' ? '' : a.suggestion }; })
      .sort(function (x, y) { return y.s - x.s; });
    var text = sub.content;
    for (var i = 0; i < edits.length; i++) {
      var ed = edits[i];
      if (ed.s === ed.e && !ed.rep) continue;
      text = text.slice(0, ed.s) + ed.rep + text.slice(ed.e);
    }
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = '<div class="modal"><h3>誊清稿（已采纳全部修改建议）</h3>' +
      '<div class="clean-text">' + esc(text) + '</div>' +
      '<div class="btn-row"><button class="btn primary" id="btnCopyClean">复制文字</button>' +
      '<button class="btn" id="btnCloseModal">关闭</button></div></div>';
    document.body.appendChild(mask);
    mask.querySelector('#btnCloseModal').onclick = function () { document.body.removeChild(mask); };
    mask.querySelector('#btnCopyClean').onclick = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('已复制到剪贴板'); }
      catch (e) { toast('复制失败，请手动选择文字'); }
      document.body.removeChild(ta);
    };
    mask.onclick = function (e) { if (e.target === mask) document.body.removeChild(mask); };
  }

  /* ================= 历史 ================= */

  function renderRecent() {
    var all = AEG.store.listCorrections().slice(0, 3);
    var box = $('homeRecent');
    if (!all.length) {
      box.innerHTML = '<div class="hist-item"><div><div class="title">还没有批改记录</div>' +
        '<div class="meta">写一篇作文，或者先看看内置示例效果。</div></div></div>';
      return;
    }
    box.innerHTML = all.map(function (c) {
      var essay = AEG.store.getEssay(c.essayId) || {};
      return '<div class="hist-item"><div><div class="title">' + esc(essay.title || '无标题') + '</div>' +
        '<div class="meta">' + esc(TYPE_MODE(c.mode)) + ' · ' + (c.overall ? c.overall.score + ' 分' : '') + ' · ' + fmtTime(c.createdAt) + '</div></div>' +
        '<div class="ops"><button class="btn" data-open="' + esc(c.id) + '">查看</button></div></div>';
    }).join('');
    wireHistButtons(box);
  }

  function TYPE_MODE(m) {
    return m === 'image_prompt' ? '看图写话' : (m === 'homework' ? '作业纸批改' : '纯文字');
  }

  function renderHistory() {
    var all = AEG.store.listCorrections();
    var box = $('histList');
    if (!all.length) {
      box.innerHTML = '<div class="hist-item"><div><div class="title">还没有批改记录</div></div></div>';
      return;
    }
    box.innerHTML = all.map(function (c) {
      var essay = AEG.store.getEssay(c.essayId) || {};
      return '<div class="hist-item"><div><div class="title">' + esc(essay.title || '无标题') + '</div>' +
        '<div class="meta">' + esc(TYPE_MODE(c.mode)) + ' · ' + (c.overall ? c.overall.score + ' 分 ' + c.overall.stars + ' 星' : '') +
        ' · ' + esc(c.model || '') + ' · ' + fmtTime(c.createdAt) + '</div></div>' +
        '<div class="ops"><button class="btn" data-open="' + esc(c.id) + '">查看</button>' +
        '<button class="btn ghost" data-del="' + esc(c.essayId) + '">删除</button></div></div>';
    }).join('');
    wireHistButtons(box);
  }

  function wireHistButtons(box) {
    var opens = box.querySelectorAll('[data-open]');
    for (var i = 0; i < opens.length; i++) {
      opens[i].onclick = function () {
        var id = this.getAttribute('data-open');
        var all = AEG.store.listCorrections();
        for (var j = 0; j < all.length; j++) {
          if (all[j].id === id) {
            var essay = AEG.store.getEssay(all[j].essayId);
            if (essay) openResult(essay, all[j]);
            else toast('找不到对应的作文内容（可能已删除）');
            return;
          }
        }
        toast('记录不存在');
      };
    }
    var dels = box.querySelectorAll('[data-del]');
    for (var k = 0; k < dels.length; k++) {
      dels[k].onclick = function () {
        var essayId = this.getAttribute('data-del');
        if (confirm('确定删除这篇作文和它的批改记录吗？')) {
          AEG.store.deleteEssay(essayId);
          renderHistory();
          toast('已删除');
        }
      };
    }
  }

  /* ================= 事件绑定 ================= */

  function bind() {
    $('navHome').onclick = function () { show('home'); };
    $('navHistory').onclick = function () { show('history'); };
    $('navSettings').onclick = openSettings;
    $('navWrite').onclick = function () { openWrite('text'); };
    $('navCompose').onclick = openCompose;
    $('navHomework').onclick = openHomework;
    $('warnGoSettings').onclick = openSettings;

    $('cardText').onclick = function () { openWrite('text'); };
    $('cardImage').onclick = function () { openWrite('image_prompt'); };
    $('cardDemoText').onclick = function () { runDemo('text'); };
    $('cardDemoImage').onclick = function () { runDemo('image_prompt'); };
    $('cardCompose').onclick = openCompose;
    $('cardHomework').onclick = openHomework;
    $('homeMoreHist').onclick = function () { show('history'); };

    $('btnCompose').onclick = composeNow;
    $('btnComposeBack').onclick = function () { show('home'); };
    $('btnComposeBack2').onclick = function () { show('home'); };
    $('btnComposeRetry').onclick = function () { show('compose'); composeNow(); };
    $('btnComposeGrade').onclick = useForGrade;
    $('btnComposeCopy').onclick = copyComposeText;
    $('cmpUploadImg').onclick = function () { $('cmpImgFile').click(); };
    $('cmpClearImg').onclick = function () { setComposeImage(''); };
    $('cmpImgFile').onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      compressImage(f).then(function (url) {
        setComposeImage(url);
        toast('图片已就绪');
      }).catch(function (err) {
        toast(err.message || '图片处理失败');
      });
      this.value = '';
    };

    $('btnBackHome').onclick = function () { show('home'); };
    $('btnBackHome2').onclick = function () { show('home'); };
    $('btnFillSample').onclick = function () {
      var s = AEG.demo.sampleEssay;
      $('inTitle').value = s.title;
      $('inGrade').value = String(s.grade);
      $('inContent').value = s.content;
      updateWordCount();
      toast('已填入示例作文');
    };
    $('btnClearEssay').onclick = function () {
      $('inTitle').value = '';
      $('inContent').value = '';
      setImage('');
      updateWordCount();
    };
    $('inContent').oninput = function () {
      updateWordCount();
      clearTimeout(draftTimer);
      draftTimer = setTimeout(saveDraft, 600);
    };
    $('inTitle').oninput = function () {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(saveDraft, 600);
    };

    $('btnUploadImg').onclick = function () { $('imgFile').click(); };
    $('btnClearImg').onclick = function () { setImage(''); };
    $('imgFile').onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      compressImage(f).then(function (url) {
        setImage(url);
        toast('图片已就绪');
      }).catch(function (err) {
        toast(err.message || '图片处理失败');
      });
      this.value = '';
    };

    // 作业纸批改
    $('btnHwUpload').onclick = function () { $('hwFile').click(); };
    $('btnHwClear').onclick = function () {
      state.hwImageDataUrls = [];
      renderHwThumbs();
    };
    $('hwFile').onchange = function () {
      var files = Array.prototype.slice.call(this.files || []);
      this.value = '';
      if (!files.length) return;
      var ok = 0, done = 0;
      files.forEach(function (f) {
        compressImage(f).then(function (url) {
          state.hwImageDataUrls.push(url);
          ok++;
        }).catch(function () { /* 单张失败忽略 */ }).then(function () {
          done++;
          if (done === files.length) {
            renderHwThumbs();
            toast(ok ? ('已添加 ' + ok + ' 张照片') : '照片处理失败');
          }
        });
      });
    };
    $('btnHwPromptImg').onclick = function () { $('hwPromptFile').click(); };
    $('btnHwClearPrompt').onclick = function () { setHwPromptImage(''); };
    $('hwPromptFile').onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      compressImage(f).then(function (url) {
        setHwPromptImage(url);
        toast('题目图片已就绪（看图写话）');
      }).catch(function (err) {
        toast(err.message || '图片处理失败');
      });
      this.value = '';
    };
    $('btnHwRun').onclick = hwRunNow;
    $('btnHwReRecognize').onclick = hwRunNow;
    $('btnHwBackHome').onclick = function () { show('home'); };
    $('btnHwBackHome3').onclick = function () { show('home'); };
    $('btnHwSave').onclick = saveAnnotatedPhoto;
    $('btnHwRegrade').onclick = hwRegradeNow;
    $('hwTgBefore').onclick = function () {
      setPhotoMarksVisible(false);
      $('hwTgBefore').classList.add('on');
      $('hwTgAfter').classList.remove('on');
    };
    $('hwTgAfter').onclick = function () {
      setPhotoMarksVisible(true);
      $('hwTgBefore').classList.remove('on');
      $('hwTgAfter').classList.add('on');
    };
    $('hwCkStrength').onchange = function () {
      state.showStrength = this.checked;
      renderPhotoMarks();
    };
    $('hwCkError').onchange = function () {
      state.showError = this.checked;
      renderPhotoMarks();
    };

    $('btnGrade').onclick = gradeNow;
    $('btnCancelGrade').onclick = function () {
      if (state.abortController) state.abortController.abort();
    };    $('btnRegrade').onclick = function () {
      if (!state.submission) return;
      $('inTitle').value = state.submission.title || '';
      $('inContent').value = state.submission.content || '';
      $('inGrade').value = String(state.submission.grade || 3);
      if (state.submission.mode === 'image_prompt' && state.submission.imageDataUrl) {
        setImage(state.submission.imageDataUrl);
      }
      state.mode = state.submission.mode;
      updateWordCount();
      show('write');
    };

    $('tgBefore').onclick = function () {
      $('marksLayer').style.display = 'none';
      $('tgBefore').classList.add('on');
      $('tgAfter').classList.remove('on');
      $('tgCompare').classList.remove('on');
      $('cmpSliderWrap').classList.add('hidden');
      state.compareMode = false;
    };
    $('tgAfter').onclick = function () {
      $('marksLayer').style.display = '';
      $('tgBefore').classList.remove('on');
      $('tgAfter').classList.add('on');
      $('tgCompare').classList.remove('on');
      $('cmpSliderWrap').classList.add('hidden');
      state.compareMode = false;
      applyCompareClip();
    };
    $('tgCompare').onclick = function () {
      $('marksLayer').style.display = '';
      $('tgBefore').classList.remove('on');
      $('tgAfter').classList.remove('on');
      $('tgCompare').classList.add('on');
      $('cmpSliderWrap').classList.remove('hidden');
      state.compareMode = true;
      state.comparePct = 100;
      $('cmpSlider').value = '100';
      applyCompareClip();
    };
    $('cmpSlider').oninput = function () {
      state.comparePct = parseInt(this.value, 10);
      applyCompareClip();
    };

    $('ckStrength').onchange = function () {
      state.showStrength = this.checked;
      renderHandwritingAndMarks();
    };
    $('ckError').onchange = function () {
      state.showError = this.checked;
      renderHandwritingAndMarks();
    };

    $('btnAdopt').onclick = adoptCorrections;
    $('btnPrint').onclick = function () { window.print(); };

    $('btnCloseSettings').onclick = closeSettings;
    $('drawerMask').onclick = closeSettings;
    $('btnSaveSettings').onclick = saveSettings;
    $('btnTestSettings').onclick = testSettings;

    $('btnExportBackup').onclick = function () {
      var includeKey = confirm('导出备份时是否包含 API Key？\n确定 = 包含，取消 = 不包含（推荐）');
      download('ai-essay-backup-' + Date.now() + '.json', AEG.store.exportBackup(includeKey));
      toast('备份已导出');
    };
    $('btnImportBackup').onclick = function () { $('backupFile').click(); };
    $('backupFile').onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          AEG.store.importBackup(reader.result);
          toast('备份已导入');
          renderHistory();
        } catch (e) {
          toast('备份文件格式不对');
        }
      };
      reader.readAsText(f);
      this.value = '';
    };
    $('btnClearAll').onclick = function () {
      if (confirm('确定清空全部设置、作文和批改记录吗？此操作不可恢复！')) {
        AEG.store.clearAll();
        refreshWarnBar();
        renderHistory();
        toast('已清空');
      }
    };

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (state.view !== 'result') return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderHandwritingAndMarks, 220);
    });
  }

  /* ================= 启动 ================= */

  function init() {
    bind();
    loadDraft();
    updateWordCount();
    refreshWarnBar();
    show('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
