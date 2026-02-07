FROM ghcr.io/coqui-ai/tts

RUN apt-get update && apt-get install -y ca-certificates curl gnupg
RUN mkdir -p /etc/apt/keyrings
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
RUN echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
RUN apt-get update && apt-get install -y nodejs

RUN apt-get update && apt-get install -y git cmake build-essential screen zstd
RUN git clone https://github.com/ggml-org/whisper.cpp.git /app/whisper
RUN cd /app/whisper && CC=/usr/bin/gcc CXX=/usr/bin/g++ cmake -B build && cmake --build build -j --config Release
RUN cd /app/whisper && sh ./models/download-ggml-model.sh small

RUN mkdir -p /cache/ollama
RUN curl -fsSL https://ollama.com/download/ollama-linux-amd64.tar.zst | tar x -C /cache/ollama --zstd
RUN screen -dm bash -c "OLLAMA_MODELS=/cache/ollama-models /cache/ollama/bin/ollama serve" && sleep 2 && /cache/ollama/bin/ollama pull llama3.1

RUN apt-get install -y ffmpeg
COPY back/main_sample.wav /app/back/main_sample.wav
RUN export COQUI_TOS_AGREED=1 && tts --model_name tts_models/multilingual/multi-dataset/xtts_v2 --text Hello --speaker_wav /app/back/main_sample.wav --language_idx fr --out_path /app/back/tmp.wav

COPY front /app/front
RUN cd /app/front && npm install && npm run build

COPY back /app/back
RUN cd /app/back && npm install
RUN cd /app/back && openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout server.key -out server.cert -subj "/C=FR/ST=IDF/L=Paris/O=Dev/CN=localhost"

EXPOSE 4433
WORKDIR /app/back
ENTRYPOINT []
CMD ["npx", "tsx", "index.ts"]
