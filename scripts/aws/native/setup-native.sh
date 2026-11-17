#!/usr/bin/env bash
# Prepare an Amazon Linux 2023 arm64 instance for native Django dev releases (systemd, no containers).
# Idempotent: EC2 user data runs it on first boot; SSM document lai-dev-native-setup reruns it.
# Never touches releases, runtime settings, history or a release's nginx config.
# Env (set by the stack): LAI_ENV AWS_REGION LAI_API_HOST LAI_ADMIN_HOST LAI_SITE_HOST
# LAI_DB_SECRET_ARN LAI_DB_INSTANCE_ID LAI_ARTIFACT_BUCKET LAI_LOG_GROUP_PREFIX LAI_ACME_MODE
# LAI_HOSTED_ZONE_ID LAI_CERT_EMAIL LAI_SWAP_MB. Installs only the database client.
set -Eeuo pipefail
CERTBOT_VERSION=4.0.0 # certbot and certbot-dns-route53, pinned together
R=/opt/lai
CB=$R/tools/certbot
LIVE=/etc/letsencrypt/live/lai-dev
ACME=/var/lib/lai/acme
CONF=/etc/nginx/conf.d/lai.conf
say() { printf '%s [setup-native] %s\n' "$(date -u +%FT%TZ)" "$*"; }
for v in LAI_ENV AWS_REGION LAI_API_HOST LAI_ADMIN_HOST LAI_DB_SECRET_ARN LAI_ARTIFACT_BUCKET; do
    [ -n "${!v:-}" ] || { say "ERROR: $v is not set"; exit 2; }
done
P=${LAI_LOG_GROUP_PREFIX:-/lai/$LAI_ENV}

# The Elastic IP is associated just after launch, so the first downloads may fail: retry them.
retry() { local n; for n in 1 2 3 4 5 6; do "$@" && return 0; say "retrying ($n): $1"; sleep $((n * 10)); done; "$@"; }
say "installing packages"
retry dnf install -y -q --setopt=install_weak_deps=False --setopt=retries=10 nginx python3.12 \
    python3.12-devel python3.12-pip gcc postgresql16 jq git tar gzip logrotate openssl util-linux \
    amazon-cloudwatch-agent >/dev/null
systemctl enable --now amazon-ssm-agent >/dev/null 2>&1 || true

getent group lai >/dev/null || groupadd --system lai
id lai >/dev/null 2>&1 || useradd --system --gid lai --no-create-home --home-dir /nonexistent --shell /sbin/nologin lai
install -d -m 0755 $R $R/releases $R/tools /etc/lai /etc/lai/certs /var/lib/lai "$ACME"
install -d -m 0750 $R/state
install -d -m 0750 -g lai $R/runtime /var/log/lai

umask 022
cat >/etc/lai/native.conf.tmp <<EOF
# Written by setup-native.sh; no secrets.
LAI_ENV=$LAI_ENV
AWS_REGION=$AWS_REGION
LAI_API_HOST=$LAI_API_HOST
LAI_ADMIN_HOST=$LAI_ADMIN_HOST
LAI_SITE_HOST=${LAI_SITE_HOST:-}
LAI_DB_SECRET_ARN=$LAI_DB_SECRET_ARN
LAI_DB_INSTANCE_ID=${LAI_DB_INSTANCE_ID:-}
LAI_ARTIFACT_BUCKET=$LAI_ARTIFACT_BUCKET
LAI_PARAM_PREFIX=/lai/$LAI_ENV/django
LAI_POWER_PREFIX=/lai/$LAI_ENV/power
LAI_DEPLOY_PREFIX=/lai/$LAI_ENV/deploy
LAI_ACME_MODE=${LAI_ACME_MODE:-http}
LAI_HOSTED_ZONE_ID=${LAI_HOSTED_ZONE_ID:-}
LAI_CERT_EMAIL=${LAI_CERT_EMAIL:-}
EOF
mv -f /etc/lai/native.conf.tmp /etc/lai/native.conf

# --- swap ----------------------------------------------------------------------------------------
swap=${LAI_SWAP_MB:-1024}
if [ "$swap" -gt 0 ] && [ ! -f /swapfile ]; then
    say "creating ${swap} MB swap"
    dd if=/dev/zero of=/swapfile bs=1M count="$swap" status=none
    chmod 0600 /swapfile
    mkswap /swapfile >/dev/null
