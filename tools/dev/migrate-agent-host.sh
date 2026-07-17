#!/usr/bin/env bash
set -euo pipefail

source_host="local"
keep_temp=0
skip_system=0
skip_home=0
skip_verify=0
target=""
# OpenSSH uses the first value it sees for most options. Keep caller-supplied
# options before these defaults so --ssh-option can override them.
ssh_opts=()
default_ssh_opts=(-o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new)
remote_tmp=""
migration_committed=0
cleanup_done=0

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
  --skip-verify        Skip final CLI and proxy verification.
  --keep-temp          Keep target temporary payload directory.
  -h, --help           Show this help.

Target prerequisites:
  - SSH login works for the target user.
  - Linux x86_64 host; requested binaries are staged and checked before install.
  - System payload: systemd is present and the target user can run sudo.
  - Verification: curl is present unless --skip-verify is used.
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

ssh_target() {
    ssh "${ssh_opts[@]}" "${default_ssh_opts[@]}" "$target" "$@"
}

ssh_target_tty() {
    ssh -tt "${ssh_opts[@]}" "${default_ssh_opts[@]}" "$target" "$@"
}

ssh_source() {
    [ "$source_host" != "local" ] || die "ssh_source called for local source"
    ssh "${ssh_opts[@]}" "${default_ssh_opts[@]}" "$source_host" "$@"
}

# SSH passes its command through the target user's login shell before bash sees
# it. Quote with POSIX single quotes instead of bash-specific printf %q output
# so targets whose login shell is dash or another POSIX shell work as well.
remote_quote() {
    local value="$1"
    value=${value//\'/\'\\\'\'}
    printf "'%s'" "$value"
}

ssh_target_bash() {
    local script="$1"
    ssh_target "bash -lc $(remote_quote "$script")"
}

ssh_target_bash_tty() {
    local script="$1"
    ssh_target_tty "bash -lc $(remote_quote "$script")"
}

ssh_source_bash() {
    local script="$1"
    ssh_source "bash -lc $(remote_quote "$script")"
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
                    .local/lib/node_modules/@anthropic-ai/claude-code \
                    .local/lib/node_modules/@openai/codex \
                    .local/lib/node_modules/@google/gemini-cli \
                    myagenttool/tools/dev/init-agent-proxy.sh
            else
                ssh_source 'tar -C "$HOME" -czf - .local/opt/node-v22 .local/lib/node_modules/@anthropic-ai/claude-code .local/lib/node_modules/@openai/codex .local/lib/node_modules/@google/gemini-cli myagenttool/tools/dev/init-agent-proxy.sh'
            fi
            ;;
        *)
            die "unknown tar kind: $kind"
            ;;
    esac
}

target_extract() {
    local subdir="$1"
    local destination_literal
    local extract_script
    destination_literal="$(remote_quote "${remote_tmp}/${subdir}")"
    extract_script="set -e
destination=${destination_literal}
umask 077
install -d -m 700 \"\$destination\"
tar -xzf - -C \"\$destination\""
    ssh_target_bash "$extract_script"
}

preflight_source() {
    local check_script='set -e'

    if [ "$skip_system" = "0" ]; then
        check_script+=$'\ntest -x /usr/local/bin/mihomo\ntest -r /etc/mihomo/config.yaml\ntest -r /etc/systemd/system/mihomo.service'
    fi
    if [ "$skip_home" = "0" ]; then
        check_script+=$'\ntest -x "$HOME/.local/opt/node-v22/bin/node"\ntest -d "$HOME/.local/lib/node_modules/@anthropic-ai/claude-code"\ntest -d "$HOME/.local/lib/node_modules/@openai/codex"\ntest -d "$HOME/.local/lib/node_modules/@google/gemini-cli"\ntest -x "$HOME/myagenttool/tools/dev/init-agent-proxy.sh"'
    fi

    if [ "$skip_system" = "1" ] && [ "$skip_home" = "1" ]; then
        return 0
    fi

    if [ "$source_host" = "local" ]; then
        bash -lc "$check_script"
    else
        ssh_source_bash "$check_script"
    fi
}

