#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VOICE_DIR="$REPO_ROOT/ai_agents/agents/examples/voice-assistant"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/ten/codespaces"
LOG_DIR="$STATE_DIR/logs"
PID_DIR="$STATE_DIR/pids"

mkdir -p "$LOG_DIR" "$PID_DIR"
chmod 700 "$STATE_DIR" "$LOG_DIR" "$PID_DIR"

say() {
  printf 'TEN: %s\n' "$1"
}

fail() {
  printf 'TEN startup failed: %s\n' "$1" >&2
  exit 1
}

run_task() {
  (cd -- "$VOICE_DIR" && task --silent "$@")
}

check_install() {
  run_task check-install >/dev/null 2>&1
}

install_dependencies() {
  say "restoring voice, frontend, and API dependencies"
  run_task install
  check_install || fail "the dependency install did not produce all required runtime files"
  say "dependencies are ready"
}

url_is_ready() {
  curl --fail --silent --show-error --max-time 2 --output /dev/null "$1" 2>/dev/null
}

start_service() {
  local name=$1
  local task_name=$2
  local url=$3
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"
  local pid=""

  if url_is_ready "$url"; then
    return 0
  fi

  if [[ -f "$pid_file" ]]; then
    read -r pid < "$pid_file" || true
  fi

  if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_file"
    (
      cd -- "$VOICE_DIR"
      nohup task --silent "$task_name" >> "$log_file" 2>&1 </dev/null &
      printf '%s\n' "$!" > "$pid_file"
    )
  fi
}

wait_for_services() {
  local attempt
  for ((attempt = 0; attempt < 60; attempt++)); do
    if url_is_ready "http://127.0.0.1:8080/health" \
      && url_is_ready "http://127.0.0.1:3000/" \
      && url_is_ready "http://127.0.0.1:49483/"; then
      say "API and web services are healthy; the voice runtime is installed and ready for API-managed sessions"
      return 0
    fi
    sleep 1
  done

  fail "services did not become healthy; check the private startup logs under $LOG_DIR"
}

case "${1:-start}" in
  install)
    install_dependencies
    ;;
  start)
    if ! check_install; then
      install_dependencies
    fi

    start_service api run-api-server http://127.0.0.1:8080/health
    start_service frontend run-frontend http://127.0.0.1:3000/
    start_service designer run-gd-server http://127.0.0.1:49483/
    wait_for_services
    ;;
  health)
    check_install || fail "required runtime files are missing; run the install command"
    url_is_ready "http://127.0.0.1:8080/health" || fail "API is not healthy"
    url_is_ready "http://127.0.0.1:3000/" || fail "frontend is not healthy"
    url_is_ready "http://127.0.0.1:49483/" || fail "designer is not healthy"
    say "API, frontend, designer, and voice runtime prerequisites are healthy"
    ;;
  *)
    fail "usage: start-ten.sh [install|start|health]"
    ;;
esac