fi
if [ -f /swapfile ]; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
    swapon --show=NAME --noheadings | grep -qx /swapfile || swapon /swapfile || true
fi

# --- RDS CA bundle -------------------------------------------------------------------------------
ca=/etc/lai/certs/rds-global-bundle.pem
if [ ! -s $ca ] || [ -n "$(find $ca -mtime +30 2>/dev/null)" ]; then
    say "downloading the RDS CA bundle"
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 -o $ca.tmp https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
    grep -q 'BEGIN CERTIFICATE' $ca.tmp && mv -f $ca.tmp $ca
fi

# --- nginx ---------------------------------------------------------------------------------------
cat >/etc/nginx/nginx.conf <<'EOF'
# Written by setup-native.sh. Sites: /etc/nginx/conf.d/lai.conf.
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log crit;
pid /run/nginx.pid;
include /usr/share/nginx/modules/*.conf;
events { worker_connections 1024; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    sendfile on;
    tcp_nopush on;
    keepalive_timeout 65;
    server_tokens off;
    access_log off;
    include /etc/nginx/conf.d/*.conf;
}
EOF
if [ ! -f $CONF ] || grep -q '^# lai-bootstrap' $CONF; then
    cat >$CONF <<EOF
# lai-bootstrap: replaced by the first release (deploy/native/nginx.conf.template).
server {
    listen 80 default_server;
    server_name _;
    location ^~ /.well-known/acme-challenge/ { root $ACME; default_type text/plain; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl default_server;
    server_name _;
    ssl_certificate $LIVE/fullchain.pem;
    ssl_certificate_key $LIVE/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    return 503;
}
EOF
fi

# --- certificates: Let's Encrypt via certbot, self-signed placeholder until it succeeds ----------
if [ ! -x $CB/bin/certbot ] || ! $CB/bin/certbot --version 2>&1 | grep -q " $CERTBOT_VERSION\$"; then
    say "installing certbot $CERTBOT_VERSION"
    rm -rf $CB
    python3.12 -m venv $CB
    retry $CB/bin/pip install -q --retries 10 --disable-pip-version-check "certbot==$CERTBOT_VERSION" \
        "certbot-dns-route53==$CERTBOT_VERSION" || say "WARNING: certbot install failed; placeholder only"
fi
cat >/usr/local/sbin/lai-cert <<'EOF'
#!/bin/bash
# Obtain or renew the lai-dev certificate (lai-certbot-renew.service). Until Let's Encrypt
# succeeds, nginx serves a self-signed placeholder at the same path. Exit 1 while on the placeholder.
set -u
. /etc/lai/native.conf
exec 8>/run/lock/lai-cert.lock
flock -w 1800 8 || exit 1
CB=/opt/lai/tools/certbot/bin/certbot
LIVE=/etc/letsencrypt/live/lai-dev
reload() { nginx -t -q 2>/dev/null && { systemctl reload nginx 2>/dev/null || systemctl start nginx; }; }
placeholder() {
    mkdir -p $LIVE
    openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$LAI_API_HOST" \
        -addext "subjectAltName=DNS:$LAI_API_HOST,DNS:$LAI_ADMIN_HOST" \
        -keyout $LIVE/privkey.pem -out $LIVE/fullchain.pem 2>/dev/null
    chmod 0600 $LIVE/privkey.pem
}
if [ -f /etc/letsencrypt/renewal/lai-dev.conf ]; then
    exec $CB renew -q --cert-name lai-dev --deploy-hook 'systemctl reload nginx'
fi
[ "${1:-}" = --placeholder ] && { [ -s $LIVE/fullchain.pem ] || placeholder; exit 0; }
[ -x $CB ] || { [ -s $LIVE/fullchain.pem ] || placeholder; exit 1; }
args=(certonly -n -q --agree-tos --cert-name lai-dev -d "$LAI_API_HOST" -d "$LAI_ADMIN_HOST")
if [ -n "${LAI_CERT_EMAIL:-}" ]; then args+=(-m "$LAI_CERT_EMAIL"); else args+=(--register-unsafely-without-email); fi
if [ "${LAI_ACME_MODE:-http}" = route53 ]; then args+=(--dns-route53); else args+=(--webroot -w /var/lib/lai/acme); fi
rm -rf $LIVE # the placeholder (certbot owns the lineage from here)
if timeout 900 $CB "${args[@]}"; then
    reload
    exit 0
fi
echo "lai-cert: Let's Encrypt failed (DNS not ready?); self-signed placeholder until the next try" >&2
placeholder
reload
exit 1
EOF
chmod 0755 /usr/local/sbin/lai-cert
/usr/local/sbin/lai-cert --placeholder

# --- systemd: certificate renewal and maintenance timers -----------------------------------------
cat >/etc/systemd/system/lai-certbot-renew.service <<'EOF'
[Unit]
Description=Obtain or renew the lai-dev TLS certificate
After=network-online.target nginx.service
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/lai-cert
EOF
cat >/etc/systemd/system/lai-certbot-renew.timer <<'EOF'
[Unit]
Description=Twice daily lai-dev certificate renewal (and retry while on the placeholder)
[Timer]
OnBootSec=10min
OnCalendar=*-*-* 18,23:00:00
RandomizedDelaySec=30min
Persistent=true
[Install]
WantedBy=timers.target
EOF
cat >/etc/systemd/system/lai-maintenance.service <<'EOF'
[Unit]
Description=Learning Adventure Island daily maintenance (no-op without a release)
After=network-online.target lai-gunicorn.service
ConditionPathExists=/opt/lai/current/scripts/aws/native/maintenance-native.sh
[Service]
Type=oneshot
ExecStart=/bin/bash /opt/lai/current/scripts/aws/native/maintenance-native.sh
EOF
cat >/etc/systemd/system/lai-maintenance.timer <<'EOF'
[Unit]
Description=Daily Learning Adventure Island maintenance
[Timer]
OnCalendar=*-*-* 20:00:00
RandomizedDelaySec=15min
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now lai-certbot-renew.timer lai-maintenance.timer >/dev/null 2>&1
for u in lai-gunicorn lai-jobs-consumer lai-jobs-dispatch lai-jobs-completions; do
    [ ! -f /etc/systemd/system/$u.service ] || systemctl enable $u.service >/dev/null 2>&1 || true
done
systemctl enable nginx >/dev/null 2>&1
if nginx -t -q; then
    systemctl reload-or-restart nginx || say "WARNING: nginx did not start"
else
    say "WARNING: nginx -t failed; nginx not (re)started"
fi

# --- logs and metrics ----------------------------------------------------------------------------
cat >/etc/logrotate.d/lai <<'EOF'
/var/log/lai/*.log {
    weekly
    rotate 6
    compress
    missingok
    notifempty
    copytruncate
}
EOF
cw=/opt/aws/amazon-cloudwatch-agent/etc/lai.json
f() { printf '{"file_path":"%s","log_group_name":"%s","log_stream_name":"{instance_id}","retention_in_days":-1}' "$1" "$2"; }
cat >$cw.tmp <<EOF
{"agent":{"metrics_collection_interval":60,"run_as_user":"root"},
 "logs":{"logs_collected":{"files":{"collect_list":[
  $(f /var/log/lai/django.log "$P/django"),
  $(f /var/log/nginx/error.log "$P/nginx"),
  $(f /var/log/lai/deploy.log "$P/deploy"),
  $(f /var/log/lai/maintenance.log "$P/deploy"),
  $(f /var/log/lai/jobs-consumer.log "$P/jobs"),
  $(f /var/log/lai/jobs-dispatch.log "$P/jobs"),
  $(f /var/log/lai/jobs-completions.log "$P/jobs")]}}},
 "metrics":{"namespace":"LearningAdventureIsland/DevEC2",
  "append_dimensions":{"InstanceId":"\${aws:InstanceId}"},"aggregation_dimensions":[["InstanceId"]],
  "metrics_collected":{"mem":{"measurement":["mem_used_percent"]},
   "disk":{"measurement":["used_percent"],"resources":["/"],"drop_device":true}}}}
EOF
if ! cmp -s $cw.tmp $cw; then
    mv -f $cw.tmp $cw
    /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:$cw -s >/dev/null ||
        say "WARNING: the CloudWatch agent did not take its configuration"
else
    rm -f $cw.tmp
    systemctl enable --now amazon-cloudwatch-agent >/dev/null 2>&1 || true
fi

# --- first certificate: never fails the setup ----------------------------------------------------
if [ ! -f /etc/letsencrypt/renewal/lai-dev.conf ]; then
    say "requesting the Let's Encrypt certificate (${LAI_ACME_MODE:-http})"
    /usr/local/sbin/lai-cert || say "WARNING: certificate pending; lai-certbot-renew.timer retries"
fi

touch $R/state/setup-complete
say "setup complete for $LAI_ENV"
