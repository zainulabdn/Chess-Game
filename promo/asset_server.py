import http.server, functools, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))


class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        # Receives the recorded video straight from the page: POST /upload/<name>
        m = re.match(r'^/upload/([A-Za-z0-9_.-]+)$', self.path)
        if not m:
            self.send_response(404); self.end_headers(); return
        length = int(self.headers.get('Content-Length', '0'))
        dest = os.path.join(ROOT, 'upload_' + m.group(1))
        remaining = length
        with open(dest, 'wb') as f:
            while remaining > 0:
                chunk = self.rfile.read(min(1 << 20, remaining))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        body = f'saved {dest} {length - remaining} bytes'.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(H, directory=ROOT)).serve_forever()
