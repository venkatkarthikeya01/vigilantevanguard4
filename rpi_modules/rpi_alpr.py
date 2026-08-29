"""
rpi_alpr.py — Licence Plate Recognition for VigilanteVanguard
==============================================================
Primary  : openalpr  (C++ library with Python bindings)
           sudo apt install openalpr openalpr-daemon openalpr-utils libopenalpr-dev
           pip install openalpr
Fallback : EasyOCR  (pure Python, heavier but no native deps)
           pip install easyocr

Usage    :
  from rpi_alpr import ALPRReader
  alpr = ALPRReader()
  plates = alpr.read_plates_from_bytes(jpeg_bytes)
  # → [{"plate": "KA03MJ1234", "confidence": 91.2, "region": "in"}, ...]

  plates = alpr.read_plates_from_file("/tmp/accident.jpg")
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
import time
from dataclasses import dataclass
from typing import List, Optional

log = logging.getLogger("vv.alpr")

# India-specific plate patterns for post-filter validation
_INDIA_PLATE_RE = re.compile(
    r"^[A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{4}$",  # e.g. KA03MJ1234
    re.IGNORECASE,
)


@dataclass
class PlateResult:
    plate: str              # normalised plate string e.g. "KA03MJ1234"
    confidence: float       # 0.0 – 100.0
    region: str             # "in" for India
    bounding_box: dict      # {"x":..,"y":..,"width":..,"height":..}
    raw: str                # raw string before normalisation


class ALPRReader:
    """
    Licence plate reader.
    Tries openalpr first (GPU-accelerated C++), falls back to EasyOCR.
    """

    def __init__(self, country: str = "in", min_confidence: float = 75.0):
        self._country = country
        self._min_confidence = min_confidence
        self._alpr = None
        self._ocr = None
        self._mode = "none"
        self._init()

    def _init(self):
        # Try openalpr
        try:
            from openalpr import Alpr
            self._alpr = Alpr(
                self._country,
                "/etc/openalpr/openalpr.conf",
                "/usr/share/openalpr/runtime_data",
            )
            self._alpr.set_top_n(5)
            self._alpr.set_default_region("ka")   # Karnataka
            self._mode = "openalpr"
            log.info("ALPR: using openalpr (C++ engine)")
            return
        except Exception as e:
            log.debug("openalpr unavailable: %s", e)

        # Try EasyOCR fallback
        try:
            import easyocr
            self._ocr = easyocr.Reader(["en"], gpu=False, verbose=False)
            self._mode = "easyocr"
            log.info("ALPR: using EasyOCR fallback")
            return
        except Exception as e:
            log.debug("EasyOCR unavailable: %s", e)

        log.warning("ALPR: no engine available — plate recognition disabled")

    # ── Public API ────────────────────────────────────────────────────────────

    def read_plates_from_bytes(self, jpeg_bytes: bytes) -> List[PlateResult]:
        """Read plates from raw JPEG bytes."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            f.write(jpeg_bytes)
            path = f.name
        try:
            return self.read_plates_from_file(path)
        finally:
            try:
                os.unlink(path)
            except Exception:
                pass

    def read_plates_from_file(self, image_path: str) -> List[PlateResult]:
        """Read plates from an image file path."""
        if self._mode == "openalpr":
            return self._read_openalpr(image_path)
        if self._mode == "easyocr":
            return self._read_easyocr(image_path)
        return []

    def read_plates_from_frame(self, frame) -> List[PlateResult]:
        """
        Read plates from an OpenCV numpy frame (BGR uint8).
        Convenient when you already have the frame in memory.
        """
        try:
            import cv2
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
                cv2.imwrite(f.name, frame)
                return self.read_plates_from_file(f.name)
        except Exception as e:
            log.error("Frame ALPR failed: %s", e)
            return []

    def get_mode(self) -> str:
        return self._mode

    # ── Engine implementations ────────────────────────────────────────────────

    def _read_openalpr(self, image_path: str) -> List[PlateResult]:
        try:
            result = self._alpr.recognize_file(image_path)
            plates = []
            for plate in result.get("results", []):
                best = plate["candidates"][0] if plate["candidates"] else None
                if not best:
                    continue
                conf = best["confidence"]
                if conf < self._min_confidence:
                    continue
                raw = best["plate"]
                normalised = self._normalise(raw)
                plates.append(PlateResult(
                    plate=normalised,
                    confidence=conf,
                    region=self._country,
                    bounding_box=plate.get("coordinates", {}),
                    raw=raw,
                ))
            return plates
        except Exception as e:
            log.error("openalpr error: %s", e)
            return []

    def _read_easyocr(self, image_path: str) -> List[PlateResult]:
        """
        EasyOCR fallback: reads all text, then filters for plate-like strings.
        Less accurate than openalpr but works without native deps.
        """
        try:
            import cv2
            import numpy as np

            img = cv2.imread(image_path)
            if img is None:
                return []

            # Pre-process: upscale + sharpen for better OCR
            img = cv2.resize(img, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

            detections = self._ocr.readtext(thresh)
            plates = []
            for (bbox, text, conf) in detections:
                clean = re.sub(r"[^A-Z0-9]", "", text.upper())
                if self._is_plate_like(clean) and conf * 100 >= self._min_confidence:
                    x1 = int(min(p[0] for p in bbox))
                    y1 = int(min(p[1] for p in bbox))
                    x2 = int(max(p[0] for p in bbox))
                    y2 = int(max(p[1] for p in bbox))
                    plates.append(PlateResult(
                        plate=self._normalise(clean),
                        confidence=round(conf * 100, 1),
                        region=self._country,
                        bounding_box={"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1},
                        raw=text,
                    ))
            return plates
        except Exception as e:
            log.error("EasyOCR error: %s", e)
            return []

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _normalise(raw: str) -> str:
        """Remove spaces/dashes, uppercase, return canonical plate."""
        return re.sub(r"[\s\-]", "", raw.upper())

    @staticmethod
    def _is_plate_like(s: str) -> bool:
        """Rough India plate heuristic: 8-10 alphanumeric chars, starts with 2 letters."""
        if len(s) < 7 or len(s) > 12:
            return False
        if not s[:2].isalpha():
            return False
        if not s[2:4].isdigit():
            return False
        return True

    def release(self):
        if self._alpr:
            self._alpr.unload()


# ── Module-level singleton ─────────────────────────────────────────────────────
_reader: Optional[ALPRReader] = None


def get_alpr_reader() -> ALPRReader:
    global _reader
    if _reader is None:
        _reader = ALPRReader()
    return _reader


def read_plates(jpeg_bytes: bytes) -> List[dict]:
    """
    Convenience function. Returns list of dicts:
    [{"plate": "KA03MJ1234", "confidence": 91.2}, ...]
    """
    results = get_alpr_reader().read_plates_from_bytes(jpeg_bytes)
    return [{"plate": r.plate, "confidence": r.confidence, "raw": r.raw} for r in results]


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)
    reader = ALPRReader()
    print("Mode:", reader.get_mode())
    if len(sys.argv) > 1:
        plates = reader.read_plates_from_file(sys.argv[1])
        for p in plates:
            print(f"  {p.plate}  conf={p.confidence:.1f}%  raw='{p.raw}'")
    else:
        print("Usage: python rpi_alpr.py <image_path>")
