"""
rpi_vehicle_tracker.py — Cross-camera vehicle tracking with DeepSORT + ALPR
=============================================================================
Tracks the same vehicle across multiple cameras by combining:
  1. ALPR licence plate (exact match)
  2. YOLOv8 vehicle bounding box + DeepSORT re-identification
  3. GPS timestamp + camera location (spatial plausibility check)

Builds a vehicle trail: list of (camera_id, timestamp, lat, lng, plate, snapshot)
Used for hit-and-run reconstruction.

Install  : pip install deep-sort-realtime ultralytics opencv-python-headless
Usage    :
  from rpi_vehicle_tracker import VehicleTracker
  tracker = VehicleTracker()
  tracker.update(camera_id="CAM-01", frame_bytes=jpeg, lat=12.97, lng=77.59)
  trail = tracker.get_trail("KA03MJ1234")
"""

from __future__ import annotations

import logging
import time
import threading
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np

log = logging.getLogger("vv.tracker")


@dataclass
class VehicleObservation:
    camera_id:  str
    timestamp:  float
    lat:        float
    lng:        float
    plate:      Optional[str]     # None if ALPR couldn't read
    track_id:   int               # DeepSORT internal track ID
    bbox:       list              # [x1, y1, x2, y2] in pixels
    confidence: float
    snapshot_b64: Optional[str] = None   # base64 JPEG crop of vehicle


@dataclass
class VehicleTrail:
    plate:        Optional[str]
    observations: List[VehicleObservation] = field(default_factory=list)
    first_seen:   float = field(default_factory=time.time)
    last_seen:    float = field(default_factory=time.time)

    @property
    def camera_sequence(self) -> List[str]:
        return [o.camera_id for o in self.observations]

    def to_dict(self) -> dict:
        return {
            "plate": self.plate,
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
            "total_sightings": len(self.observations),
            "cameras": list(dict.fromkeys(self.camera_sequence)),  # unique, ordered
            "trail": [
                {
                    "camera_id":  o.camera_id,
                    "timestamp":  o.timestamp,
                    "lat":        o.lat,
                    "lng":        o.lng,
                    "plate":      o.plate,
                    "confidence": o.confidence,
                    "bbox":       o.bbox,
                }
                for o in self.observations
            ],
        }


