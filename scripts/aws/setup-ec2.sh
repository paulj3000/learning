#!/usr/bin/env bash
# Prepare an Amazon Linux 2023 instance to run Django releases (ADR-037). Idempotent: the stack
# runs it from EC2 user data on first boot, and the SSM document `lai-django-setup-<env>` reruns it
# after a change (it never touches releases, the runtime configuration, history or data).
#
# Settings come from the environment (the stack sets them in front of this script):
#   LAI_ENV, AWS_REGION, LAI_ECR_REPOSITORY_URI, LAI_API_HOST, LAI_DB_MODE (rds|container),
#   LAI_DB_SECRET_ARN, LAI_DB_INSTANCE_ID, LAI_PREMIGRATION_SNAPSHOT, LAI_DATA_VOLUME_ID (container
#   mode only), LAI_APP_LOG_GROUP, LAI_DEPLOY_LOG_GROUP.
# Installs: Docker Engine (AL2023 package), the Docker Compose plugin (pinned, checksum verified),
# jq, the CloudWatch agent (deploy log, memory and disk metrics). SSM Agent ships with AL2023.
set -Eeuo pipefail

COMPOSE_VERSION=v5.5.1
declare -A COMPOSE_SHA256=(
    [x86_64]=db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576
    [aarch64]=732e3a84c1a0f67256ce80bc2598a24546b10ca05f9faa97efceb1171ece2ef7
)
RDS_CA_URL=https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
LAI_ROOT=/opt/lai
METRICS_NAMESPACE=LearningAdventureIsland/EC2

