"""Host isolation in the EC2 nginx proxy (deploy/ec2/nginx/default.conf.template, LAI-INFRA-003).

Renders the template the way the nginx image does (envsubst of the two host names), points the
upstream at a local fake Django that echoes what it received, and sends real requests to a real
nginx. Skipped where no nginx binary is installed. Nothing here touches Docker, AWS or the network.
"""

import http.server
import json
import shutil
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

TEMPLATE = Path(__file__).resolve().parents[2] / "deploy/ec2/nginx/default.conf.template"
API = "api.example.test"
ADMIN = "ladm.example.test"

pytestmark = pytest.mark.skipif(shutil.which("nginx") is None, reason="needs nginx")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Echo(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (http.server's naming)
        body = json.dumps({"host": self.headers["Host"], "path": self.path}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_POST = do_GET

    def log_message(self, *args):
        pass


def render(backend_port: int, proxy_port: int) -> str:
    text = TEMPLATE.read_text()
    assert text.count("server django:8000;") == 1
    assert text.count("listen 8080") == 3
    text = text.replace("${LAI_API_HOST}", API).replace("${LAI_ADMIN_HOST}", ADMIN)
    assert "${" not in text, "the template uses a variable the image would not substitute"
    text = text.replace("server django:8000;", f"server 127.0.0.1:{backend_port};")
    return text.replace("listen 8080", f"listen 127.0.0.1:{proxy_port}")


@pytest.fixture(scope="module")
def proxy(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("nginx")
    backend = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Echo)
    threading.Thread(target=backend.serve_forever, daemon=True).start()
    port = free_port()
    (tmp / "logs").mkdir()
    temp_paths = ""
    for name in ("client_body", "proxy", "fastcgi", "uwsgi", "scgi"):
        (tmp / name).mkdir()
        temp_paths += f"{name}_temp_path {tmp / name};\n"
    (tmp / "nginx.conf").write_text(
        "pid nginx.pid;\nerror_log logs/error.log;\nevents {}\nhttp {\n"
        + temp_paths
        + render(backend.server_address[1], port)
        + "\n}\n"
    )
    check = subprocess.run(
        ["nginx", "-t", "-p", str(tmp), "-c", "nginx.conf"], capture_output=True, text=True
    )
    assert check.returncode == 0, check.stderr
    process = subprocess.Popen(
        ["nginx", "-p", str(tmp), "-c", "nginx.conf", "-g", "daemon off;"],
        stderr=subprocess.PIPE,
    )
    deadline = time.monotonic() + 10
    while True:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            if time.monotonic() > deadline or process.poll() is not None:
                process.kill()
                pytest.fail("nginx did not start")
            time.sleep(0.05)
    yield port
    process.terminate()
    process.wait(timeout=10)
    backend.shutdown()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def get(port: int, host: str, path: str):
    """(status, echoed JSON or None, Location header) for one request."""
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers={"Host": host})
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request, timeout=5) as response:
            body = response.read()
            is_json = response.headers.get_content_type() == "application/json"
            return response.status, json.loads(body) if is_json else None, None
    except urllib.error.HTTPError as error:
        return error.code, None, error.headers.get("Location")


def test_the_api_host_reaches_django_for_api_paths_only(proxy):
    status, echoed, _ = get(proxy, API, "/api/v1/me/")
    assert status == 200
    assert echoed == {"host": API, "path": "/api/v1/me/"}
    for path in ("/admin/", "/admin/login/", "/static/admin/css/base.css", "/", "/nope"):
        assert get(proxy, API, path)[0] == 404, path


def test_the_admin_host_serves_the_admin_and_never_the_api(proxy):
    status, echoed, _ = get(proxy, ADMIN, "/admin/login/")
    assert status == 200
    assert echoed == {"host": ADMIN, "path": "/admin/login/"}
    assert get(proxy, ADMIN, "/static/admin/css/base.css")[0] == 200
    status, _, location = get(proxy, ADMIN, "/")
    assert (status, location) == (302, "/admin/")
    for path in ("/api/v1/me/", "/api/v1/health/ready/", "/api/"):
        assert get(proxy, ADMIN, path)[0] == 404, path


def test_unknown_hosts_get_health_probes_and_nothing_else(proxy):
    # The load balancer's target checks use the instance address as Host.
    status, echoed, _ = get(proxy, "10.40.0.12", "/api/v1/health/ready/")
    assert status == 200
    assert echoed == {"host": API, "path": "/api/v1/health/ready/"}
    assert get(proxy, "10.40.0.12", "/nginx-health")[0] == 200
    for host in ("10.40.0.12", "evil.example", "lai-alb-123.us-west-1.elb.amazonaws.com"):
        for path in ("/admin/", "/api/v1/me/", "/"):
            assert get(proxy, host, path)[0] == 404, (host, path)