preflight_target() {
    local check_script='set -e
test "$(uname -s)" = Linux || { echo "target must run Linux" >&2; exit 1; }
test "$(uname -m)" = x86_64 || { echo "target architecture must be x86_64 (found: $(uname -m))" >&2; exit 1; }
command -v bash >/dev/null'

    if [ "$skip_system" = "0" ] || [ "$skip_home" = "0" ]; then
        check_script+=$'\ncommand -v tar >/dev/null'
    fi
    if [ "$skip_system" = "0" ]; then
        check_script+=$'\ncommand -v sudo >/dev/null\ncommand -v systemctl >/dev/null'
    fi
    if [ "$skip_verify" = "0" ]; then
        check_script+=$'\ncommand -v curl >/dev/null || { echo "target curl is required for proxy verification" >&2; exit 1; }'
    fi
    if [ "$skip_home" = "1" ]; then
        check_script+=$'\ntest -x "$HOME/myagenttool/tools/dev/init-agent-proxy.sh" || { echo "target init-agent-proxy.sh is required with --skip-home" >&2; exit 1; }'
    fi

    ssh_target_bash "$check_script"
}

create_remote_tmp() {
    local output
    local create_script
    create_script='set -e
umask 077
base="$HOME/.cache/agent-host-migrate"
install -d -m 700 "$base"
mktemp -d "$base/run.XXXXXXXXXX"'
    output="$(ssh_target_bash "$create_script")"

    case "$output" in
        *$'\n'*) die "target returned an invalid temporary directory path" ;;
        /*/.cache/agent-host-migrate/run.*) ;;
        *) die "target returned an unsafe temporary directory path: $output" ;;
    esac
    remote_tmp="$output"
}

validate_staged_payloads() {
    local remote_tmp_literal
    local validate_script
    remote_tmp_literal="$(remote_quote "$remote_tmp")"
    validate_script="set -euo pipefail
remote_tmp=${remote_tmp_literal}"

    if [ "$skip_system" = "0" ]; then
        validate_script+=$'\npayload="$remote_tmp/system"\ntest -x "$payload/usr/local/bin/mihomo"\ntest -r "$payload/etc/mihomo/config.yaml"\ntest -r "$payload/etc/systemd/system/mihomo.service"\n"$payload/usr/local/bin/mihomo" -v >/dev/null\n"$payload/usr/local/bin/mihomo" -t -d "$payload/etc/mihomo" >/dev/null'
    fi
    if [ "$skip_home" = "0" ]; then
        validate_script+=$'\npayload="$remote_tmp/home"\ntest -x "$payload/.local/opt/node-v22/bin/node"\ntest -d "$payload/.local/lib/node_modules/@anthropic-ai/claude-code"\ntest -d "$payload/.local/lib/node_modules/@openai/codex"\ntest -d "$payload/.local/lib/node_modules/@google/gemini-cli"\ntest -x "$payload/myagenttool/tools/dev/init-agent-proxy.sh"\n"$payload/.local/opt/node-v22/bin/node" -v >/dev/null'
    fi

    ssh_target_bash "$validate_script"
}

install_system_payload() {
    local remote_tmp_literal
    local install_script
    remote_tmp_literal="$(remote_quote "$remote_tmp")"
    install_script="set -euo pipefail
remote_tmp=${remote_tmp_literal}
payload=\"\$remote_tmp/system\"
backup=\"\$remote_tmp/backup/system\"
mkdir -p \"\$backup/absent\"
chmod 700 \"\$remote_tmp/backup\" \"\$backup\" 2>/dev/null || true

existing=()
for rel in usr/local/bin/mihomo etc/mihomo etc/systemd/system/mihomo.service; do
    if sudo test -e \"/\$rel\" || sudo test -L \"/\$rel\"; then
        existing+=(\"\$rel\")
    else
        marker=\"\$backup/absent/\$rel\"
        mkdir -p \"\${marker%/*}\"
        : > \"\$marker\"
    fi
done
if [ \"\${#existing[@]}\" -gt 0 ]; then
    sudo tar -C / -cpf - \"\${existing[@]}\" > \"\$backup/original.tar\"
fi
systemctl is-active mihomo > \"\$backup/service-active\" 2>/dev/null || true
systemctl is-enabled mihomo > \"\$backup/service-enabled\" 2>/dev/null || true
: > \"\$backup/started\"

token=\"\${remote_tmp##*/}\"
root_stage=\"/etc/.mihomo-migrate.\$token\"
binary_stage=\"/usr/local/bin/.mihomo-migrate.\$token\"
unit_stage=\"/etc/systemd/system/.mihomo.service.migrate.\$token\"
cleanup_stage() {
    sudo rm -rf -- \"\$root_stage\" \"\$binary_stage\" \"\$unit_stage\"
}
trap cleanup_stage EXIT

