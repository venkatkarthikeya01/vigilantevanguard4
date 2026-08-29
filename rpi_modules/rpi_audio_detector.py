"""
rpi_audio_detector.py — Gunshot / Scream / Explosion audio detection
=====================================================================
Model    : YAMNet (Google AudioSet) — runs on Hailo-8L NPU or CPU
           pip install tensorflow-hub sounddevice numpy scipy

Hardware : USB microphone (any USB audio device)
           sudo apt install portaudio19-dev
           pip install sounddevice soundfile

Usage    :
  from rpi_audio_detector import AudioDetector
  det = AudioDetector()
  det.start(callback=my_callback)
  # callback called with: {"event": "gunshot", "confidence": 0.87, "timestamp": ...}
"""

from __future__ import annotations

import collections
import logging
import queue
import threading
import time
from dataclasses import dataclass
from typing import Callable, List, Optional

import numpy as np

log = logging.getLogger("vv.audio")

SAMPLE_RATE      = 16000     # YAMNet requires 16 kHz
WINDOW_S         = 0.96      # YAMNet analysis window (960ms)
OVERLAP_S        = 0.48      # 50% overlap
CHUNK_FRAMES     = int(SAMPLE_RATE * WINDOW_S)
HOP_FRAMES       = int(SAMPLE_RATE * OVERLAP_S)
MIN_CONFIDENCE   = 0.65      # minimum score to fire callback

# YAMNet class indices we care about (from AudioSet ontology)
# Full list: https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/yamnet_class_map.csv
ALERT_CLASSES = {
    # (yamnet_class_index, label, vv_incident_type)
    427: ("Gunshot, gunfire",       "Weapon Detected"),
    396: ("Explosion",              "Fire / Smoke"),
    397: ("Boom",                   "Fire / Smoke"),
    48:  ("Screaming",              "Physical Fight"),
    423: ("Glass breaking",         "Theft / Robbery"),
    17:  ("Car alarm",              "Suspicious Activity"),
    300: ("Fire alarm",             "Fire / Smoke"),
    301: ("Smoke detector",         "Fire / Smoke"),
    302: ("Carbon monoxide alarm",  "Fire / Smoke"),
}

@dataclass
class AudioEvent:
    yamnet_class: int
    label: str
    incident_type: str
    confidence: float
    timestamp: float
    audio_snippet_db: float     # RMS dB of the window


