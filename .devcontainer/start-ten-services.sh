#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
task_dir="$repo_root/ai_agents/agents/examples/voice-assistant"

# Avoid starting duplicate services if the lifecycle hook runs more than once.
if pgrep -f '^task --taskfile Taskfile.yml run$' >/dev/null 2>&1; then
  exit 0
fi
if curl -fsS --max-time 2 http://127.0.0.1:3000/companion >/dev/null \
  && curl -fsS --max-time 2 http://127.0.0.1:8080/ >/dev/null; then
  exit 0
fi

cd "$task_dir"
export PWD="$task_dir"
nohup task --taskfile Taskfile.yml run \
  >/tmp/ten-voice-services.log 2>&1 </dev/null &