say() { printf '%s [setup-ec2] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

for name in LAI_ENV AWS_REGION LAI_ECR_REPOSITORY_URI LAI_API_HOST LAI_DB_MODE LAI_APP_LOG_GROUP \
    LAI_DEPLOY_LOG_GROUP; do
    [ -n "${!name:-}" ] || { say "ERROR: $name is not set"; exit 2; }
done

# --- packages ------------------------------------------------------------------------------------
say "installing packages"
dnf install -y --setopt=install_weak_deps=False docker jq amazon-cloudwatch-agent util-linux \
    logrotate >/dev/null

arch=$(uname -m)
plugin=/usr/libexec/docker/cli-plugins/docker-compose
if ! "$plugin" version 2>/dev/null | grep -q "${COMPOSE_VERSION#v}"; then
    say "installing docker compose $COMPOSE_VERSION"
    tmp=$(mktemp)
    curl -fsSL -o "$tmp" \
        "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-$arch"
    echo "${COMPOSE_SHA256[$arch]}  $tmp" | sha256sum -c --quiet -
    install -D -m 0755 "$tmp" "$plugin"
    rm -f "$tmp"
fi

# --- docker --------------------------------------------------------------------------------------
# Containers that do not send logs to CloudWatch (one-off `compose run` tasks) rotate locally.
daemon_json='{"log-driver":"local","log-opts":{"max-size":"10m","max-file":"5"},"live-restore":true}'
mkdir -p /etc/docker
if [ "$(cat /etc/docker/daemon.json 2>/dev/null)" != "$daemon_json" ]; then
    printf '%s' "$daemon_json" >/etc/docker/daemon.json
    systemctl restart docker 2>/dev/null || true
fi
systemctl enable --now docker >/dev/null
systemctl enable --now amazon-ssm-agent >/dev/null 2>&1 || say "WARNING: amazon-ssm-agent is not installed"

# --- users and directories -----------------------------------------------------------------------
# `lai` (uid 10001) matches the user inside the Django image; it owns nothing secret.
getent group lai >/dev/null || groupadd --system --gid 10001 lai
id lai >/dev/null 2>&1 || useradd --system --uid 10001 --gid lai --no-create-home --shell /sbin/nologin lai
install -d -m 0755 "$LAI_ROOT" "$LAI_ROOT/releases" "$LAI_ROOT/certs" /etc/lai
install -d -m 0700 "$LAI_ROOT/runtime" "$LAI_ROOT/state"
install -d -m 0750 /var/log/lai

cat >/etc/lai/deploy.conf.tmp <<EOF
# Written by setup-ec2.sh; no secrets. Rerun the setup document to change it.
LAI_ENV=$LAI_ENV
AWS_REGION=$AWS_REGION
LAI_ECR_REPOSITORY_URI=$LAI_ECR_REPOSITORY_URI
LAI_PARAM_PREFIX=/lai/$LAI_ENV/django
LAI_RELEASE_PARAM=/lai/$LAI_ENV/deploy/last-release
LAI_API_HOST=$LAI_API_HOST
LAI_DB_MODE=$LAI_DB_MODE
LAI_DB_SECRET_ARN=${LAI_DB_SECRET_ARN:-}
LAI_DB_INSTANCE_ID=${LAI_DB_INSTANCE_ID:-}
LAI_PREMIGRATION_SNAPSHOT=${LAI_PREMIGRATION_SNAPSHOT:-false}
LAI_APP_LOG_GROUP=$LAI_APP_LOG_GROUP
LAI_DATA_DIR=/var/lib/lai-data
EOF
chmod 0644 /etc/lai/deploy.conf.tmp
mv -f /etc/lai/deploy.conf.tmp /etc/lai/deploy.conf

# --- RDS CA bundle (TLS verify-full) -------------------------------------------------------------
bundle="$LAI_ROOT/certs/rds-global-bundle.pem"
if [ ! -s "$bundle" ] || [ -n "$(find "$bundle" -mtime +30 2>/dev/null)" ]; then
    say "downloading the RDS CA bundle"
    curl -fsSL -o "$bundle.tmp" "$RDS_CA_URL"
    grep -q 'BEGIN CERTIFICATE' "$bundle.tmp"
    chmod 0644 "$bundle.tmp"
    mv -f "$bundle.tmp" "$bundle"
fi

# --- dev database volume (container mode only) ---------------------------------------------------
# A separate EBS volume the stack retains, so the data outlives the instance and every release.
# It is formatted only when it has no filesystem; an existing filesystem is never touched.
install -d -m 0755 /var/lib/lai-data
if [ "$LAI_DB_MODE" = container ] && [ -n "${LAI_DATA_VOLUME_ID:-}" ]; then
    device="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${LAI_DATA_VOLUME_ID//-/}"
    for _ in $(seq 1 60); do [ -e "$device" ] && break; sleep 5; done
    [ -e "$device" ] || { say "ERROR: data volume $LAI_DATA_VOLUME_ID is not attached"; exit 3; }
    if ! blkid "$device" >/dev/null 2>&1; then
        say "formatting the new data volume"
        mkfs -t xfs -L lai-data "$device" >/dev/null
    fi
    uuid=$(blkid -s UUID -o value "$device")
    grep -q "$uuid" /etc/fstab || echo "UUID=$uuid /var/lib/lai-data xfs defaults,nofail 0 2" >>/etc/fstab
    mountpoint -q /var/lib/lai-data || mount /var/lib/lai-data
    install -d -m 0700 -o 70 -g 70 /var/lib/lai-data/postgres
fi

# --- logs and metrics ----------------------------------------------------------------------------
cat >/etc/logrotate.d/lai <<'EOF'
/var/log/lai/*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
}
EOF

agent_config=/opt/aws/amazon-cloudwatch-agent/etc/lai.json
cat >"$agent_config.tmp" <<EOF
{
  "agent": { "metrics_collection_interval": 60, "run_as_user": "root" },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/lai/deploy.log",
            "log_group_name": "$LAI_DEPLOY_LOG_GROUP",
            "log_stream_name": "{instance_id}",
            "retention_in_days": -1
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "$METRICS_NAMESPACE",
    "append_dimensions": { "InstanceId": "\${aws:InstanceId}" },
    "aggregation_dimensions": [["InstanceId"]],
    "metrics_collected": {
      "mem": { "measurement": ["mem_used_percent"] },
      "disk": { "measurement": ["used_percent"], "resources": ["/"], "drop_device": true }
    }
  }
}
EOF
if ! cmp -s "$agent_config.tmp" "$agent_config"; then
    mv -f "$agent_config.tmp" "$agent_config"
    /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 \
        -c "file:$agent_config" -s >/dev/null
else
    rm -f "$agent_config.tmp"
    systemctl enable --now amazon-cloudwatch-agent >/dev/null 2>&1 || true
fi

say "setup complete for $LAI_ENV (compose $COMPOSE_VERSION, database mode $LAI_DB_MODE)"
