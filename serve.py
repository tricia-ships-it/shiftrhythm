#!/usr/bin/env python3
"""ShiftRhythm local server.

Serves ONLY the app's own files, ONLY to this computer (127.0.0.1), with strict
security headers. Nothing else in this folder (like .git or tests) is reachable.
Usage: python3 serve.py [port]
"""
import http.server, os, sys, mimetypes

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
ALLOWED_DIRS = ("css/", "js/", "icons/")
ALLOWED_FILES = {"index.html", "manifest.webmanifest", "sw.js"}
TYPES = {".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png",
         ".html": "text/html; charset=utf-8", ".webmanifest": "application/manifest+json"}
CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; manifest-src 'self'; "
       "worker-src 'self'; connect-src https://api.github.com; media-src 'none'; object-src 'none'; frame-src 'none'; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")

class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "ShiftRhythm"
    sys_version = ""

    def _headers(self, code, ctype=None, length=0):
        self.send_response(code)
        if ctype: self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=()")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        rel = path.lstrip("/") or "index.html"
        ok = (rel in ALLOWED_FILES or (rel.startswith(ALLOWED_DIRS) and "/" not in rel.split("/", 1)[1])) \
            and ".." not in rel and "\\" not in rel and not rel.startswith(".")
        full = os.path.realpath(os.path.join(ROOT, rel))
        if not ok or not full.startswith(ROOT + os.sep) or not os.path.isfile(full):
            body = b"Not found"
            self._headers(404, "text/plain; charset=utf-8", len(body)); self.wfile.write(body); return
        with open(full, "rb") as f: body = f.read()
        ext = os.path.splitext(rel)[1]
        self._headers(200, TYPES.get(ext, mimetypes.guess_type(rel)[0] or "application/octet-stream"), len(body))
        self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def log_message(self, *args):
        pass  # keep the console quiet; nothing is logged

if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"ShiftRhythm is running at http://127.0.0.1:{PORT}/  (only this computer can open it)")
    print("Keep this window open while you use it. Press Ctrl+C to stop.")
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
