#!/usr/bin/env python3
"""Diarized prosody metrics for one sampled call wav.

Usage (inside scripts/mine/audio/.venv):  python analyze.py <id>   or  --all
Output: ../work/audio/<id>.metrics.json
Pure-math helpers (wpm, pause_ratio, semitone_std, group_spans) are import-safe
without heavy deps so tests run on system python.
"""
import json, math, sys
from pathlib import Path

WORK = Path(__file__).resolve().parents[1] / "work"
AUDIO = WORK / "audio"
FIRST_WINDOW_S = 60.0   # counsellor = dominant speaker of the first minute
SPAN_GAP_S = 0.4   # tight: turn-taking pauses must split spans or diarization mixes speakers


# ---------- pure math (unit-tested, no heavy imports) ----------

def wpm(words, speech_seconds):
    return 0.0 if speech_seconds <= 0 else words / (speech_seconds / 60.0)


def group_spans(word_list, gap=SPAN_GAP_S):
    spans = []
    for w in word_list:
        if spans and w["start"] - spans[-1]["end"] <= gap:
            spans[-1]["end"] = w["end"]
            spans[-1]["words"] += 1
        else:
            spans.append({"start": w["start"], "end": w["end"], "words": 1})
    return spans


def pause_ratio(spans, total_seconds):
    if total_seconds <= 0:
        return 0.0
    speech = sum(s["end"] - s["start"] for s in spans)
    return max(0.0, min(1.0, (total_seconds - speech) / total_seconds))


def semitone_std(f0_values):
    vals = [v for v in f0_values if v and v > 0]
    if len(vals) < 2:
        return 0.0
    ref = sum(vals) / len(vals)
    semis = [12.0 * math.log2(v / ref) for v in vals]
    mean = sum(semis) / len(semis)
    return math.sqrt(sum((s - mean) ** 2 for s in semis) / len(semis))


# ---------- heavy pipeline ----------

def transcribe(wav_path):
    from faster_whisper import WhisperModel
    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(str(wav_path), word_timestamps=True, language="en")
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"start": w.start, "end": w.end, "word": w.word})
    return words


def embed_spans(y, sr, spans):
    """One voice embedding per span; resemblyzer if available, else MFCC means."""
    import numpy as np
    clips = []
    for s in spans:
        a, b = int(s["start"] * sr), int(s["end"] * sr)
        clips.append(y[a:b] if b > a else y[a:a + sr])
    try:
        from resemblyzer import VoiceEncoder
        enc = VoiceEncoder()
        return np.array([enc.embed_utterance(c.astype("float32")) for c in clips])
    except ImportError:
        import librosa
        return np.array([librosa.feature.mfcc(y=c.astype("float32"), sr=sr, n_mfcc=20).mean(axis=1)
                         for c in clips])


def diarize(y, sr, spans):
    """Label each span 0/1; speaker dominating the first minute = counsellor."""
    import numpy as np
    from sklearn.cluster import AgglomerativeClustering
    if len(spans) < 4:
        return [0] * len(spans), 0
    emb = embed_spans(y, sr, spans)
    labels = AgglomerativeClustering(n_clusters=2).fit_predict(emb)
    early = {0: 0.0, 1: 0.0}
    for s, lab in zip(spans, labels):
        if s["start"] < FIRST_WINDOW_S:
            early[int(lab)] += min(s["end"], FIRST_WINDOW_S) - s["start"]
    counsellor = 0 if early[0] >= early[1] else 1
    return [int(l) for l in labels], counsellor


def speaker_metrics(y, sr, spans, total_seconds):
    import librosa
    import numpy as np
    words = sum(s["words"] for s in spans)
    speech = sum(s["end"] - s["start"] for s in spans)
    f0_all, rms_all = [], []
    for s in spans:
        a, b = int(s["start"] * sr), int(s["end"] * sr)
        clip = y[a:b]
        if len(clip) < sr // 2:
            continue
        f0, _, _ = librosa.pyin(clip.astype("float32"), sr=sr,
                                fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C6"))
        f0_all.extend([float(v) for v in f0 if v == v])  # drop NaN
        rms_all.extend(librosa.feature.rms(y=clip.astype("float32"))[0].tolist())
    rms = np.array(rms_all) if rms_all else np.array([0.0])
    return {
        "wpm": round(wpm(words, speech), 1),
        "talkRatio": round(speech / total_seconds, 3) if total_seconds else 0.0,
        "pauseRatio": round(pause_ratio(spans, total_seconds), 3),
        "pitchVarSemitones": round(semitone_std(f0_all), 2),
        "energyCv": round(float(rms.std() / rms.mean()), 3) if rms.mean() > 0 else 0.0,
        "speechSeconds": round(speech, 1),
    }


def analyze_one(call_id):
    import librosa
    wav = AUDIO / f"{call_id}.wav"
    y, sr = librosa.load(str(wav), sr=16000, mono=True)
    total = len(y) / sr
    words = transcribe(wav)
    spans = group_spans(words)
    labels, counsellor = diarize(y, sr, spans)
    by_speaker = {"counsellor": [], "student": []}
    for s, lab in zip(spans, labels):
        by_speaker["counsellor" if lab == counsellor else "student"].append(s)
    metrics = {
        "id": call_id,
        "totalSeconds": round(total, 1),
        "counsellor": speaker_metrics(y, sr, by_speaker["counsellor"], total),
        "student": speaker_metrics(y, sr, by_speaker["student"], total),
        "diarizationSpans": len(spans),
    }
    out = AUDIO / f"{call_id}.metrics.json"
    out.write_text(json.dumps(metrics, indent=2))
    print("wrote", out.name)


def main():
    if "--all" in sys.argv:
        sample = json.loads((WORK / "audio-sample.json").read_text())
        for s in sample:
            if (AUDIO / f"{s['id']}.wav").exists() and not (AUDIO / f"{s['id']}.metrics.json").exists():
                try:
                    analyze_one(s["id"])
                except Exception as e:  # noqa: BLE001 - skip bad files, keep the batch going
                    print("FAIL", s["id"], e)
    else:
        analyze_one(sys.argv[1])


if __name__ == "__main__":
    main()
