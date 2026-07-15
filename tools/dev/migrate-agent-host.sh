#!/usr/bin/env bash
set -euo pipefail

source_host="local"
keep_temp=0
skip_system=0
skip_home=0
skip_verify=0
target=""
ssh_opts=(-o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new)

usage() {
    cat <<'EOF'
Usage:
  migrate-agent-host.sh [options] <target-ssh>

Examples:
  # Run on a prepared source host, migrate to a new target.
  tools/dev/migrate-agent-host.sh devagent@10.10.10.60

  # Run from a control host, pulling the source payload from 10.10.10.122.
  tools/dev/migrate-agent-host.sh --source devagent@10.10.10.122 devagent@10.10.10.60

Options:
  --source <ssh|local>  Prepared source host. Defaults to local.
  --ssh-option <opt>   Extra ssh/scp option, repeatable.
  --skip-system        Do not copy/install mihomo and systemd service.
  --skip-home          Do not copy Node, global CLI packages, or init script.
  --skip-verify        Skip final command and proxy verification.
  --keep-temp          Keep target temporary payload directory.
  -h, --help           Show this help.

Target prerequisites:
  - SSH login works for the target user.
  - Target user can sudo to install mihomo under /usr/local/bin and /etc.
  - Linux x86_64 systemd host. The source payload is copied as-is.
EOF
}

log() {
    printf '[migrate-agent-host] %s\n' "$*"
}

warn() {
    printf '[migrate-agent-host] WARN: %s\n' "$*" >&2
}

die() {
    printf '[migrate-agent-host] ERROR: %s\n' "$*" >&2
    exit 1
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --source)
            [ "$#" -ge 2 ] || die "--source requires a value"
            source_host="$2"
            shift 2
            ;;
        --ssh-option)
            [ "$#" -ge 2 ] || die "--ssh-option requires a value"
            ssh_opts+=("$2")
            shift 2
            ;;
        --skip-system)
            skip_system=1
            shift
            ;;
        --skip-home)
            skip_home=1
            shift
            ;;
        --skip-verify)
            skip_verify=1
            shift
            ;;
        --keep-temp)
            keep_temp=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        --)
            shift
            break
            ;;
        -*)
            die "unknown option: $1"
            ;;
        *)
            if [ -n "$target" ]; then
                die "unexpected extra argument: $1"
            fi
            target="$1"
            shift
            ;;
    esac
done

if [ -z "$target" ] && [ "$#" -gt 0 ]; then
    target="$1"
fi
[ -n "$target" ] || { usage >&2; exit 2; }

timestamp="$(date +%Y%m%d%H%M%S)"
remote_tmp=".cache/agent-host-migrate/${timestamp}"

ssh_target() {
    ssh "${ssh_opts[@]}" "$target" "$@"
}

ssh_source() {
    [ "$source_host" != "local" ] || die "ssh_source called for local source"
    ssh "${ssh_opts[@]}" "$source_host" "$@"
}

run_source_tar() {
    local kind="$1"
    case "$kind" in
        system)
            if [ "$source_host" = "local" ]; then
                tar -C / -czf - \
                    usr/local/bin/mihomo \
                    etc/mihomo \
                    etc/systemd/system/mihomo.service
            else
                ssh_source "tar -C / -czf - usr/local/bin/mihomo etc/mihomo etc/systemd/system/mihomo.service"
            fi
            ;;
        home)
            if [ "$source_host" = "local" ]; then
                tar -C "$HOME" -czf - \
                    .local/opt/node-v22 \
                    .local/lib/node_modules \
                    myagenttool/tools/dev/init-agent-proxy.sh
            else
                ssh_source 'tar -C "$HOME" -czf - .local/opt/node-v22 .local/lib/node_modules myagenttool/tools/dev/init-agent-proxy.sh'
            fi
            ;;
        *)
            die "unknown tar kind: $kind"
            ;;
    esac
}

target_extract() {
    local subdir="$1"
    ssh_target "mkdir -p ~/${remote_tmp}/${subdir} && tar -xzf - -C ~/${remote_tmp}/${subdir}"
}

preflight_source() {
    local check_script='
set -e
test -x /usr/local/bin/mihomo
test -r /etc/mihomo/config.yaml
test -r /etc/systemd/system/mihomo.service
test -x "$HOME/.local/opt/node-v22/bin/node"
test -d "$HOME/.local/lib/node_modules/@anthropic-ai/claude-code"
test -d "$HOME/.local/lib/node_modules/@openai/codex"
test -d "$HOME/.local/lib/node_modules/@google/gemini-cli"
test -x "$HOME/myagenttool/tools/dev/init-agent-proxy.sh"
'
    if [ "$source_host" = "local" ]; then
        bash -lc "$check_script"
    else
        ssh_source "bash -lc $(printf '%q' "$check_script")"
    fi
}

