#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
voice_assistant_dir="$repo_root/ai_agents/agents/examples/voice-assistant"
runtime_dir="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/ten-codespaces-${UID}"
pid_file="$runtime_dir/voice-assistant.pid"

if [[ ! -f "$voice_assistant_dir/Taskfile.yml" ]]; then
  printf '%s\n' "TEN startup failed: voice-assistant Taskfile was not found." >&2
  exit 1
fi

for command in task curl flock readlink tr; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'TEN startup failed: required command "%s" is unavailable.\n' "$command" >&2
    exit 1
  fi
done

umask 077
mkdir -p "$runtime_dir"
chmod 700 "$runtime_dir"
exec 9>"$runtime_dir/start.lock"
flock -x 9

task_run_is_active() {
  local pid command cwd

  [[ -r "$pid_file" ]] || return 1
  IFS= read -r pid < "$pid_file" || true
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  [[ -r "/proc/$pid/cmdline" && -r "/proc/$pid/cwd" ]] || return 1

  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" || return 1
  [[ "$cwd" == "$voice_assistant_dir" ]] || return 1

  command="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)" || return 1
  [[ "$command" == *"task run"* ]]
}

if ! task_run_is_active; then
  rm -f "$pid_file"
  cd "$voice_assistant_dir"
  nohup task run 9>&- >/dev/null 2>&1 </dev/null &
  printf '%s\n' "$!" > "$pid_file"
fi

deadline=$((SECONDS + 180))
while (( SECONDS < deadline )); do
  curl --silent --fail --noproxy '*' --max-time 2 --output /dev/null http://127.0.0.1:3000/ &
  page_check_pid=$!
  curl --silent --fail --noproxy '*' --max-time 2 --output /dev/null http://127.0.0.1:8080/health &
  api_check_pid=$!

  page_ready=0
  api_ready=0
  if wait "$page_check_pid"; then
    page_ready=1
  fi
  if wait "$api_check_pid"; then
    api_ready=1
  fi

  if (( page_ready && api_ready )); then
    printf '%s\n' "TEN companion page and API are ready; Codespaces ports remain private."
    exit 0
  fi

  sleep 1
done

printf '%s\n' "TEN startup timed out: the companion page and API did not both become ready." >&2
exit 1
