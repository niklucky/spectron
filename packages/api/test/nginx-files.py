"""Exercise the committed Nginx configuration using a controlled upstream.

The separate files.test.ts suite verifies real API authentication/offload headers.
This check verifies Nginx consumes those headers, reauthorizes cached requests,
serves byte ranges, and rejects direct requests to its internal location.
"""
import pathlib
import subprocess
import tempfile
import time
import urllib.request
import urllib.error

repo = pathlib.Path(__file__).resolve().parents[3]
with tempfile.TemporaryDirectory(prefix="spectron-nginx-files-") as tmp:
    root = pathlib.Path(tmp)
    files = root / "files"
    files.mkdir(mode=0o755)
    (files / "2026-09-06").mkdir()
    key = "2026-09-06/abcdefghijklmnopqrstu.bin"
    payload = b"Protected reusable file."
    (files / key).write_bytes(payload)
    conf = root / "nginx.conf"
    conf.write_text((repo / "deploy/nginx.app.conf").read_text() + '''
server {
    listen 3001;
    location /api/files/ {
        if ($http_cookie != "file-test") { return 403; }
        add_header X-Accel-Redirect "/_protected_files/2026-09-06/abcdefghijklmnopqrstu.bin";
        add_header Content-Disposition 'attachment; filename="sample.bin"';
        return 200;
    }
}
''')
    container = subprocess.check_output([
        "docker", "run", "--rm", "-d", "--add-host", "api:127.0.0.1",
        "-p", "127.0.0.1::80", "-v", f"{conf}:/etc/nginx/conf.d/default.conf:ro",
        "-v", f"{files}:/data/files:ro", "nginx:stable-alpine",
    ], text=True).strip()
    try:
        port = subprocess.check_output(["docker", "port", container, "80/tcp"], text=True).strip().rsplit(":", 1)[1]
        base = f"http://127.0.0.1:{port}"
        def request(path, headers=None):
            try:
                with urllib.request.urlopen(urllib.request.Request(base + path, headers=headers or {}), timeout=5) as response:
                    return response.status, response.headers, response.read()
            except urllib.error.HTTPError as response:
                return response.code, response.headers, response.read()
        for attempt in range(30):
            try:
                status, _, _ = request("/api/files/test")
                break
            except OSError:
                time.sleep(0.1)
        assert status == 403
        status, headers, body = request("/api/files/test", {"Cookie": "file-test"})
        assert status == 200, (status, body)
        assert body == payload
        assert headers.get("Cache-Control") == "private, no-cache", headers
        assert headers.get("Content-Disposition") == 'attachment; filename="sample.bin"'
        assert headers.get("X-Content-Type-Options") == "nosniff"
        etag = headers.get("ETag")
        assert etag
        assert request("/api/files/test", {"Cookie": "file-test", "If-None-Match": etag})[0] == 304
        assert request("/api/files/test", {"If-None-Match": etag})[0] == 403
        status, headers, body = request("/api/files/test", {"Cookie": "file-test", "Range": "bytes=0-8"})
        assert status == 206 and body == payload[:9]
        assert request("/_protected_files/" + key, {"Cookie": "file-test"})[0] == 404
        subprocess.run(["docker", "exec", container, "nginx", "-t"], check=True)
        print("Nginx protected delivery, private revalidation, ranges and direct-access checks passed.")
    finally:
        subprocess.run(["docker", "stop", container], check=True, stdout=subprocess.DEVNULL)
