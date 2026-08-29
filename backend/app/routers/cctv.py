"""
AI Smart CCTV Surveillance & Emergency Dispatch — VigilanteVanguard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This module adds AI-powered incident detection on top of multiple
video sources (webcam, IP-camera, uploaded file, future RTSP feeds).
All Catalyst SDK calls are best-effort / fail-safe.

Architecture is intentionally source-agnostic: the VideoIngestionEngine
accepts a source descriptor; swapping from a demo source to a live RTSP
URL from Karnataka Police CCTV feeds requires only changing the
source_url field in the camera registry — zero architectural change.

AI detection is performed by a rule-based heuristic engine backed by
OpenCV and a lightweight YOLO-style mock model.  When real GPU hardware
is available, replacing _detect_frame() with an actual YOLOv8 call is
a one-function change.

v5.0 additions:
  • Reverse geocoding via Nominatim (no API key, OSM data)
  • Incident heatmap analytics (hourly, by-type, by-severity)
  • Incident CSV/JSON export endpoint
  • Camera health-check endpoint
  • Camera location updated from client Geolocation API
  • Push notification polling endpoint (/notifications/poll)
  • YOLOv8 real-time training hook (ultralytics, when available)
"""

from __future__ import annotations

import asyncio
import base64
import concurrent.futures
import csv
import hashlib
import io
import json
import math
import os
import random
import time
import uuid
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException,
    UploadFile, WebSocket, WebSocketDisconnect,
)
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

# ── Notification store (in-memory) ───────────────────────────────────────────
_NOTIFICATIONS: List[Dict[str, Any]] = []
_NOTIF_COUNTER = 0

# ── httpx for async HTTP (already in requirements) ────────────────
try:
    import httpx
    _HTTPX_OK = True
except ImportError:
    _HTTPX_OK = False
    print("[CCTV] httpx not available — IP camera proxy disabled")

# ── Auth (reuse existing) ─────────────────────────────────────────
try:
    from app.core.auth import verify_catalyst_token, AuthUser
except ImportError:
    AuthUser = Any  # type: ignore
    async def verify_catalyst_token():  # type: ignore
        return None

# ── OpenCV — optional, graceful degradation ──────────────────────
try:
    import cv2
    import numpy as _np_cv
    _CV2_OK = True
except ImportError:
    _CV2_OK = False
    print("[CCTV] OpenCV not installed — running in pure demo mode")

# ── YOLOv8 — optional, real-time inference when ultralytics installed ─
try:
    from ultralytics import YOLO as _YOLO_CLS
    _YOLO_OK = True
    print("[CCTV] ultralytics/YOLOv8 available — real inference enabled")
except ImportError:
    _YOLO_OK = False

_YOLO_MODEL = None   # loaded lazily on first use

# ── Thread-pool for CPU-bound detection (keeps the async event loop free) ────
# One worker per CPU core up to 4 — enough for real-time multi-camera scanning.
_DETECTION_POOL = concurrent.futures.ThreadPoolExecutor(
    max_workers=min(4, (os.cpu_count() or 2)),
    thread_name_prefix="vv-detect",
)

# ── Per-frame feature cache (LRU, keyed by MD5 of JPEG bytes) ────────────────
# Avoids recomputing the 2344-dim feature vector when the same JPEG frame
# arrives twice (e.g. buffer replay on a slow camera).  Cache is bounded at
# 64 entries (~1-2 MB RAM).
@lru_cache(maxsize=64)
def _cached_frame_hash(frame_md5: str, _frame_bytes_dummy: bytes) -> Optional[bytes]:
    """Not called directly — tag is used only as LRU key. See detect_frame_async."""
    return None   # real work done in detect_frame_async

# MD5 → last detection result (None = no incident)
_FRAME_RESULT_CACHE: Dict[str, Optional[Dict[str, Any]]] = {}
_FRAME_RESULT_CACHE_ORDER: List[str] = []
_FRAME_CACHE_MAX = 64

def _get_frame_cache(md5: str) -> tuple[bool, Optional[Dict[str, Any]]]:
    """Return (hit, result). Result may be None (meaning 'no incident detected')."""
    if md5 in _FRAME_RESULT_CACHE:
        return True, _FRAME_RESULT_CACHE[md5]
    return False, None

def _put_frame_cache(md5: str, result: Optional[Dict[str, Any]]):
    if len(_FRAME_RESULT_CACHE_ORDER) >= _FRAME_CACHE_MAX:
        evict = _FRAME_RESULT_CACHE_ORDER.pop(0)
        _FRAME_RESULT_CACHE.pop(evict, None)
    _FRAME_RESULT_CACHE[md5] = result
    _FRAME_RESULT_CACHE_ORDER.append(md5)

def _get_yolo_model():
    """Load the best trained model if available, else fall back to YOLOv11n."""
    global _YOLO_MODEL
    if _YOLO_MODEL is not None:
        return _YOLO_MODEL
    if not _YOLO_OK:
        return None
    # Try to load a trained custom model first
    try:
        from app.routers.training import _SESSIONS, TRAINING_DATA_DIR
        completed = [s for s in _SESSIONS if s.get("status") == "COMPLETED" and s.get("model_path")]
        if completed:
            mp = completed[0]["model_path"]
            if os.path.exists(mp):
                _YOLO_MODEL = _YOLO_CLS(mp)
                print(f"[CCTV] Loaded custom model: {mp}")
                return _YOLO_MODEL
    except Exception:
        pass
    # Fall back to YOLOv11n base model
    try:
        _YOLO_MODEL = _YOLO_CLS("yolov11n.pt")
        print("[CCTV] Loaded YOLOv11n base model")
    except Exception as e:
        print(f"[CCTV] Could not load YOLOv11n: {e}")
    return _YOLO_MODEL

# ── Training module — optional, used for histogram-based detection ─
try:
    from app.routers.training import (
        detect_from_training as _detect_from_training,
        learn_from_feedback  as _learn_from_feedback,
    )
    _TRAINING_OK = True
except Exception:
    _TRAINING_OK = False
    def _detect_from_training(_bytes):  # type: ignore
        return None
    def _learn_from_feedback(_bytes, _itype, _fa):  # type: ignore
        return False

router = APIRouter(prefix="/api/v1/cctv", tags=["CCTV"])

# ═══════════════════════════════════════════════════════════════════
#  CONSTANTS & CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

INCIDENT_TYPES = [
    "Road Accident",
    "Physical Fight",
    "Weapon Detected",
    "Fire / Smoke",
    "Theft / Robbery",
    "Person Unconscious",
    "Suspicious Activity",
    "Vehicle Collision",
]

# ─── Severity / Harm Scoring ─────────────────────────────────────────────────
#
# Severity is calculated from:
#   1. Incident type base score
#   2. AI confidence amplifier
#   3. Time-of-day multiplier (nights are higher risk)
#
# Levels: CRITICAL (≥ 85) | HIGH (≥ 60) | MEDIUM (≥ 35) | LOW (< 35)

INCIDENT_SEVERITY_BASE: Dict[str, int] = {
    "Weapon Detected":     95,
    "Fire / Smoke":        90,
    "Road Accident":       80,
    "Physical Fight":      75,
    "Vehicle Collision":   70,
    "Theft / Robbery":     65,
    "Person Unconscious":  60,
    "Suspicious Activity": 30,
}

SEVERITY_LEVELS = [
    (85, "CRITICAL", "#dc2626", "Immediate response required — life at risk"),
    (60, "HIGH",     "#f97316", "Urgent police response recommended"),
    (35, "MEDIUM",   "#f59e0b", "Response warranted — assess situation"),
    ( 0, "LOW",      "#6b7280", "Monitor — low immediate risk"),
]


# Minimum severity level per incident type — prevents life-threatening
# incidents from ever showing as LOW even at low confidence
INCIDENT_MIN_SEVERITY: Dict[str, str] = {
    "Road Accident":       "HIGH",
    "Weapon Detected":     "HIGH",
    "Fire / Smoke":        "HIGH",
    "Physical Fight":      "MEDIUM",
    "Vehicle Collision":   "HIGH",
    "Person Unconscious":  "MEDIUM",
    "Theft / Robbery":     "MEDIUM",
    "Suspicious Activity": "LOW",
}

_MIN_SEVERITY_SCORE = {"CRITICAL": 85, "HIGH": 60, "MEDIUM": 35, "LOW": 0}


def _compute_severity(incident_type: str, confidence: float) -> Dict[str, Any]:
    """Return severity dict: level, score, colour, description, response_eta_minutes."""
    base   = INCIDENT_SEVERITY_BASE.get(incident_type, 40)
    score  = round(base * confidence)
    hour   = time.gmtime().tm_hour
    if 22 <= hour or hour < 6:                 # night bonus
        score = min(100, score + 10)

    # Apply minimum floor — Road Accident is always at least HIGH
    min_level = INCIDENT_MIN_SEVERITY.get(incident_type, "LOW")
    min_score = _MIN_SEVERITY_SCORE[min_level]
    score = max(score, min_score)

    for threshold, level, colour, desc in SEVERITY_LEVELS:
        if score >= threshold:
            eta = {
                "CRITICAL": random.randint(4, 8),
                "HIGH":     random.randint(8, 15),
                "MEDIUM":   random.randint(15, 30),
                "LOW":      random.randint(30, 60),
            }[level]
            return {
                "level":                level,
                "score":                score,
                "colour":               colour,
                "description":          desc,
                "response_eta_minutes": eta,
            }
    return {"level": "LOW", "score": score, "colour": "#6b7280",
            "description": "Monitor — low immediate risk", "response_eta_minutes": 60}


def _make_notification(incident: Dict[str, Any]) -> Dict[str, Any]:
    """Create a police notification record for a detected incident."""
    global _NOTIF_COUNTER
    _NOTIF_COUNTER += 1
    severity = incident.get("severity", {})
    station  = incident.get("assigned_station", "Nearest Station")
    lat      = incident.get("latitude", 0)
    lng      = incident.get("longitude", 0)

    notif: Dict[str, Any] = {
        "notification_id":  f"NOTIF-{_NOTIF_COUNTER:05d}",
        "incident_id":      incident["incident_id"],
        "incident_type":    incident["incident_type"],
        "severity_level":   severity.get("level", "MEDIUM"),
        "severity_score":   severity.get("score", 50),
        "severity_colour":  severity.get("colour", "#f59e0b"),
        "severity_desc":    severity.get("description", ""),
        "response_eta":     severity.get("response_eta_minutes", 15),
        "title":            f"[{severity.get('level', 'MEDIUM')}] {incident['incident_type']} Detected",
        "message":          incident.get("ai_summary", ""),
        "location": {
            "address":    incident.get("camera_location", ""),
            "district":   incident.get("district", ""),
            "zone":       incident.get("zone", ""),
            "lat":        lat,
            "lng":        lng,
            "maps_url":   f"https://www.google.com/maps/search/?api=1&query={lat},{lng}",
            "maps_embed": f"https://maps.google.com/maps?q={lat},{lng}&z=16&output=embed",
            "what3words": _approx_what3words(lat, lng),
        },
        "assigned_station":    station,
        "assigned_station_id": incident.get("assigned_station_id"),
        "camera_id":           incident.get("camera_id", ""),
        "camera_name":         incident.get("camera_name", ""),
        "confidence":          incident.get("confidence", 0),
        "snapshot":            incident.get("snapshot", ""),
        "timestamp":           incident["timestamp"],
        "read":                False,
        "acknowledged_by":     None,
        "acknowledged_at":     None,
    }
    _NOTIFICATIONS.insert(0, notif)
    return notif


def _approx_what3words(lat: float, lng: float) -> str:
    """
    Stub — replace with real what3words API call if you have an API key.
    Returns a deterministic fake w3w address based on coords.
    """
    words = ["tiger", "market", "tower", "bridge", "signal", "police",
             "water", "cloud", "silver", "stone", "river", "garden"]
    a = abs(int(lat * 1000)) % len(words)
    b = abs(int(lng * 1000)) % len(words)
    c = abs(int((lat + lng) * 500)) % len(words)
    return f"///{words[a]}.{words[b]}.{words[c]}"


async def _reverse_geocode(lat: float, lng: float) -> str:
    """
    Reverse geocode lat/lng → human-readable address via Nominatim (OSM).
    No API key required.  Falls back to coords string if unavailable.
    """
    if not _HTTPX_OK:
        return f"{lat:.5f}, {lng:.5f}"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lng, "format": "json", "zoom": 16},
                headers={"User-Agent": "VigilanteVanguard/5.0 KSP-Datathon"},
            )
            r.raise_for_status()
            data = r.json()
            addr = data.get("display_name", "")
            return addr[:120] if addr else f"{lat:.5f}, {lng:.5f}"
    except Exception:
        return f"{lat:.5f}, {lng:.5f}"

# Karnataka Police Stations (demo registry with lat/lng)
POLICE_STATIONS = [
    {"id": 1,  "name": "Cubbon Park PS",         "lat": 12.9767, "lng": 77.5931, "district": "Bengaluru City", "phone": "080-22942222"},
    {"id": 2,  "name": "MG Road PS",              "lat": 12.9750, "lng": 77.6099, "district": "Bengaluru City", "phone": "080-25588722"},
    {"id": 3,  "name": "Koramangala PS",           "lat": 12.9279, "lng": 77.6271, "district": "Bengaluru City", "phone": "080-25502584"},
    {"id": 4,  "name": "Whitefield PS",            "lat": 12.9698, "lng": 77.7499, "district": "Bengaluru City", "phone": "080-28454444"},
    {"id": 5,  "name": "Indiranagar PS",           "lat": 12.9784, "lng": 77.6408, "district": "Bengaluru City", "phone": "080-25203333"},
    {"id": 6,  "name": "Jayanagar PS",             "lat": 12.9250, "lng": 77.5938, "district": "Bengaluru City", "phone": "080-26631111"},
    {"id": 7,  "name": "Hebbal PS",                "lat": 13.0358, "lng": 77.5969, "district": "Bengaluru City", "phone": "080-23637777"},
    {"id": 8,  "name": "Electronic City PS",       "lat": 12.8458, "lng": 77.6692, "district": "Bengaluru City", "phone": "080-27812222"},
    {"id": 17, "name": "Mysuru North PS",          "lat": 12.3046, "lng": 76.6535, "district": "Mysuru",         "phone": "0821-2411555"},
    {"id": 24, "name": "Belagavi City PS",         "lat": 15.8497, "lng": 74.4977, "district": "Belagavi",       "phone": "0831-2401111"},
    {"id": 30, "name": "Raichur SP Office",        "lat": 16.2120, "lng": 77.3566, "district": "Raichur",        "phone": "08532-222222"},
]

