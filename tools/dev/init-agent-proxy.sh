#!/usr/bin/env bash
set -euo pipefail

proxy_host="${AGENT_PROXY_HOST:-127.0.0.1}"
proxy_ports="${AGENT_PROXY_PORTS:-7897 7890}"
bin_dir="${AGENT_PROXY_BIN_DIR:-$HOME/.local/bin}"
user_bin_dir="${AGENT_PROXY_USER_BIN_DIR:-$HOME/bin}"
bashrc="${AGENT_PROXY_BASHRC:-$HOME/.bashrc}"
mode="install"

usage() {
    cat <<'EOF'
Usage: init-agent-proxy [--check-only] [--install-only]

Installs or repairs local agent proxy helpers:
  - with-agent-proxy: run any command through the detected local proxy.
  - claude wrapper: runs Claude Code through HTTP(S)_PROXY and prefers IPv4.
  - bashrc block: puts ~/bin and ~/.local/bin on PATH and wraps codex.

Environment:
  AGENT_PROXY_HOST       Proxy host, default 127.0.0.1.
  AGENT_PROXY_PORTS      Space-separated ports, default "7897 7890".
  AGENT_PROXY_BIN_DIR    Wrapper install dir, default ~/.local/bin.
  AGENT_PROXY_USER_BIN_DIR Launcher dir, default ~/bin.
EOF
}

log() {
    printf '[init-agent-proxy] %s\n' "$*"
}

warn() {
    printf '[init-agent-proxy] WARN: %s\n' "$*" >&2
}

die() {
    printf '[init-agent-proxy] ERROR: %s\n' "$*" >&2
    exit 1
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --check-only) mode="check" ;;
        --install-only) mode="install-only" ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
    shift
done

port_open() {
    local port="$1"
    timeout 1 bash -c "</dev/tcp/${proxy_host}/${port}" >/dev/null 2>&1
}

pick_proxy_url() {
    local port
    for port in $proxy_ports; do
        if port_open "$port"; then
            printf 'http://%s:%s\n' "$proxy_host" "$port"
            return 0
        fi
    done
    return 1
}

backup_file() {
    local path="$1"
    [ -f "$path" ] || return 0
    local backup
    local ts
    ts="$(date +%Y%m%d%H%M%S)"
    backup="$(mktemp "${path}.bak-agent-proxy-${ts}.XXXXXX")"
    if ! cp -p -- "$path" "$backup"; then
        rm -f "$backup"
        return 1
    fi
}

remove_dangling_symlink() {
    local path="$1"
    if [ -L "$path" ] && [ ! -e "$path" ]; then
        rm -f "$path"
    fi
}

prepare_install_dirs() {
    mkdir -p "$bin_dir" "$user_bin_dir"
    bin_dir="$(cd "$bin_dir" && pwd -P)"
    user_bin_dir="$(cd "$user_bin_dir" && pwd -P)"
}

write_with_agent_proxy() {
    mkdir -p "$bin_dir"
    cat > "${bin_dir}/with-agent-proxy" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

proxy_host="${AGENT_PROXY_HOST:-127.0.0.1}"
proxy_ports="${AGENT_PROXY_PORTS:-7897 7890}"

port_open() {
    local port="$1"
    timeout 1 bash -c "</dev/tcp/${proxy_host}/${port}" >/dev/null 2>&1
}

pick_proxy_url() {
    local port
    for port in $proxy_ports; do
        if port_open "$port"; then
            printf 'http://%s:%s\n' "$proxy_host" "$port"
            return 0
        fi
    done
    return 1
}

case "${1:-}" in
    --print-url)
        pick_proxy_url
        exit
        ;;
    --env)
        proxy_url="$(pick_proxy_url)"
        cat <<ENV
export HTTPS_PROXY="$proxy_url"
export HTTP_PROXY="$proxy_url"
export ALL_PROXY="$proxy_url"
export https_proxy="$proxy_url"
export http_proxy="$proxy_url"
export all_proxy="$proxy_url"
export NO_PROXY="localhost,127.0.0.1,::1"
export no_proxy="localhost,127.0.0.1,::1"
ENV
        exit
        ;;
    --check)
        proxy_url="$(pick_proxy_url)" || {
            echo "no proxy port is reachable on ${proxy_host}: ${proxy_ports}" >&2
            exit 1
        }
        echo "proxy=$proxy_url"
        exit
        ;;