class AudioDetector:
    """
    Continuously analyses microphone input using YAMNet.
    On detection, calls the registered callback in a separate thread.
    """

    def __init__(
        self,
        device_index: Optional[int] = None,   # None = system default mic
        min_confidence: float = MIN_CONFIDENCE,
    ):
        self._device_index = device_index
        self._min_confidence = min_confidence
        self._callback: Optional[Callable] = None
        self._running = False
        self._audio_q: queue.Queue = queue.Queue(maxsize=20)
        self._model = None
        self._class_map = None
        self._thread: Optional[threading.Thread] = None
        self._capture_thread: Optional[threading.Thread] = None
        self._cooldowns: dict = {}   # label → last_fire_time

    def start(self, callback: Callable[[AudioEvent], None] = None):
        """Start audio capture and analysis. callback called on each detection."""
        self._callback = callback
        self._running = True
        self._load_model()
        self._capture_thread = threading.Thread(
            target=self._capture_loop, daemon=True, name="vv-audio-cap"
        )
        self._inference_thread = threading.Thread(
            target=self._inference_loop, daemon=True, name="vv-audio-inf"
        )
        self._capture_thread.start()
        self._inference_thread.start()
        log.info("AudioDetector started")

    def stop(self):
        self._running = False

    # ── Model loading ─────────────────────────────────────────────────────────

    def _load_model(self):
        """Load YAMNet from TensorFlow Hub."""
        try:
            import tensorflow_hub as hub
            import tensorflow as tf
            self._model = hub.load("https://tfhub.dev/google/yamnet/1")
            log.info("YAMNet loaded from TF Hub")
        except Exception as e:
            log.warning("TF Hub YAMNet unavailable (%s) — trying local tflite", e)
            self._load_tflite()

    def _load_tflite(self):
        """Load local YAMNet TFLite model (for offline/Hailo use)."""
        try:
            import tflite_runtime.interpreter as tflite
            model_path = os.path.join(
                os.path.dirname(__file__), "models", "yamnet.tflite"
            )
            if not os.path.exists(model_path):
                log.warning("YAMNet tflite not found at %s — audio detection disabled", model_path)
                return
            self._model = tflite.Interpreter(model_path=model_path)
            self._model.allocate_tensors()
            self._model_type = "tflite"
            log.info("YAMNet tflite loaded from %s", model_path)
        except Exception as e:
            log.error("Cannot load YAMNet: %s — audio detection disabled", e)

    # ── Audio capture ─────────────────────────────────────────────────────────

    def _capture_loop(self):
        """Read microphone in chunks and push to inference queue."""
        try:
            import sounddevice as sd
            buf = np.zeros(CHUNK_FRAMES, dtype=np.float32)
            ring = collections.deque(maxlen=CHUNK_FRAMES)
            hop_count = 0
            log.info("Microphone capture started (device=%s)", self._device_index)

            def audio_callback(indata, frames, time_info, status):
                # indata shape: (frames, channels)
                mono = indata[:, 0] if indata.ndim > 1 else indata.flatten()
                ring.extend(mono)
                nonlocal hop_count
                hop_count += len(mono)
                if hop_count >= HOP_FRAMES and len(ring) >= CHUNK_FRAMES:
                    chunk = np.array(list(ring)[-CHUNK_FRAMES:], dtype=np.float32)
                    try:
                        self._audio_q.put_nowait(chunk)
                    except queue.Full:
                        pass
                    hop_count = 0

            with sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype="float32",
                device=self._device_index,
                callback=audio_callback,
                blocksize=HOP_FRAMES,
            ):
                while self._running:
                    time.sleep(0.1)
        except ImportError:
            log.error("sounddevice not installed — audio detection disabled")
        except Exception as e:
            log.error("Audio capture error: %s", e)

    # ── Inference ─────────────────────────────────────────────────────────────

    def _inference_loop(self):
        """Pull audio chunks from queue and run YAMNet inference."""
        while self._running:
            try:
                chunk = self._audio_q.get(timeout=1.0)
                if self._model is not None:
                    self._analyse(chunk)
            except queue.Empty:
                continue
            except Exception as e:
                log.error("Inference error: %s", e)

    def _analyse(self, waveform: np.ndarray):
        """Run YAMNet on one window and check for alert classes."""
        try:
            rms_db = float(20 * np.log10(np.sqrt(np.mean(waveform ** 2)) + 1e-9))

            # Skip very quiet audio (background noise)
            if rms_db < -40:
                return

            scores = self._run_model(waveform)
            if scores is None:
                return

            for class_idx, (label, incident_type) in ALERT_CLASSES.items():
                if class_idx >= len(scores):
                    continue
                confidence = float(scores[class_idx])
                if confidence >= self._min_confidence:
                    # Cooldown: don't fire same label more than once per 30s
                    last = self._cooldowns.get(label, 0)
                    if time.time() - last < 30:
                        continue
                    self._cooldowns[label] = time.time()

                    event = AudioEvent(
                        yamnet_class=class_idx,
                        label=label,
                        incident_type=incident_type,
                        confidence=round(confidence, 3),
                        timestamp=time.time(),
                        audio_snippet_db=round(rms_db, 1),
                    )
                    log.warning("AUDIO EVENT: %s (%.1f%%) rms=%.1fdB",
                                label, confidence * 100, rms_db)
                    if self._callback:
                        threading.Thread(
                            target=self._callback, args=(event,), daemon=True
                        ).start()
        except Exception as e:
            log.error("Analysis error: %s", e)

    def _run_model(self, waveform: np.ndarray) -> Optional[np.ndarray]:
        """Run inference and return per-class scores array."""
        try:
            import tensorflow as tf
            scores, embeddings, log_mel = self._model(waveform)
            return np.mean(scores.numpy(), axis=0)   # mean over frames
        except Exception:
            pass
        # TFLite fallback
        try:
            inp = self._model.get_input_details()[0]
            out = self._model.get_output_details()[0]
            self._model.set_tensor(inp["index"], waveform.reshape(1, -1))
            self._model.invoke()
            return self._model.get_tensor(out["index"])[0]
        except Exception as e:
            log.debug("Model inference failed: %s", e)
        return None


# ── Module-level singleton ─────────────────────────────────────────────────────
import os
_detector: Optional[AudioDetector] = None


def get_audio_detector() -> AudioDetector:
    global _detector
    if _detector is None:
        _detector = AudioDetector()
    return _detector


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)

    def on_event(event: AudioEvent):
        print(f"🔊 AUDIO ALERT: {event.label} ({event.confidence:.1%}) → {event.incident_type}")

    det = AudioDetector()
    det.start(callback=on_event)
    print("Listening for gunshots/screams/explosions… (Ctrl+C to stop)")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        det.stop()
        print("Stopped")
