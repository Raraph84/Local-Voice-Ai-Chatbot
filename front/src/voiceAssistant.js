import { useEffect, useRef, useState } from "react";

export const VoiceAssistant = () => {
    const [stream, setStream] = useState(null);
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

        const date = Date.now();

        const response = await fetch("http://localhost:8080/run", {
            method: "POST",
            body: blob
        });

        const reader = response.body.getReader();
        const audioQueue = [];
        let isPlaying = false;
        let buffer = new Uint8Array(0);

        const playNext = async () => {
            if (audioQueue.length === 0) {
                isPlaying = false;
                return;
            }
            isPlaying = true;
            const audioBlob = audioQueue.shift();
            const url = URL.createObjectURL(audioBlob);
            audioRef.current.src = url;
            audioRef.current.volume = 0.2;

            audioRef.current.onended = () => {
                URL.revokeObjectURL(url);
                playNext();
            };

            await audioRef.current.play();
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Ajouter les nouvelles données au buffer
            const newBuffer = new Uint8Array(buffer.length + value.length);
            newBuffer.set(buffer);
            newBuffer.set(value, buffer.length);
            buffer = newBuffer;

            // Convertir en texte pour chercher les boundaries
            const text = new TextDecoder().decode(buffer);
            const boundaryPattern = "--audiobound\r\n";

            let pos = 0;
            while ((pos = text.indexOf(boundaryPattern, pos)) !== -1) {
                const nextBoundary = text.indexOf(boundaryPattern, pos + boundaryPattern.length);

                if (nextBoundary === -1 && !done) {
                    // Pas encore le prochain boundary, attendre plus de données
                    break;
                }

                const endPos = nextBoundary !== -1 ? nextBoundary : text.length;
                const part = text.substring(pos + boundaryPattern.length, endPos);

                const headerEnd = part.indexOf("\r\n\r\n");
                if (headerEnd !== -1) {
                    // Calculer la position des données audio en bytes
                    const audioStartText = pos + boundaryPattern.length + headerEnd + 4;
                    const audioEndText = endPos;

                    // Extraire les bytes audio
                    const audioData = buffer.slice(audioStartText, audioEndText);

                    // Enlever les \r\n à la fin si présents
                    let cleanEnd = audioData.length;
                    if (cleanEnd >= 2 && audioData[cleanEnd - 2] === 13 && audioData[cleanEnd - 1] === 10) {
                        cleanEnd -= 2;
                    }

                    const cleanAudioData = audioData.slice(0, cleanEnd);

                    if (cleanAudioData.length > 0) {
                        const audioBlob = new Blob([cleanAudioData], { type: "audio/wav" });
                        audioQueue.push(audioBlob);
                        console.log("Audio chunk received:", cleanAudioData.length, "bytes", Date.now() - date, "ms");

                        if (!isPlaying) {
                            playNext();
                        }
                    }
                }

                if (nextBoundary !== -1) {
                    // Supprimer la partie traitée du buffer
                    buffer = buffer.slice(nextBoundary);
                    break; // Re-vérifier depuis le début
                } else {
                    buffer = new Uint8Array(0);
                    break;
                }
            }
        }

        console.log("Voice assistant request sent successfully");
        recording.current = false;
    };

    const audioRef = useRef(null);

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