esac

proxy_url="$(pick_proxy_url)" || {
    echo "no proxy port is reachable on ${proxy_host}: ${proxy_ports}" >&2
    exit 1
}

export HTTPS_PROXY="$proxy_url"
export HTTP_PROXY="$proxy_url"
export ALL_PROXY="$proxy_url"
export https_proxy="$proxy_url"
export http_proxy="$proxy_url"
export all_proxy="$proxy_url"
export NO_PROXY="localhost,127.0.0.1,::1"
export no_proxy="localhost,127.0.0.1,::1"

if [ "$#" -eq 0 ]; then
    env | grep -Ei '^(HTTPS?|ALL|NO)_PROXY=|^(https?|all|no)_proxy=' | sort
    exit
fi

exec "$@"
EOF
    chmod 755 "${bin_dir}/with-agent-proxy"
}

install_claude_wrapper() {
    mkdir -p "$bin_dir"
    local claude_path="${bin_dir}/claude"
    local real_path="${bin_dir}/claude-real"
    local default_real="$HOME/.local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe"

    remove_dangling_symlink "$real_path"
    if [ -L "$claude_path" ]; then
        local target
        target="$(readlink "$claude_path")"
        if [ -e "$claude_path" ] && [ ! -e "$real_path" ]; then
            ln -s "$target" "$real_path"
        fi
    elif [ -x "$claude_path" ] && ! grep -q 'MYAGENTTOOL_CLAUDE_PROXY_WRAPPER' "$claude_path" 2>/dev/null; then
        if [ ! -e "$real_path" ]; then
            mv "$claude_path" "$real_path"
        fi
    fi

    if [ ! -e "$real_path" ] && [ -x "$default_real" ]; then
        remove_dangling_symlink "$real_path"
        ln -s "$default_real" "$real_path"
    fi

    rm -f "$claude_path"
    cat > "$claude_path" <<'EOF'
#!/usr/bin/env bash
# MYAGENTTOOL_CLAUDE_PROXY_WRAPPER
set -euo pipefail

wrapper_dir="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
real_claude="${CLAUDE_REAL_BIN:-${wrapper_dir}/claude-real}"
if [ ! -x "$real_claude" ]; then
    real_claude="$HOME/.local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe"
fi
if [ ! -x "$real_claude" ]; then
    echo "claude-real is not executable: $real_claude" >&2
    exit 127
fi

node_options="${NODE_OPTIONS:-}"
case " $node_options " in
    *" --dns-result-order="*) ;;
    *) node_options="${node_options:+$node_options }--dns-result-order=ipv4first" ;;
esac
export NODE_OPTIONS="$node_options"

proxy_helper="${wrapper_dir}/with-agent-proxy"
if [ -x "$proxy_helper" ] && proxy_url="$("$proxy_helper" --print-url 2>/dev/null)"; then
    export HTTPS_PROXY="$proxy_url"
    export HTTP_PROXY="$proxy_url"
    export https_proxy="$proxy_url"
    export http_proxy="$proxy_url"
    export NO_PROXY="localhost,127.0.0.1,::1"
    export no_proxy="$NO_PROXY"
    unset ALL_PROXY all_proxy
fi

exec "$real_claude" "$@"
EOF
    chmod 755 "$claude_path"
}

install_codex_wrapper() {
    mkdir -p "$bin_dir"
    local codex_path="${bin_dir}/codex"
    local real_path="${bin_dir}/codex-real"
    local default_real="$HOME/.local/lib/node_modules/@openai/codex/bin/codex.js"

    remove_dangling_symlink "$real_path"
    if [ -L "$codex_path" ]; then
        local target
        target="$(readlink "$codex_path")"
        if [ -e "$codex_path" ] && [ ! -e "$real_path" ]; then
            ln -s "$target" "$real_path"
        fi
    elif [ -x "$codex_path" ] && ! grep -q 'MYAGENTTOOL_CODEX_PROXY_WRAPPER' "$codex_path" 2>/dev/null; then
        if [ ! -e "$real_path" ]; then
            mv "$codex_path" "$real_path"
        fi
    fi

    if [ ! -e "$real_path" ] && [ -x "$default_real" ]; then
        remove_dangling_symlink "$real_path"
        ln -s "$default_real" "$real_path"
    fi

    rm -f "$codex_path"
    cat > "$codex_path" <<'EOF'
#!/usr/bin/env bash
# MYAGENTTOOL_CODEX_PROXY_WRAPPER
set -euo pipefail

wrapper_dir="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
real_codex="${CODEX_REAL_BIN:-${wrapper_dir}/codex-real}"
if [ ! -x "$real_codex" ]; then
    real_codex="$HOME/.local/lib/node_modules/@openai/codex/bin/codex.js"
fi
if [ ! -x "$real_codex" ]; then
    echo "codex-real is not executable: $real_codex" >&2
    exit 127
fi

node_options="${NODE_OPTIONS:-}"
case " $node_options " in
    *" --dns-result-order="*) ;;
    *) node_options="${node_options:+$node_options }--dns-result-order=ipv4first" ;;