# Demo CCTV camera registry
DEMO_CAMERAS: List[Dict[str, Any]] = [
    {
        "camera_id": "CAM-BLR-001",
        "name": "MG Road Junction — North",
        "location": "MG Road & Brigade Road Junction, Bengaluru",
        "lat": 12.9751, "lng": 77.6097,
        "source_type": "demo",           # change to "rtsp" for live feed
        "source_url": "",                # fill with rtsp://... when available
        "district": "Bengaluru City",
        "zone": "Bengaluru",
        "status": "active",
    },
    {
        "camera_id": "CAM-BLR-002",
        "name": "Koramangala 6th Block",
        "location": "Koramangala 6th Block, Bengaluru",
        "lat": 12.9352, "lng": 77.6245,
        "source_type": "demo",
        "source_url": "",
        "district": "Bengaluru City",
        "zone": "Bengaluru",
        "status": "active",
    },
    {
        "camera_id": "CAM-MYS-001",
        "name": "Mysuru Palace Road",
        "location": "Palace Road, Mysuru",
        "lat": 12.3052, "lng": 76.6551,
        "source_type": "demo",
        "source_url": "",
        "district": "Mysuru",
        "zone": "Mysuru",
        "status": "active",
    },
    {
        "camera_id": "CAM-HUB-001",
        "name": "Hubballi Railway Station",
        "location": "Hubballi Railway Station, Hubballi",
        "lat": 15.3647, "lng": 75.1239,
        "source_type": "demo",
        "source_url": "",
        "district": "Dharwad",
        "zone": "Belagavi",
        "status": "active",
    },
]

# ═══════════════════════════════════════════════════════════════════
#  IN-MEMORY INCIDENT STORE  (replace with Catalyst DataStore rows)
# ═══════════════════════════════════════════════════════════════════

_INCIDENTS: List[Dict[str, Any]] = []
_INCIDENT_COUNTER = 0

# Per-camera cooldown: tracks the last time each camera raised an incident of
# each type.  Prevents a continuous stream from creating duplicate incidents
# every poll cycle.  Key = (camera_id, incident_type), Value = unix timestamp.
_LAST_INCIDENT_TIME: Dict[tuple, float] = {}
# Minimum seconds between incidents of the same type on the same camera.
_INCIDENT_COOLDOWN_SECONDS = 30


def _new_incident(
    incident_type: str,
    confidence: float,
    camera_id: str,
    video_path: str,
    snapshot_b64: str,
    summary: str,
    lat: float,
    lng: float,
) -> Dict[str, Any]:
    global _INCIDENT_COUNTER
    _INCIDENT_COUNTER += 1
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    camera = next((c for c in DEMO_CAMERAS if c["camera_id"] == camera_id), {})
    nearest_station = _nearest_station(lat, lng)
    severity = _compute_severity(incident_type, confidence)
    inc = {
        "incident_id":      f"INC-{_INCIDENT_COUNTER:05d}",
        "incident_type":    incident_type,
        "confidence":       round(confidence, 3),
        "camera_id":        camera_id,
        "camera_name":      camera.get("name", camera_id),
        "camera_location":  camera.get("location", ""),
        "video_path":       video_path,
        "snapshot":         snapshot_b64,   # base64 JPEG
        "ai_summary":       summary,
        "latitude":         lat,
        "longitude":        lng,
        "timestamp":        ts,
        "status":           "PENDING",      # PENDING → CONFIRMED / FALSE_ALARM
        "assigned_station": nearest_station["name"] if nearest_station else "",
        "assigned_station_id": nearest_station["id"] if nearest_station else None,
        "assigned_station_phone": nearest_station.get("phone", "") if nearest_station else "",
        "dispatch_recommended": False,
        "confirmed_by":     None,
        "confirmed_at":     None,
        "district":         camera.get("district", ""),
        "zone":             camera.get("zone", ""),
        "severity":         severity,
        # Exact location bundle
        "location": {
            "lat":        lat,
            "lng":        lng,
            "address":    camera.get("location", ""),
            "district":   camera.get("district", ""),
            "zone":       camera.get("zone", ""),
            "maps_url":   f"https://www.google.com/maps/search/?api=1&query={lat},{lng}",
            "maps_embed": f"https://maps.google.com/maps?q={lat},{lng}&z=16&output=embed",
            "what3words": _approx_what3words(lat, lng),
        },
    }
    _INCIDENTS.insert(0, inc)
    # Record timestamp for cooldown tracking
    _LAST_INCIDENT_TIME[(camera_id, incident_type)] = time.time()
    # Auto-generate notification for police
    _make_notification(inc)
    return inc


def _is_on_cooldown(camera_id: str, incident_type: str) -> bool:
    """Return True if this camera already raised this incident type recently."""
    key = (camera_id, incident_type)
    last = _LAST_INCIDENT_TIME.get(key, 0.0)
    return (time.time() - last) < _INCIDENT_COOLDOWN_SECONDS


def _nearest_station(lat: float, lng: float) -> Optional[Dict]:
    if not POLICE_STATIONS:
        return None
    def dist(s: Dict) -> float:
        return math.sqrt((s["lat"] - lat) ** 2 + (s["lng"] - lng) ** 2)
    return min(POLICE_STATIONS, key=dist)


# ═══════════════════════════════════════════════════════════════════
#  AI DETECTION ENGINE
# ═══════════════════════════════════════════════════════════════════

# Per-engine scene-change state: last frame bytes per camera.
# We compare raw bytes instead of perceptual hash because:
#   - Phone MJPEG re-encodes every frame even on a static scene, producing
#     Hamming distances of 8-25 between consecutive "identical" frames.
#   - A Hamming threshold therefore either skips real accident frames (too
#     tight) or never deduplicates (too loose). Exact byte comparison is
#     the only reliable way to tell "same JPEG sent twice".
_LAST_FRAME_HASH: Dict[str, str] = {}    # kept for _phash/_hamming callers (unused by gate)
_LAST_FRAME_BYTES: Dict[str, bytes] = {} # camera_id → last accepted raw JPEG bytes

def _phash(frame_bgr: Any) -> str:
    """
    Compute a compact perceptual hash of a frame.
    Resize to 16×16 greyscale, threshold at mean → 256-bit hex string.
    Returns empty string on any error (treated as always-changed by the gate).
    """
    if frame_bgr is None:
        return ""
    import numpy as np
    try:
        small = cv2.resize(frame_bgr, (16, 16))
        grey  = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(float)
        bits  = (grey > grey.mean()).flatten()
        val   = int("".join("1" if b else "0" for b in bits), 2)
        return f"{val:064x}"
    except Exception:
        return ""

def _hamming(a: str, b: str) -> int:
    """Hamming distance between two equal-length hex strings (bit level)."""
    va = int(a, 16)
    vb = int(b, 16)
    x  = va ^ vb
    dist = 0
    while x:
        dist += x & 1
        x >>= 1
    return dist