preflight_target() {
    ssh_target 'bash -lc '\''
set -e
command -v bash >/dev/null
command -v tar >/dev/null
command -v sudo >/dev/null
command -v systemctl >/dev/null
uname -m
'\'''
}

install_system_payload() {
    log "installing mihomo and systemd service on target; sudo may prompt"
    ssh -tt "${ssh_opts[@]}" "$target" "bash -lc 'set -e
payload=\"\$HOME/${remote_tmp}/system\"
sudo install -m 755 \"\$payload/usr/local/bin/mihomo\" /usr/local/bin/mihomo
sudo install -d -m 755 /etc/mihomo
sudo rm -rf /etc/mihomo/*
sudo cp -a \"\$payload/etc/mihomo/.\" /etc/mihomo/
sudo chown -R root:root /etc/mihomo
sudo chmod 644 /etc/mihomo/config.yaml /etc/mihomo/GeoSite.dat /etc/mihomo/geoip.metadb 2>/dev/null || true
sudo install -m 644 \"\$payload/etc/systemd/system/mihomo.service\" /etc/systemd/system/mihomo.service
sudo systemctl daemon-reload
sudo systemctl enable --now mihomo
systemctl is-active mihomo
'"
}

install_home_payload() {
    log "installing Node, global CLI packages, and init script into target home"
    ssh_target "bash -lc 'set -e
payload=\"\$HOME/${remote_tmp}/home\"
mkdir -p \"\$HOME/.local/opt\" \"\$HOME/.local/bin\" \"\$HOME/.local/lib\" \"\$HOME/myagenttool/tools/dev\"
rm -rf \"\$HOME/.local/opt/node-v22\" \"\$HOME/.local/lib/node_modules\"
cp -a \"\$payload/.local/opt/node-v22\" \"\$HOME/.local/opt/node-v22\"
cp -a \"\$payload/.local/lib/node_modules\" \"\$HOME/.local/lib/node_modules\"
cp -a \"\$payload/myagenttool/tools/dev/init-agent-proxy.sh\" \"\$HOME/myagenttool/tools/dev/init-agent-proxy.sh\"
python3 -c \"from pathlib import Path; p=Path.home()/\\\"myagenttool/tools/dev/init-agent-proxy.sh\\\"; p.write_bytes(p.read_bytes().replace(b\\\"\\\\r\\\\n\\\", b\\\"\\\\n\\\"))\" 2>/dev/null || true
chmod +x \"\$HOME/myagenttool/tools/dev/init-agent-proxy.sh\"
ln -sfn \"\$HOME/.local/opt/node-v22/bin/node\" \"\$HOME/.local/bin/node\"
ln -sfn \"\$HOME/.local/opt/node-v22/bin/npm\" \"\$HOME/.local/bin/npm\"
ln -sfn \"\$HOME/.local/opt/node-v22/bin/npx\" \"\$HOME/.local/bin/npx\"
ln -sfn \"\$HOME/.local/opt/node-v22/bin/corepack\" \"\$HOME/.local/bin/corepack\"
export PATH=\"\$HOME/.local/bin:\$HOME/bin:\$PATH\"
npm config set prefix \"\$HOME/.local\" >/dev/null 2>&1 || true
node -v
npm -v
'"
}

run_init_proxy() {
    log "running target init-agent-proxy"
    ssh_target 'bash -lc '\''export PATH="$HOME/.local/bin:$HOME/bin:$PATH"; "$HOME/myagenttool/tools/dev/init-agent-proxy.sh"'\'''
}

verify_target() {
    log "verifying target CLIs and proxy"
    ssh_target 'bash -lc '\''export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
with-agent-proxy --check
node -v
claude --version
codex --version
gemini --version
"$HOME/bin/init-agent-proxy" --check-only
'\'''
}

cleanup_target() {
    [ "$keep_temp" = "0" ] || {
        warn "keeping target temp directory: ~/${remote_tmp}"
        return 0
    }
    ssh_target "rm -rf ~/${remote_tmp}"
}

log "source=${source_host} target=${target}"
log "checking source payload"
preflight_source
log "checking target prerequisites"
preflight_target

if [ "$skip_system" = "0" ]; then
    log "copying mihomo payload"
    run_source_tar system | target_extract system
    install_system_payload
else
    warn "skipping system payload"
fi

if [ "$skip_home" = "0" ]; then
    log "copying home payload; this includes Node and global CLI packages"
    run_source_tar home | target_extract home
    install_home_payload
else
    warn "skipping home payload"
fi

run_init_proxy

if [ "$skip_verify" = "0" ]; then
    verify_target
else
    warn "skipping final verification"
fi

cleanup_target
log "done"