esac
export NODE_OPTIONS="$node_options"

proxy_helper="${wrapper_dir}/with-agent-proxy"
if [ -x "$proxy_helper" ] && proxy_url="$("$proxy_helper" --print-url 2>/dev/null)"; then
    export HTTPS_PROXY="$proxy_url"
    export HTTP_PROXY="$proxy_url"
    export ALL_PROXY="$proxy_url"
    export https_proxy="$proxy_url"
    export http_proxy="$proxy_url"
    export all_proxy="$proxy_url"
    export NO_PROXY="localhost,127.0.0.1,::1"
    export no_proxy="$NO_PROXY"
fi

exec "$real_codex" "$@"
EOF
    chmod 755 "$codex_path"
}

install_gemini_wrapper() {
    mkdir -p "$bin_dir"
    local gemini_path="${bin_dir}/gemini"
    local real_path="${bin_dir}/gemini-real"
    local target
    local candidate
    local default_reals=(
        "$HOME/.local/lib/node_modules/@google/gemini-cli/dist/index.js"
        "$HOME/.local/lib/node_modules/@google/gemini-cli/bin/gemini.js"
        "$HOME/.local/lib/node_modules/@google/gemini-cli/bundle/gemini.js"
        "$HOME/.local/lib/node_modules/@google/gemini-cli/cli.js"
        "$HOME/.local/lib/node_modules/gemini-cli/bin/gemini.js"
    )

    remove_dangling_symlink "$real_path"
    if [ -L "$gemini_path" ]; then
        target="$(readlink "$gemini_path")"
        if [ -e "$gemini_path" ] && [ ! -e "$real_path" ]; then
            ln -s "$target" "$real_path"
        fi
    elif [ -x "$gemini_path" ] && ! grep -q 'MYAGENTTOOL_GEMINI_PROXY_WRAPPER' "$gemini_path" 2>/dev/null; then
        if [ ! -e "$real_path" ]; then
            mv "$gemini_path" "$real_path"
        fi
    fi

    if [ ! -e "$real_path" ]; then
        for candidate in "${default_reals[@]}"; do
            if [ -x "$candidate" ]; then
                remove_dangling_symlink "$real_path"
                ln -s "$candidate" "$real_path"
                break
            fi
        done
    fi

    if [ ! -e "$real_path" ]; then
        warn "gemini CLI was not found; skipping gemini wrapper"
        return 0
    fi

    rm -f "$gemini_path"
    cat > "$gemini_path" <<'EOF'
#!/usr/bin/env bash
# MYAGENTTOOL_GEMINI_PROXY_WRAPPER
set -euo pipefail

wrapper_dir="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
real_gemini="${GEMINI_REAL_BIN:-${wrapper_dir}/gemini-real}"
if [ ! -x "$real_gemini" ]; then
    echo "gemini-real is not executable: $real_gemini" >&2
    exit 127
fi

node_options="${NODE_OPTIONS:-}"
case " $node_options " in
    *" --dns-result-order="*) ;;
    *) node_options="${node_options:+$node_options }--dns-result-order=ipv4first" ;;
esac
export NODE_OPTIONS="$node_options"

proxy_helper="${wrapper_dir}/with-agent-proxy"
if [ -x "$proxy_helper" ] && proxy_url="$("$proxy_helper" --print-url 2>/dev/null)"; then
    export HTTPS_PROXY="$proxy_url"
    export HTTP_PROXY="$proxy_url"
    export ALL_PROXY="$proxy_url"
    export https_proxy="$proxy_url"
    export http_proxy="$proxy_url"
    export all_proxy="$proxy_url"
    export NO_PROXY="localhost,127.0.0.1,::1"
    export no_proxy="$NO_PROXY"