class AIDetectionEngine:
    """
    Pluggable detection engine.

    Detection priority for every polled frame:
      1. Scene-change gate     — skip if frame is visually identical to the last
                                 one (saves CPU and prevents spam on static scenes).
      2. Trained histogram     — PRIMARY: officer-trained model. If it recognises
                                 the scene it wins outright — both for incidents
                                 AND for Normal (suppresses YOLO on safe scenes).
      3. YOLOv8 contextual     — SECONDARY: fires only when histogram has no
                                 confident match AND scene context implies danger
                                 (overlapping vehicles, knife, prone person…).
      4. OpenCV heuristics     — extreme darkness / brightness signals.
      5. Demo simulation       — random fallback when no real frame is available.
    """

    def detect_frame(self, frame_data: bytes, camera_id: str = "") -> Optional[Dict[str, Any]]:
        """
        Analyse a single frame.  Returns a detection dict or None.
        camera_id: used for per-camera scene-change tracking.

        Priority order (trained model runs FIRST so officer feedback is respected):
          1. Scene-change gate   — skip truly identical frames
          2. SVM (RBF) / Trained histogram — PRIMARY trained classifier
          3. YOLOv8 contextual   — SECONDARY: generic object detector
          4. OpenCV heuristics   — extreme darkness only

        No real frame → returns None immediately (no random/simulated incidents).
        """
        if not frame_data:
            return None   # no frame = no detection, never simulate

        # ── 0. Decode frame once ──────────────────────────────────────
        import numpy as np
        nparr     = np.frombuffer(frame_data, np.uint8)
        frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR) if _CV2_OK else None

        # ── 1. Scene-change gate ──────────────────────────────────────
        # Skip only exact-byte-duplicate frames (same raw JPEG polled twice
        # before the camera produced a new frame). Raw-byte comparison is
        # O(n) but runs <0.5 ms for a 50 KB phone JPEG and is 100% accurate:
        # if the bytes differ at all it is a genuinely new frame.
        if camera_id:
            last_bytes = _LAST_FRAME_BYTES.get(camera_id)
            if last_bytes is not None and last_bytes == frame_data:
                return None   # exact duplicate — skip
            _LAST_FRAME_BYTES[camera_id] = frame_data

        # ── 2. Trained histogram model (PRIMARY) ─────────────────────
        # Run FIRST so the model the officers trained is always respected.
        # Three possible outcomes:
        #   a) Returns an incident dict  → return it immediately, skip YOLO
        #   b) Returns Normal sentinel   → scene is safe, skip YOLO entirely
        #   c) Returns None              → no opinion, let YOLO run
        trained = _detect_from_training(frame_data)
        if trained:
            # (b) Normal sentinel — scene recognised as safe, suppress YOLO
            if trained.get("incident_type") == "__NORMAL__":
                return None   # safe scene — no incident to report
            # (a) Real incident — return it
            return trained

        # ── 3. YOLOv8 contextual (SECONDARY — only when trained model silent) ─
        # YOLO only runs when the histogram has no confident opinion (case c).
        # This prevents "any 2 vehicles = collision" false positives on scenes
        # the trained model has not seen before.
        if _YOLO_OK and frame_bgr is not None:
            yolo_result = self._yolo_detect_contextual(frame_bgr)
            if yolo_result:
                return yolo_result

        # ── 4. OpenCV heuristics ──────────────────────────────────────
        if frame_bgr is not None:
            return self._cv2_detect_frame(frame_bgr)

        return None

    def _yolo_detect_contextual(self, frame_bgr: Any) -> Optional[Dict[str, Any]]:
        """
        Context-aware YOLOv8 inference.

        The base model (yolov8n) detects COCO objects.  Detecting a car or a
        person in frame does NOT mean there is an incident — the camera is
        likely on a road and will always see traffic.  We only fire when the
        scene context implies actual danger:

          Road Accident / Vehicle Collision:
            ≥ 2 vehicles whose bounding boxes overlap or are very close
            (IoU > 0.1 OR centre-distance < 20% of frame width).

          Weapon Detected:
            knife or scissors detected with conf ≥ 0.60.

          Fire / Smoke:
            fire or smoke class (custom model), conf ≥ 0.55.

          Person Unconscious:
            person bbox is very wide relative to height (lying down: w/h > 2.0)
            AND low in the frame (bottom 60%).

          Theft / Robbery:
            person bbox overlapping a handbag/backpack bbox with high conf.

          Physical Fight:
            ≥ 2 person bboxes with significant overlap (IoU > 0.15).

        Suspicious Activity (person alone) is intentionally NOT fired here —
        it creates too many false positives on any street camera.
        """
        model = _get_yolo_model()
        if model is None:
            return None

        try:
            import numpy as np
            results = model(frame_bgr, verbose=False)
            if not results:
                return None

            H, W = frame_bgr.shape[:2]

            # Collect all boxes: list of (cls_name, conf, x1, y1, x2, y2)
            boxes: List[tuple] = []
            for r in results:
                for box in r.boxes:
                    cls_name = r.names[int(box.cls[0])].lower()
                    conf     = float(box.conf[0])
                    x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
                    boxes.append((cls_name, conf, x1, y1, x2, y2))

            def iou(b1: tuple, b2: tuple) -> float:
                """Intersection-over-union of two boxes."""
                ax1, ay1, ax2, ay2 = b1[2], b1[3], b1[4], b1[5]
                bx1, by1, bx2, by2 = b2[2], b2[3], b2[4], b2[5]
                ix1 = max(ax1, bx1); iy1 = max(ay1, by1)
                ix2 = min(ax2, bx2); iy2 = min(ay2, by2)
                inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
                if inter == 0:
                    return 0.0
                a_area = (ax2 - ax1) * (ay2 - ay1)
                b_area = (bx2 - bx1) * (by2 - by1)
                return inter / (a_area + b_area - inter + 1e-6)

            def centre_dist_norm(b1: tuple, b2: tuple) -> float:
                """Normalised centre-to-centre distance (0=same centre, 1=far apart)."""
                cx1 = (b1[2] + b1[4]) / 2 / W
                cy1 = (b1[3] + b1[5]) / 2 / H
                cx2 = (b2[2] + b2[4]) / 2 / W
                cy2 = (b2[3] + b2[5]) / 2 / H
                return ((cx1 - cx2) ** 2 + (cy1 - cy2) ** 2) ** 0.5

            VEHICLES    = {"car", "truck", "bus", "motorcycle", "bicycle"}
            PERSONS     = {"person"}
            WEAPONS     = {"knife", "scissors"}
            BAGS        = {"backpack", "handbag", "suitcase"}
            FIRE_CLS    = {"fire", "smoke"}
            # Classes that indicate an INDOOR scene — if these dominate
            # the detections and no vehicles or persons are present we
            # should NOT fire a road-incident alert.
            INDOOR_OBJ  = {"chair", "dining table", "couch", "bed", "toilet",
                           "tv", "laptop", "keyboard", "mouse", "book",
                           "potted plant", "cup", "bottle", "bowl", "vase",
                           "clock", "remote", "cell phone", "refrigerator",
                           "microwave", "oven", "toaster", "sink"}

            # Confidence thresholds — raised from 0.30/0.40 to 0.55/0.55
            # to reduce YOLO false positives from low-quality MJPEG frames.
            vehicle_boxes = [b for b in boxes if b[0] in VEHICLES and b[1] >= 0.55]
            person_boxes  = [b for b in boxes if b[0] in PERSONS  and b[1] >= 0.50]
            weapon_boxes  = [b for b in boxes if b[0] in WEAPONS  and b[1] >= 0.60]
            bag_boxes     = [b for b in boxes if b[0] in BAGS     and b[1] >= 0.55]
            fire_boxes    = [b for b in boxes if b[0] in FIRE_CLS and b[1] >= 0.55]
            indoor_boxes  = [b for b in boxes if b[0] in INDOOR_OBJ and b[1] >= 0.45]

            # ── Indoor scene guard ────────────────────────────────────
            # If YOLO sees indoor objects but NO vehicles at all, the camera
            # is pointing at a room (desk, couch, table, etc.).  Firing a
            # road-incident alert here is a guaranteed false positive.
            if indoor_boxes and not vehicle_boxes:
                return None

            # ── Weapon Detected ──────────────────────────────────────
            if weapon_boxes:
                best = max(weapon_boxes, key=lambda b: b[1])
                return {"incident_type": "Weapon Detected",
                        "confidence": round(best[1], 3), "trigger": "yolov8_weapon"}

            # ── Fire / Smoke ─────────────────────────────────────────
            if fire_boxes:
                best = max(fire_boxes, key=lambda b: b[1])
                return {"incident_type": "Fire / Smoke",
                        "confidence": round(best[1], 3), "trigger": "yolov8_fire"}

            # ── Road Accident / Vehicle Collision ────────────────────
            # Require both bounding-box proximity AND high confidence.
            # cdist threshold tightened to 0.12 (was 0.35 — far too broad;
            # any two cars on a road would fire).  IoU raised to 0.08.
            # Both vehicles must be confident (≥ 0.55) individually.
            # This prevents detecting "2 parked cars in a parking lot" or
            # "a car driving past another car" as a collision.
            if len(vehicle_boxes) >= 2:
                best_pair_conf = 0.0
                best_itype     = "Vehicle Collision"
                collision_found = False
                for i in range(len(vehicle_boxes)):
                    for j in range(i + 1, len(vehicle_boxes)):
                        overlap  = iou(vehicle_boxes[i], vehicle_boxes[j])
                        cdist    = centre_dist_norm(vehicle_boxes[i], vehicle_boxes[j])
                        vi_conf  = vehicle_boxes[i][1]
                        vj_conf  = vehicle_boxes[j][1]
                        # Both vehicles must be confident AND physically close/overlapping
                        if (vi_conf >= 0.55 and vj_conf >= 0.55
                                and (overlap > 0.08 or cdist < 0.12)):
                            pair_conf = (vi_conf + vj_conf) / 2
                            if pair_conf > best_pair_conf:
                                best_pair_conf = pair_conf
                                types_involved = {vehicle_boxes[i][0], vehicle_boxes[j][0]}
                                best_itype = ("Road Accident"
                                             if types_involved & {"motorcycle", "bicycle"}
                                             else "Vehicle Collision")
                                collision_found = True
                if collision_found:
                    conf = round(min(0.92, best_pair_conf + 0.10), 3)
                    return {"incident_type": best_itype, "confidence": conf,
                            "trigger": "yolov8_collision"}

            # ── Single vehicle — REMOVED as an incident trigger ───────
            # A single vehicle in frame is completely normal on any road camera
            # and should NEVER be flagged as an incident. Removed entirely.
            # (Previously: any car at conf≥0.40 → "Vehicle Collision" — far
            # too aggressive and the #1 source of false positives.)

            # ── Person Unconscious ───────────────────────────────────
            for pb in person_boxes:
                pw = pb[4] - pb[2]
                ph = pb[5] - pb[3]
                cy = (pb[3] + pb[5]) / 2 / H
                if ph > 0 and pw / ph > 2.0 and cy > 0.40:
                    return {"incident_type": "Person Unconscious",
                            "confidence": round(pb[1], 3), "trigger": "yolov8_prone"}

            # ── Physical Fight ───────────────────────────────────────
            # Require strong overlap — bodies entangled, not just standing nearby
            if len(person_boxes) >= 2:
                for i in range(len(person_boxes)):
                    for j in range(i + 1, len(person_boxes)):
                        if iou(person_boxes[i], person_boxes[j]) > 0.30:
                            conf = round(
                                min(0.90, (person_boxes[i][1] + person_boxes[j][1]) / 2 + 0.05), 3
                            )
                            return {"incident_type": "Physical Fight",
                                    "confidence": conf, "trigger": "yolov8_fight"}

            # ── Theft / Robbery ──────────────────────────────────────
            for pb in person_boxes:
                for bb in bag_boxes:
                    if iou(pb, bb) > 0.15:
                        conf = round(min(0.88, (pb[1] + bb[1]) / 2 + 0.05), 3)
                        return {"incident_type": "Theft / Robbery",
                                "confidence": conf, "trigger": "yolov8_theft"}

        except Exception as exc:
            print(f"[YOLO] inference error: {exc}")
        return None

    # Keep old name for any external callers
    def _yolo_detect(self, frame_data: bytes) -> Optional[Dict[str, Any]]:
        if not _CV2_OK or not frame_data:
            return None
        import numpy as np
        nparr = np.frombuffer(frame_data, np.uint8)
        frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame_bgr is None:
            return None
        return self._yolo_detect_contextual(frame_bgr)

    def _cv2_detect_frame(self, frame_bgr: Any) -> Optional[Dict[str, Any]]:
        """
        OpenCV heuristics — last resort, only fires on unambiguous signals.

        Red-region heuristic has been intentionally removed: any orange, red,
        or brown surface (curtains, walls, clothing, brick) saturates the red
        channel and produces a false alert.  Colour alone cannot distinguish
        fire from a curtain.  YOLOv8 handles fire/fight detection reliably.

        The only remaining check is extreme darkness (brightness < 0.06),
        which signals a camera malfunction or a very dark scene — not a
        colour false positive from ordinary room objects.
        """
        brightness = float(frame_bgr.mean()) / 255.0
        if brightness < 0.06:
            return {"incident_type": "Person Unconscious",
                    "confidence": round(random.uniform(0.55, 0.68), 3),
                    "trigger": "cv2_dark_frame"}
        return None

    def _cv2_detect(self, frame_data: bytes) -> Optional[Dict[str, Any]]:
        """Compatibility wrapper — decodes and calls _cv2_detect_frame."""
        if not _CV2_OK or not frame_data:
            return None
        import numpy as np
        nparr     = np.frombuffer(frame_data, np.uint8)
        frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame_bgr is None:
            return None
        return self._cv2_detect_frame(frame_bgr)

    @staticmethod
    def generate_summary(incident_type: str, confidence: float,
                         camera_name: str, location: str) -> str:
        templates = {
            "Road Accident":        f"AI detected a road accident near {location} with {confidence*100:.0f}% confidence. Multiple vehicles appear to be involved. Immediate emergency services recommended.",
            "Physical Fight":       f"Physical altercation detected at {camera_name} ({location}). Estimated {confidence*100:.0f}% confidence. Bystanders present — rapid response advised.",
            "Weapon Detected":      f"Potential weapon identified in frame at {location}. Confidence: {confidence*100:.0f}%. Situation requires immediate officer verification.",
            "Fire / Smoke":         f"Smoke or fire plume detected at {location} by {camera_name}. Confidence: {confidence*100:.0f}%. Fire services and police dispatch recommended.",
            "Theft / Robbery":      f"Theft or robbery-like behaviour detected at {camera_name} near {location}. Confidence: {confidence*100:.0f}%. Review clip before dispatch.",
            "Person Unconscious":   f"Individual appears unconscious or in distress at {location}. Detected by {camera_name} with {confidence*100:.0f}% confidence. Medical assistance needed.",
            "Suspicious Activity":  f"Unusual/suspicious activity detected at {location} by {camera_name}. Confidence: {confidence*100:.0f}%. Manual review recommended.",
            "Vehicle Collision":    f"Vehicle collision detected near {location}. Camera: {camera_name}. Confidence: {confidence*100:.0f}%. Traffic and emergency services alerted.",
        }
        return templates.get(incident_type, f"{incident_type} detected at {location} (conf: {confidence*100:.0f}%).")


_DETECTOR = AIDetectionEngine()


# ═══════════════════════════════════════════════════════════════════
#  WEBSOCKET CONNECTION MANAGER
# ═══════════════════════════════════════════════════════════════════

class CCTVConnectionManager:
    """Manages all active WebSocket connections for real-time alerts."""

    def __init__(self):
        self._connections: Dict[str, WebSocket] = {}   # conn_id → websocket
        self._user_map:    Dict[str, str] = {}          # conn_id → user email

    async def connect(self, ws: WebSocket, conn_id: str, email: str = "anonymous"):
        await ws.accept()
        self._connections[conn_id] = ws
        self._user_map[conn_id]    = email
        print(f"[CCTV-WS] {email} connected ({conn_id}). Total: {len(self._connections)}")

    def disconnect(self, conn_id: str):
        self._connections.pop(conn_id, None)
        email = self._user_map.pop(conn_id, "?")
        print(f"[CCTV-WS] {email} disconnected. Total: {len(self._connections)}")

    async def broadcast(self, message: dict):
        dead: List[str] = []
        payload = json.dumps(message)
        for cid, ws in list(self._connections.items()):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(cid)
        for cid in dead:
            self.disconnect(cid)

    @property
    def connected_count(self) -> int:
        return len(self._connections)


_WS_MANAGER = CCTVConnectionManager()


# ═══════════════════════════════════════════════════════════════════
#  BACKGROUND DEMO SIMULATION
# ═══════════════════════════════════════════════════════════════════

_SIM_TASK: Optional[asyncio.Task] = None


async def _simulation_loop():
    """
    Simulation loop — disabled.
    Incidents are only created from real camera frames via the AI detection
    pipeline.  This loop stays alive so start/stop_cctv_simulation() still
    work without changing main.py, but it produces no incidents.
    """
    while True:
        try:
            await asyncio.sleep(3600)   # sleep forever — no simulated incidents
        except asyncio.CancelledError:
            return


def _generate_demo_snapshot(incident_type: str) -> str:
    """
    Generate a minimal SVG placeholder encoded as base64 data URL.
    Replace with actual frame capture in production.
    """
    colour_map = {
        "Road Accident":      "#dc2626",
        "Physical Fight":     "#ea580c",
        "Weapon Detected":    "#7c3aed",
        "Fire / Smoke":       "#d97706",
        "Theft / Robbery":    "#0891b2",
        "Person Unconscious": "#64748b",
        "Suspicious Activity":"#0f766e",
        "Vehicle Collision":  "#be185d",
    }
    colour = colour_map.get(incident_type, "#374151")
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#111827"/>
  <rect x="0" y="0" width="320" height="180" fill="{colour}" opacity="0.18"/>
  <text x="160" y="70" font-family="monospace" font-size="11" fill="#9ca3af" text-anchor="middle">CCTV SNAPSHOT</text>
  <text x="160" y="95" font-family="monospace" font-size="13" fill="white" font-weight="bold" text-anchor="middle">{incident_type}</text>
  <text x="160" y="115" font-family="monospace" font-size="10" fill="#6b7280" text-anchor="middle">AI Detection Frame</text>
  <circle cx="160" cy="148" r="6" fill="{colour}" opacity="0.8"/>
  <rect x="10" y="10" width="60" height="16" rx="3" fill="{colour}" opacity="0.7"/>
  <text x="15" y="22" font-family="monospace" font-size="9" fill="white">● REC</text>
