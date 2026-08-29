"""
rpi_injury_triage.py — YOLOv8-pose victim triage (T1/T2/T3)
============================================================
Uses YOLOv8n-pose to detect human body keypoints in accident frames.
Classifies each detected person as:
  T1 (Immediate)  — unconscious / not moving / lying flat
  T2 (Delayed)    — sitting, limited movement
  T3 (Minor)      — standing, moving independently

Also estimates victim count for ambulance dispatch.

Install  : pip install ultralytics opencv-python-headless

Usage    :
  from rpi_injury_triage import InjuryTriager
  triager = InjuryTriager()
  result = triager.triage_frame(jpeg_bytes)
  # → {"victim_count": 2, "triage_code": "T1",
  #    "persons": [{"id":0,"code":"T1","posture":"lying"},
  #                {"id":1,"code":"T2","posture":"sitting"}]}
"""

from __future__ import annotations

import logging
import os
import tempfile
from dataclasses import dataclass
from typing import List, Optional

import numpy as np

log = logging.getLogger("vv.triage")

POSE_MODEL_PATH = os.environ.get("POSE_MODEL_PATH", "yolov8n-pose.pt")
CONF_THRESHOLD  = float(os.environ.get("TRIAGE_CONF", "0.40"))


@dataclass
class PersonTriage:
    person_id:   int
    triage_code: str     # "T1" | "T2" | "T3"
    posture:     str     # "lying" | "sitting" | "standing" | "unknown"
    confidence:  float
    bbox:        list    # [x1, y1, x2, y2]


@dataclass
class TriageResult:
    victim_count:   int
    triage_code:    str      # worst-case triage across all persons
    persons:        List[PersonTriage]
    analysis_notes: str

    def to_dict(self) -> dict:
        return {
            "victim_count":   self.victim_count,
            "triage_code":    self.triage_code,
            "persons":        [
                {"id": p.person_id, "code": p.triage_code,
                 "posture": p.posture, "confidence": p.confidence}
                for p in self.persons
            ],
            "analysis_notes": self.analysis_notes,
        }


class InjuryTriager:
    """Estimates victim count and triage code from accident frame."""

    def __init__(self, model_path: str = POSE_MODEL_PATH):
        self._model = None
        self._model_path = model_path
        self._load_model()

    def _load_model(self):
        try:
            from ultralytics import YOLO
            self._model = YOLO(self._model_path)
            log.info("YOLOv8-pose loaded: %s", self._model_path)
        except Exception as e:
            log.warning("YOLOv8-pose not available (%s) — using fallback triage", e)

    # ── Public API ────────────────────────────────────────────────────────────

    def triage_frame(self, jpeg_bytes: bytes) -> TriageResult:
        """Run pose estimation on a JPEG frame and return triage result."""
        if self._model is None:
            return self._fallback_triage(jpeg_bytes)

        try:
            import cv2
            arr = np.frombuffer(jpeg_bytes, np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is None:
                return self._empty_result()
            return self._analyse_frame(frame)
        except Exception as e:
            log.error("Triage analysis error: %s", e)
            return self._empty_result()

    def triage_file(self, image_path: str) -> TriageResult:
        with open(image_path, "rb") as f:
            return self.triage_frame(f.read())

    # ── Internal analysis ─────────────────────────────────────────────────────

    def _analyse_frame(self, frame) -> TriageResult:
        results = self._model(frame, conf=CONF_THRESHOLD, verbose=False)
        persons = []

        for result in results:
            if result.keypoints is None:
                continue
            kps = result.keypoints.xy.numpy()     # shape: (N_persons, 17, 2)
            boxes = result.boxes.xyxy.numpy() if result.boxes else []
            confs  = result.boxes.conf.numpy()  if result.boxes else []

            for i, (kp, conf) in enumerate(zip(kps, confs)):
                posture, code = self._classify_posture(kp, frame.shape)
                bbox = list(map(float, boxes[i])) if i < len(boxes) else []
                persons.append(PersonTriage(
                    person_id=i, triage_code=code,
                    posture=posture, confidence=float(conf),
                    bbox=bbox,
                ))

        worst = self._worst_triage([p.triage_code for p in persons])
        notes = self._build_notes(persons)
        return TriageResult(
            victim_count=len(persons),
            triage_code=worst,
            persons=persons,
            analysis_notes=notes,
        )

    @staticmethod
    def _classify_posture(keypoints: np.ndarray, frame_shape: tuple) -> tuple:
        """
        Classify posture from 17 COCO keypoints.
        Returns (posture_label, triage_code).
        Keypoints: 0=nose,5=L_shoulder,6=R_shoulder,11=L_hip,12=R_hip,
                   13=L_knee,14=R_knee,15=L_ankle,16=R_ankle
        """
        H, W = frame_shape[:2]
        def valid(idx): return keypoints[idx][0] > 0 and keypoints[idx][1] > 0

        # Check if person is lying (horizontal body axis)
        if valid(5) and valid(6) and valid(11) and valid(12):
            shoulder_y = (keypoints[5][1] + keypoints[6][1]) / 2
            hip_y      = (keypoints[11][1] + keypoints[12][1]) / 2
            shoulder_x = (keypoints[5][0] + keypoints[6][0]) / 2
            hip_x      = (keypoints[11][0] + keypoints[12][0]) / 2
            dy = abs(hip_y - shoulder_y)
            dx = abs(hip_x - shoulder_x)
            # Lying: horizontal extent >> vertical extent
            if dx > dy * 1.5:
                return "lying", "T1"
            # Sitting: hips are low, ankles visible but body not horizontal
            if valid(15) or valid(16):
                ankle_y = max(
                    keypoints[15][1] if valid(15) else 0,
                    keypoints[16][1] if valid(16) else 0,
                )
                if ankle_y > H * 0.5 and dy < H * 0.4:
                    return "sitting", "T2"
            return "standing", "T3"

        # Insufficient keypoints — assume worst case T2
        return "unknown", "T2"

    @staticmethod
    def _worst_triage(codes: List[str]) -> str:
        if not codes: return "T3"
        if "T1" in codes: return "T1"
        if "T2" in codes: return "T2"
        return "T3"

    @staticmethod
    def _build_notes(persons: List[PersonTriage]) -> str:
        if not persons:
            return "No victims detected in frame"
        t1 = sum(1 for p in persons if p.triage_code == "T1")
        t2 = sum(1 for p in persons if p.triage_code == "T2")
        t3 = sum(1 for p in persons if p.triage_code == "T3")
        return (f"{len(persons)} victim(s): T1(immediate)={t1}, "
                f"T2(delayed)={t2}, T3(minor)={t3}")

    @staticmethod
    def _fallback_triage(jpeg_bytes: bytes) -> TriageResult:
        """When no pose model: conservative T2 default."""
        return TriageResult(
            victim_count=1, triage_code="T2",
            persons=[], analysis_notes="Pose model unavailable — T2 assigned by default",
        )

    @staticmethod
    def _empty_result() -> TriageResult:
        return TriageResult(victim_count=0, triage_code="T3", persons=[], analysis_notes="No persons detected")


_triager: Optional[InjuryTriager] = None


def get_triager() -> InjuryTriager:
    global _triager
    if _triager is None:
        _triager = InjuryTriager()
    return _triager


def triage_frame(jpeg_bytes: bytes) -> dict:
    return get_triager().triage_frame(jpeg_bytes).to_dict()