fi

exec "$real_gemini" "$@"
EOF
    chmod 755 "$gemini_path"
}

resolve_write_path() {
    local path="$1"
    local resolved
    if command -v realpath >/dev/null 2>&1; then
        realpath "$path"
        return
    fi
    if command -v readlink >/dev/null 2>&1; then
        if resolved="$(readlink -f "$path" 2>/dev/null)" && [ -n "$resolved" ]; then
            printf '%s\n' "$resolved"
            return
        fi
    fi
    if [ -L "$path" ]; then
        return 1
    fi
    resolved="$(cd "$(dirname "$path")" && pwd -P)/$(basename "$path")"
    printf '%s\n' "$resolved"
}

preserve_file_mode() {
    local source="$1"
    local destination="$2"
    local mode_value
    if chmod --reference="$source" "$destination" 2>/dev/null; then
        return 0
    fi
    mode_value="$(stat -c '%a' "$source" 2>/dev/null || stat -f '%Lp' "$source" 2>/dev/null || true)"
    if [ -n "$mode_value" ]; then
        chmod "$mode_value" "$destination"
    else
        warn "could not preserve mode for $source"
    fi
}

ensure_bashrc_block() {
    if [ ! -e "$bashrc" ]; then
        touch "$bashrc"
    fi

    local write_path
    if ! write_path="$(resolve_write_path "$bashrc")"; then
        die "cannot safely resolve bashrc path: $bashrc"
    fi

    local write_dir
    local write_name
    local tmp
    local status=0
    local path_prefix
    local quoted_path_prefix
    local quoted_proxy_helper
    write_dir="$(dirname "$write_path")"
    write_name="$(basename "$write_path")"
    tmp="$(mktemp "${write_dir}/.${write_name}.agent-proxy.XXXXXX")"

    awk \
        -v start1='# >>> myagenttool proxy init >>>' \
        -v end1='# <<< myagenttool proxy init <<<' \
        -v start2='# >>> claude proxy wrapper >>>' \
        -v end2='# <<< claude proxy wrapper <<<' \
        -v start3='# >>> codex proxy wrapper >>>' \
        -v end3='# <<< codex proxy wrapper <<<' '
            function flush_blanks(    i) {
                for (i = 0; i < pending_blanks; i++) print ""
                pending_blanks = 0
            }
            $0 == start1 || $0 == start2 || $0 == start3 {
                if (!skip && pending_blanks > 0) pending_blanks--
                flush_blanks()
                skip = 1
                next
            }
            $0 == end1 || $0 == end2 || $0 == end3 { skip = 0; next }
            skip { next }
            $0 == "" { pending_blanks++; next }
            { flush_blanks(); print }
            END { if (skip) exit 2; flush_blanks() }
        ' "$bashrc" > "$tmp" || status="$?"

    case "$status" in
        0) ;;
        2)
            rm -f "$tmp"
            die "unterminated proxy block in $bashrc"
            ;;
        *)
            rm -f "$tmp"
            die "failed to filter proxy blocks in $bashrc (awk status $status)"
            ;;
    esac

    path_prefix="${user_bin_dir}:${bin_dir}"
    printf -v quoted_path_prefix '%q' "$path_prefix"
    printf -v quoted_proxy_helper '%q' "${bin_dir}/with-agent-proxy"

    {
        printf '\n# >>> myagenttool proxy init >>>\n'
        printf 'export PATH=%s:"$PATH"\n' "$quoted_path_prefix"
        cat <<EOF
if [ "\${TERM:-}" = "dumb" ]; then export TERM=xterm-256color; fi

codex() {
    local proxy_url
    local proxy_helper=$quoted_proxy_helper
    if [ -x "\$proxy_helper" ] && proxy_url="\$("\$proxy_helper" --print-url 2>/dev/null)"; then
        HTTPS_PROXY="\$proxy_url" HTTP_PROXY="\$proxy_url" ALL_PROXY="\$proxy_url" \
        https_proxy="\$proxy_url" http_proxy="\$proxy_url" all_proxy="\$proxy_url" \
        NO_PROXY="localhost,127.0.0.1,::1" no_proxy="localhost,127.0.0.1,::1" \
        command codex "\$@"
    else
        command codex "\$@"
    fi
}
# <<< myagenttool proxy init <<<
EOF
    } >> "$tmp" || {
        rm -f "$tmp"
        die "failed to build bashrc update for $bashrc"
    }

    preserve_file_mode "$bashrc" "$tmp"
    if ! backup_file "$bashrc"; then
        rm -f "$tmp"
        die "failed to back up $bashrc"
    fi
    if ! mv "$tmp" "$write_path"; then
        rm -f "$tmp"
        die "failed to replace $bashrc"
    fi
}

