"""Gunicorn settings for the native dev instance (installed as /etc/lai/gunicorn.conf.py).

Loopback only: nginx terminates TLS and is the only client. No access log (request paths carry
child ids, ADR-025, gate G10); Django writes its own privacy-filtered request line. WEB_CONCURRENCY
and GUNICORN_TIMEOUT may come from /lai/dev/django/* through django.env.
"""

import os

bind = "127.0.0.1:8000"
workers = int(os.environ.get("WEB_CONCURRENCY", "3"))
threads = 1
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "30"))
graceful_timeout = 30
keepalive = 5
max_requests = 1000
max_requests_jitter = 100
accesslog = None
errorlog = "-"
loglevel = "info"
forwarded_allow_ips = "127.0.0.1"
worker_tmp_dir = "/dev/shm"  # noqa: S108 - a RAM disk for heartbeats, gunicorn docs
proc_name = "lai-gunicorn"
