"""
rpi_siren.py — GPIO siren + multi-language voice announcements
==============================================================
Hardware : 5V relay module on GPIO17 → 12V siren/buzzer
           USB Audio adapter → speaker (for voice announcements)

Install  : sudo apt install espeak-ng
           pip install gpiozero RPi.GPIO pyttsx3

GPIO Wiring :
  Relay IN1  →  RPi5 Pin 11 (GPIO17)
  Relay VCC  →  RPi5 Pin  4 (5V)
  Relay GND  →  RPi5 Pin  6 (GND)
  Relay COM  →  12V (+)
  Relay NO   →  Siren (+)
  Siren (-)  →  12V GND

Usage    :
  from rpi_siren import SirenController
  siren = SirenController()
  siren.alert("Road Accident")   # siren + voice in English + Kannada
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
from typing import Optional

log = logging.getLogger("vv.siren")

SIREN_GPIO_PIN  = int(os.environ.get("SIREN_GPIO_PIN", "17"))
SIREN_ENABLED   = os.environ.get("SIREN_ENABLED", "true").lower() == "true"
VOICE_ENABLED   = os.environ.get("VOICE_ENABLED", "true").lower() == "true"
SIREN_DURATION  = int(os.environ.get("SIREN_DURATION_S", "5"))

# Voice announcements: English + Kannada (espeak-ng phonetic)
_ANNOUNCEMENTS: dict[str, dict[str, str]] = {
    "Road Accident": {
        "en": "Attention! Road accident detected. Ambulance has been called. Please clear the area.",
        "kn": "Attention! Anta raste apadatte snehate. Ambulance kareyalagide. Daari bittu iri.",
    },
    "Fire / Smoke": {
        "en": "Warning! Fire detected. Please evacuate immediately. Fire services have been alerted.",
        "kn": "Endari! Belli snehate. Turant Tappe aagu. Daagli seva alertaagide.",
    },
    "Weapon Detected": {
        "en": "Warning! Weapon detected. Police have been alerted. Please remain calm.",
        "kn": "Endari! Ayuda snehate. Police alertaagide. Shaantavagi iri.",
    },
    "Physical Fight": {
        "en": "Warning! Incident detected. Police are on their way. Please move away from the area.",
        "kn": "Endari! Ghatane snehate. Police baruttide. Jagadi inda hogiri.",
    },
    "Vehicle Collision": {
        "en": "Attention! Vehicle collision detected. Emergency services have been notified.",
        "kn": "Attention! Vahana apadatte snehate. Taradi seva alert aagide.",
    },
    "Person Unconscious": {
        "en": "Medical emergency! Unconscious person detected. Ambulance has been called.",
        "kn": "Vaiddakeeya taradi! Nirdhaara manushya snehate. Ambulance kareyalagide.",
    },
    "Suspicious Activity": {
        "en": "Warning! Suspicious activity detected. Police have been alerted. Stay alert.",
        "kn": "Endari! Sandehakara chatuvatige snehate. Police alertaagide. Eetabaannu iru.",
    },
    "default": {
        "en": "Incident detected. Emergency services have been notified. Please cooperate with authorities.",
        "kn": "Ghatane snehate. Taradi seva tilipisalagide. Adhikarikalige sahakariisi.",
    },
}


class SirenController:
    """
    Controls the physical siren relay and text-to-speech announcements.
    All operations are non-blocking (run in background threads).
    """

    def __init__(
        self,
        gpio_pin: int = SIREN_GPIO_PIN,
        siren_enabled: bool = SIREN_ENABLED,
        voice_enabled: bool = VOICE_ENABLED,
    ):
        self._gpio_pin = gpio_pin
        self._siren_enabled = siren_enabled
        self._voice_enabled = voice_enabled
        self._gpio = None
        self._lock = threading.Lock()
        self._active = False
        self._init_gpio()

    def _init_gpio(self):
        """Initialise GPIO relay pin. Silently disabled if not on RPi."""
        if not self._siren_enabled:
            return
        try:
            from gpiozero import OutputDevice
            self._gpio = OutputDevice(self._gpio_pin, active_high=False, initial_value=False)
            log.info("GPIO siren ready on pin %d", self._gpio_pin)
        except Exception as e:
            log.warning("GPIO not available (%s) — siren disabled", e)
            self._siren_enabled = False

    # ── Public API ────────────────────────────────────────────────────────────

    def alert(
        self,
        incident_type: str = "default",
        siren_duration: int = SIREN_DURATION,
        languages: list = None,
    ):
        """
        Trigger siren + voice announcement in background.
        Non-blocking — returns immediately.
        """
        if languages is None:
            languages = ["en", "kn"]

        t = threading.Thread(
            target=self._alert_worker,
            args=(incident_type, siren_duration, languages),
            daemon=True,
            name="vv-siren",
        )
        t.start()
        log.info("Siren alert triggered for: %s", incident_type)

    def sound_siren_only(self, duration_s: int = 5):
        """Activate siren relay without voice."""
        threading.Thread(
            target=self._pulse_siren,
            args=(duration_s,),
            daemon=True,
        ).start()

    def speak(self, text: str, language: str = "en"):
        """Speak text via espeak-ng. Blocking call."""
        if not self._voice_enabled:
            log.debug("[MOCK VOICE] %s", text[:60])
            return
        try:
            lang_code = "kn" if language == "kn" else "en"
            subprocess.run(
                ["espeak-ng", "-v", lang_code, "-s", "140", "-a", "200", text],
                timeout=30,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except FileNotFoundError:
            # espeak-ng not installed — try pyttsx3
            self._speak_pyttsx3(text)
        except Exception as e:
            log.error("espeak error: %s", e)

    def stop(self):
        """Immediately silence the siren."""
        if self._gpio:
            self._gpio.off()
        self._active = False
        log.info("Siren stopped")

    def is_active(self) -> bool:
        return self._active

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _alert_worker(self, incident_type: str, siren_duration: int, languages: list):
        with self._lock:
            self._active = True
            try:
                # 1. Sound siren
                self._pulse_siren(siren_duration)

                # 2. Voice announcements in each language
                msgs = _ANNOUNCEMENTS.get(incident_type, _ANNOUNCEMENTS["default"])
                for lang in languages:
                    msg = msgs.get(lang)
                    if msg:
                        self.speak(msg, language=lang)
                        time.sleep(0.5)   # brief pause between languages
            finally:
                self._active = False

    def _pulse_siren(self, duration_s: int):
        """Activate relay for duration_s seconds."""
        if self._gpio:
            try:
                self._gpio.on()
                time.sleep(duration_s)
                self._gpio.off()
            except Exception as e:
                log.error("GPIO siren pulse error: %s", e)
        else:
            log.info("[MOCK SIREN] ON for %ds", duration_s)
            time.sleep(min(duration_s, 1))   # Don't block long in mock mode

    def _speak_pyttsx3(self, text: str):
        try:
            import pyttsx3
            engine = pyttsx3.init()
            engine.setProperty("rate", 140)
            engine.setProperty("volume", 1.0)
            engine.say(text)
            engine.runAndWait()
        except Exception as e:
            log.error("pyttsx3 error: %s", e)


# ── Module-level singleton ─────────────────────────────────────────────────────
_controller: Optional[SirenController] = None


def get_siren() -> SirenController:
    global _controller
    if _controller is None:
        _controller = SirenController()
    return _controller


def sound_alert(incident_type: str = "default", duration_s: int = 5):
    """Convenience one-liner used by rpi_edge_manager."""
    get_siren().alert(incident_type, siren_duration=duration_s)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ctrl = SirenController()
    print("Testing siren + voice for 'Road Accident'…")
    ctrl.alert("Road Accident", siren_duration=3)
    time.sleep(15)
    print("Done")