sudo rm -rf -- \"\$root_stage\" \"\$binary_stage\" \"\$unit_stage\"
sudo install -d -m 700 \"\$root_stage\"
sudo cp -a \"\$payload/etc/mihomo\" \"\$root_stage/new-mihomo\"
sudo chown -R root:root \"\$root_stage/new-mihomo\"
sudo install -m 755 \"\$payload/usr/local/bin/mihomo\" \"\$binary_stage\"
sudo install -m 644 \"\$payload/etc/systemd/system/mihomo.service\" \"\$unit_stage\"

sudo mv -f -- \"\$binary_stage\" /usr/local/bin/mihomo
if sudo test -e /etc/mihomo || sudo test -L /etc/mihomo; then
    sudo mv -- /etc/mihomo \"\$root_stage/previous-mihomo\"
fi
sudo mv -- \"\$root_stage/new-mihomo\" /etc/mihomo
sudo chmod 644 /etc/mihomo/config.yaml /etc/mihomo/GeoSite.dat /etc/mihomo/geoip.metadb 2>/dev/null || true
sudo mv -f -- \"\$unit_stage\" /etc/systemd/system/mihomo.service
sudo systemctl daemon-reload
sudo systemctl enable mihomo
if systemctl is-active --quiet mihomo; then
    sudo systemctl restart mihomo
else
    sudo systemctl start mihomo
fi
systemctl is-active --quiet mihomo
: > \"\$backup/installed\""

    log "installing mihomo and systemd service on target; sudo may prompt"
    ssh_target_bash_tty "$install_script"
}