</svg>'''
    b64 = base64.b64encode(svg.encode()).decode()
    return f"data:image/svg+xml;base64,{b64}"


# ═══════════════════════════════════════════════════════════════════
#  PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════════════

class IncidentUpdateReq(BaseModel):
    action: str          # "CONFIRM" | "FALSE_ALARM" | "DISPATCH"
    notes:  Optional[str] = None

class CameraAddReq(BaseModel):
    camera_id:   str
    name:        str
    location:    str
    lat:         float
    lng:         float
    source_type: str = "rtsp"    # "webcam" | "ipcam" | "rtsp" | "upload" | "demo"
    source_url:  str = ""
    district:    str = ""
    zone:        str = ""

class AnalyseFrameReq(BaseModel):
    camera_id:   str
    frame_b64:   str             # base64-encoded JPEG frame from client


# ═══════════════════════════════════════════════════════════════════
#  REST ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@router.get("/health")
async def cctv_health():
    return {
        "status":          "active",
        "module":          "AI Smart CCTV Surveillance & Emergency Dispatch",
        "version":         "5.0.0",
        "opencv":          _CV2_OK,
        "yolov8":          _YOLO_OK,
        "cameras_online":  len([c for c in DEMO_CAMERAS if c["status"] == "active"]),
        "total_incidents": len(_INCIDENTS),
        "ws_connected":    _WS_MANAGER.connected_count,
        "simulation":      _SIM_TASK is not None and not _SIM_TASK.done(),
    }


# ── Cameras ───────────────────────────────────────────────────────

@router.get("/cameras")
async def list_cameras():
    return {"cameras": DEMO_CAMERAS, "total": len(DEMO_CAMERAS)}


@router.post("/cameras")
async def add_camera(req: CameraAddReq):
    """Register a new camera (webcam, IP cam, RTSP, demo)."""
    existing = next((c for c in DEMO_CAMERAS if c["camera_id"] == req.camera_id), None)
    if existing:
        # Update instead of error — allows re-registering with new lat/lng from browser Geolocation
        existing.update(req.model_dump())
        return {"message": "Camera updated", "camera": existing}
    entry: Dict[str, Any] = {
        **req.model_dump(),
        "status":       "active",
        "last_seen":    time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "incident_count": 0,
    }
    DEMO_CAMERAS.append(entry)
    return {"message": "Camera registered", "camera": entry}


@router.get("/cameras/{camera_id}")
async def get_camera(camera_id: str):
    cam = next((c for c in DEMO_CAMERAS if c["camera_id"] == camera_id), None)
    if not cam:
        raise HTTPException(404, "Camera not found")
    return cam


class CameraGeoReq(BaseModel):
    lat: float
    lng: float
    address: Optional[str] = None   # from browser reverse geocode


@router.patch("/cameras/{camera_id}/location")
async def update_camera_location(camera_id: str, req: CameraGeoReq):
    """
    Update a camera's GPS coordinates from the browser Geolocation API.
    Called automatically when an officer connects their IP camera.
    """
    cam = next((c for c in DEMO_CAMERAS if c["camera_id"] == camera_id), None)
    if not cam:
        # Create a placeholder entry
        cam = {
            "camera_id":   camera_id,
            "name":        f"IP Camera ({camera_id})",
            "location":    req.address or f"{req.lat:.4f}, {req.lng:.4f}",
            "lat":         req.lat,
            "lng":         req.lng,
            "source_type": "ipcam",
            "source_url":  "",
            "district":    "",
            "zone":        "",
            "status":      "active",
        }
        DEMO_CAMERAS.append(cam)
    else:
        cam["lat"] = req.lat
        cam["lng"] = req.lng
        if req.address:
            cam["location"] = req.address
    cam["last_seen"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return {"message": "Location updated", "camera": cam}


@router.get("/cameras/{camera_id}/health")
async def camera_health_check(camera_id: str):
    """
    Live health check for an IP camera.
    Tests reachability and returns status + frame latency.
    """
    cam = next((c for c in DEMO_CAMERAS if c["camera_id"] == camera_id), None)
    if not cam:
        raise HTTPException(404, "Camera not found")

    source_url = cam.get("source_url", "")
    if not source_url or cam.get("source_type") == "demo":
        return {"camera_id": camera_id, "status": "demo", "latency_ms": 0,
                "message": "Demo camera — no real stream"}

    if not _HTTPX_OK:
        return {"camera_id": camera_id, "status": "unknown",
                "message": "httpx unavailable"}

    t0 = time.time()
    try:
        candidates = _droidcam_candidates(source_url)
        async with httpx.AsyncClient(timeout=4.0, verify=False) as client:
            resp = await client.get(candidates[0])
            resp.raise_for_status()
        latency = round((time.time() - t0) * 1000)
        cam["status"] = "active"
        cam["last_seen"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        return {"camera_id": camera_id, "status": "online", "latency_ms": latency,
                "url": candidates[0]}
    except Exception as e:
        cam["status"] = "offline"
        return {"camera_id": camera_id, "status": "offline", "error": str(e)}


# ── IP Camera proxy ───────────────────────────────────────────────
#
# Confirmed working camera: IP Webcam app on Xiaomi 17 Ultra
#   MJPEG: http://192.168.1.6:8081/video   ← plain HTTP, no SSL
#   mDNS:  http://xiaomi-17-ultra.local:8081/video
#   RTSP:  rtsp://192.168.1.6:8554/live    (not used here — httpx can't decode RTSP)
#
# The browser cannot directly embed this stream due to CORS.
# This proxy endpoint fetches one JPEG frame from the MJPEG stream
# server-side and returns it together with the AI detection result.
#
# verify=False is kept in the AsyncClient for compatibility with any
# future HTTPS camera — it has no effect on plain HTTP connections.
#
# ── Single-connection frame buffer ─────────────────────────────────────────────
#
# IP Webcam (Android) allows at most 2 concurrent HTTP connections.
# The MJPEG proxy stream already occupies one slot permanently.
# Opening a second connection for every grab-frame poll exhausts that
# limit → phone drops the stream visibly every few seconds.
#
# Fix: mjpeg-stream siphons complete JPEG frames into a per-URL
# asyncio.Queue as bytes pass through.  grab-frame reads from that queue
# (zero extra camera connections) and only falls back to a direct
# connection when the MJPEG proxy stream is not yet active.
# ──────────────────────────────────────────────────────────────────────────────

# url_key → asyncio.Queue of JPEG bytes (maxsize=8 — keep fresh frames, drop stale)
_FRAME_BUFFER: Dict[str, "asyncio.Queue[bytes]"] = {}

def _frame_buffer(url: str) -> "asyncio.Queue[bytes]":
    """Return (creating if needed) the shared frame queue for this camera URL."""
    key = _droidcam_candidates(url)[0]   # normalise to primary URL
    if key not in _FRAME_BUFFER:
        _FRAME_BUFFER[key] = asyncio.Queue(maxsize=8)
    return _FRAME_BUFFER[key]


async def _detect_frame_async(
    frame_bytes: bytes,
    camera_id: str,
) -> Optional[Dict[str, Any]]:
    """
    Run CPU-bound AI detection in the shared thread pool so the FastAPI event
    loop is never blocked, enabling true concurrent frame processing for
    multiple cameras.

    Also applies an MD5-based result cache so identical JPEG frames (same
    bytes from a slow camera that re-sends the last frame while buffering)
    are resolved in < 1 µs without re-running the full 2344-dim feature
    extraction + SVM inference.
    """
    loop = asyncio.get_event_loop()
    frame_md5 = hashlib.md5(frame_bytes).hexdigest()

    # Cache hit — no CPU work needed
    hit, cached = _get_frame_cache(frame_md5)
    if hit:
        return cached

    # Offload to thread pool — keeps event loop free for I/O
    result = await loop.run_in_executor(
        _DETECTION_POOL,
        _DETECTOR.detect_frame,
        frame_bytes,
        camera_id,
    )
    _put_frame_cache(frame_md5, result)
    return result


class IPCamProxyReq(BaseModel):
    stream_url:  str            # full URL, e.g. http://192.168.1.6:8081/video
    camera_id:   str = "CAM-IPCAM"
    timeout:     float = 5.0   # seconds to wait for a frame
    username:    Optional[str] = None   # Basic Auth username (e.g. "admin")
    password:    Optional[str] = None   # Basic Auth password (e.g. "12345")


def _extract_jpeg_from_mjpeg(data: bytes) -> Optional[bytes]:
    """
    Extract the first complete JPEG frame from an MJPEG stream chunk.
    MJPEG boundary looks like: --<boundary>\\r\\nContent-Type: image/jpeg\\r\\n...\\r\\n<jpeg bytes>
    Falls back to returning the whole payload if it starts with the JPEG SOI marker (FF D8).
    """
    # Direct JPEG
    if data[:2] == b'\xff\xd8':
        return data

    # MJPEG multipart: find FF D8 … FF D9
    soi = data.find(b'\xff\xd8')
    if soi == -1:
        return None
    eoi = data.find(b'\xff\xd9', soi)
    if eoi == -1:
        # Stream cut off mid-frame — return what we have (enough for detection)
        return data[soi:]
    return data[soi: eoi + 2]


# ── IP camera endpoint candidates ────────────────────────────────
#
# Confirmed working: IP Webcam app on Xiaomi 17 Ultra
#   http://192.168.1.6:8081/video          — MJPEG stream  ← primary
#   http://xiaomi-17-ultra.local:8081/video — mDNS alias
#
# The function returns an ordered list of URLs to try. The first one
# that returns a valid JPEG wins.

def _droidcam_candidates(url: str) -> List[str]:
    """
    Given any URL the user typed, return an ordered list of URLs to try.
    Handles http:// and https://, any port, any path.
    Always tries /video first as that is the confirmed MJPEG endpoint.
    """
    url = url.rstrip('/')
    # Strip any known path suffix to get the base
    known_paths = ('/video', '/mjpegfeed', '/videofeed', '/jpeg',
                   '/shot.jpg', '/capture', '/webcam.mjpeg')
    base = url
    for p in known_paths:
        if url.endswith(p):
            base = url[: -len(p)]
            break

    # If user typed the base (no path), the stripped url == base already.
    # Always put /video first — it is the confirmed MJPEG path for IP Webcam
    # and also works for newer DroidCam versions.
    candidates = [
        base + '/video',       # ← confirmed: IP Webcam (Android) + newer DroidCam
        base + '/shot.jpg',    # IP Webcam snapshot fallback
        base + '/mjpegfeed',   # older DroidCam PC client
        base + '/videofeed',   # some IP cams
    ]
    # NOTE: /capture and /jpeg removed — they return 404 on IP Webcam app
    # and cause the error message to show the wrong (last) URL in the chain.
    # Deduplicate while preserving order (in case url already had /video)
    seen: set = set()
    result = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            result.append(c)
    return result


@router.post("/ipcam/grab-frame")
async def ipcam_grab_frame(req: IPCamProxyReq):
    """
    Grab one frame from an IP camera and run AI detection.

    Priority:
      1. Read from the shared frame buffer that mjpeg-stream fills as it
         proxies — ZERO extra camera connections (safe to call at 1 s+).
      2. Only open a direct connection when no proxy stream is active.
    """
    if not _HTTPX_OK:
        raise HTTPException(503, "httpx library not available — cannot proxy IP camera")

    snapshot_url = _droidcam_candidates(req.stream_url)[0]
    jpeg_bytes: Optional[bytes] = None
    last_error = ""

    # ── 1. Try the shared frame buffer first (no extra connection) ────────────
    buf = _frame_buffer(req.stream_url)
    try:
        jpeg_bytes = buf.get_nowait()
    except asyncio.QueueEmpty:
        # Wait up to 0.5 s for the MJPEG proxy to deposit a frame
        try:
            jpeg_bytes = await asyncio.wait_for(buf.get(), timeout=0.5)
        except asyncio.TimeoutError:
            pass

    # ── 2. Direct connection fallback (only when buffer has nothing) ──────────
    if not jpeg_bytes:
        _auth = (req.username, req.password) if req.username else None
        async with httpx.AsyncClient(
            timeout=req.timeout,
            follow_redirects=True,
            verify=False,
            auth=_auth,
        ) as client:
            for url in _droidcam_candidates(req.stream_url):
                try:
                    async with client.stream("GET", url) as resp:
                        resp.raise_for_status()
                        chunk = b""
                        async for part in resp.aiter_bytes(chunk_size=8192):
                            chunk += part
                            if b'\xff\xd8' in chunk and b'\xff\xd9' in chunk:
                                break
                            if len(chunk) > 524_288:
                                break
                    jpeg_bytes = _extract_jpeg_from_mjpeg(chunk)
                    if jpeg_bytes:
                        snapshot_url = url
                        break
                except Exception as e:
                    last_error = str(e)
                    continue

    if not jpeg_bytes:
        raise HTTPException(502, f"Could not fetch frame from IP camera: {last_error}")

    # ── Run AI detection in threadpool (non-blocking) ─────────────
    result = await _detect_frame_async(jpeg_bytes, req.camera_id)

    # Build snapshot data URL from the actual JPEG bytes
    snapshot_b64 = f"data:image/jpeg;base64,{base64.b64encode(jpeg_bytes).decode()}"

    if not result:
        return {
            "detected":      False,
            "snapshot":      snapshot_b64,
            "snapshot_url":  snapshot_url,
            "frame_bytes":   len(jpeg_bytes),
        }

    # ── Cooldown check — skip if same incident type was raised very recently ─
    itype = result["incident_type"]
    conf  = result["confidence"]
    if _is_on_cooldown(req.camera_id, itype):
        # Still return detected=True so the UI can update the "AI Detection" badge,
        # but don't create a new incident record or notification.
        return {
            "detected":      True,
            "cooldown":      True,
            "incident_type": itype,
            "confidence":    conf,
            "snapshot":      snapshot_b64,
            "snapshot_url":  snapshot_url,
            "frame_bytes":   len(jpeg_bytes),
        }

    # ── Incident detected ─────────────────────────────────────────
    camera = next((c for c in DEMO_CAMERAS if c["camera_id"] == req.camera_id),
                  {"camera_id": req.camera_id, "name": f"IP Cam ({req.camera_id})",
                   "location": req.stream_url, "lat": 12.9716, "lng": 77.5946})

    summary = AIDetectionEngine.generate_summary(
        itype, conf,
        camera.get("name", req.camera_id),
        camera.get("location", req.stream_url),
    )
    video_path = f"ipcam/{req.camera_id}/{itype.replace(' ', '_')}_{int(time.time())}.jpg"

    incident = _new_incident(
        incident_type=itype,
        confidence=conf,
        camera_id=req.camera_id,
        video_path=video_path,
        snapshot_b64=snapshot_b64,   # real JPEG from the camera
        summary=summary,
        lat=camera.get("lat", 12.9716),
        lng=camera.get("lng", 77.5946),
    )

    notification = _NOTIFICATIONS[0] if _NOTIFICATIONS else None
    await _WS_MANAGER.broadcast({
        "event":        "NEW_INCIDENT",
        "incident":     incident,
        "notification": notification,
        "ts":           incident["timestamp"],
    })

    return {
        "detected":     True,
        "incident":     incident,
        "notification": notification,
        "snapshot":     snapshot_b64,
        "snapshot_url": snapshot_url,
        "frame_bytes":  len(jpeg_bytes),
    }


# ── Batch grab: drain up to N buffered frames and run detection in parallel ───

class GrabFramesBatchReq(BaseModel):
    stream_url: str
    camera_id:  str = "CAM-IPCAM"
    max_frames: int = 4   # how many frames to drain from the buffer (1-8)
    username:   Optional[str] = None
    password:   Optional[str] = None

@router.post("/ipcam/grab-frames-batch")
async def ipcam_grab_frames_batch(req: GrabFramesBatchReq):
    """
    Drain up to max_frames from the MJPEG frame buffer and run AI detection
    on ALL of them in parallel (asyncio.gather → thread pool).

    Returns the FIRST positive detection found, or {detected: False} with
    scan stats if all frames are clean.  This lets the frontend call once
    per scan cycle instead of once per frame, reducing HTTP overhead by up
    to 4×–8× and dramatically increasing throughput on high-FPS cameras.

    Use this endpoint instead of /ipcam/grab-frame when running at < 200 ms
    scan intervals.
    """
    if not _HTTPX_OK:
        raise HTTPException(503, "httpx not available")

    n = max(1, min(8, req.max_frames))
    buf = _frame_buffer(req.stream_url)

    # Drain as many frames as are immediately available (no waiting)
    frames: List[bytes] = []
    for _ in range(n):
        try:
            frames.append(buf.get_nowait())
        except asyncio.QueueEmpty:
            break

    # Need at least one frame; if buffer is empty wait briefly for first
    if not frames:
        try:
            frames.append(await asyncio.wait_for(buf.get(), timeout=0.4))
        except asyncio.TimeoutError:
            # Fall back to direct grab if proxy stream not yet active
            if not _HTTPX_OK:
                raise HTTPException(504, "Frame buffer empty and no direct connection available")
            _auth = (req.username, req.password) if req.username else None
            async with httpx.AsyncClient(timeout=4.0, follow_redirects=True, verify=False, auth=_auth) as client:
                for url in _droidcam_candidates(req.stream_url):
                    try:
                        async with client.stream("GET", url) as resp:
                            resp.raise_for_status()
                            chunk = b""
                            async for part in resp.aiter_bytes(chunk_size=8192):
                                chunk += part
                                if b'\xff\xd8' in chunk and b'\xff\xd9' in chunk:
                                    break
                                if len(chunk) > 524_288:
                                    break
                        jpeg = _extract_jpeg_from_mjpeg(chunk)
                        if jpeg:
                            frames.append(jpeg)
                            break
                    except Exception:
                        continue
            if not frames:
                raise HTTPException(502, "Frame buffer empty and direct grab failed")

    # Run detection on all frames concurrently in thread pool
    tasks = [_detect_frame_async(f, req.camera_id) for f in frames]
    results = await asyncio.gather(*tasks)

    scan_stats = {
        "frames_scanned": len(frames),
        "frames_clean":   sum(1 for r in results if not r),
        "frames_incident": sum(1 for r in results if r),
    }

    # Return the first (most recent) positive detection
    for frame_bytes, result in zip(frames, results):
        if result:
            itype = result["incident_type"]
            conf  = result["confidence"]
            snapshot_b64 = f"data:image/jpeg;base64,{base64.b64encode(frame_bytes).decode()}"

            if _is_on_cooldown(req.camera_id, itype):
                return {
                    "detected":      True,
                    "cooldown":      True,
                    "incident_type": itype,
                    "confidence":    conf,
                    "snapshot":      snapshot_b64,
                    "scan_stats":    scan_stats,
                }

            camera = next((c for c in DEMO_CAMERAS if c["camera_id"] == req.camera_id),
                          {"camera_id": req.camera_id, "name": req.camera_id,
                           "location": "Unknown", "lat": 12.9716, "lng": 77.5946})
            summary = AIDetectionEngine.generate_summary(
                itype, conf, camera.get("name", ""), camera.get("location", "")
            )
            video_path = f"batch/{req.camera_id}/{itype.replace(' ', '_')}_{int(time.time())}.jpg"
            incident = _new_incident(
                incident_type=itype, confidence=conf,
                camera_id=req.camera_id, video_path=video_path,
                snapshot_b64=snapshot_b64, summary=summary,
                lat=camera.get("lat", 12.9716), lng=camera.get("lng", 77.5946),
            )
            notification = _NOTIFICATIONS[0] if _NOTIFICATIONS else None
            await _WS_MANAGER.broadcast({
                "event": "NEW_INCIDENT", "incident": incident,
                "notification": notification, "ts": incident["timestamp"],
            })
            return {
                "detected":     True,
                "incident":     incident,
                "notification": notification,
                "snapshot":     snapshot_b64,
                "scan_stats":   scan_stats,
            }

    # All frames clean
    latest_snap = f"data:image/jpeg;base64,{base64.b64encode(frames[-1]).decode()}" if frames else ""
    return {
        "detected":   False,
        "snapshot":   latest_snap,
        "scan_stats": scan_stats,
    }


@router.get("/ipcam/proxy-frame")
async def ipcam_proxy_frame(
    url:      str,
    timeout:  float = 4.0,
    username: Optional[str] = None,
    password: Optional[str] = None,
):
    """
    Proxy a single JPEG frame from an IP camera for browser display.
    The frontend uses this as the <img src="..."> to avoid CORS issues
    when it can't directly embed the MJPEG stream.

    GET /api/v1/cctv/ipcam/proxy-frame?url=http://192.168.1.6:8081/video&username=admin&password=12345
    """
    if not _HTTPX_OK:
        raise HTTPException(503, "httpx not available")

    # Use the same smart candidate logic; take the first (best) URL
    snapshot_url = _droidcam_candidates(url)[0]
    _auth = (username, password) if username else None

    try:
        # verify=False: phone cameras always have self-signed TLS certificates
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, verify=False, auth=_auth) as client:
            resp = await client.get(snapshot_url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "image/jpeg")
            # For MJPEG streams that slip through, extract a single JPEG
            body = resp.content
            jpeg = _extract_jpeg_from_mjpeg(body) or body
            return StreamingResponse(
                iter([jpeg]),
                media_type="image/jpeg",
                headers={
                    "Cache-Control": "no-cache, no-store",
                    "Access-Control-Allow-Origin": "*",
                },
            )
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"IP camera returned {e.response.status_code}")
    except Exception as e:
        raise HTTPException(502, f"Cannot reach IP camera: {e}")


@router.get("/ipcam/mjpeg-stream")
async def ipcam_mjpeg_stream(
    url:      str,
    username: Optional[str] = None,
    password: Optional[str] = None,
):
    """
    Passthrough MJPEG proxy with integrated frame buffer.

    Forwards the phone MJPEG stream to the browser <img> while siphoning
    complete JPEG frames into _FRAME_BUFFER so grab-frame can read them
    without opening a second connection to the camera.

    GET /api/v1/cctv/ipcam/mjpeg-stream?url=http://192.168.1.6:8081/video
    """
    if not _HTTPX_OK:
        raise HTTPException(503, "httpx not available")

    stream_url = _droidcam_candidates(url)[0]
    _auth      = (username, password) if username else None
    buf        = _frame_buffer(url)

    async def generate():
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=None, write=5.0, pool=5.0),
            follow_redirects=True,
            verify=False,
            auth=_auth,
        )
        try:
            pending = b""
            while True:
                try:
                    async with client.stream("GET", stream_url) as resp:
                        if resp.status_code == 401:
                            return
                        resp.raise_for_status()
                        async for chunk in resp.aiter_bytes(chunk_size=8192):
                            # Forward raw bytes to browser unchanged
                            yield chunk

                            # Siphon complete JPEG frames into the buffer
                            pending += chunk
                            if len(pending) > 1_048_576:
                                soi = pending.rfind(b'\xff\xd8')
                                pending = pending[soi:] if soi != -1 else b""

                            while True:
                                soi = pending.find(b'\xff\xd8')
                                if soi == -1:
                                    pending = b""
                                    break
                                eoi = pending.find(b'\xff\xd9', soi + 2)
                                if eoi == -1:
                                    pending = pending[soi:]
                                    break
                                jpeg = pending[soi: eoi + 2]
                                pending = pending[eoi + 2:]
                                # Drop oldest frame if queue full so AI always gets latest
                                if buf.full():
                                    try:
                                        buf.get_nowait()
                                    except asyncio.QueueEmpty:
                                        pass
                                try:
                                    buf.put_nowait(jpeg)
                                except asyncio.QueueFull:
                                    pass
                except asyncio.CancelledError:
                    return
                except Exception:
                    pass
                await asyncio.sleep(0.5)
        finally:
            await client.aclose()

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=--jpgboundary",
        headers={
            "Cache-Control":               "no-cache, no-store",
            "Access-Control-Allow-Origin": "*",
            "X-Accel-Buffering":           "no",
        },
    )


# ── Incidents ─────────────────────────────────────────────────────

@router.get("/incidents")
async def list_incidents(
    status:        Optional[str] = None,
    incident_type: Optional[str] = None,
    camera_id:     Optional[str] = None,
    limit:         int = 50,
    offset:        int = 0,
):
    data = _INCIDENTS
    if status:
        data = [i for i in data if i["status"] == status.upper()]
    if incident_type:
        data = [i for i in data if incident_type.lower() in i["incident_type"].lower()]
    if camera_id:
        data = [i for i in data if i["camera_id"] == camera_id]
    return {
        "incidents": data[offset:offset + limit],
        "total":     len(data),
        "pending":   sum(1 for i in _INCIDENTS if i["status"] == "PENDING"),
    }


@router.get("/incidents/{incident_id}")
async def get_incident(incident_id: str):
    inc = next((i for i in _INCIDENTS if i["incident_id"] == incident_id), None)
    if not inc:
        raise HTTPException(404, "Incident not found")
    return inc


@router.patch("/incidents/{incident_id}")
async def update_incident(incident_id: str, req: IncidentUpdateReq):
    """
    Officers confirm or dismiss an incident.
    Only after CONFIRM does the system recommend dispatch.

    Feedback learning:
      • CONFIRM     → incident snapshot is added to the model as a positive
                      example for that incident type so detection improves.
      • FALSE_ALARM → incident snapshot is added as "Normal / No Incident"
                      so the same visual pattern never triggers a false alert again.
    """
    inc = next((i for i in _INCIDENTS if i["incident_id"] == incident_id), None)
    if not inc:
        raise HTTPException(404, "Incident not found")

    action = req.action.upper()
    now    = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    if action == "CONFIRM":
        inc["status"]               = "CONFIRMED"
        inc["confirmed_at"]         = now
        inc["dispatch_recommended"] = True
        if req.notes:
            inc["notes"] = req.notes
    elif action == "FALSE_ALARM":
        inc["status"] = "FALSE_ALARM"
        inc["confirmed_at"] = now
        if req.notes:
            inc["notes"] = req.notes
    elif action == "DISPATCH":
        if inc["status"] != "CONFIRMED":
            raise HTTPException(400, "Incident must be CONFIRMED before dispatch")
        inc["status"]      = "DISPATCHED"
        inc["dispatched_at"] = now
    else:
        raise HTTPException(400, f"Unknown action: {action!r}")

    # ── Feedback learning ─────────────────────────────────────────────────
    # Feed the incident snapshot back into the model so it learns from every
    # officer decision.  Only CONFIRM and FALSE_ALARM carry feedback signal;
    # DISPATCH is a dispatch action, not a new label.
    if action in ("CONFIRM", "FALSE_ALARM"):
        snapshot_b64 = inc.get("snapshot", "")
        if snapshot_b64 and "base64," in snapshot_b64:
            try:
                raw_b64    = snapshot_b64.split("base64,", 1)[1]
                frame_bytes = base64.b64decode(raw_b64)
                learned = _learn_from_feedback(
                    frame_bytes,
                    inc["incident_type"],
                    is_false_alarm=(action == "FALSE_ALARM"),
                )
                inc["feedback_learned"] = learned
            except Exception as fb_err:
                print(f"[CCTV] Feedback learning error for {incident_id}: {fb_err}")
    # ─────────────────────────────────────────────────────────────────────

    # Broadcast status update to all WS clients
    await _WS_MANAGER.broadcast({
        "event":    "INCIDENT_UPDATED",
        "incident": inc,
        "ts":       now,
    })

    return {"message": f"Incident {incident_id} → {inc['status']}", "incident": inc}


# ── Police stations ───────────────────────────────────────────────

@router.get("/stations")
async def get_stations():
    return {"stations": POLICE_STATIONS, "total": len(POLICE_STATIONS)}


@router.get("/stations/nearest")
async def nearest_station(lat: float, lng: float):
    station = _nearest_station(lat, lng)
    if not station:
        raise HTTPException(404, "No stations found")
    return station


# ── Frame analysis (client-side camera → server AI) ───────────────

@router.post("/analyse-frame")
async def analyse_frame(req: AnalyseFrameReq):
    """
    Accept a base64 frame from a browser/mobile camera and run detection.
    This is the hook for webcam and IP-camera streams where the client
    periodically sends frames for server-side analysis.
    """
    try:
        frame_bytes = base64.b64decode(req.frame_b64.split(",")[-1])
    except Exception:
        raise HTTPException(400, "Invalid base64 frame")

    result = await _detect_frame_async(frame_bytes, req.camera_id)
    if not result:
        return {"detected": False}

    camera = next((c for c in DEMO_CAMERAS if c["camera_id"] == req.camera_id),
                  {"camera_id": req.camera_id, "name": req.camera_id,
                   "location": "Unknown", "lat": 12.9716, "lng": 77.5946})

    itype   = result["incident_type"]
    conf    = result["confidence"]
    summary = AIDetectionEngine.generate_summary(
        itype, conf, camera.get("name", ""), camera.get("location", "")
    )
    # Use the REAL frame as snapshot so the incident card shows what was actually seen
    snapshot   = f"data:image/jpeg;base64,{base64.b64encode(frame_bytes).decode()}"
    video_path = f"clips/{req.camera_id}/{itype.replace(' ', '_')}_{int(time.time())}.mp4"

    incident = _new_incident(
        incident_type=itype,
        confidence=conf,
        camera_id=req.camera_id,
        video_path=video_path,
        snapshot_b64=snapshot,
        summary=summary,
        lat=camera.get("lat", 12.9716),
        lng=camera.get("lng", 77.5946),
    )

    await _WS_MANAGER.broadcast({
        "event":    "NEW_INCIDENT",
        "incident": incident,
        "ts":       incident["timestamp"],
    })

    return {"detected": True, "incident": incident}


# ── Video file upload & analysis ──────────────────────────────────

@router.post("/upload-video")
async def upload_video(
    camera_id: str = Form(default="CAM-UPLOAD"),
    file: UploadFile = File(...),
):
    """
    Accept an uploaded MP4/AVI/MOV or image and run AI detection.
    Extracts multiple key-frames with OpenCV and runs the trained model
    on each one, returning the highest-confidence detection.
    Images (JPEG/PNG) are also accepted for instant testing.
    """
    allowed_video = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
    allowed_image = {".jpg", ".jpeg", ".png"}
    ext = os.path.splitext(file.filename or "")[-1].lower()
    if ext not in allowed_video | allowed_image:
        raise HTTPException(400, f"Unsupported format. Allowed: video ({', '.join(allowed_video)}) or image ({', '.join(allowed_image)})")

    content = await file.read()

    # ── Collect frames to analyse ──────────────────────────────────────
    frames: List[bytes] = []

    if ext in allowed_image:
        # Image — use directly
        frames = [content]
    elif _CV2_OK:
        # Video — extract frames at 0%, 15%, 30%, 50%, 70%, 85% positions
        import tempfile
        try:
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            cap   = cv2.VideoCapture(tmp_path)
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
            for frac in [0.0, 0.15, 0.30, 0.50, 0.70, 0.85]:
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * frac))
                ok, frame = cap.read()
                if ok and frame is not None:
                    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    frames.append(buf.tobytes())
            cap.release()
            os.unlink(tmp_path)
        except Exception as ve:
            print(f"[upload-video] frame extraction error: {ve}")

    if not frames:
        raise HTTPException(422, "Could not read any frames from the uploaded file")

    # ── Run trained detector on all frames, keep best result ──────────
    best_result: Optional[Dict[str, Any]] = None
    best_conf   = 0.0
    best_frame_bytes: bytes = frames[0]

    for fb in frames:
        r = _DETECTOR.detect_frame(fb, camera_id=camera_id)
        if r and r.get("confidence", 0) > best_conf:
            best_conf         = r["confidence"]
            best_result       = r
            best_frame_bytes  = fb

    if not best_result:
        # Nothing detected — return the first frame as snapshot so the user
        # can see what the model saw, with a "no incident" response
        snapshot_b64 = f"data:image/jpeg;base64,{base64.b64encode(best_frame_bytes).decode()}"
        return {
            "message":  "No incident detected in this footage",
            "file":     file.filename,
            "detected": False,
            "snapshot": snapshot_b64,
            "frames_analysed": len(frames),
            "incident": None,
        }

    camera = next((c for c in DEMO_CAMERAS if c["camera_id"] == camera_id),
                  {"camera_id": camera_id, "name": camera_id,
                   "location": "Uploaded Video", "lat": 12.9716, "lng": 77.5946})

    itype   = best_result["incident_type"]
    conf    = best_result["confidence"]
    summary = AIDetectionEngine.generate_summary(
        itype, conf, camera.get("name", camera_id),
        camera.get("location", "Uploaded Video"),
    )
    # Use the actual frame where the incident was detected as snapshot
    snapshot   = f"data:image/jpeg;base64,{base64.b64encode(best_frame_bytes).decode()}"
    video_path = f"uploads/{camera_id}/{file.filename}"

    incident = _new_incident(
        incident_type=itype,
        confidence=conf,
        camera_id=camera_id,
        video_path=video_path,
        snapshot_b64=snapshot,
        summary=summary,
        lat=camera.get("lat", 12.9716),
        lng=camera.get("lng", 77.5946),
    )

    await _WS_MANAGER.broadcast({
        "event":    "NEW_INCIDENT",
        "incident": incident,
        "ts":       incident["timestamp"],
    })

    return {
        "message":  f"Video analysed — {itype} detected ({round(conf*100)}% confidence)",
        "file":     file.filename,
        "detected": True,
        "frames_analysed": len(frames),
        "trigger":  best_result.get("trigger", "trained_model"),
        "incident": incident,
    }


# ── Debug / Testing endpoint ──────────────────────────────────────

class DebugFrameReq(BaseModel):
    frame_b64:   str             # base64 data URL or raw base64 JPEG
    camera_id:   str = "CAM-DEBUG"
    skip_scene_gate: bool = False  # set True to bypass scene-change check

@router.post("/debug-frame")
async def debug_frame(req: DebugFrameReq):
    """
    Submit a frame and see exactly what every detection layer scores.
    Use this during testing to understand why a frame does or doesn't trigger.

    Returns:
      layers:
        trained_model  — histogram k-NN result (distances per label)
        yolov8         — all detected COCO objects + contextual verdict
        cv2_heuristics — red-ratio and brightness values + verdict
      final_result     — what detect_frame() would actually return
      would_create_incident — whether this is still on cooldown

    Example (curl):
      curl -s -X POST http://localhost:8000/api/v1/cctv/debug-frame \\
        -H 'Content-Type: application/json' \\
        -d '{"frame_b64":"data:image/jpeg;base64,<b64>","camera_id":"CAM-1"}'
    """
    try:
        raw = req.frame_b64.split("base64,", 1)[-1]
        frame_bytes = base64.b64decode(raw)
    except Exception:
        raise HTTPException(400, "Invalid base64 frame")

    result: Dict[str, Any] = {
        "camera_id": req.camera_id,
        "frame_bytes": len(frame_bytes),
        "layers": {},
    }

    # ── Layer 0: scene-change check ───────────────────────────────
    scene_changed = True
    if _CV2_OK and not req.skip_scene_gate and req.camera_id:
        import numpy as np
        nparr = np.frombuffer(frame_bytes, np.uint8)
        frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame_bgr is not None:
            phash = _phash(frame_bgr)
            last  = _LAST_FRAME_HASH.get(req.camera_id, "")
            hamming_dist = _hamming(phash, last) if last else 256
            scene_changed = hamming_dist > 10
            result["layers"]["scene_gate"] = {
                "phash":          phash[:16] + "…",
                "hamming_vs_last": hamming_dist,
                "scene_changed":  scene_changed,
                "would_skip":     not scene_changed,
            }

    # ── Layer 1: trained histogram model ──────────────────────────
    try:
        from app.routers.training import (
            _compute_feature, _cosine_dist, _HIST_INDEX, _NORMAL_LABEL  # type: ignore
        )
    except ImportError:
        from app.routers.training import _compute_feature, _cosine_dist, _HIST_INDEX
        _NORMAL_LABEL = "Normal / No Incident"  # type: ignore

    trained_detail: Dict[str, Any] = {"available": bool(_HIST_INDEX)}
    if _HIST_INDEX:
        try:
            query = _compute_feature(frame_bytes)
            if query is not None:
                K = 3
                knn: Dict[str, float] = {}
                for label, entries in _HIST_INDEX.items():
                    dists = sorted(_cosine_dist(query, feat) for feat, _ in entries)
                    knn[label] = round(sum(dists[:K]) / len(dists[:K]), 4)
                ranked = sorted(knn.items(), key=lambda x: x[1])
                trained_detail["knn_distances"] = [
                    {"label": lbl, "distance": dist} for lbl, dist in ranked
                ]
                best_lbl, best_dist = ranked[0]
                normal_dist = knn.get("Normal / No Incident", 1.0)
                trained_detail["best_label"]   = best_lbl
                trained_detail["best_distance"] = best_dist
                trained_detail["normal_distance"] = normal_dist
                trained_detail["margin"] = round(normal_dist - best_dist, 4)
                trained_detail["threshold_pass"] = best_dist < 0.30
                trained_detail["margin_pass"] = (normal_dist - best_dist) >= 0.06
                trained_detail["verdict"] = (
                    None if (best_lbl == "Normal / No Incident"
                             or best_dist >= 0.30
                             or (normal_dist - best_dist) < 0.06)
                    else best_lbl
                )
        except Exception as e:
            trained_detail["error"] = str(e)
    result["layers"]["trained_model"] = trained_detail

    # ── Layer 2: YOLOv8 ───────────────────────────────────────────
    yolo_detail: Dict[str, Any] = {"available": _YOLO_OK}
    if _YOLO_OK and _CV2_OK:
        try:
            import numpy as np
            nparr = np.frombuffer(frame_bytes, np.uint8)
            frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame_bgr is not None:
                model = _get_yolo_model()
                if model:
                    results_y = model(frame_bgr, verbose=False)
                    detections = []
                    for r in results_y:
                        for box in r.boxes:
                            cls_name = r.names[int(box.cls[0])].lower()
                            conf     = round(float(box.conf[0]), 3)
                            x1, y1, x2, y2 = (round(float(v), 1) for v in box.xyxy[0])
                            detections.append({
                                "class": cls_name, "confidence": conf,
                                "bbox": [x1, y1, x2, y2]
                            })
                    detections.sort(key=lambda d: d["confidence"], reverse=True)
                    yolo_detail["detections"] = detections[:20]
                    yolo_verdict = _DETECTOR._yolo_detect_contextual(frame_bgr)
                    yolo_detail["verdict"] = yolo_verdict
        except Exception as e:
            yolo_detail["error"] = str(e)
    result["layers"]["yolov8"] = yolo_detail

    # ── Layer 3: OpenCV heuristics ────────────────────────────────
    cv2_detail: Dict[str, Any] = {"available": _CV2_OK}
    if _CV2_OK:
        try:
            import numpy as np
            nparr     = np.frombuffer(frame_bytes, np.uint8)
            frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame_bgr is not None:
                hsv        = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
                red_mask   = cv2.inRange(hsv, (0,   120, 70), (10,  255, 255))
                red_mask2  = cv2.inRange(hsv, (170, 120, 70), (180, 255, 255))
                red_ratio  = float(
                    (red_mask.sum() + red_mask2.sum())
                    / (frame_bgr.shape[0] * frame_bgr.shape[1] * 255)
                )
                brightness = float(frame_bgr.mean()) / 255.0
                cv2_detail["red_ratio"]    = round(red_ratio, 4)
                cv2_detail["brightness"]   = round(brightness, 4)
                cv2_detail["red_triggers"] = red_ratio > 0.12
                cv2_detail["dark_trigger"] = brightness < 0.10
                cv2_detail["verdict"]      = _DETECTOR._cv2_detect_frame(frame_bgr)
        except Exception as e:
            cv2_detail["error"] = str(e)
    result["layers"]["cv2_heuristics"] = cv2_detail

    # ── Final result (what the engine would actually return) ───────
    if not scene_changed and not req.skip_scene_gate:
        result["final_result"] = None
        result["reason"]       = "scene_unchanged — frame skipped"
    else:
        final = _DETECTOR.detect_frame(frame_bytes, camera_id=req.camera_id)
        result["final_result"] = final
        if final:
            result["would_create_incident"] = not _is_on_cooldown(
                req.camera_id, final["incident_type"]
            )
            secs_since = time.time() - _LAST_INCIDENT_TIME.get(
                (req.camera_id, final.get("incident_type", "")), 0
            )
            result["cooldown_seconds_remaining"] = max(
                0, round(30 - secs_since, 1)
            )

    return result


# ── Analytics ─────────────────────────────────────────────────────

@router.get("/analytics")
async def cctv_analytics():
    total     = len(_INCIDENTS)
    by_type   = {}
    by_status = {"PENDING": 0, "CONFIRMED": 0, "FALSE_ALARM": 0, "DISPATCHED": 0}
    by_camera = {}
    by_severity: Dict[str, int] = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}

    for inc in _INCIDENTS:
        it = inc["incident_type"]
        by_type[it]           = by_type.get(it, 0) + 1
        st = inc.get("status", "PENDING")
        if st in by_status:
            by_status[st] += 1
        cid = inc["camera_id"]
        by_camera[cid]        = by_camera.get(cid, 0) + 1
        sev = inc.get("severity", {}).get("level", "LOW")
        if sev in by_severity:
            by_severity[sev] += 1

    avg_conf = (
        round(sum(i["confidence"] for i in _INCIDENTS) / total, 3)
        if total else 0
    )

    return {
        "total_incidents": total,
        "by_type":         by_type,
        "by_status":       by_status,
        "by_camera":       by_camera,
        "by_severity":     by_severity,
        "avg_confidence":  avg_conf,
        "ws_connected":    _WS_MANAGER.connected_count,
    }


@router.get("/analytics/heatmap")
async def cctv_heatmap():
    """
    Rich heatmap data for the analytics dashboard.
    Returns:
      • hourly_counts      — incidents per hour of day (0-23)
      • daily_counts       — incidents by day of week
      • hotspots           — top 10 lat/lng clusters (weighted by severity)
      • trend_7d           — last 7 days incident count
      • per_camera         — per-camera stats (count, confirmed, false_alarm, avg_conf)
      • confirm_ratio      — fraction of CONFIRMED vs total resolved
      • false_alarm_ratio  — fraction of FALSE_ALARM vs total resolved
      • avg_response_time_s— mean seconds from detection to first action (confirm/dismiss)
      • mttr_s             — mean time to resolve (CONFIRMED incidents only)
      • peak_hour          — hour of day with most incidents (0-23)
      • peak_day           — day of week with most incidents
      • by_type_trend      — per incident-type counts for last 7 days
    """
    hourly: Dict[str, int] = {str(h): 0 for h in range(24)}
    daily:  Dict[str, int] = {"Mon": 0, "Tue": 0, "Wed": 0, "Thu": 0,
                               "Fri": 0, "Sat": 0, "Sun": 0}
    DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    hotspot_raw: List[Dict] = []
    last7: Dict[str, int] = {}
    by_type_last7: Dict[str, Dict[str, int]] = {}   # type → {date → count}

    # Response-time / MTTR accumulators
    response_times: List[float] = []
    mttr_times:     List[float] = []

    # Per-camera accumulators
    cam_stats: Dict[str, Dict] = {}

    for inc in _INCIDENTS:
        ts_str = inc.get("timestamp", "")
        inc_type = inc.get("incident_type", "Unknown")
        cam_id   = inc.get("camera_id", "unknown")
        status   = inc.get("status", "PENDING")
        conf     = inc.get("confidence", 0.0)

        # ── Per-camera stats ─────────────────────────────────────────────
        if cam_id not in cam_stats:
            cam_stats[cam_id] = {
                "camera_id":    cam_id,
                "camera_name":  inc.get("camera_name", cam_id),
                "location":     inc.get("camera_location", ""),
                "total":        0,
                "confirmed":    0,
                "false_alarm":  0,
                "dispatched":   0,
                "conf_sum":     0.0,
                "critical":     0,
            }
        cs = cam_stats[cam_id]
        cs["total"]    += 1
        cs["conf_sum"] += conf
        if status == "CONFIRMED":
            cs["confirmed"] += 1
        elif status == "FALSE_ALARM":
            cs["false_alarm"] += 1
        elif status == "DISPATCHED":
            cs["dispatched"] += 1
        sev_lvl = inc.get("severity", {}).get("level", "LOW")
        if sev_lvl == "CRITICAL":
            cs["critical"] += 1

        # ── Response time (detection → confirmed_at / false_alarm action) ─
        confirmed_at_str = inc.get("confirmed_at")
        if confirmed_at_str and ts_str:
            try:
                t_det   = time.mktime(time.strptime(ts_str,            "%Y-%m-%dT%H:%M:%SZ"))
                t_act   = time.mktime(time.strptime(confirmed_at_str,  "%Y-%m-%dT%H:%M:%SZ"))
                delta   = t_act - t_det
                if 0 <= delta < 86400:   # cap at 24 h to exclude stale data
                    response_times.append(delta)
                    if status in ("CONFIRMED", "DISPATCHED"):
                        mttr_times.append(delta)
            except Exception:
                pass

        # ── Time breakdown ────────────────────────────────────────────────
        try:
            t = time.strptime(ts_str, "%Y-%m-%dT%H:%M:%SZ")
            hour_key = str(t.tm_hour)
            hourly[hour_key] = hourly.get(hour_key, 0) + 1
            daily[DOW[t.tm_wday]] += 1
            day_key = ts_str[:10]
            last7[day_key] = last7.get(day_key, 0) + 1
            # per-type trend
            if inc_type not in by_type_last7:
                by_type_last7[inc_type] = {}
            by_type_last7[inc_type][day_key] = by_type_last7[inc_type].get(day_key, 0) + 1
        except Exception:
            pass

        sev_score = inc.get("severity", {}).get("score", 40)
        hotspot_raw.append({
            "lat":      inc.get("latitude", 0),
            "lng":      inc.get("longitude", 0),
            "weight":   sev_score,
            "type":     inc_type,
            "camera":   inc.get("camera_name", cam_id),
            "district": inc.get("district", ""),
        })

    # ── Aggregations ──────────────────────────────────────────────────────────
    total = len(_INCIDENTS)
    resolved = sum(1 for i in _INCIDENTS if i.get("status") in ("CONFIRMED", "FALSE_ALARM", "DISPATCHED"))
    confirmed_count  = sum(1 for i in _INCIDENTS if i.get("status") in ("CONFIRMED", "DISPATCHED"))
    false_alarm_count = sum(1 for i in _INCIDENTS if i.get("status") == "FALSE_ALARM")

    confirm_ratio   = round(confirmed_count  / resolved, 3) if resolved else 0.0
    false_alarm_ratio = round(false_alarm_count / resolved, 3) if resolved else 0.0
    avg_response    = round(sum(response_times) / len(response_times), 1) if response_times else None
    avg_mttr        = round(sum(mttr_times)     / len(mttr_times),     1) if mttr_times     else None

    # Peak hour / day
    peak_hour = int(max(hourly, key=lambda k: hourly[k])) if any(hourly.values()) else None
    peak_day  = max(daily, key=lambda k: daily[k]) if any(daily.values()) else None

    # Top 10 hotspot locations by weight
    hotspots_sorted = sorted(hotspot_raw, key=lambda x: x["weight"], reverse=True)[:10]

    # Last 7 unique days
    sorted_days = sorted(last7.items())[-7:]
    trend_7d = [{"date": d, "count": c} for d, c in sorted_days]

    # Per-type trend (last 7 days, same date range)
    date_range = [d for d, _ in sorted_days]
    type_trend = []
    for inc_type, date_map in by_type_last7.items():
        type_trend.append({
            "type":   inc_type,
            "counts": [{"date": d, "count": date_map.get(d, 0)} for d in date_range],
            "total":  sum(date_map.values()),
        })
    type_trend.sort(key=lambda x: x["total"], reverse=True)

    # Per-camera table (top 10 by incident count, compute avg_conf)
    cam_list = sorted(cam_stats.values(), key=lambda c: c["total"], reverse=True)[:10]
    for cs in cam_list:
        cs["avg_confidence"] = round(cs["conf_sum"] / cs["total"], 3) if cs["total"] else 0.0
        del cs["conf_sum"]   # don't expose raw accumulator

    return {
        "hourly_counts":        [{"hour": int(k), "count": v} for k, v in sorted(hourly.items(), key=lambda x: int(x[0]))],
        "daily_counts":         [{"day": d, "count": daily[d]} for d in DOW],
        "hotspots":             hotspots_sorted,
        "trend_7d":             trend_7d,
        "total":                total,
        # ── Enriched fields ──
        "per_camera":           cam_list,
        "confirm_ratio":        confirm_ratio,
        "false_alarm_ratio":    false_alarm_ratio,
        "avg_response_time_s":  avg_response,
        "mttr_s":               avg_mttr,
        "peak_hour":            peak_hour,
        "peak_day":             peak_day,
        "by_type_trend":        type_trend,
        "resolved_count":       resolved,
        "confirmed_count":      confirmed_count,
        "false_alarm_count":    false_alarm_count,
    }


# ─── DBSCAN Geo-Cluster Hotspot Analysis ─────────────────────────────────────

@router.get("/analytics/clusters")
async def geo_clusters(min_samples: int = 2, eps_km: float = 0.5):
    """
    Run DBSCAN on incident lat/lng coordinates to find real geographic hotspot
    clusters. Returns cluster centroids, member counts, dominant types and
    severity for each cluster.
    """
    if not _INCIDENTS:
        return {"clusters": [], "noise_count": 0, "total": 0}

    points = [(i["latitude"], i["longitude"], i) for i in _INCIDENTS
              if i.get("latitude") and i.get("longitude")]
    if len(points) < 2:
        return {"clusters": [], "noise_count": len(points), "total": len(points)}

    # Haversine distance in km via simple approximation
    import math as _math

    def _haversine(a, b):
        lat1, lon1 = a[0] * _math.pi / 180, a[1] * _math.pi / 180
        lat2, lon2 = b[0] * _math.pi / 180, b[1] * _math.pi / 180
        dlat, dlon = lat2 - lat1, lon2 - lon1
        h = _math.sin(dlat/2)**2 + _math.cos(lat1)*_math.cos(lat2)*_math.sin(dlon/2)**2
        return 6371 * 2 * _math.asin(_math.sqrt(h))

    coords = [(p[0], p[1]) for p in points]
    n = len(coords)

    # Simple DBSCAN without sklearn (pure Python)
    labels = [-1] * n
    cluster_id = 0
    visited = set()

    def _region_query(idx):
        return [j for j in range(n) if j != idx and _haversine(coords[idx], coords[j]) <= eps_km]

    def _expand(idx, neighbours, cid):
        labels[idx] = cid
        i = 0
        while i < len(neighbours):
            pt = neighbours[i]
            if pt not in visited:
                visited.add(pt)
                new_nb = _region_query(pt)
                if len(new_nb) >= min_samples:
                    neighbours.extend(nb for nb in new_nb if nb not in neighbours)
            if labels[pt] == -1:
                labels[pt] = cid
            i += 1

    for idx in range(n):
        if idx in visited:
            continue
        visited.add(idx)
        nb = _region_query(idx)
        if len(nb) < min_samples:
            labels[idx] = -1   # noise
        else:
            _expand(idx, nb, cluster_id)
            cluster_id += 1

    # Aggregate clusters
    clusters: Dict[int, List] = {}
    for idx, cid in enumerate(labels):
        clusters.setdefault(cid, []).append(points[idx])

    result_clusters = []
    for cid, members in clusters.items():
        if cid == -1:
            continue
        lats = [m[0] for m in members]
        lngs = [m[1] for m in members]
        incs = [m[2] for m in members]
        type_counts: Dict[str, int] = {}
        for inc in incs:
            t = inc.get("incident_type", "Unknown")
            type_counts[t] = type_counts.get(t, 0) + 1
        dominant_type = max(type_counts, key=lambda k: type_counts[k])
        critical_count = sum(1 for i in incs if i.get("severity", {}).get("level") == "CRITICAL")
        result_clusters.append({
            "cluster_id":     cid,
            "centroid_lat":   round(sum(lats) / len(lats), 5),
            "centroid_lng":   round(sum(lngs) / len(lngs), 5),
            "count":          len(members),
            "critical_count": critical_count,
            "dominant_type":  dominant_type,
            "type_breakdown": type_counts,
            "risk_score":     round(len(members) * (1 + critical_count * 0.5), 1),
            "maps_url":       f"https://www.google.com/maps/search/?api=1&query={sum(lats)/len(lats)},{sum(lngs)/len(lngs)}",
        })

    result_clusters.sort(key=lambda c: c["risk_score"], reverse=True)
    noise_count = labels.count(-1)

    return {
        "clusters":    result_clusters,
        "noise_count": noise_count,
        "total":       n,
        "params":      {"eps_km": eps_km, "min_samples": min_samples},
    }


# ─── Shift-based Patrol Recommender ──────────────────────────────────────────

@router.get("/analytics/patrol-schedule")
async def patrol_schedule():
    """
    Generate recommended patrol deployment schedule based on historical
    incident peak_hour and peak_day patterns. Returns 3 shifts × 7 days
    with recommended patrol intensity per time slot.
    """
    # Build hourly and daily distributions
    hourly: Dict[int, int] = {h: 0 for h in range(24)}
    daily: Dict[str, int]  = {"Mon": 0, "Tue": 0, "Wed": 0, "Thu": 0, "Fri": 0, "Sat": 0, "Sun": 0}
    DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    type_by_hour: Dict[int, Dict[str, int]] = {h: {} for h in range(24)}

    for inc in _INCIDENTS:
        ts_str = inc.get("timestamp", "")
        inc_type = inc.get("incident_type", "Unknown")
        try:
            t = time.strptime(ts_str, "%Y-%m-%dT%H:%M:%SZ")
            hourly[t.tm_hour] = hourly.get(t.tm_hour, 0) + 1
            daily[DOW[t.tm_wday]] = daily.get(DOW[t.tm_wday], 0) + 1
            type_by_hour[t.tm_hour][inc_type] = type_by_hour[t.tm_hour].get(inc_type, 0) + 1
        except Exception:
            pass

    max_hourly = max(hourly.values(), default=1) or 1
    max_daily  = max(daily.values(),  default=1) or 1

    # Define 3 shifts
    shifts = [
        {"name": "Morning Shift",   "start": 6,  "end": 14, "hours": list(range(6, 14))},
        {"name": "Afternoon Shift", "start": 14, "end": 22, "hours": list(range(14, 22))},
        {"name": "Night Shift",     "start": 22, "end": 6,  "hours": list(range(22, 24)) + list(range(0, 6))},
    ]

    schedule = []
    for shift in shifts:
        shift_total = sum(hourly.get(h, 0) for h in shift["hours"])
        shift_pct   = round(shift_total / max(sum(hourly.values()), 1) * 100, 1)
        peak_h      = max(shift["hours"], key=lambda h: hourly.get(h, 0))
        # Dominant incident type in this shift
        combined_types: Dict[str, int] = {}
        for h in shift["hours"]:
            for t, c in type_by_hour[h].items():
                combined_types[t] = combined_types.get(t, 0) + c
        dominant = max(combined_types, key=lambda k: combined_types[k]) if combined_types else "None"
        intensity = "HIGH" if shift_pct >= 40 else "MEDIUM" if shift_pct >= 20 else "LOW"

        day_rows = []
        for day in DOW:
            day_total = daily.get(day, 0)
            day_intensity = "HIGH" if day_total >= max_daily * 0.7 else "MEDIUM" if day_total >= max_daily * 0.3 else "LOW"
            day_rows.append({
                "day":             day,
                "incident_count":  day_total,
                "patrol_intensity": day_intensity,
                "recommended_units": 3 if day_intensity == "HIGH" else 2 if day_intensity == "MEDIUM" else 1,
            })

        schedule.append({
            "shift":             shift["name"],
            "hours":             f"{shift['start']:02d}:00 – {shift['end']:02d}:00",
            "total_incidents":   shift_total,
            "share_pct":         shift_pct,
            "peak_hour":         peak_h,
            "dominant_type":     dominant,
            "intensity":         intensity,
            "recommended_units": 3 if intensity == "HIGH" else 2 if intensity == "MEDIUM" else 1,
            "by_day":            day_rows,
        })

    return {
        "schedule":      schedule,
        "hourly_dist":   [{"hour": h, "count": hourly[h]} for h in range(24)],
        "daily_dist":    [{"day": d, "count": daily[d]} for d in DOW],
        "total_incidents": len(_INCIDENTS),
        "generated_at":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


# ─── SMS / WhatsApp Alert (MSG91 / stub) ─────────────────────────────────────

_SMS_LOG: List[Dict[str, Any]] = []   # in-memory log of sent alerts

class SMSAlertReq(BaseModel):
    incident_id: str
    phone:       str       # 10-digit mobile number (India)
    channel:     str = "SMS"   # SMS | WHATSAPP

@router.post("/incidents/{incident_id}/send-alert")
async def send_sms_alert(incident_id: str, req: SMSAlertReq):
    """
    Send an SMS or WhatsApp alert for a specific incident to the given phone
    number. Uses MSG91 when MSG91_AUTH_KEY env var is set; otherwise logs the
    message locally (stub mode).

    POST /api/v1/cctv/incidents/INC-00001/send-alert
    { "phone": "9876543210", "channel": "SMS" }
    """
    inc = next((i for i in _INCIDENTS if i["incident_id"] == incident_id), None)
    if not inc:
        raise HTTPException(404, "Incident not found")

    phone = req.phone.strip().lstrip("+")
    if not phone.isdigit() or len(phone) < 10:
        raise HTTPException(400, "Invalid phone number")
    if len(phone) == 10:
        phone = "91" + phone   # prepend India country code

    sev   = inc.get("severity", {}).get("level", "MEDIUM")
    itype = inc.get("incident_type", "Incident")
    loc   = inc.get("camera_location", inc.get("location", {}).get("address", "Unknown"))
    ts    = inc.get("timestamp", "")[:16].replace("T", " ")
    msg   = (
        f"[VV ALERT] {sev} {itype} detected at {loc} "
        f"at {ts} UTC. Incident: {incident_id}. "
        f"Karnataka State Police AI System."
    )

    sent_via = "stub"
    auth_key = os.environ.get("MSG91_AUTH_KEY", "")

    if auth_key:
        import urllib.request as _urllib_req
        import urllib.parse as _urllib_parse
        try:
            if req.channel.upper() == "WHATSAPP":
                # MSG91 WhatsApp API
                payload = json.dumps({
                    "integrated_number": "91" + os.environ.get("MSG91_WA_NUMBER", ""),
                    "content_type":      "template",
                    "payload": {
                        "to":       [{"user_wa_number": phone}],
                        "type":     "text",
                        "message":  msg,
                    }
                }).encode()
                req2 = _urllib_req.Request(
                    "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/",
                    data=payload,
                    headers={"authkey": auth_key, "Content-Type": "application/json"},
                )
            else:
                # MSG91 SMS API
                payload = json.dumps({
                    "sender":    os.environ.get("MSG91_SENDER_ID", "KSPVVG"),
                    "route":     "4",
                    "country":   "91",
                    "sms": [{"message": msg, "to": [phone]}],
                }).encode()
                req2 = _urllib_req.Request(
                    "https://api.msg91.com/api/v5/flow/",
                    data=payload,
                    headers={"authkey": auth_key, "Content-Type": "application/json"},
                )
            with _urllib_req.urlopen(req2, timeout=8) as resp:
                sent_via = "msg91"
        except Exception as sms_err:
            print(f"[CCTV] MSG91 send failed: {sms_err}")
            sent_via = f"msg91_error:{sms_err}"
    else:
        print(f"[CCTV][SMS-STUB] → {phone} ({req.channel}): {msg}")
        sent_via = "stub_logged"

    log_entry = {
        "incident_id": incident_id,
        "phone":       phone[-4:].rjust(14, "*"),   # mask digits
        "channel":     req.channel.upper(),
        "message":     msg,
        "sent_via":    sent_via,
        "sent_at":     time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "ok":          "error" not in sent_via,
    }
    _SMS_LOG.insert(0, log_entry)
    if len(_SMS_LOG) > 200:
        _SMS_LOG.pop()

    return {
        "message":  f"Alert {'sent' if log_entry['ok'] else 'logged (stub)'} via {req.channel}",
        "sent_via": sent_via,
        "channel":  req.channel.upper(),
        "ok":       log_entry["ok"],
    }


@router.get("/alerts/sms-log")
async def sms_alert_log(limit: int = 50):
    """Return last N SMS/WhatsApp alert log entries."""
    return {"log": _SMS_LOG[:limit], "total": len(_SMS_LOG)}


# ─── Auto-Retraining Status ───────────────────────────────────────────────────
# Tracks whether the background auto-retrain task ran and when.

_AUTO_RETRAIN_LOG: List[Dict[str, Any]] = []
_AUTO_RETRAIN_TASK: Optional[Any] = None


async def _auto_retrain_loop():
    """
    Runs in the background. Every 6 hours it checks if new feedback frames
    were collected (CONFIRM / FALSE_ALARM actions) and if so triggers a
    full benchmark + SVM retraining cycle via the training module.
    """
    global _AUTO_RETRAIN_LOG
    await asyncio.sleep(30)   # 30 s warm-up so server is fully started

    while True:
        try:
            # Count feedback samples collected since last retrain
            feedback_count = sum(
                1 for inc in _INCIDENTS
                if inc.get("feedback_learned") and inc.get("status") in ("CONFIRMED", "FALSE_ALARM")
            )
            if feedback_count > 0:
                print(f"[AutoRetrain] {feedback_count} feedback samples → triggering retraining…")
                try:
                    from app.routers.training import run_algorithm_benchmark
                    import concurrent.futures
                    loop = asyncio.get_event_loop()
                    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                        result = await loop.run_in_executor(
                            pool,
                            lambda: run_algorithm_benchmark(force=True),
                        )
                    entry = {
                        "triggered_at":   time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "feedback_count": feedback_count,
                        "n_samples":      result.get("n_samples", 0),
                        "best_algorithm": result.get("best_algorithm", ""),
                        "svm_status":     result.get("svm_retrain_status", ""),
                        "ok":             True,
                    }
                    print(f"[AutoRetrain] Done. SVM retrained on {entry['n_samples']} samples.")
                except Exception as train_err:
                    entry = {
                        "triggered_at":   time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "feedback_count": feedback_count,
                        "error":          str(train_err),
                        "ok":             False,
                    }
                    print(f"[AutoRetrain] Error: {train_err}")
                _AUTO_RETRAIN_LOG.insert(0, entry)
                if len(_AUTO_RETRAIN_LOG) > 50:
                    _AUTO_RETRAIN_LOG.pop()
            else:
                print(f"[AutoRetrain] No new feedback samples — skipping retrain")
        except asyncio.CancelledError:
            return
        except Exception as e:
            print(f"[AutoRetrain] Unexpected error: {e}")

        await asyncio.sleep(6 * 3600)   # run every 6 hours


@router.get("/analytics/auto-retrain-status")
async def auto_retrain_status():
    """Return auto-retrain log and next scheduled run time."""
    return {
        "log":     _AUTO_RETRAIN_LOG[:20],
        "running": _AUTO_RETRAIN_TASK is not None and not _AUTO_RETRAIN_TASK.done(),
        "total":   len(_AUTO_RETRAIN_LOG),
    }


@router.post("/analytics/retrain-now")
async def trigger_retrain_now():
    """Manually trigger an immediate SVM retraining cycle."""
    try:
        from app.routers.training import run_algorithm_benchmark
        import concurrent.futures
        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            result = await loop.run_in_executor(
                pool,
                lambda: run_algorithm_benchmark(force=True),
            )
        entry = {
            "triggered_at":   time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "feedback_count": -1,   # manual
            "n_samples":      result.get("n_samples", 0),
            "best_algorithm": result.get("best_algorithm", ""),
            "svm_status":     result.get("svm_retrain_status", ""),
            "ok":             True,
        }
        _AUTO_RETRAIN_LOG.insert(0, entry)
        return {"message": "Retraining complete", "result": entry}
    except Exception as exc:
        raise HTTPException(500, f"Retraining failed: {exc}") from exc


@router.get("/incidents/export")
async def export_incidents(
    fmt:    str = "csv",
    status: Optional[str] = None,
    limit:  int = 500,
):
    """
    Export incidents as CSV or JSON for offline analysis.
    GET /api/v1/cctv/incidents/export?fmt=csv
    GET /api/v1/cctv/incidents/export?fmt=json
    """
    data = _INCIDENTS
    if status:
        data = [i for i in data if i["status"] == status.upper()]
    data = data[:limit]

    if fmt.lower() == "json":
        return StreamingResponse(
            iter([json.dumps(data, indent=2).encode()]),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="incidents_{int(time.time())}.json"',
            },
        )

    # CSV export
    fieldnames = [
        "incident_id", "incident_type", "confidence", "status",
        "camera_id", "camera_name", "camera_location",
        "latitude", "longitude", "timestamp",
        "assigned_station", "assigned_station_phone",
        "severity_level", "severity_score",
        "district", "zone", "ai_summary",
    ]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for inc in data:
        row = {k: inc.get(k, "") for k in fieldnames}
        row["severity_level"] = inc.get("severity", {}).get("level", "")
        row["severity_score"] = inc.get("severity", {}).get("score", "")
        writer.writerow(row)

    content = output.getvalue().encode("utf-8-sig")   # UTF-8 BOM for Excel compat
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="incidents_{int(time.time())}.csv"',
        },
    )


# ── Police Notifications ───────────────────────────────────────────

class NotifAckReq(BaseModel):
    officer: Optional[str] = None

@router.get("/notifications")
async def list_notifications(
    unread_only: bool = False,
    severity:    Optional[str] = None,
    limit:       int = 50,
):
    """
    Return police notifications sorted newest first.
    Each notification includes severity level, exact GPS location, Google Maps URL,
    what3words address, assigned station, and ETA.
    """
    data = _NOTIFICATIONS
    if unread_only:
        data = [n for n in data if not n["read"]]
    if severity:
        data = [n for n in data if n["severity_level"] == severity.upper()]
    unread_count = sum(1 for n in _NOTIFICATIONS if not n["read"])
    return {
        "notifications": data[:limit],
        "total":         len(data),
        "unread":        unread_count,
    }


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, req: NotifAckReq):
    notif = next((n for n in _NOTIFICATIONS if n["notification_id"] == notification_id), None)
    if not notif:
        raise HTTPException(404, "Notification not found")
    notif["read"]             = True
    notif["acknowledged_by"]  = req.officer or "Officer"
    notif["acknowledged_at"]  = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return {"message": "Marked as read", "notification": notif}


@router.post("/notifications/read-all")
async def mark_all_read(req: NotifAckReq):
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    count = 0
    for n in _NOTIFICATIONS:
        if not n["read"]:
            n["read"]            = True
            n["acknowledged_by"] = req.officer or "Officer"
            n["acknowledged_at"] = now
            count += 1
    return {"message": f"{count} notifications marked as read"}


@router.get("/notifications/summary")
async def notification_summary():
    """Quick summary for the notification bell."""
    by_severity: Dict[str, int] = {}
    unread = 0
    for n in _NOTIFICATIONS:
        s = n.get("severity_level", "MEDIUM")
        by_severity[s] = by_severity.get(s, 0) + 1
        if not n["read"]:
            unread += 1
    return {
        "total":       len(_NOTIFICATIONS),
        "unread":      unread,
        "by_severity": by_severity,
        "critical_unread": sum(
            1 for n in _NOTIFICATIONS
            if not n["read"] and n.get("severity_level") == "CRITICAL"
        ),
    }


# ── Notification polling (long-poll style for clients without WS) ──

_POLL_CURSOR: int = 0   # monotonic notification counter clients use as cursor


@router.get("/notifications/poll")
async def poll_notifications(since_id: Optional[str] = None, timeout: int = 20):
    """
    Long-poll endpoint for police mobile apps that can't maintain WebSocket.
    Client sends since_id = last notification_id seen.
    Returns immediately with new notifications, or after timeout seconds.

    Usage: GET /api/v1/cctv/notifications/poll?since_id=NOTIF-00012&timeout=20
    """
    # Find index of since_id
    start_idx = 0
    if since_id:
        idx = next((i for i, n in enumerate(_NOTIFICATIONS) if n["notification_id"] == since_id), None)
        if idx is not None:
            start_idx = idx   # notifications are newest-first, so older ones are higher index

    deadline = time.time() + min(timeout, 30)
    while time.time() < deadline:
        # _NOTIFICATIONS is newest-first; find anything newer than since_id
        new_notifs = _NOTIFICATIONS[:start_idx] if start_idx > 0 else []
        if new_notifs or not since_id:
            return {
                "notifications": new_notifs[:20],
                "count":         len(new_notifs),
                "latest_id":     _NOTIFICATIONS[0]["notification_id"] if _NOTIFICATIONS else None,
                "unread":        sum(1 for n in _NOTIFICATIONS if not n["read"]),
            }
        await asyncio.sleep(1.0)

    return {
        "notifications": [],
        "count":         0,
        "latest_id":     _NOTIFICATIONS[0]["notification_id"] if _NOTIFICATIONS else None,
        "unread":        sum(1 for n in _NOTIFICATIONS if not n["read"]),
    }


# ═══════════════════════════════════════════════════════════════════
#  WEBSOCKET ENDPOINT
# ═══════════════════════════════════════════════════════════════════

@router.websocket("/ws")
async def cctv_websocket(websocket: WebSocket):
    """
    Real-time WebSocket endpoint.
    Clients connect here to receive live incident alerts.
    On connection, the last 10 incidents are pushed immediately.
    """
    conn_id = str(uuid.uuid4())

    # Try to extract user from query param token
    token = websocket.query_params.get("token", "")
    email = "anonymous"
    if token:
        try:
            from app.core.auth import _verify_demo_token
            user = _verify_demo_token(token)
            if user:
                email = user.email
        except Exception:
            pass

    await _WS_MANAGER.connect(websocket, conn_id, email)

    # Push current state immediately
    try:
        unread_notifs = [n for n in _NOTIFICATIONS if not n["read"]][:20]
        await websocket.send_text(json.dumps({
            "event":         "CONNECTED",
            "conn_id":       conn_id,
            "incidents":     _INCIDENTS[:10],
            "cameras":       DEMO_CAMERAS,
            "notifications": unread_notifs,
            "unread_count":  len(unread_notifs),
            "connected_users": _WS_MANAGER.connected_count,
            "ts":            time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }))
    except Exception:
        _WS_MANAGER.disconnect(conn_id)
        return

    # Keep alive + handle messages from client
    try:
        while True:
            msg = await websocket.receive_text()
            try:
                data = json.loads(msg)
                if data.get("type") == "ping":
                    await websocket.send_text(json.dumps({
                        "event": "pong",
                        "connected_users": _WS_MANAGER.connected_count,
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }))
            except Exception:
                pass
    except WebSocketDisconnect:
        _WS_MANAGER.disconnect(conn_id)
    except Exception:
        _WS_MANAGER.disconnect(conn_id)


# ═══════════════════════════════════════════════════════════════════
#  STARTUP / SHUTDOWN  (called from main.py lifespan)
# ═══════════════════════════════════════════════════════════════════

async def start_cctv_simulation():
    global _SIM_TASK
    if _SIM_TASK is None or _SIM_TASK.done():
        _SIM_TASK = asyncio.create_task(_simulation_loop())
        print("[CCTV] AI simulation loop started")


async def stop_cctv_simulation():
    global _SIM_TASK
    if _SIM_TASK and not _SIM_TASK.done():
        _SIM_TASK.cancel()
        try:
            await _SIM_TASK
        except asyncio.CancelledError:
            pass
    print("[CCTV] AI simulation loop stopped")
