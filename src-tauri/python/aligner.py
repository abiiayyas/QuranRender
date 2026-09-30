import sys
import json
import warnings
import whisper_timestamped as whisper

# Suppress warnings to keep stdout clean for JSON parsing
warnings.filterwarnings("ignore")

def align_audio(req_file):
    with open(req_file, 'r') as f:
        req = json.load(f)
    
    audio_path = req['audio_path']
    surah = req['surah']
    ayahs = req['ayahs']
    texts = req['texts']
    
    # Load model (this will download on first run)
    model = whisper.load_model("tiny", device="cpu")
    
    # Load audio
    audio = whisper.load_audio(audio_path)
    
    # In a real forced aligner, we would pass the texts as the initial prompt
    # For whisper_timestamped, we just transcribe and get timestamps.
    # To strictly force align, we'd use `whisper.transcribe(model, audio, language="ar", initial_prompt=" ".join(texts))`
    
    full_text = " ".join(texts)
    result = whisper.transcribe(model, audio, language="ar", initial_prompt=full_text)
    
    out_ayahs = []
    
    # For MVP, we map the output segments back to the ayahs.
    # This is a naive implementation since whisper returns its own segments.
    # A true aligner would map exact words. We'll approximate.
    
    if "segments" in result:
        total_duration = result["segments"][-1]["end"] * 1000 if result["segments"] else 0
        
        # We just bundle all words from all segments into one array, then distribute them to ayahs
        all_words = []
        for segment in result["segments"]:
            if "words" in segment:
                for w in segment["words"]:
                    all_words.append({
                        "word": w["text"],
                        "start_ms": int(w["start"] * 1000),
                        "end_ms": int(w["end"] * 1000),
                        "confidence": w.get("confidence", 1.0)
                    })
        
        # Naive distribution (1 ayah = all words, since we are doing MVP)
        # Proper implementation would calculate character matching.
        out_ayahs.append({
            "surah": surah,
            "ayah": ayahs[0] if ayahs else 1,
            "text": texts[0] if texts else "",
            "start_ms": all_words[0]["start_ms"] if all_words else 0,
            "end_ms": all_words[-1]["end_ms"] if all_words else 0,
            "words": all_words
        })
        
        output = {
            "success": True,
            "error_message": None,
            "total_duration_ms": int(total_duration),
            "ayahs": out_ayahs
        }
    else:
        output = {
            "success": False,
            "error_message": "No segments returned",
            "total_duration_ms": 0,
            "ayahs": []
        }
    
    print(json.dumps(output))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    align_audio(sys.argv[1])
