import { useEffect, useRef, useState } from "react";

export const VoiceAssistant = () => {
    const [stream, setStream] = useState(null);
    const ws = useRef(null);
    const audioQueue = useRef([]);
    const isPlaying = useRef(false);
    const audioRef = useRef(null);

    useEffect(() => {
        ws.current = new WebSocket("wss://" + window.location.hostname + ":4433");

        ws.current.onopen = () => {
            console.log("WebSocket connected");
        };

        ws.current.onmessage = async (event) => {
            if (typeof event.data === "string") {
                console.log("WebSocket message:", event.data);
                const data = JSON.parse(event.data);
                if (data.done) {
                    console.log("Voice assistant request completed");
                    recording.current = false;
                }
                return;
            }

            const audioBlob = new Blob([event.data], { type: "audio/wav" });
            audioQueue.current.push(audioBlob);
            console.log("Audio chunk received:", event.data.size, "bytes");

            if (!isPlaying.current)
                playNext();
        };

        ws.current.onclose = () => {
            console.log("WebSocket disconnected");
        };

        return () => ws.current?.close();
    }, []);

    const playNext = async () => {
        if (audioQueue.current.length === 0) {
            isPlaying.current = false;
            return;
        }
        isPlaying.current = true;
        const audioBlob = audioQueue.current.shift();
        const url = URL.createObjectURL(audioBlob);
        audioRef.current.src = url;
        audioRef.current.volume = 0.2;

        audioRef.current.onended = () => {
            URL.revokeObjectURL(url);
            playNext();
        };

        await audioRef.current.play();
    };

    useEffect(() => {
        (async () => {
            setStream(await navigator.mediaDevices.getUserMedia({ audio: true }));
            console.log("Audio stream started");
        })();
    }, []);

    const recorders = useRef([]);
    const recording = useRef(false);
    useEffect(() => {
        if (!stream) return;

        const interval = setInterval(() => {
            if (recording.current) return;

            const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
            const data = [];
            recorder.ondataavailable = (event) => data.push(event.data);
            recorder.start(100);

            if (recorders.current.length === 2)
                recorders.current.shift().recorder.stop();
            recorders.current.push({ recorder, data });
        }, 1000);

        return () => clearInterval(interval);
    }, [stream]);

    /*const lastNoise = useRef(0);
    useEffect(() => {
        if (!stream) return;

        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        audioContext.createMediaStreamSource(stream).connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const checkVolume = () => {
            analyser.getByteFrequencyData(dataArray);

            const sum = dataArray.reduce((acc, value) => acc + value * value, 0);
            const rms = Math.sqrt(sum / dataArray.length);
            const db = 20 * Math.log10(rms / 255);

            if (db > -16) lastNoise.current = Date.now();
        };

        const interval = setInterval(checkVolume, 50);
        return () => {
            clearInterval(interval);
            audioContext.close();
        };
    }, [stream]);*/

    const handleRun = async () => {
        console.log("Keyword detected, waiting for silence...");
        recording.current = true;

        await new Promise((resolve) => setTimeout(resolve, 1000));

        /*await new Promise((resolve) => {
            const interval = setInterval(() => {
                if (lastNoise.current < Date.now() - 250) {
                    clearInterval(interval);
                    resolve();
                }
            }, 20);
        });*/

        let silenceStart = null;
        await waitFor(stream, (db) => {
            if (db > -16) silenceStart = null;
            else if (!silenceStart) silenceStart = Date.now();
            else if (Date.now() - silenceStart > 250) return true;
            return false;
        });

        console.log("Silence detected, sending voice assistant request...");

        const blob = new Blob(recorders.current[0].data, { type: "audio/webm" });
        const arrayBuffer = await blob.arrayBuffer();
        ws.current.send(arrayBuffer);
    };

    return <>
        <audio ref={audioRef} controls />

        <button onClick={handleRun}>Start Recording</button>
    </>;
};

const waitFor = (stream, condition, timeout = null) => new Promise((resolve, reject) => {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioContext.createMediaStreamSource(stream).connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const checkVolume = () => {
        analyser.getByteFrequencyData(dataArray);

        const sum = dataArray.reduce((acc, value) => acc + value * value, 0);
        const rms = Math.sqrt(sum / dataArray.length);
        const db = 20 * Math.log10(rms / 255);

        if (condition(db)) {
            clearInterval(interval);
            if (timeoutId) clearTimeout(timeoutId);
            audioContext.close();
            resolve();
        }
    };

    let timeoutId = null;
    if (timeout) {
        timeoutId = setTimeout(() => {
            clearInterval(interval);
            audioContext.close();
            reject();
        }, timeout);
    }

    const interval = setInterval(checkVolume, 20);
});