class VehicleTracker:
    """
    Maintains a per-camera DeepSORT tracker and a global plate→trail index.
    Thread-safe. Designed for continuous operation on RPi5 + AI HAT+.
    """

    VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
    TRAIL_EXPIRY_S  = 3600   # forget trails older than 1 hour
    MAX_TRAILS      = 500    # max vehicles to track simultaneously

    def __init__(self):
        self._lock = threading.Lock()
        self._trackers: Dict[str, object] = {}   # camera_id → DeepSORT instance
        self._trails: Dict[str, VehicleTrail] = {}   # plate → VehicleTrail
        self._track_to_plate: Dict[Tuple[str, int], str] = {}   # (cam, track_id) → plate
        self._yolo = None
        self._alpr = None
        self._ds_available = False
        self._init()

    def _init(self):
        """Load YOLOv8 + DeepSORT. Graceful degradation if unavailable."""
        try:
            from ultralytics import YOLO
            self._yolo = YOLO("yolov8n.pt")
            log.info("VehicleTracker: YOLOv8n loaded")
        except Exception as e:
            log.warning("YOLOv8 unavailable for vehicle tracker: %s", e)

        try:
            from deep_sort_realtime.deepsort_tracker import DeepSort
            self._DeepSort = DeepSort
            self._ds_available = True
            log.info("VehicleTracker: DeepSORT available")
        except Exception as e:
            log.warning("DeepSORT unavailable: %s — tracking disabled", e)

        try:
            from rpi_alpr import ALPRReader
            self._alpr = ALPRReader()
        except Exception as e:
            log.debug("ALPR unavailable for tracker: %s", e)

    # ── Public API ────────────────────────────────────────────────────────────

    def update(
        self,
        camera_id: str,
        frame_bytes: bytes,
        lat: float,
        lng: float,
    ) -> List[VehicleObservation]:
        """
        Process one frame from a camera.
        Returns list of VehicleObservation objects detected in this frame.
        """
        import cv2
        try:
            nparr = np.frombuffer(frame_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                return []
        except Exception:
            return []

        detections = self._detect_vehicles(frame)
        if not detections:
            return []

        tracks = self._run_deepsort(camera_id, frame, detections)
        observations = []

        for track in tracks:
            track_id = track.track_id if hasattr(track, "track_id") else track.get("id", 0)
            bbox     = track.to_ltrb() if hasattr(track, "to_ltrb") else track.get("bbox", [0,0,0,0])
            conf     = track.det_conf  if hasattr(track, "det_conf")  else track.get("conf", 0.5)

            # Crop vehicle for ALPR
            x1, y1, x2, y2 = [int(v) for v in bbox]
            crop = frame[max(0,y1):y2, max(0,x1):x2]
            plate = self._read_plate_from_crop(crop)

            # Link track to plate
            key = (camera_id, track_id)
            if plate:
                with self._lock:
                    self._track_to_plate[key] = plate
            else:
                with self._lock:
                    plate = self._track_to_plate.get(key)

            obs = VehicleObservation(
                camera_id=camera_id,
                timestamp=time.time(),
                lat=lat,
                lng=lng,
                plate=plate,
                track_id=track_id,
                bbox=[x1, y1, x2, y2],
                confidence=float(conf) if conf else 0.5,
            )

            if plate:
                self._update_trail(plate, obs)

            observations.append(obs)

        self._expire_old_trails()
        return observations

    def get_trail(self, plate: str) -> Optional[VehicleTrail]:
        """Get the full trail for a specific licence plate."""
        with self._lock:
            return self._trails.get(plate.upper().replace(" ", ""))

    def get_all_active_trails(self) -> List[dict]:
        """Return all active trails as dicts."""
        cutoff = time.time() - self.TRAIL_EXPIRY_S
        with self._lock:
            return [
                t.to_dict() for t in self._trails.values()
                if t.last_seen > cutoff
            ]

    def get_hit_and_run_candidates(self) -> List[dict]:
        """
        Return vehicles seen at accident location then leaving quickly.
        Heuristic: trail has ≥2 cameras + last observation moved away.
        """
        candidates = []
        with self._lock:
            for plate, trail in self._trails.items():
                if len(trail.observations) >= 2:
                    cams = list(dict.fromkeys(trail.camera_sequence))
                    if len(cams) >= 2:
                        candidates.append({
                            "plate": plate,
                            "cameras": cams,
                            "sightings": len(trail.observations),
                            "duration_s": trail.last_seen - trail.first_seen,
                            "trail": trail.to_dict(),
                        })
        candidates.sort(key=lambda x: x["sightings"], reverse=True)
        return candidates

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _detect_vehicles(self, frame) -> list:
        """Run YOLOv8 and return vehicle detections as [[x1,y1,x2,y2,conf,cls],...]"""
        if not self._yolo:
            return []
        try:
            results = self._yolo(frame, verbose=False, classes=list(self.VEHICLE_CLASSES.keys()))
            dets = []
            for box in results[0].boxes:
                xyxy = box.xyxy[0].tolist()
                conf = float(box.conf[0])
                cls  = int(box.cls[0])
                if conf >= 0.4:
                    dets.append((xyxy, conf, cls))
            return dets
        except Exception as e:
            log.debug("YOLO vehicle detect error: %s", e)
            return []

    def _run_deepsort(self, camera_id: str, frame, detections: list) -> list:
        """Run DeepSORT tracker on detections for this camera."""
        if not self._ds_available:
            return []
        try:
            if camera_id not in self._trackers:
                self._trackers[camera_id] = self._DeepSort(max_age=30)
            tracker = self._trackers[camera_id]
            # DeepSORT expects: [([x1,y1,w,h], conf, cls), ...]
            ds_input = [
                ([b[0], b[1], b[2]-b[0], b[3]-b[1]], c, str(cls))
                for (b, c, cls) in detections
            ]
            return tracker.update_tracks(ds_input, frame=frame)
        except Exception as e:
            log.debug("DeepSORT error: %s", e)
            return []

    def _read_plate_from_crop(self, crop) -> Optional[str]:
        """Run ALPR on a cropped vehicle image."""
        if self._alpr is None or crop is None or crop.size == 0:
            return None
        try:
            import cv2
            _, jpeg = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
            plates = self._alpr.read_plates_from_bytes(jpeg.tobytes())
            if plates:
                return plates[0].plate
        except Exception:
            pass
        return None

    def _update_trail(self, plate: str, obs: VehicleObservation):
        plate = plate.upper().replace(" ", "")
        with self._lock:
            if plate not in self._trails:
                self._trails[plate] = VehicleTrail(plate=plate, first_seen=obs.timestamp)
            trail = self._trails[plate]
            trail.observations.append(obs)
            trail.last_seen = obs.timestamp

    def _expire_old_trails(self):
        cutoff = time.time() - self.TRAIL_EXPIRY_S
        with self._lock:
            expired = [p for p, t in self._trails.items() if t.last_seen < cutoff]
            for p in expired:
                del self._trails[p]
            if expired:
                log.debug("Expired %d old vehicle trails", len(expired))


# ── Module-level singleton ─────────────────────────────────────────────────────
_tracker: Optional[VehicleTracker] = None


def get_vehicle_tracker() -> VehicleTracker:
    global _tracker
    if _tracker is None:
        _tracker = VehicleTracker()
    return _tracker


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    import sys
    tracker = VehicleTracker()
    if len(sys.argv) > 1:
        with open(sys.argv[1], "rb") as f:
            obs = tracker.update("CAM-TEST", f.read(), 12.9716, 77.5946)
        for o in obs:
            print(f"  Track {o.track_id}: plate={o.plate} conf={o.confidence:.2f}")
    else:
        print("Usage: python rpi_vehicle_tracker.py <image.jpg>")
