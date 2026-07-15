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
    local ts
    ts="$(date +%Y%m%d%H%M%S)"
    cp -p "$path" "${path}.bak-agent-proxy-${ts}"
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

    if [ -L "$claude_path" ]; then
        local target
        target="$(readlink "$claude_path")"
        if [ ! -e "$real_path" ]; then
            ln -s "$target" "$real_path"
        fi
    elif [ -x "$claude_path" ] && ! grep -q 'MYAGENTTOOL_CLAUDE_PROXY_WRAPPER' "$claude_path" 2>/dev/null; then
        if [ ! -e "$real_path" ]; then
            mv "$claude_path" "$real_path"
        fi
    fi

    if [ ! -e "$real_path" ] && [ -x "$default_real" ]; then
        ln -s "../lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe" "$real_path"
    fi

    rm -f "$claude_path"
    cat > "$claude_path" <<'EOF'
#!/usr/bin/env bash
# MYAGENTTOOL_CLAUDE_PROXY_WRAPPER
set -euo pipefail

real_claude="${CLAUDE_REAL_BIN:-$HOME/.local/bin/claude-real}"
if [ ! -x "$real_claude" ]; then
    real_claude="$HOME/.local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe"
fi

node_options="${NODE_OPTIONS:-}"
case " $node_options " in
    *" --dns-result-order="*) ;;
    *) node_options="${node_options:+$node_options }--dns-result-order=ipv4first" ;;
esac
export NODE_OPTIONS="$node_options"

proxy_helper="$HOME/.local/bin/with-agent-proxy"
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

    if [ -L "$codex_path" ]; then
        local target
        target="$(readlink "$codex_path")"
        if [ ! -e "$real_path" ]; then
            ln -s "$target" "$real_path"
        fi
    elif [ -x "$codex_path" ] && ! grep -q 'MYAGENTTOOL_CODEX_PROXY_WRAPPER' "$codex_path" 2>/dev/null; then
        if [ ! -e "$real_path" ]; then
            mv "$codex_path" "$real_path"
        fi
    fi

    if [ ! -e "$real_path" ] && [ -x "$default_real" ]; then
        ln -s "../lib/node_modules/@openai/codex/bin/codex.js" "$real_path"
    fi

    rm -f "$codex_path"
    cat > "$codex_path" <<'EOF'
#!/usr/bin/env bash
# MYAGENTTOOL_CODEX_PROXY_WRAPPER
set -euo pipefail

real_codex="${CODEX_REAL_BIN:-$HOME/.local/bin/codex-real}"
if [ ! -x "$real_codex" ]; then
    real_codex="$HOME/.local/lib/node_modules/@openai/codex/bin/codex.js"
fi

node_options="${NODE_OPTIONS:-}"
case " $node_options " in
    *" --dns-result-order="*) ;;
    *) node_options="${node_options:+$node_options }--dns-result-order=ipv4first" ;;
esac
export NODE_OPTIONS="$node_options"

proxy_helper="$HOME/.local/bin/with-agent-proxy"
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

    if [ -L "$gemini_path" ]; then
        target="$(readlink "$gemini_path")"
        if [ ! -e "$real_path" ]; then
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

real_gemini="${GEMINI_REAL_BIN:-$HOME/.local/bin/gemini-real}"
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

proxy_helper="$HOME/.local/bin/with-agent-proxy"
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

remove_marked_block() {
    local path="$1"
    local start="$2"
    local end="$3"
    [ -f "$path" ] || return 0
    local tmp
    local status=0
    tmp="$(mktemp)"
    awk -v start="$start" -v end="$end" '
        $0 == start { skip = 1; changed = 1; next }
        $0 == end { skip = 0; next }
        !skip { print }
        END { if (skip) exit 2; if (!changed) exit 3 }
    ' "$path" > "$tmp" || status="$?"
    if [ "$status" = "2" ]; then
        rm -f "$tmp"
        die "unterminated block in $path: $start"
    fi
    if [ "$status" = "3" ]; then
        rm -f "$tmp"
        return 0
    fi
    backup_file "$path"
    mv "$tmp" "$path"
}

ensure_bashrc_block() {
    touch "$bashrc"
    remove_marked_block "$bashrc" '# >>> myagenttool proxy init >>>' '# <<< myagenttool proxy init <<<'
    remove_marked_block "$bashrc" '# >>> claude proxy wrapper >>>' '# <<< claude proxy wrapper <<<'
    remove_marked_block "$bashrc" '# >>> codex proxy wrapper >>>' '# <<< codex proxy wrapper <<<'
    backup_file "$bashrc"
    cat >> "$bashrc" <<'EOF'

# >>> myagenttool proxy init >>>
export PATH="$HOME/bin:$HOME/.local/bin:$PATH"
if [ "${TERM:-}" = "dumb" ]; then export TERM=xterm-256color; fi

codex() {
    local proxy_url
    if [ -x "$HOME/.local/bin/with-agent-proxy" ] && proxy_url="$("$HOME/.local/bin/with-agent-proxy" --print-url 2>/dev/null)"; then
        HTTPS_PROXY="$proxy_url" HTTP_PROXY="$proxy_url" ALL_PROXY="$proxy_url" \
        https_proxy="$proxy_url" http_proxy="$proxy_url" all_proxy="$proxy_url" \
        NO_PROXY="localhost,127.0.0.1,::1" no_proxy="localhost,127.0.0.1,::1" \
        command codex "$@"
    else
        command codex "$@"
    fi
}
# <<< myagenttool proxy init <<<
EOF
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
        warn "curl is not installed; skipping network checks"
        return 0
    fi

    local trace
    trace="$(curl -sS --connect-timeout 8 --max-time 20 --proxy "$proxy_url" https://www.cloudflare.com/cdn-cgi/trace || true)"
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

    log "google.com via proxy: $(curl_status "$proxy_url" https://www.google.com)"
    log "chatgpt.com via proxy: $(curl_status "$proxy_url" https://chatgpt.com)"
    log "gemini.google.com via proxy: $(curl_status "$proxy_url" https://gemini.google.com)"
    log "aistudio.google.com via proxy: $(curl_status "$proxy_url" https://aistudio.google.com)"
    log "generativelanguage.googleapis.com via proxy: $(curl_status "$proxy_url" https://generativelanguage.googleapis.com)"
    log "api.anthropic.com via proxy: $(curl_status "$proxy_url" https://api.anthropic.com)"
}

if [ "$mode" = "check" ]; then
    verify_proxy
    exit
fi

log "installing proxy helpers"
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