snapshot_home_state() {
    local remote_tmp_literal
    local snapshot_script
    remote_tmp_literal="$(remote_quote "$remote_tmp")"
    snapshot_script="set -euo pipefail
remote_tmp=${remote_tmp_literal}
backup=\"\$remote_tmp/backup/home\"
original=\"\$backup/original\"
absent=\"\$backup/absent\"
mkdir -p \"\$original\" \"\$absent\"
chmod 700 \"\$remote_tmp/backup\" \"\$backup\" 2>/dev/null || true
[ ! -f \"\$backup/started\" ] || exit 0

exists() {
    [ -e \"\$1\" ] || [ -L \"\$1\" ]
}
mark_absent() {
    mkdir -p \"\${1%/*}\"
    : > \"\$1\"
}
snapshot_small() {
    local rel=\"\$1\"
    local current=\"\$HOME/\$rel\"
    local saved=\"\$original/\$rel\"
    if exists \"\$current\"; then
        mkdir -p \"\${saved%/*}\"
        cp -a -- \"\$current\" \"\$saved\"
    else
        mark_absent \"\$absent/\$rel\"
    fi
}

small_paths=(
    .bashrc
    myagenttool/tools/dev/init-agent-proxy.sh
    .local/bin/node .local/bin/npm .local/bin/npx .local/bin/corepack
    .local/bin/with-agent-proxy
    .local/bin/claude .local/bin/claude-real
    .local/bin/codex .local/bin/codex-real
    .local/bin/gemini .local/bin/gemini-real
    bin/init-agent-proxy
)
for rel in \"\${small_paths[@]}\"; do
    snapshot_small \"\$rel\"
done

if [ -L \"\$HOME/.bashrc\" ]; then
    referent=\"\$(readlink -f -- \"\$HOME/.bashrc\" 2>/dev/null || readlink -m -- \"\$HOME/.bashrc\")\"
    [ -n \"\$referent\" ]
    printf '%s\\0' \"\$referent\" > \"\$backup/bashrc-referent-path\"
    if exists \"\$referent\"; then
        [ ! -d \"\$referent\" ] || { echo \"bashrc symlink points to a directory: \$referent\" >&2; exit 1; }
        cp -a -- \"\$referent\" \"\$backup/bashrc-referent\"
    else
        : > \"\$backup/bashrc-referent-absent\"
    fi
fi
: > \"\$backup/started\""

    log "snapshotting target shell and wrapper state"
    ssh_target_bash "$snapshot_script"
}

install_home_payload() {
    local remote_tmp_literal
    local install_script
    remote_tmp_literal="$(remote_quote "$remote_tmp")"
    install_script="set -euo pipefail
remote_tmp=${remote_tmp_literal}
payload=\"\$remote_tmp/home\"
backup=\"\$remote_tmp/backup/home\"
original=\"\$backup/original\"
absent=\"\$backup/absent\"
mkdir -p \"\$original\" \"\$absent\"
chmod 700 \"\$remote_tmp/backup\" \"\$backup\" 2>/dev/null || true

exists() {
    [ -e \"\$1\" ] || [ -L \"\$1\" ]
}
mark_absent() {
    mkdir -p \"\${1%/*}\"
    : > \"\$1\"
}
move_current() {
    local rel=\"\$1\"
    local current=\"\$HOME/\$rel\"
    local saved=\"\$original/\$rel\"
    if exists \"\$current\"; then
        mkdir -p \"\${saved%/*}\"
        mv -- \"\$current\" \"\$saved\"
    else
        mark_absent \"\$absent/\$rel\"
    fi
}

[ -f \"\$backup/started\" ] || { echo \"target home snapshot is missing\" >&2; exit 1; }

mkdir -p \"\$HOME/.local/opt\" \"\$HOME/.local/bin\" \"\$HOME/.local/lib/node_modules\" \"\$HOME/myagenttool/tools/dev\"
move_current .local/opt/node-v22
mv -- \"\$payload/.local/opt/node-v22\" \"\$HOME/.local/opt/node-v22\"

packages=(
    @anthropic-ai/claude-code
    @openai/codex
    @google/gemini-cli
)
for package in \"\${packages[@]}\"; do
    mkdir -p \"\$HOME/.local/lib/node_modules/\${package%/*}\"
    move_current \".local/lib/node_modules/\$package\"
    mv -- \"\$payload/.local/lib/node_modules/\$package\" \"\$HOME/.local/lib/node_modules/\$package\"
done

rm -rf -- \"\$HOME/myagenttool/tools/dev/init-agent-proxy.sh\"
cp -a -- \"\$payload/myagenttool/tools/dev/init-agent-proxy.sh\" \"\$HOME/myagenttool/tools/dev/init-agent-proxy.sh\"
python3 -c \"from pathlib import Path; p=Path.home()/\\\"myagenttool/tools/dev/init-agent-proxy.sh\\\"; p.write_bytes(p.read_bytes().replace(b\\\"\\\\r\\\\n\\\", b\\\"\\\\n\\\"))\" 2>/dev/null || true
chmod +x \"\$HOME/myagenttool/tools/dev/init-agent-proxy.sh\"

for name in node npm npx corepack; do
    rm -rf -- \"\$HOME/.local/bin/\$name\"
    ln -s \"\$HOME/.local/opt/node-v22/bin/\$name\" \"\$HOME/.local/bin/\$name\"
done
export PATH=\"\$HOME/.local/bin:\$HOME/bin:\$PATH\"
node -v
npm -v
: > \"\$backup/installed\""

    log "installing Node and agent CLI packages into target home"
    ssh_target_bash "$install_script"
}

run_init_proxy() {
    local init_script
    init_script='export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
"$HOME/myagenttool/tools/dev/init-agent-proxy.sh" --install-only'
    log "installing target agent proxy helpers"
    ssh_target_bash "$init_script"
}

verify_target() {
    local verify_script
    verify_script='set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
with-agent-proxy --check
node -v
claude --version
codex --version
gemini --version
"$HOME/bin/init-agent-proxy" --check-only'
    log "verifying target CLIs and proxy"
    ssh_target_bash "$verify_script"
}

rollback_home_payload() {
    local remote_tmp_literal
    local rollback_script
    remote_tmp_literal="$(remote_quote "$remote_tmp")"
    rollback_script="set -euo pipefail
remote_tmp=${remote_tmp_literal}
backup=\"\$remote_tmp/backup/home\"
[ -f \"\$backup/started\" ] || exit 0
original=\"\$backup/original\"
absent=\"\$backup/absent\"
exists() {
    [ -e \"\$1\" ] || [ -L \"\$1\" ]
}
restore_path() {
    local rel=\"\$1\"
    local current=\"\$HOME/\$rel\"
    local saved=\"\$original/\$rel\"
    if exists \"\$saved\"; then
        rm -rf -- \"\$current\"
        mkdir -p \"\${current%/*}\"
        mv -- \"\$saved\" \"\$current\"
    elif [ -f \"\$absent/\$rel\" ]; then
        rm -rf -- \"\$current\"
    fi
}

paths=(
    .local/opt/node-v22
    .local/lib/node_modules/@anthropic-ai/claude-code
    .local/lib/node_modules/@openai/codex
    .local/lib/node_modules/@google/gemini-cli
    .bashrc
    myagenttool/tools/dev/init-agent-proxy.sh
    .local/bin/node .local/bin/npm .local/bin/npx .local/bin/corepack
    .local/bin/with-agent-proxy
    .local/bin/claude .local/bin/claude-real
    .local/bin/codex .local/bin/codex-real
    .local/bin/gemini .local/bin/gemini-real
    bin/init-agent-proxy
)
for rel in \"\${paths[@]}\"; do
    restore_path \"\$rel\"
done

if [ -f \"\$backup/bashrc-referent-path\" ]; then
    referent=''
    IFS= read -r -d '' referent < \"\$backup/bashrc-referent-path\"
    [ -n \"\$referent\" ]
    if exists \"\$backup/bashrc-referent\"; then
        rm -rf -- \"\$referent\"
        mkdir -p \"\${referent%/*}\"
        mv -- \"\$backup/bashrc-referent\" \"\$referent\"
    elif [ -f \"\$backup/bashrc-referent-absent\" ]; then
        rm -rf -- \"\$referent\"
    fi
fi"
    ssh_target_bash "$rollback_script"
}

rollback_system_payload() {
    local remote_tmp_literal
    local rollback_script
    remote_tmp_literal="$(remote_quote "$remote_tmp")"
    rollback_script="set -euo pipefail
remote_tmp=${remote_tmp_literal}
backup=\"\$remote_tmp/backup/system\"
[ -f \"\$backup/started\" ] || exit 0

sudo rm -rf -- /usr/local/bin/mihomo /etc/mihomo /etc/systemd/system/mihomo.service
if [ -s \"\$backup/original.tar\" ]; then
    sudo tar -C / -xpf \"\$backup/original.tar\"
fi
sudo systemctl daemon-reload

active=\"\$(cat \"\$backup/service-active\" 2>/dev/null || true)\"
enabled=\"\$(cat \"\$backup/service-enabled\" 2>/dev/null || true)\"
if [ \"\$active\" = active ]; then
    sudo systemctl restart mihomo
else
    sudo systemctl stop mihomo 2>/dev/null || true
fi
case \"\$enabled\" in
    enabled) sudo systemctl enable mihomo ;;
    masked) sudo systemctl mask mihomo ;;
    *) sudo systemctl disable mihomo 2>/dev/null || true ;;
esac"
    ssh_target_bash_tty "$rollback_script"
}

rollback_target() {
    local failed=0
    log "migration failed; restoring previous target state"
    rollback_home_payload || failed=1
    if [ "$skip_system" = "0" ]; then
        rollback_system_payload || failed=1
    fi
    return "$failed"
}

cleanup_target() {
    local remote_tmp_literal
    local cleanup_script
    [ -n "$remote_tmp" ] || return 0
    [ "$cleanup_done" = "0" ] || return 0
    cleanup_done=1

    if [ "$keep_temp" = "1" ]; then
        warn "keeping target temp directory: ${remote_tmp}"
        return 0
    fi

    remote_tmp_literal="$(remote_quote "$remote_tmp")"
    cleanup_script="set -e
remote_tmp=${remote_tmp_literal}
rm -rf -- \"\$remote_tmp\""
    if ! ssh_target_bash "$cleanup_script"; then
        warn "could not remove target temp directory: ${remote_tmp}"
    fi
}

handle_exit() {
    local status="$?"
    local rollback_ok=1
    trap - EXIT HUP INT TERM
    set +e

    if [ -n "$remote_tmp" ] && [ "$migration_committed" = "0" ]; then
        rollback_target || rollback_ok=0
    fi
    if [ "$rollback_ok" = "1" ]; then
        cleanup_target
    else
        warn "rollback was incomplete; keeping target recovery data at ${remote_tmp}"
    fi
    exit "$status"
}

log "source=${source_host} target=${target}"
if [ "$skip_system" = "0" ] || [ "$skip_home" = "0" ]; then
    log "checking requested source payload"
    preflight_source
else
    warn "skipping source payload checks"
fi
log "checking target prerequisites"
preflight_target

create_remote_tmp
trap handle_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$skip_system" = "0" ]; then
    log "copying mihomo payload"
    run_source_tar system | target_extract system
else
    warn "skipping system payload"
fi

if [ "$skip_home" = "0" ]; then
    log "copying Node and agent CLI payload"
    run_source_tar home | target_extract home
else
    warn "skipping home payload"
fi

if [ "$skip_system" = "0" ] || [ "$skip_home" = "0" ]; then
    log "validating staged payloads on target"
    validate_staged_payloads
fi

snapshot_home_state

if [ "$skip_system" = "0" ]; then
    install_system_payload
fi
if [ "$skip_home" = "0" ]; then
    install_home_payload
fi

run_init_proxy

if [ "$skip_verify" = "0" ]; then
    verify_target
else
    warn "skipping final verification"
fi

migration_committed=1
cleanup_target
log "done"
