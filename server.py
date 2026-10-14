#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地小服务：静态文件 + LLM 转发代理（解决浏览器 CORS 跨域直连失败）

用法：
    python3 server.py            # 默认 http://127.0.0.1:8787
    python3 server.py 9000       # 指定端口

页面打开 http://127.0.0.1:8787 后，在「设置」里勾选"通过本地代理转发"即可。
API Key 只在本机进程内转发到你自己配置的模型地址，不会经过任何第三方。
"""
import json
import os
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
BIND = "127.0.0.1"  # 只监听本机，不对外网开放
MAX_BODY = 20 * 1024 * 1024  # 图片 base64 体积上限 20MB
TIMEOUT = 180


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[local] %s\n" % (fmt % args))

    # ---- CORS 预检 ----
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    # ---- LLM 转发 ----
    def do_POST(self):
        if self.path.rstrip("/") != "/api/llm":
            self.send_error(404, "Not Found")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0 or length > MAX_BODY:
                self.send_error(400, "Bad body size")
                return
            req = json.loads(self.rfile.read(length).decode("utf-8"))
            target = (req.get("target") or "").strip()
            if not target.startswith(("http://", "https://")):
                self._json(400, {"error": "target 必须是 http(s) 地址"})
                return
            body = json.dumps(req.get("body") or {}, ensure_ascii=False).encode("utf-8")
            headers = {"Content-Type": "application/json"}
            if req.get("apiKey"):
                headers["Authorization"] = "Bearer " + str(req["apiKey"])
            upstream_req = urllib.request.Request(target, data=body, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(upstream_req, timeout=TIMEOUT) as resp:
                    data = resp.read()
                    self._raw(200, data)
            except urllib.error.HTTPError as e:
                self._raw(e.code, e.read())
        except Exception as e:  # noqa: BLE001
            self._json(502, {"error": "代理转发失败：%s" % e})

    def _json(self, status, obj):
        self._raw(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _raw(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    print("AI 批改作文 · 本地服务已启动")
    print("  页面地址:   http://%s:%d/index.html" % (BIND, PORT))
    print("  转发接口:   http://%s:%d/api/llm" % (BIND, PORT))
    print("  停止:       按 Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        server.server_close()


if __name__ == "__main__":
    main()
