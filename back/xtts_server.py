import torch
from TTS.api import TTS
from flask import Flask, request, send_file
import os
import tempfile

app = Flask(__name__)

print("Loading TTS model...")
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda")
print("Model loaded!")

@app.route("/generate", methods=["POST"])
def generate():
    try:
        text = request.form.get("text")
        language = request.form.get("language", "en")
        speaker_file = request.files.get("speaker_wav")
        
        if not text:
            return {"error": "text is required"}, 400
        if not speaker_file:
            return {"error": "speaker_wav file is required"}, 400
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as speaker_temp:
            speaker_file.save(speaker_temp.name)
            speaker_path = speaker_temp.name
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as output_temp:
            output_path = output_temp.name
        
        tts.tts_to_file(
            text=text,
            speaker_wav=speaker_path,
            language=language,
            file_path=output_path
        )
        
        os.unlink(speaker_path)
        
        return send_file(
            output_path,
            mimetype="audio/wav",
            as_attachment=False,
            download_name="output.wav"
        )
        
    except Exception as e:
        return {"error": str(e)}, 500
    finally:
        if "output_path" in locals() and os.path.exists(output_path):
            try:
                os.unlink(output_path)
            except:
                pass

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
