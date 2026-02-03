#!/bin/bash

if [ ! -d /cache/ollama ]; then
    mkdir -p /cache/ollama
    curl -fsSL https://ollama.com/download/ollama-linux-amd64.tar.zst | tar x -C /cache/ollama --zstd
fi

export PATH="/cache/ollama/bin:$PATH"
export OLLAMA_MODELS="/cache/ollama-models"
ollama serve &
sleep 1
ollama pull llama3.1
pkill -9 ollama

cd /app/back
exec npx tsx index.ts
