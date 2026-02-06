import * as https from "https";
import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import express from "express";
import cors from "cors";
import ffmpeg from "fluent-ffmpeg";
import { WebSocketServer, WebSocket } from "ws";

const sovitsSettings = {
    text_lang: "en",
    ref_audio_path: path.resolve("main_sample.wav"),
    prompt_text: "This is a sample voice for you to just get started with because it sounds kind of cute, but just make sure this doesn't have long silences.",
    prompt_lang: "en"
};

const whisper = child_process.spawn("/app/whisper/build/bin/whisper-server", ["-m", "/app/whisper/models/ggml-base.bin", "--port", "8081"]);
whisper.stdout.pipe(process.stdout);
whisper.stderr.pipe(process.stderr);

const ollama = child_process.spawn("/cache/ollama/bin/ollama", ["serve"], { env: { HOME: "/home", OLLAMA_MODELS: "/cache/ollama-models" } });
ollama.stdout.pipe(process.stdout);
ollama.stderr.pipe(process.stderr);
const ollamaStarting = async (data: Buffer) => {
    if (!data.toString().includes("Listening on")) return;
    ollama.stderr.off("data", ollamaStarting);
    await fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "llama3.1",
            messages: [{ role: "user", content: "Hello" }]
        })
    });
    console.log("Ollama started!");
};
ollama.stderr.on("data", ollamaStarting);

const sovits = child_process.spawn("python3", ["api_v2.py"], { cwd: "/workspace/GPT-SoVITS" });
sovits.stdout.pipe(process.stdout);
sovits.stderr.pipe(process.stderr);
const sovitsStarting = async (data: Buffer) => {
    if (!data.toString().includes("Uvicorn running on")) return;
    sovits.stderr.off("data", sovitsStarting);
    await fetch("http://127.0.0.1:9880/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello!", ...sovitsSettings })
    });
    console.log("SoVITS started!");
};
sovits.stderr.on("data", sovitsStarting);

const app = express();
app.use(cors());
app.use(express.static("/app/front/build"));

const conversationHistory: { role: string, content: string }[] = [
    { role: "system", content: "Please be concise and do quick replies that will be read aloud." }
];

const run = async (input: Buffer, ws: WebSocket) => {
    console.time("ffmpeg");
    const inputPath = path.join(__dirname, `temp_${Date.now()}.mp3`);
    const outputPath = path.join(__dirname, `temp_${Date.now()}.wav`);
    fs.writeFileSync(inputPath, input);
    await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
            .toFormat("wav")
            .audioFrequency(16000)
            .audioChannels(1)
            .on("end", () => resolve())
            .on("error", (err) => reject(err))
            .save(outputPath);
    });
    const wavBuffer = fs.readFileSync(outputPath);
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
    console.timeEnd("ffmpeg");

    console.time("transcription");
    const form = new FormData();
    form.append("file", new Blob([wavBuffer]), "audio.wav");
    form.append("language", "en");
    const whisper = await fetch("http://127.0.0.1:8081/inference", {
        method: "POST",
        body: form
    });
    const whisperResult = await whisper.json();
    console.timeEnd("transcription");

    ws.send(JSON.stringify({ type: "transcription", text: whisperResult.text }));

    conversationHistory.push({ role: "user", content: whisperResult.text });

    console.time("ollama");
    const ollama = await fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "llama3.1",
            messages: conversationHistory,
            stream: true
        })
    });

    let response = "";
    let currentSentence = "";
    let buffer = "";
    const reader = ollama.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const chunk = JSON.parse(line);
                const content = chunk.message?.content || "";
                if (!content) continue;

                response += content;
                currentSentence += content;

                if (/[.!?]/.test(content)) {
                    console.timeEnd("ollama");
                    console.log("Phrase complète:", currentSentence.trim());
                    const sentence = currentSentence.trim();
                    currentSentence = "";

                    ws.send(JSON.stringify({ type: "sentence", text: sentence }));

                    console.time("sovits");
                    const sovits = await fetch("http://127.0.0.1:9880/tts", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ text: sentence, ...sovitsSettings })
                    });
                    if (!sovits.ok) {
                        console.error("SoVITS error:", await sovits.text());
                        continue;
                    }
                    const audioBuffer = await sovits.arrayBuffer();
                    console.timeEnd("sovits");

                    ws.send(Buffer.from(audioBuffer));
                }
            } catch (e) {
                console.error("Error parsing JSON:", e);
            }
        }
    }

    conversationHistory.push({ role: "assistant", content: response });

    ws.send(JSON.stringify({ done: true }));
};

const server = https.createServer({ key: fs.readFileSync("server.key"), cert: fs.readFileSync("server.cert") }, app);

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
    console.log("WebSocket client connected");

    ws.on("message", (message) => {
        run(Buffer.from(message as ArrayBuffer), ws);
    });

    ws.on("close", () => {
        console.log("WebSocket client disconnected");
    });
});

server.listen(4433, () => console.log("Server running on port 4433"));