install_self_launcher() {
    mkdir -p "$user_bin_dir"
    local script_path
    if command -v realpath >/dev/null 2>&1; then
        script_path="$(realpath "${BASH_SOURCE[0]}")"
    else
        script_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
    fi
    rm -f "${user_bin_dir}/init-agent-proxy"
    ln -s "$script_path" "${user_bin_dir}/init-agent-proxy"
}

report_mihomo() {
    if command -v systemctl >/dev/null 2>&1; then
        local state
        state="$(systemctl is-active mihomo 2>/dev/null || true)"
        [ -n "$state" ] && log "mihomo service: $state"
    fi
    if [ -r /etc/mihomo/config.yaml ]; then
        if grep -qi 'anthropic.com' /etc/mihomo/config.yaml && grep -qi 'claude.ai' /etc/mihomo/config.yaml; then
            log "mihomo rules include anthropic.com and claude.ai"
        else
            warn "mihomo config does not visibly include anthropic.com and claude.ai rules"
        fi
        if grep -qi 'gemini.google.com' /etc/mihomo/config.yaml && grep -qi 'generativelanguage.googleapis.com' /etc/mihomo/config.yaml; then
            log "mihomo rules include gemini.google.com and generativelanguage.googleapis.com"
        else
            warn "mihomo config does not visibly include Gemini rules"
        fi
    fi
}

curl_status() {
    local proxy_url="$1"
    local url="$2"
    curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --connect-timeout 8 --max-time 20 --proxy "$proxy_url" "$url"
}

verify_proxy() {
    report_mihomo
    local proxy_url
    proxy_url="$(pick_proxy_url)" || die "no proxy port is reachable on ${proxy_host}: ${proxy_ports}"
    log "selected proxy: $proxy_url"

    if ! command -v curl >/dev/null 2>&1; then
        die "curl is not installed; cannot verify proxy connectivity"
    fi

    local trace
    if ! trace="$(curl -sS --connect-timeout 8 --max-time 20 --proxy "$proxy_url" https://www.cloudflare.com/cdn-cgi/trace)"; then
        die "Cloudflare trace request failed via $proxy_url"
    fi
    local loc colo
    loc="$(printf '%s\n' "$trace" | awk -F= '$1=="loc"{print $2}')"
    colo="$(printf '%s\n' "$trace" | awk -F= '$1=="colo"{print $2}')"
    if [ -n "$loc" ]; then
        log "proxy region: loc=${loc} colo=${colo:-unknown}"
        if [ "$loc" != "US" ]; then
            warn "proxy exit is not US; Claude availability may still fail"
        fi
    else
        warn "could not read proxy region from Cloudflare trace"
    fi

    local check_name
    local check_url
    local check_result
    while read -r check_name check_url; do
        if ! check_result="$(curl_status "$proxy_url" "$check_url")"; then
            die "$check_name request failed via $proxy_url"
        fi
        log "$check_name via proxy: $check_result"
    done <<'EOF'
google.com https://www.google.com
chatgpt.com https://chatgpt.com
gemini.google.com https://gemini.google.com
aistudio.google.com https://aistudio.google.com
generativelanguage.googleapis.com https://generativelanguage.googleapis.com
api.anthropic.com https://api.anthropic.com
EOF
}

if [ "$mode" = "check" ]; then
    verify_proxy
    exit
fi

log "installing proxy helpers"
prepare_install_dirs
write_with_agent_proxy
install_claude_wrapper
install_codex_wrapper
install_gemini_wrapper
ensure_bashrc_block
install_self_launcher

log "installed: ${bin_dir}/with-agent-proxy"
log "installed: ${bin_dir}/claude"
log "installed: ${bin_dir}/codex"
if [ -x "${bin_dir}/gemini" ]; then
    log "installed: ${bin_dir}/gemini"
fi
log "launcher: ${user_bin_dir}/init-agent-proxy"

if [ "$mode" != "install-only" ]; then
    verify_proxy
fi

log "done. Run: source ~/.bashrc"
