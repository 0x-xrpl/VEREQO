#!/bin/sh
# Isolated compatible runtime. Existing Ollama service and model files are preserved.
# No model download. Use VEREQO_OLLAMA_ENDPOINT=http://127.0.0.1:11435 with the probe.
set -eu
export OLLAMA_HOST=127.0.0.1:11435
export OLLAMA_KV_CACHE_TYPE=f16
export OLLAMA_FLASH_ATTENTION=false
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_CONTEXT_LENGTH=2048
exec ollama serve
