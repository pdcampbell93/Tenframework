#!/bin/bash

set -e
umask 077

cd "$(dirname "${BASH_SOURCE[0]}")/.."

#export TEN_ENABLE_PYTHON_DEBUG=true
#export TEN_PYTHON_DEBUG_PORT=5678
# Install the metadata-only Python diagnostic policy before any SDK imports.
export PYTHONPATH="$(pwd)/scripts/privacy:$(pwd)/ten_packages/system/ten_ai_base/interface:${PYTHONPATH:-}"
# SDK debugging can include HTTP authorization headers and response bodies.
unset OPENAI_LOG
unset PYTHONFAULTHANDLER
export LD_LIBRARY_PATH=$(pwd)/ten_packages/system/agora_rtc_sdk/lib:$(pwd)/ten_packages/extension/agora_rtm/lib:$(pwd)/ten_packages/system/azure_speech_sdk/lib
export NODE_PATH=$(pwd)/ten_packages/system/ten_runtime_nodejs/lib:$NODE_PATH

exec bin/main "$@"
