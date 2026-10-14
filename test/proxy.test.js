/* 端到端验证本地代理：模拟模型服务 ← server.py /api/llm ← 前端请求体 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const MOCK_PORT = 9907;
const PROXY_PORT = 9908;

// 1. 模拟 OpenAI 兼容模型服务
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer sk-test-123') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
      return;
    }
    let parsed = {};
    try { parsed = JSON.parse(body); } catch (e) { /* ignore */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      model: parsed.model || 'mock-model',
      choices: [{ message: { role: 'assistant', content: '{"annotations":[],"overall":{"score":80,"stars":4,"summary":"ok","strengths":[],"improvements":[],"suggestions":[]}}' } }]
    }));
  });
});

function post(port, pathName, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({ host: '127.0.0.1', port, path: pathName, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(port, pathName) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathName }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', reject);
  });
}

(async () => {
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra || ''); }
  };

  await new Promise((r) => mock.listen(MOCK_PORT, r));
  const py = spawn('python3', [path.join(root, 'server.py'), String(PROXY_PORT)], { cwd: root });
  let pyLog = '';
  py.stderr.on('data', (d) => (pyLog += d));
  py.stdout.on('data', (d) => (pyLog += d));

  // 等 server.py 就绪
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { await get(PROXY_PORT, '/index.html'); ready = true; } catch (e) { /* retry */ }
  }
  check('server.py 启动并能返回页面', ready);

  if (ready) {
    // 静态文件
    const page = await get(PROXY_PORT, '/index.html');
    check('静态页面 200', page.status === 200 && page.body.indexOf('AI 批改小学生作文') >= 0);

    // 代理转发正常路径
    const okRes = await post(PROXY_PORT, '/api/llm', {
      target: `http://127.0.0.1:${MOCK_PORT}/v1/chat/completions`,
      apiKey: 'sk-test-123',
      body: { model: 'mock-model', messages: [{ role: 'user', content: 'ping' }] }
    });
    const okData = JSON.parse(okRes.body);
    check('代理转发成功(200)', okRes.status === 200);
    check('代理透传模型响应', okData.choices && okData.choices[0].message.content.indexOf('"overall"') >= 0);
    check('代理带 CORS 头', okRes.headers['access-control-allow-origin'] === '*');

    // 错误路径：上游 401 透传
    const errRes = await post(PROXY_PORT, '/api/llm', {
      target: `http://127.0.0.1:${MOCK_PORT}/v1/chat/completions`,
      apiKey: 'sk-wrong',
      body: { model: 'mock-model', messages: [] }
    });
    check('上游 401 透传', errRes.status === 401);

    // 非法 target 拒绝
    const badRes = await post(PROXY_PORT, '/api/llm', { target: 'file:///etc/passwd', apiKey: 'x', body: {} });
    check('非法 target 拒绝(400)', badRes.status === 400);

    // OPTIONS 预检
    const opt = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: PROXY_PORT, path: '/api/llm', method: 'OPTIONS' }, (res) => resolve({ status: res.statusCode, headers: res.headers }));
      req.on('error', reject);
      req.end();
    });
    check('OPTIONS 预检 204 + CORS', opt.status === 204 && opt.headers['access-control-allow-origin'] === '*');
  }

  py.kill();
  mock.close();
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if (fail) console.log('server.py 日志:', pyLog.slice(0, 500));
  process.exit(fail ? 1 : 0);
})();
