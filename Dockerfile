FROM xxxxrt666/gpt-sovits

RUN apt-get update && apt-get install -y ca-certificates curl gnupg
RUN mkdir -p /etc/apt/keyrings
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
RUN echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
RUN apt-get update && apt-get install -y nodejs

RUN apt-get update && apt-get install -y git cmake build-essential screen
RUN git clone https://github.com/ggml-org/whisper.cpp.git /app/whisper
RUN cd /app/whisper && CC=/usr/bin/gcc CXX=/usr/bin/g++ cmake -B build && cmake --build build -j --config Release
RUN cd /app/whisper && sh ./models/download-ggml-model.sh base

RUN mkdir -p /cache/ollama
RUN curl -fsSL https://ollama.com/download/ollama-linux-amd64.tar.zst | tar x -C /cache/ollama --zstd
RUN screen -dm bash -c "OLLAMA_MODELS=/cache/ollama-models /cache/ollama/bin/ollama serve" && sleep 2 && /cache/ollama/bin/ollama pull llama3.1

COPY back /app/back
COPY front /app/front

RUN cd /app/front && npm install && npm run build
RUN cd /app/back && npm install

RUN rm -rf /workspace/GPT-SoVITS/GPT_SoVITS/pretrained_models && \
  rm -rf /workspace/GPT-SoVITS/GPT_SoVITS/text/G2PWModel && \
  rm -rf /workspace/GPT-SoVITS/tools/asr/models && \
  rm -rf /workspace/GPT-SoVITS/tools/uvr5/uvr5_weights && \
  ln -s /workspace/models/pretrained_models /workspace/GPT-SoVITS/GPT_SoVITS/pretrained_models && \
  ln -s /workspace/models/G2PWModel /workspace/GPT-SoVITS/GPT_SoVITS/text/G2PWModel && \
  ln -s /workspace/models/asr_models /workspace/GPT-SoVITS/tools/asr/models && \
  ln -s /workspace/models/uvr5_weights /workspace/GPT-SoVITS/tools/uvr5/uvr5_weights

WORKDIR /app/back
CMD ["npx", "tsx", "index.ts"]
