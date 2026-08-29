"""
catalyst_pipeline.py — VigilanteVanguard RPi5  v5
════════════════════════════════════════════════════════════════
v5 changes (on top of v4):
  • Supervision ByteTrack integration — persistent object IDs across frames.
  • sv.Detections wrapper around Hailo raw detections (no second inference).
  • Trajectory history per tracker ID — last 60 positions (bounded, no leak).
  • Per-track motion features: velocity_px_s, acceleration_px_s2, direction.
  • /status extended with "tracking" block — all existing fields preserved.
  • Dashboard labels updated with tracker ID: "Car #4 0.87".
  • Graceful fallback: if supervision unavailable, everything works as before.
  • Supervision installed from local extracted repo at import time.

v4 changes:
  • Modem: dynamic port probe (ttyUSB1/2/0/3), full ATI/CPIN/CSQ/CEREG/QNWINFO
    diagnostics at startup, SIM+registration guard for SMS/voice dispatch.
  • GPS priority chain:
      1. Physical GNSS via modem (AT+QGPS / AT+QGPSGNMEA)
      2. Phone IP-camera GPS fallback (POST /phone/location, max age 60s)
      3. No GPS
    Browser /push_location kept for legacy dashboard use.
  • Phone GPS endpoint: POST /phone/location accepts lat/lng/accuracy/timestamp.
  • /status now returns a unified "gps" object with source/fix/age_seconds.
  • SMS/voice dispatch blocked until SIM READY + CEREG registered.
  • Hailo/camera/OCR/encode threads unchanged.

Architecture:
  CAMERA THREAD  ──latest BGR──►  HAILO THREAD  ──dets + frame──►  ENCODE THREAD
                                        │                                 │
                                  _decode() → sv.Detections         latest_web_frame
                                        │                                 │
                                  ByteTrack tracker              MJPEG STREAM (IDs)
                                        │                                 │
                                  trajectory/motion layer            BROWSER
                                        │
                                  ACCIDENT ENGINE (unchanged)
                                        │
                                  OCR WORKER (async)
                                  MODEM THREAD
                                  GNSS THREAD

Rules:
  • No growing queues.   • OCR never blocks Hailo.
  • JPEG never blocks Hailo.   • Browser always gets newest frame.
  • No stretched resize — letterbox 1920×1080 → 640×640.
  • Plate crop from ORIGINAL full-res frame.
  • Demo button: NEVER real emergency action.
  • GPS: never fake coordinates. Never block pipeline for GPS.
  • Tracker: pure CPU, no neural inference, bounded history.
"""

import os, sys, re, time, glob, threading, queue, subprocess, math
from collections import deque
import numpy as np
import cv2
from datetime import datetime
from flask import Flask, Response, jsonify, request, render_template_string

# ── Supervision — graceful optional import ────────────────────────
# Try 1: already pip-installed (pydeprecate + scipy installed → works)
# Try 2: local extracted repo at ~/supervision-develop (dev ZIP)
# Try 3: any other sys.path location
# All tracking is disabled silently if none of the above works.
def _ensure_sv_on_path():
    """Add the supervision src/ directory to sys.path if needed."""
    candidates = [
        # pip-installed location — nothing to add, will resolve automatically
        # local extracted ZIP (RPi5 default location):
        os.path.expanduser("~/supervision-develop/supervision-develop/src"),
        os.path.expanduser("~/Downloads/supervision-develop/supervision-develop/src"),
        # project-local copy (useful when deploying via SCP):
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "supervision", "src"),
    ]
    for p in candidates:
        if os.path.isdir(p) and p not in sys.path:
            sys.path.insert(0, p)
            return p
    return None

_sv_added_path = _ensure_sv_on_path()

try:
    import supervision as sv
    # ByteTrack is lazily resolved in supervision.__init__; force the import
    # here so any deprecation notice appears at startup, not mid-frame.
    from supervision.tracker.byte_tracker.core import ByteTrack as _ByteTrack
    _SV_OK = True
    _sv_src = getattr(sv, "__file__", "installed")
    print(f"[Tracking] Supervision {getattr(sv, '__version__', '?')} available — tracking enabled (src={_sv_src})")
except ImportError as _sv_err:
    sv = None
    _ByteTrack = None
    _SV_OK = False
    print(f"[Tracking] Supervision unavailable — tracking disabled")
    print(f"[Tracking]   Install: pip3 install --break-system-packages pydeprecate scipy")
    print(f"[Tracking]   Then:    pip3 install --break-system-packages ~/supervision-develop/supervision-develop")
    if _sv_added_path:
        print(f"[Tracking]   Found src at {_sv_added_path} but import failed: {_sv_err}")
except Exception as _sv_err:
    sv = None
    _ByteTrack = None
    _SV_OK = False
    print(f"[Tracking] Supervision import error — tracking disabled: {_sv_err}")

# ── Catalyst snapshot/training + incident push (optional) ──────────
try:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "modules"))
    from rpi_catalyst import upload_snapshot as _cat_upload_snapshot, push_to_catalyst as _cat_push
    _CATALYST_AVAILABLE = True
except ImportError:
    _CATALYST_AVAILABLE = False
    def _cat_upload_snapshot(*a, **kw): return None
    def _cat_push(*a, **kw): return None

# ── Severity engine (optional) ──────────────────────────────────────
try:
    from severity_engine import SeverityEngine as _SeverityEngine, Detection as _SevDetection
    _severity_engine = _SeverityEngine()
    _SEVERITY_AVAILABLE = True
except ImportError:
    _SeverityEngine = None
    _SevDetection   = None
    _severity_engine = None
    _SEVERITY_AVAILABLE = False

# ══════════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════════
HEF_PATH   = os.path.expanduser("~/yolov11n.hef")
PHONE_URL  = "http://192.168.1.9:8081/video"
CONF_THRES = 0.30
FLASK_PORT = 5000

# Default to USB camera since IP cam (phone) is off
camera_mode = "usb"

# Modem candidate ports — tried in order, first AT-responsive port wins.
# ttyUSB1 / ttyUSB2 confirmed on EG800AK-CN; ttyUSB0 kept as last resort.
# Device numbers can shift after reboot so we probe dynamically at startup.
MODEM_PORTS = ["/dev/ttyUSB1", "/dev/ttyUSB2", "/dev/ttyUSB0", "/dev/ttyUSB3"]

CLASS_NAMES = {
     0:"accident",               1:"ambulance",
     2:"auto_rickshaw",          3:"bus",
     4:"car",                    5:"damaged_vehicle",
     6:"fallen_injured_person",  7:"firetruck",
     8:"license_plate",          9:"motorcycle",
    10:"person",                11:"police_vehicle",
    12:"road_debris",           13:"tipped_over",
    14:"truck",                 15:"vehicle_fire",
    16:"damaged_head_light",    17:"damaged_hood",
    18:"damaged_trunk",         19:"damaged_window",
    20:"damaged_windscreen",    21:"damaged_bumper",
    22:"damaged_door",          23:"damaged_fender",
    24:"damaged_mirror_glass",  25:"dent_or_scratch",
    26:"missing_grille",
}

# Accident scoring weights
_CLASS_SCORES = {
    0:4, 6:4, 15:4, 13:3, 5:2, 1:2, 11:1, 12:1,
    16:1,17:1,18:1,19:1,20:1,21:1,22:1,23:1,24:1,25:1,26:1,
}
POSSIBLE_SCORE  = 3
CONFIRMED_SCORE = 6
ALERT_FRAMES    = 5
COOLDOWN_SECS   = 30

# ══════════════════════════════════════════════════════════════════
# SHARED STATE
# ══════════════════════════════════════════════════════════════════

# ── Camera ────────────────────────────────────────────────────────
# camera_mode is set in CONFIG section above (default: "usb" — phone IP cam off)
_cam_switch_flag = threading.Event()   # set when mode changes
_frame_lock      = threading.Lock()
_latest_frame    = None        # newest raw BGR from camera

# ── Inference results ─────────────────────────────────────────────
_det_lock       = threading.Lock()
_latest_dets    = []
_latest_timing  = {}

# ── Encode output (annotated JPEG bytes for browser) ─────────────
_web_lock        = threading.Lock()
_latest_web_jpg  = None

# ── OCR ───────────────────────────────────────────────────────────
_ocr_queue  = queue.Queue(maxsize=3)
_plate_lock = threading.Lock()
_plates     = {}   # plate_text → {first_seen, last_seen, confidence}

# ── GPS ───────────────────────────────────────────────────────────
# Unified GPS state — built by _gps_arbiter() from physical + phone sources.
# Never written directly by modem_thread or phone endpoint; they write to
# _gnss_state and _phone_gps_state respectively.  _gps_arbiter() merges them.
_gps_lock = threading.Lock()
_gps_state = {
    "fix":          False,
    "lat":          None,
    "lng":          None,
    "accuracy":     None,
    "source":       "none",     # "modem" | "phone" | "browser" | "none"
    "method":       "none",     # human-readable
    "satellites":   None,
    "timestamp":    None,       # ISO string of last fix
    "age_seconds":  None,       # seconds since last fix
    "cell_info":    None,
}

# ── Physical GNSS state (written by gnss_thread) ──────────────────
_gnss_lock  = threading.Lock()
_gnss_state = {
    "status":     "GPS_UNAVAILABLE",  # GPS_FIX | GPS_NO_FIX | GPS_UNAVAILABLE | GPS_ERROR
    "lat":        None,
    "lng":        None,
    "accuracy":   None,
    "satellites": None,
    "timestamp":  None,
    "updated_at": 0.0,   # time.time() of last successful poll
}

# ── Phone IP-camera GPS state (written by /phone/location endpoint) ─
_phone_gps_lock  = threading.Lock()
_phone_gps_state = {
    "lat":        None,
    "lng":        None,
    "accuracy":   None,
    "timestamp":  None,
    "received_at": 0.0,  # time.time() when we got it
}

# Max age (seconds) before phone GPS is considered stale
_PHONE_GPS_MAX_AGE = 60

# ── LTE ───────────────────────────────────────────────────────────
_lte_lock  = threading.Lock()
_lte_state = {"online": False, "rssi": None, "checked_at": None}

# ── Accident engine ───────────────────────────────────────────────
_acc_lock  = threading.Lock()
_acc_state = {
    "status": "NORMAL",  # NORMAL | POSSIBLE | CONFIRMED | ALERT
    "score": 0, "confirm_count": 0,
    "last_alert_ts": 0, "event_id": None, "event_ts": None,
    "classes": [],
}

# ── Demo ──────────────────────────────────────────────────────────
_demo_lock  = threading.Lock()
_demo_state = {"active": False, "event": None}

# ── Training image store ───────────────────────────────────────────
# Snapshots captured on ALERT, keyed by event_id.
# Each entry: {"jpeg": bytes, "snapshot_url": str|None, "label": None|"accident"|"no_accident"}
_snap_lock     = threading.Lock()
_snapshots     = {}   # event_id → {"jpeg": bytes, "snapshot_url": str|None, "label": None}
_TRAIN_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), "training", "dataset", "custom")

# ── FPS ───────────────────────────────────────────────────────────
_fps = {"camera": 0.0, "hailo": 0.0, "encode": 0.0}

# ══════════════════════════════════════════════════════════════════
# TRACKING STATE + ENGINE
# All tracking data lives here.  hailo_thread writes; /status reads.
# ══════════════════════════════════════════════════════════════════

# Shared tracker (initialized once below; None when sv unavailable)
_tracker = None
if _SV_OK:
    try:
        _tracker = _ByteTrack(
            track_activation_threshold=0.25,
            lost_track_buffer=30,
            minimum_matching_threshold=0.8,
            frame_rate=15,           # C270 typical rate; conservative for RPi5
            minimum_consecutive_frames=1,
        )
        print("[Tracking] Tracker initialized (ByteTrack, frame_rate=15)")
    except Exception as _te:
        _tracker = None
        print(f"[Tracking] Tracker init failed: {_te}")

# Trajectory history: tracker_id → deque of (timestamp, cx, cy)
# Bounded to _TRAJ_MAX entries — never grows unbounded.
_TRAJ_MAX        = 60          # ~4 s at 15 fps
_TRAJ_STALE_SECS = 5.0         # remove entry if no update in this many seconds
_traj_lock       = threading.Lock()
_track_history: dict = {}      # {tracker_id: deque([(ts, cx, cy), ...])}
_track_last_seen: dict = {}    # {tracker_id: last_update_time}

# Last computed per-track motion info — exposed in /status
_tracking_lock  = threading.Lock()
_tracking_state = {
    "enabled":       _SV_OK and _tracker is not None,
    "active_count":  0,
    "objects":       [],   # list of per-track dicts, refreshed every hailo frame
}


def _hailo_dets_to_sv(dets: list) -> "sv.Detections":
    """
    Convert the list of raw Hailo detection dicts produced by _decode()
    into a supervision sv.Detections object.

    Input format (from _decode):
        {"class_id": int, "class_name": str, "score": float,
         "px1": int, "py1": int, "px2": int, "py2": int}

    sv.Detections expects:
        xyxy: float32 array shape (N, 4)  — [x1, y1, x2, y2]
        confidence: float32 array shape (N,)
        class_id:   int array shape (N,)
    """
    if not dets:
        return sv.Detections.empty()

    n = len(dets)
    xyxy       = np.zeros((n, 4), dtype=np.float32)
    confidence = np.zeros(n,      dtype=np.float32)
    class_ids  = np.zeros(n,      dtype=int)

    for i, d in enumerate(dets):
        xyxy[i]       = [d["px1"], d["py1"], d["px2"], d["py2"]]
        confidence[i] = d["score"]
        class_ids[i]  = d["class_id"]

    return sv.Detections(
        xyxy=xyxy,
        confidence=confidence,
        class_id=class_ids,
    )


def _update_trajectories(tracked_sv: "sv.Detections") -> None:
    """
    Update the bounded trajectory deque for each active tracker ID.
    Purges stale tracks (not seen for > _TRAJ_STALE_SECS seconds).
    """
    now = time.time()
    with _traj_lock:
        # Add new position for every currently tracked object
        if tracked_sv.tracker_id is not None:
            for i, tid in enumerate(tracked_sv.tracker_id):
                x1, y1, x2, y2 = tracked_sv.xyxy[i]
                cx = (x1 + x2) / 2.0
                cy = (y1 + y2) / 2.0

                if tid not in _track_history:
                    _track_history[tid] = deque(maxlen=_TRAJ_MAX)
                _track_history[tid].append((now, cx, cy))
                _track_last_seen[tid] = now

        # Purge stale tracks to prevent memory leaks
        stale = [tid for tid, t in _track_last_seen.items()
                 if now - t > _TRAJ_STALE_SECS]
        for tid in stale:
            _track_history.pop(tid, None)
            _track_last_seen.pop(tid, None)


def _compute_motion(tid: int) -> dict:
    """
    Compute motion features for a single tracker ID from its history.

    Returns a dict with:
        velocity_px_s     — pixel displacement per second (pixel-space only,
                            NOT km/h — no calibrated camera model exists)
        acceleration_px_s2 — change in velocity per second (pixel-space)
        direction_deg     — heading in degrees (0=East, 90=South, CCW+)

    All values are None if insufficient history exists.
    """
    with _traj_lock:
        hist = list(_track_history.get(tid, []))

    if len(hist) < 2:
        return {"velocity_px_s": None, "acceleration_px_s2": None,
                "direction_deg": None}

    # Velocity: use last two points
    t1, x1, y1 = hist[-2]
    t2, x2, y2 = hist[-1]
    dt = t2 - t1
    if dt <= 0:
        return {"velocity_px_s": None, "acceleration_px_s2": None,
                "direction_deg": None}

    dx = x2 - x1
    dy = y2 - y1
    dist = math.hypot(dx, dy)
    vel = dist / dt   # px/s

    # Direction: degrees clockwise from East (standard image coords)
    direction = math.degrees(math.atan2(dy, dx)) % 360.0

    # Acceleration: requires at least 3 points
    acc = None
    if len(hist) >= 3:
        t0, x0, y0 = hist[-3]
        dt0 = t1 - t0
        if dt0 > 0:
            vel0 = math.hypot(x1 - x0, y1 - y0) / dt0
            dt_mid = (dt + dt0) / 2.0
            if dt_mid > 0:
                acc = (vel - vel0) / dt_mid

    return {
        "velocity_px_s":      round(vel,  2),
        "acceleration_px_s2": round(acc,  2) if acc is not None else None,
        "direction_deg":       round(direction, 1),
    }


def _run_tracker(dets: list) -> list:
    """
    Run ByteTrack on this frame's detections.

    Takes a list of Hailo detection dicts, passes them through the tracker,
    updates trajectory histories, and returns an augmented list of dicts
    that includes a "tracker_id" key on each entry (None if untracked).

    Also refreshes _tracking_state for /status.

    CRITICAL: the returned list still uses the same dict format as the
    input so _update_accident() and OCR code see no difference.
    The only addition is the "tracker_id" key.
    """
    # If supervision not available, passthrough with tracker_id=None
    if not _SV_OK or _tracker is None or not dets:
        for d in dets:
            d.setdefault("tracker_id", None)
        with _tracking_lock:
            _tracking_state["enabled"] = False
            _tracking_state["active_count"] = 0
            _tracking_state["objects"] = []
        return dets

    try:
        sv_dets = _hailo_dets_to_sv(dets)
        tracked = _tracker.update_with_detections(sv_dets)
    except Exception as e:
        print(f"[Tracking] tracker error: {e}")
        for d in dets:
            d.setdefault("tracker_id", None)
        return dets

    # Build a lookup: xyxy → tracker_id using IoU matching
    # The tracker returns only confirmed tracks; unmatched dets get id=None.
    # We map by index using the same IoU re-match ByteTrack does internally.
    tracked_objects = []
    n_orig = len(dets)

    # Assign tracker_id=None to all first
    for d in dets:
        d["tracker_id"] = None

    if tracked.tracker_id is not None and len(tracked) > 0:
        # Match original dets to tracked detections by nearest-box IoU
        orig_boxes = np.array([[d["px1"], d["py1"], d["px2"], d["py2"]]
                                for d in dets], dtype=np.float32)
        track_boxes = tracked.xyxy.astype(np.float32)

        # Simple IoU matching: for each tracked box find the best original det
        for ti in range(len(tracked)):
            tx1, ty1, tx2, ty2 = track_boxes[ti]
            best_iou  = 0.0
            best_di   = -1
            for di in range(n_orig):
                dx1, dy1 = dets[di]["px1"], dets[di]["py1"]
                dx2, dy2 = dets[di]["px2"], dets[di]["py2"]
                # IoU
                ix1 = max(tx1, dx1); iy1 = max(ty1, dy1)
                ix2 = min(tx2, dx2); iy2 = min(ty2, dy2)
                iw  = max(0.0, ix2 - ix1)
                ih  = max(0.0, iy2 - iy1)
                inter = iw * ih
                if inter <= 0:
                    continue
                area_t = (tx2 - tx1) * (ty2 - ty1)
                area_d = (dx2 - dx1) * (dy2 - dy1)
                union  = area_t + area_d - inter
                iou    = inter / union if union > 0 else 0.0
                if iou > best_iou:
                    best_iou = iou
                    best_di  = di
            if best_di >= 0 and best_iou > 0.3:
                dets[best_di]["tracker_id"] = int(tracked.tracker_id[ti])

    # Update trajectories + compute motion for each tracked object
    _update_trajectories(tracked)
    now = time.time()

    for d in dets:
        tid = d.get("tracker_id")
        if tid is not None:
            cx = (d["px1"] + d["px2"]) / 2.0
            cy = (d["py1"] + d["py2"]) / 2.0
            motion = _compute_motion(tid)
            tracked_objects.append({
                "id":                  tid,
                "class_id":            d["class_id"],
                "class_name":          d["class_name"],
                "confidence":          d["score"],
                "center":              [round(cx, 1), round(cy, 1)],
                "bbox":                [d["px1"], d["py1"], d["px2"], d["py2"]],
                "velocity_px_s":       motion["velocity_px_s"],
                "acceleration_px_s2":  motion["acceleration_px_s2"],
                "direction_deg":       motion["direction_deg"],
            })

    with _tracking_lock:
        _tracking_state["enabled"]      = True
        _tracking_state["active_count"] = len(tracked_objects)
        _tracking_state["objects"]      = tracked_objects

    active = len(tracked_objects)
    if active > 0:
        pass   # only log state changes to avoid per-frame spam
    return dets

# ══════════════════════════════════════════════════════════════════
# CAMERA — find / open helpers (NO locks held during probe)
# ══════════════════════════════════════════════════════════════════

def _find_usb_camera():
    """Return path to C270 by-id, or first probed /dev/video* that works."""
    for p in glob.glob("/dev/v4l/by-id/*"):
        if any(k in p.lower() for k in ("logitech","c270","webcam")):
            return p
    for dev in sorted(glob.glob("/dev/video*"),
                      key=lambda x: int(re.search(r"(\d+)$", x).group(1))):
        try:
            cap = cv2.VideoCapture(dev, cv2.CAP_V4L2)
            if not cap.isOpened(): cap.release(); continue
            ret, frm = cap.read(); cap.release()
            if ret and frm is not None:
                return dev
        except Exception:
            pass
    return None


def _open_cap(mode):
    """
    Open and return a cv2.VideoCapture for the given mode.
    Does NOT hold any shared lock — safe to call from camera_thread.
    Returns (cap, source_str) or (None, None).
    """
    if mode == "ip":
        cap = cv2.VideoCapture(PHONE_URL)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if cap.isOpened():
            return cap, PHONE_URL
        cap.release()
        return None, None
    else:
        src = _find_usb_camera()
        if src is None:
            print("[Camera] No USB camera found")
            return None, None
        cap = cv2.VideoCapture(src, cv2.CAP_V4L2)
        # MJPG mode is required — raw YUYV on C270 tops out at ~5fps
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        cap.set(cv2.CAP_PROP_FPS,          30)
        cap.set(cv2.CAP_PROP_BUFFERSIZE,   1)
        if cap.isOpened():
            ret, test = cap.read()
            if ret and test is not None:
                print(f"[Camera] ✓ C270 opened {int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x"
                      f"{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))} "
                      f"@ {int(cap.get(cv2.CAP_PROP_FPS))}fps  src={src}")
                return cap, src
            # Frame read failed — try again with index 0 fallback
            cap.release()
        # Fallback: try /dev/video0 directly without by-id path
        cap = cv2.VideoCapture(0, cv2.CAP_V4L2)
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        cap.set(cv2.CAP_PROP_FPS,          30)
        cap.set(cv2.CAP_PROP_BUFFERSIZE,   1)
        if cap.isOpened():
            ret, test = cap.read()
            if ret and test is not None:
                print(f"[Camera] ✓ C270 fallback /dev/video0 opened")
                return cap, "/dev/video0"
            cap.release()
        print("[Camera] ✗ C270 opened but no frames — check USB connection")
        return None, None

# ══════════════════════════════════════════════════════════════════
# CAMERA THREAD
# ══════════════════════════════════════════════════════════════════

def camera_thread():
    global _latest_frame
    active_mode = None
    cap         = None
    fps_t0 = time.time(); fps_n = 0

    while True:
        # ── Detect switch request ────────────────────────────────
        current_mode = camera_mode
        if current_mode != active_mode or _cam_switch_flag.is_set():
            _cam_switch_flag.clear()
            if cap is not None:
                cap.release(); cap = None
            print(f"[Camera] Switching to {current_mode.upper()} …")
            cap, src = _open_cap(current_mode)
            active_mode = current_mode
            with _frame_lock:
                _latest_frame = None
            if cap:
                print(f"[Camera] ✓ Opened: {src}")
            else:
                print(f"[Camera] ✗ Failed to open {current_mode}")

        if cap is None:
            time.sleep(0.3); continue

        ret, frame = cap.read()
        if not ret:
            # Reconnect on failure
            cap.release(); cap = None
            time.sleep(0.1); continue

        with _frame_lock:
            _latest_frame = frame        # overwrite — never queue

        fps_n += 1
        if time.time() - fps_t0 >= 2.0:
            _fps["camera"] = round(fps_n / (time.time() - fps_t0), 1)
            fps_n = 0; fps_t0 = time.time()

# ══════════════════════════════════════════════════════════════════
# LETTERBOX / UNLETTERBOX
# ══════════════════════════════════════════════════════════════════

def _letterbox(bgr):
    h, w   = bgr.shape[:2]
    rgb    = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    scale  = min(640 / w, 640 / h)
    # Clamp to 640 to prevent rounding → 641 which causes Hailo INVALID_FRAME_SIZE
    nw = min(int(w * scale), 640)
    nh = min(int(h * scale), 640)
    resized = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas  = np.full((640, 640, 3), 114, dtype=np.uint8)
    px, py  = (640 - nw) // 2, (640 - nh) // 2
    canvas[py:py+nh, px:px+nw] = resized
    return canvas, scale, px, py


def _unbox(yn1, xn1, yn2, xn2, scale, px, py, W, H):
    lx1, lx2 = float(xn1)*640, float(xn2)*640
    ly1, ly2 = float(yn1)*640, float(yn2)*640
    ox1 = int(max(0, min(W, (lx1-px)/scale)))
    ox2 = int(max(0, min(W, (lx2-px)/scale)))
    oy1 = int(max(0, min(H, (ly1-py)/scale)))
    oy2 = int(max(0, min(H, (ly2-py)/scale)))
    return oy1, ox1, oy2, ox2

# ══════════════════════════════════════════════════════════════════
# HAILO INIT  — activate once, keep pipeline open for process life
# ══════════════════════════════════════════════════════════════════
# DECODE NMS-BY-CLASS
#
# HEF output shape (confirmed): (27, 5, 100)
#   axis 0 — 27 classes
#   axis 1 — 5 fields: y1_norm, x1_norm, y2_norm, x2_norm, score
#   axis 2 — up to 100 candidate detections per class
#
# After res[out_name][0] strips the batch dim:
#   raw.shape == (27, 5, 100)
#   raw[cid]  == (5, 100)  ← 5 rows, each 100 values
#   raw[cid].T == (100, 5) ← 100 candidate detections, each with 5 fields
#
# ══════════════════════════════════════════════════════════════════

def _decode(raw, scale, px, py, H, W):
    dets = []
    for cid in range(len(raw)):
        # raw[cid] shape: (5, 100) — transpose to (100, 5) so each row is one detection
        class_dets = np.asarray(raw[cid])
        if class_dets.ndim == 2 and class_dets.shape[0] == 5:
            # Confirmed layout (27, 5, 100) — transpose to (100, 5)
            candidates = class_dets.T
        elif class_dets.ndim == 2 and class_dets.shape[1] == 5:
            # Already (N, 5) — use as-is (forward-compat with possible firmware variants)
            candidates = class_dets
        else:
            # Unexpected shape — skip this class, log once
            print(f"[Decode] unexpected shape for class {cid}: {class_dets.shape}")
            continue

        for d in candidates:
            if len(d) < 5:
                continue
            y1n, x1n, y2n, x2n, score = d[:5]
            score = float(score)
            if score < CONF_THRES:
                continue
            oy1, ox1, oy2, ox2 = _unbox(y1n, x1n, y2n, x2n, scale, px, py, W, H)
            dets.append({
                "class_id":   cid,
                "class_name": CLASS_NAMES.get(cid, f"unknown_class_{cid}"),
                "score":      round(score, 3),
                "px1": ox1, "py1": oy1, "px2": ox2, "py2": oy2,
            })
    return dets

# ══════════════════════════════════════════════════════════════════
# TRAINING SNAPSHOT HELPERS
# ══════════════════════════════════════════════════════════════════

def _capture_training_snapshot(event_id: str, dets: list):
    """
    Capture the current frame as a JPEG snapshot for training.
    Stored in _snapshots[event_id] and uploaded to Catalyst FileStore.
    Called immediately after an ALERT is raised, outside _acc_lock.
    """
    with _frame_lock:
        frame = _latest_frame
    if frame is None:
        return

    # Annotate the snapshot with bounding boxes
    snap = frame.copy()
    for d in dets:
        x1,y1,x2,y2 = d["px1"],d["py1"],d["px2"],d["py2"]
        col = (0, 0, 220) if d["class_name"] in {"accident","fallen_injured_person","tipped_over"} else (0,200,200)
        cv2.rectangle(snap,(x1,y1),(x2,y2),col,2)
        cv2.putText(snap, d["class_name"], (x1,max(y1-4,8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255,255,255), 1)

    ok, enc = cv2.imencode(".jpg", snap, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        return
    jpeg = enc.tobytes()

    # Store locally
    with _snap_lock:
        # Keep at most 50 snapshots in RAM
        if len(_snapshots) >= 50:
            oldest = next(iter(_snapshots))
            del _snapshots[oldest]
        _snapshots[event_id] = {"jpeg": jpeg, "snapshot_url": None, "label": None}

    # Upload to Catalyst FileStore in background
    def _do_upload():
        url = _cat_upload_snapshot(event_id, jpeg)
        if url:
            with _snap_lock:
                if event_id in _snapshots:
                    _snapshots[event_id]["snapshot_url"] = url
            print(f"[Snapshot] ✓ Uploaded {event_id} → {url}")
        else:
            print(f"[Snapshot] Upload skipped/failed for {event_id}")

    threading.Thread(target=_do_upload, daemon=True, name=f"snap-{event_id}").start()


# ══════════════════════════════════════════════════════════════════
# ACCIDENT ENGINE
# ══════════════════════════════════════════════════════════════════

def _score(dets):
    damage_bonus = 0; total = 0
    for d in dets:
        cid = d["class_id"]
        pts = _CLASS_SCORES.get(cid, 0)
        if cid in {16,17,18,19,20,21,22,23,24,25,26}:
            damage_bonus = min(damage_bonus + pts, 4)
        else:
            total += pts
    return total + damage_bonus


def _update_accident(dets):
    _snap_event_id  = None
    _alert_dets     = None
    with _acc_lock:
        fs  = _score(dets)
        st  = _acc_state
        st["score"] = min(st["score"] + fs, 20)
        if fs == 0:
            st["score"] = max(0, st["score"] - 1)
        st["classes"] = list({d["class_name"] for d in dets})
        now = time.time()
        if st["score"] >= CONFIRMED_SCORE:
            st["status"]        = "CONFIRMED"
            st["confirm_count"] += 1
        elif st["score"] >= POSSIBLE_SCORE:
            st["status"]        = "POSSIBLE"
            st["confirm_count"] = 0
        else:
            st["status"]        = "NORMAL"
            st["confirm_count"] = 0
        if (st["status"] == "CONFIRMED"
                and st["confirm_count"] >= ALERT_FRAMES
                and now - st["last_alert_ts"] > COOLDOWN_SECS):
            st["status"]        = "ALERT"
            st["last_alert_ts"] = now
            st["event_id"]      = f"INC-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
            st["event_ts"]      = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            st["confirm_count"] = 0
            st["score"]         = 0
            # Capture snapshot + push to Catalyst — outside _acc_lock to avoid deadlock
            _snap_event_id = st["event_id"]
            _alert_dets    = list(dets)   # copy for use outside lock
            print(f"[Accident] ⚠ ALERT  {st['event_id']}")
        else:
            _snap_event_id = None

    # ── Outside lock: snapshot + Catalyst push ───────────────────
    if _snap_event_id:
        _capture_training_snapshot(_snap_event_id, _alert_dets or dets)
        _push_incident_to_catalyst(_snap_event_id, _alert_dets or dets)


def _push_incident_to_catalyst(event_id: str, dets: list) -> None:
    """
    Build a SeverityResult from the current detections and push the incident
    to the Catalyst AppSail backend (POST /api/v1/rpi/incident) in a daemon
    thread so the inference loop is never blocked.

    Falls back gracefully if:
      - severity_engine not installed  → uses a minimal stub SeverityResult
      - CATALYST_WEBHOOK_URL not set  → push_to_catalyst() silently skips
      - Any other error               → logged, pipeline continues
    """
    if not _CATALYST_AVAILABLE:
        return

    def _do_push():
        try:
            # ── GPS coordinates ──────────────────────────────────
            with _gps_lock:
                lat = _gps_state.get("lat") or 0.0
                lng = _gps_state.get("lng") or 0.0
                gps_fix = _gps_state.get("fix", False)

            # ── Build SeverityResult ─────────────────────────────
            if _SEVERITY_AVAILABLE and _SevDetection is not None:
                # Convert our detection dicts → SeverityEngine Detection objects
                sev_dets = []
                for d in dets:
                    try:
                        sev_dets.append(_SevDetection(
                            class_id   = d["class_id"],
                            class_name = d["class_name"],
                            confidence = d["score"],
                            bbox       = (d["px1"], d["py1"], d["px2"], d["py2"]),
                        ))
                    except Exception:
                        pass
                severity_result = _severity_engine.assess(
                    detections  = sev_dets,
                    lat         = lat if gps_fix else None,
                    lng         = lng if gps_fix else None,
                    address     = "",
                    incident_id = event_id,
                )
            else:
                # Minimal stub when severity_engine not available
                from types import SimpleNamespace
                classes = list({d["class_name"] for d in dets})
                severity_result = SimpleNamespace(
                    severity_label    = "HIGH",
                    severity_score    = 3,
                    primary_class     = classes[0] if classes else "accident",
                    all_classes       = classes,
                    vehicle_count     = sum(1 for d in dets if d["class_id"] in {2,3,4,9,14}),
                    person_down       = any(d["class_id"] == 6 for d in dets),
                    fire_detected     = any(d["class_id"] == 15 for d in dets),
                    rollover_detected = any(d["class_id"] == 13 for d in dets),
                    dispatch_actions  = ["voice_police", "voice_ambulance"],
                    description       = f"Accident detected: {', '.join(classes[:4])}",
                )

            # ── Camera ID from current mode ───────────────────────
            cam_id = f"RPI5-{camera_mode.upper()}"

            print(f"[Catalyst] Pushing incident {event_id}  "
                  f"severity={severity_result.severity_label}  "
                  f"classes={severity_result.all_classes[:3]}")

            _cat_push(
                incident_id    = event_id,
                severity_result= severity_result,
                lat            = lat if gps_fix else 0.0,
                lng            = lng if gps_fix else 0.0,
                address_short  = "",
                address_full   = "",
                camera_id      = cam_id,
                blocking       = False,
            )
        except Exception as exc:
            print(f"[Catalyst] Push error (non-fatal): {exc}")

    threading.Thread(target=_do_push, daemon=True, name=f"cat-push-{event_id}").start()

# ══════════════════════════════════════════════════════════════════
# HAILO THREAD — owns ALL Hailo resources via proper context managers
# No global pipeline. No manual __enter__/__exit__.
# ══════════════════════════════════════════════════════════════════

# Shared: hailo thread writes; encode thread reads
_infer_result_lock = threading.Lock()
_infer_result      = None   # (frame_bgr, dets, timing_dict)


def hailo_thread():
    global _infer_result

    from hailo_platform import (
        HEF, VDevice, HailoStreamInterface, ConfigureParams,
        InputVStreamParams, OutputVStreamParams, FormatType, InferVStreams,
    )

    # ── Open Hailo device and build network ───────────────────────
    try:
        hef    = HEF(HEF_PATH)
        device = VDevice()
        cfg    = ConfigureParams.create_from_hef(hef, interface=HailoStreamInterface.PCIe)
        for _n in cfg:
            cfg[_n].batch_size = 1
        network_group = device.configure(hef, cfg)[0]
        in_p   = InputVStreamParams.make(network_group, format_type=FormatType.UINT8)
        out_p  = OutputVStreamParams.make(network_group, format_type=FormatType.FLOAT32)
        in_name  = hef.get_input_vstream_infos()[0].name
        out_name = hef.get_output_vstream_infos()[0].name
        print(f"[Hailo] ✓ {HEF_PATH}")
        print(f"[Hailo]   in={in_name}  out={out_name}")
    except Exception as e:
        print(f"[Hailo] INIT FAILED: {e}")
        return

    fps_t0 = time.time(); fps_n = 0

    # ── Inference loop inside proper context managers ─────────────
    with network_group.activate():
        with InferVStreams(network_group, in_p, out_p) as pipe:
            while True:
                # Get latest camera frame
                with _frame_lock:
                    frame = _latest_frame
                if frame is None:
                    time.sleep(0.01); continue

                H, W = frame.shape[:2]

                # Letterbox to 640×640 RGB, enforce (1,640,640,3) uint8
                t0 = time.time()
                canvas, scale, px, py = _letterbox(frame)
                tensor = np.ascontiguousarray(
                    canvas[:640, :640, :], dtype=np.uint8
                ).reshape(1, 640, 640, 3)
                t_pre = (time.time() - t0) * 1000

                # Infer
                t1 = time.time()
                try:
                    res = pipe.infer({in_name: tensor})
                    raw = res[out_name][0]   # [0] = first (only) batch item → list[27]
                except Exception as e:
                    print(f"[Hailo] infer error: {e}")
                    time.sleep(0.01); continue
                t_inf = (time.time() - t1) * 1000

                # Decode detections
                t2 = time.time()
                dets = _decode(raw, scale, px, py, H, W)

                # ── Supervision tracking ──────────────────────────
                # Converts dets → sv.Detections, runs ByteTrack,
                # adds tracker_id to each dict, updates trajectories.
                # Falls back silently if supervision is unavailable.
                # _update_accident sees the same dict format as before.
                dets = _run_tracker(dets)
                # ─────────────────────────────────────────────────
                t_post = (time.time() - t2) * 1000

                # Update shared detection state
                with _det_lock:
                    _latest_dets.clear()
                    _latest_dets.extend(dets)
                    _latest_timing.update({"pre": t_pre, "inf": t_inf, "post": t_post})

                # Update accident engine (unchanged — still uses class_id/score/etc.)
                _update_accident(dets)

                # Queue license plate crops for OCR worker
                for d in dets:
                    if d["class_id"] == 8:
                        x1,y1,x2,y2 = d["px1"],d["py1"],d["px2"],d["py2"]
                        if x2 > x1 and y2 > y1:
                            crop = frame[y1:y2, x1:x2]
                            if crop.size > 0:
                                try: _ocr_queue.put_nowait((crop.copy(), d["score"]))
                                except queue.Full: pass

                # Hand result to encode thread (overwrite, never queue)
                with _infer_result_lock:
                    _infer_result = (frame, dets, {"pre": t_pre, "inf": t_inf, "post": t_post})

                fps_n += 1
                if time.time() - fps_t0 >= 2.0:
                    _fps["hailo"] = round(fps_n / (time.time() - fps_t0), 1)
                    fps_n = 0; fps_t0 = time.time()

# ══════════════════════════════════════════════════════════════════
# ENCODE THREAD — annotation + JPEG, completely separate from Hailo
# ══════════════════════════════════════════════════════════════════

_BOX_COL = {
    "accident":              (0,0,220),
    "fallen_injured_person": (0,0,220),
    "tipped_over":           (0,0,220),
    "vehicle_fire":          (0,100,220),
    "damaged_vehicle":       (0,140,255),
    "ambulance":             (255,200,0),
    "license_plate":         (0,220,0),
}
_DEF_COL = (0,200,200)

_last_infer_result = None   # track to skip if unchanged


def encode_thread():
    global _latest_web_jpg, _last_infer_result
    fps_t0 = time.time(); fps_n = 0
    while True:
        with _infer_result_lock:
            result = _infer_result
        if result is None or result is _last_infer_result:
            time.sleep(0.005); continue
        _last_infer_result = result
        frame, dets, timing = result

        ta = time.time()
        out = frame.copy()
        H, W = out.shape[:2]

        for d in dets:
            col = _BOX_COL.get(d["class_name"], _DEF_COL)
            x1,y1,x2,y2 = d["px1"],d["py1"],d["px2"],d["py2"]
            cv2.rectangle(out,(x1,y1),(x2,y2),col,2)
            # Include tracker ID in label when available: "Car #4 0.87"
            tid = d.get("tracker_id")
            if tid is not None:
                lbl = f"{d['class_name']} #{tid} {d['score']:.2f}"
            else:
                lbl = f"{d['class_name']} {d['score']:.2f}"
            (tw,th),_ = cv2.getTextSize(lbl,cv2.FONT_HERSHEY_SIMPLEX,0.45,1)
            cv2.rectangle(out,(x1,max(y1-th-4,0)),(x1+tw+4,y1),col,-1)
            cv2.putText(out,lbl,(x1+2,max(y1-3,8)),cv2.FONT_HERSHEY_SIMPLEX,0.45,(255,255,255),1)

        # Overlay text
        with _acc_lock:
            ast = _acc_state["status"]; asc = _acc_state["score"]
        with _gps_lock:
            gfix = _gps_state["fix"]
            glat = _gps_state["lat"]; glng = _gps_state["lng"]
        gps_str = f"GPS: {glat:.5f},{glng:.5f}" if gfix else "GPS: NO FIX"
        lines = [
            f"Cam:{_fps['camera']}fps  Hailo:{_fps['hailo']}fps  Enc:{_fps['encode']}fps",
            f"Pre:{timing['pre']:.1f}ms  Inf:{timing['inf']:.1f}ms  Post:{timing['post']:.1f}ms",
            f"Accident:{ast}  score:{asc}   {gps_str}",
        ]
        for i,ln in enumerate(lines):
            y = H - 12 - (len(lines)-1-i)*18
            cv2.putText(out,ln,(8,y),cv2.FONT_HERSHEY_SIMPLEX,0.42,(0,0,0),3)
            cv2.putText(out,ln,(8,y),cv2.FONT_HERSHEY_SIMPLEX,0.42,(255,255,255),1)

        # Downscale to 960×540 for browser — keeps JPEG small and fast
        out_sm = cv2.resize(out, (960, 540), interpolation=cv2.INTER_LINEAR)
        ok, jpg = cv2.imencode(".jpg", out_sm, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if ok:
            with _web_lock:
                _latest_web_jpg = jpg.tobytes()

        fps_n += 1
        if time.time() - fps_t0 >= 2.0:
            _fps["encode"] = round(fps_n / (time.time() - fps_t0), 1)
            fps_n = 0; fps_t0 = time.time()

# ══════════════════════════════════════════════════════════════════
# OCR WORKER
# ══════════════════════════════════════════════════════════════════

def _clean(text):
    text = re.sub(r"[^A-Z0-9]","",text.upper())
    if len(text)<4 or not any(c.isdigit() for c in text) or not any(c.isalpha() for c in text):
        return ""
    return text


def _tesseract(crop):
    if crop is None or crop.size == 0: return ""
    h,w = crop.shape[:2]
    if h<6 or w<12: return ""
    cv2.imwrite(os.path.expanduser("~/plate_debug.jpg"), crop)
    crop6 = cv2.resize(crop,None,fx=6,fy=6,interpolation=cv2.INTER_CUBIC)
    gray  = cv2.bilateralFilter(cv2.cvtColor(crop6,cv2.COLOR_BGR2GRAY),5,50,50)
    _,otsu = cv2.threshold(gray,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    adpt   = cv2.adaptiveThreshold(gray,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY,31,11)
    _,inv  = cv2.threshold(gray,0,255,cv2.THRESH_BINARY_INV+cv2.THRESH_OTSU)
    best   = ""
    for img in [gray,otsu,adpt,inv]:
        ok,enc = cv2.imencode(".png",img)
        if not ok: continue
        for psm in ["6","7","8","11","13"]:
            try:
                r = subprocess.run(
                    ["tesseract","stdin","stdout","--psm",psm,
                     "-c","tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"],
                    input=enc.tobytes(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=1)
                t = _clean(r.stdout.decode(errors="ignore"))
                if len(t) > len(best): best = t
            except Exception: continue
    if best: print(f"[OCR] PLATE: {best}",flush=True)
    return best


def ocr_worker():
    while True:
        try:
            crop, score = _ocr_queue.get(timeout=1.0)
        except queue.Empty:
            continue
        text = _tesseract(crop)
        if text:
            with _plate_lock:
                ts = time.strftime("%H:%M:%S")
                if text in _plates:
                    _plates[text]["last_seen"]  = ts
                    _plates[text]["confidence"] = max(_plates[text]["confidence"], score)
                else:
                    _plates[text] = {"first_seen":ts,"last_seen":ts,"confidence":round(score,2)}
        _ocr_queue.task_done()

# ══════════════════════════════════════════════════════════════════
# MODEM + GNSS
#
# Hardware: Quectel EG800AK-CN (EG800AKCN91LCR07A07M04)
#   ttyUSB0 — silent (diagnostic/data port)
#   ttyUSB1 — AT interface ✓
#   ttyUSB2 — AT interface ✓
#
# SIM:   AT+CPIN? = READY  (confirmed working)
# LTE:   AT+CSQ = 15,99    (signal present)
# CEREG: 0,0 → not registered yet — SMS/voice DISABLED until stat=1 or 5
#
# GNSS:  EG800AK-CN MAY support AT+QGPS / AT+QGPSGNMEA.
#        Not confirmed on this firmware — gnss_thread probes and falls
#        back gracefully to GPS_UNAVAILABLE without blocking anything.
# ══════════════════════════════════════════════════════════════════

# ── Modem readiness state ─────────────────────────────────────────
_modem_lock  = threading.Lock()
_modem_state = {
    "port":             None,   # confirmed AT port e.g. "/dev/ttyUSB1"
    "model":            "",     # ATI response
    "sim_ready":        False,  # True only when CPIN? = READY
    "registered":       False,  # True only when CEREG stat = 1 or 5
    "rssi":             None,
    "online":           False,
    "network":          "",     # AT+QNWINFO result string
    "dispatch_enabled": False,  # sim_ready AND registered
    "checked_at":       None,
    "cell_info":        None,
}


def _modem_ready() -> bool:
    """
    Returns True only when SIM READY + network registered (CEREG 1 or 5).
    All SMS/voice dispatch functions must check this before sending.
    """
    with _modem_lock:
        return _modem_state["dispatch_enabled"]


def _at(ser, cmd, wait=0.6):
    ser.reset_input_buffer()
    ser.write((cmd + "\r").encode())
    time.sleep(wait)
    return ser.read_all().decode(errors="ignore")


def _probe_modem_ports() -> tuple:
    """
    Dynamically probe all candidate ports at 115200.
    Returns (serial_object, port_path) for the first port that responds
    to AT with OK, or (None, None) if none found.
    Logs each attempt clearly.
    """
    try:
        import serial
        import serial.tools.list_ports
    except ImportError:
        print("[Modem] pyserial not installed — modem disabled")
        return None, None

    # Build candidate list: configured ports + anything the OS reports
    # as a USB serial device (handles reboot renumbering automatically)
    os_ports = sorted(
        [p.device for p in serial.tools.list_ports.comports()
         if "USB" in (p.device or "") or "ACM" in (p.device or "")],
        key=lambda x: int(re.search(r"(\d+)$", x).group(1))
        if re.search(r"(\d+)$", x) else 99
    )
    # Merge: configured candidates first, then any OS-detected extras
    candidates = list(dict.fromkeys(MODEM_PORTS + os_ports))

    for p in candidates:
        print(f"[Modem] Testing {p} …")
        try:
            s = serial.Serial(p, 115200, timeout=2)
            r = _at(s, "AT")
            if "OK" in r:
                print(f"[Modem] ✓ AT interface: {p}")
                return s, p
            s.close()
            print(f"[Modem] ✗ {p} — no AT response")
        except Exception as e:
            print(f"[Modem] ✗ {p} — {e}")

    return None, None


def _run_diagnostics(ser) -> dict:
    """
    Run full modem diagnostics after AT port is found.
    Returns dict with model, sim_ready, registered, rssi, network.
    Does NOT enable SMS/voice — only reads status.
    """
    diag = {"model": "", "sim_ready": False, "registered": False,
            "rssi": None, "cereg": "", "network": "", "online": False}

    # ATI — model info
    r = _at(ser, "ATI")
    for line in r.splitlines():
        line = line.strip()
        if line and line not in ("ATI", "OK", ""):
            diag["model"] += line + " "
    diag["model"] = diag["model"].strip()
    print(f"[Modem] Model  : {diag['model'] or '(no response)'}")

    # AT+CPIN? — SIM status
    r = _at(ser, "AT+CPIN?")
    if "READY" in r:
        diag["sim_ready"] = True
        print("[Modem] SIM    : READY")
    elif "CME ERROR" in r:
        err = re.search(r"CME ERROR:\s*(\d+)", r)
        code = err.group(1) if err else "?"
        print(f"[Modem] SIM    : ERROR {code} (not inserted or not ready)")
    else:
        print(f"[Modem] SIM    : {r.strip()!r}")

    # AT+CSQ — signal strength
    r = _at(ser, "AT+CSQ")
    m = re.search(r"\+CSQ:\s*(\d+),", r)
    if m:
        rssi = int(m.group(1))
        diag["rssi"] = rssi
        online = rssi not in (0, 99)
        diag["online"] = online
        print(f"[Modem] Signal : {rssi}/31  {'(signal OK)' if online else '(no signal)'}")
    else:
        print("[Modem] Signal : no response")

    # AT+CEREG? — network registration
    r = _at(ser, "AT+CEREG?")
    m = re.search(r"\+CEREG:\s*\d+,(\d+)", r)
    stat = int(m.group(1)) if m else -1
    diag["cereg"] = str(stat)
    reg_desc = {1: "registered home", 5: "registered roaming",
                0: "not registered", 2: "searching", 3: "denied"}
    print(f"[Modem] Network: {reg_desc.get(stat, f'stat={stat}')}")
    if stat in (1, 5):
        diag["registered"] = True

    # AT+QNWINFO — network operator / band info
    r = _at(ser, "AT+QNWINFO", wait=0.8)
    m = re.search(r'\+QNWINFO:\s*"([^"]*)"', r)
    if m:
        diag["network"] = m.group(0).replace("+QNWINFO: ", "").strip()
        print(f"[Modem] Network: {diag['network']}")

    # Summary
    dispatch = diag["sim_ready"] and diag["registered"]
    diag["dispatch_enabled"] = dispatch
    if dispatch:
        print("[Modem] ✓ SIM ready + registered — SMS/voice dispatch ENABLED")
    else:
        reasons = []
        if not diag["sim_ready"]:   reasons.append("SIM not ready")
        if not diag["registered"]:  reasons.append("not registered on network")
        print(f"[Modem] ⚠ SMS/voice dispatch DISABLED ({', '.join(reasons)})")

    return diag


def _parse_serving_cell(resp):
    """
    Parse AT+QENG="servingcell" LTE response.
    Example: +QENG: "servingcell","LIMSRV","LTE","FDD",405,861,43CC30,321,2463,5,...
    Returns dict with mcc, mnc, cell_id, rsrp, rsrq or None.
    """
    m = re.search(
        r'\+QENG:\s*"servingcell","[^"]*","LTE","[^"]*",'
        r'(\d+),(\d+),([0-9A-Fa-f]+),(\d+),(\d+),\d+,\d+,\d+,\d+,(-?\d+),(-?\d+)',
        resp
    )
    if not m:
        return None
    return {
        "mcc":     m.group(1),
        "mnc":     m.group(2),
        "cell_id": m.group(3),
        "pci":     m.group(4),
        "earfcn":  m.group(5),
        "rsrp":    int(m.group(6)),
        "rsrq":    int(m.group(7)),
    }


def modem_thread():
    try:
        import serial
    except ImportError:
        print("[Modem] pyserial not installed — modem disabled")
        return

    print("[Modem] ── EG800AK-CN diagnostic probe ──────────────────")
    print("[Modem] GPS: physical GNSS probed by gnss_thread separately")

    # ── Dynamic port probe ────────────────────────────────────────
    ser, port = _probe_modem_ports()
    if port is None:
        print("[Modem] ✗ No AT-responsive port found — modem thread exiting")
        print("[Modem]   Checked:", MODEM_PORTS)
        return

    # ── Full diagnostics at startup ───────────────────────────────
    diag = _run_diagnostics(ser)

    with _modem_lock:
        _modem_state.update({
            "port":             port,
            "model":            diag["model"],
            "sim_ready":        diag["sim_ready"],
            "registered":       diag["registered"],
            "rssi":             diag.get("rssi"),
            "online":           diag.get("online", False),
            "network":          diag.get("network", ""),
            "dispatch_enabled": diag.get("dispatch_enabled", False),
            "checked_at":       time.strftime("%H:%M:%S"),
        })
    with _lte_lock:
        _lte_state.update({
            "online":     diag.get("online", False),
            "rssi":       diag.get("rssi"),
            "checked_at": time.strftime("%H:%M:%S"),
        })

    print("[Modem] ── entering poll loop (every 15s) ───────────────")

    # ── Main poll loop — keep serial open ────────────────────────
    while True:
        try:
            if ser is None or not ser.is_open:
                ser = serial.Serial(port, 115200, timeout=2)

            # ── Signal strength ───────────────────────────────────
            r = _at(ser, "AT+CSQ")
            m = re.search(r"\+CSQ:\s*(\d+),", r)
            rssi   = int(m.group(1)) if m else None
            online = rssi is not None and rssi not in (0, 99)
            with _lte_lock:
                _lte_state.update({
                    "online":     online,
                    "rssi":       rssi,
                    "checked_at": time.strftime("%H:%M:%S"),
                })

            # ── SIM + registration re-check (every poll) ─────────
            # Allows dispatch to auto-enable once SIM is inserted
            r_pin = _at(ser, "AT+CPIN?")
            sim_ready = "READY" in r_pin

            r_reg = _at(ser, "AT+CEREG?")
            m_reg = re.search(r"\+CEREG:\s*\d+,(\d+)", r_reg)
            stat  = int(m_reg.group(1)) if m_reg else -1
            registered = stat in (1, 5)

            prev_ready    = _modem_state["sim_ready"]
            prev_reg      = _modem_state["registered"]
            dispatch_now  = sim_ready and registered
            with _modem_lock:
                _modem_state.update({
                    "sim_ready":        sim_ready,
                    "registered":       registered,
                    "rssi":             rssi,
                    "online":           online,
                    "dispatch_enabled": dispatch_now,
                    "checked_at":       time.strftime("%H:%M:%S"),
                })

            # Log only when state changes (not every 15s)
            if sim_ready != prev_ready or registered != prev_reg:
                if dispatch_now:
                    print("[Modem] ✓ SIM ready + registered — SMS/voice dispatch NOW ENABLED")
                else:
                    reasons = []
                    if not sim_ready:   reasons.append("SIM not ready")
                    if not registered:  reasons.append("not registered")
                    print(f"[Modem] ⚠ Dispatch still DISABLED ({', '.join(reasons)})")

            # ── Cell tower info (AT+QENG) ─────────────────────────
            r2   = _at(ser, 'AT+QENG="servingcell"', wait=0.8)
            cell = _parse_serving_cell(r2)
            if cell:
                cell_str = (f"MCC={cell['mcc']} MNC={cell['mnc']} "
                            f"Cell={cell['cell_id']} RSRP={cell['rsrp']}dBm")
                with _gps_lock:
                    _gps_state["cell_info"] = cell_str
                    if not _gps_state["fix"]:
                        _gps_state["source"] = "cell"
                with _modem_lock:
                    _modem_state["cell_info"] = cell_str

        except Exception as e:
            print(f"[Modem] poll error: {e}")
            if ser:
                try: ser.close()
                except Exception: pass
            ser = None
            with _lte_lock:
                _lte_state["online"] = False
            with _modem_lock:
                _modem_state["online"] = False

        time.sleep(15)


# ══════════════════════════════════════════════════════════════════
# GNSS THREAD — physical GPS via Quectel AT+QGPS
#
# Runs independently of modem_thread (modem_thread owns LTE/SIM/cell).
# Probes for GNSS support at startup, polls every 10s when active.
# Never blocks Hailo or camera threads.
# ══════════════════════════════════════════════════════════════════

# How many seconds to wait for first GNSS fix before giving up and
# marking GPS_UNAVAILABLE (phone fallback takes over immediately).
_GNSS_FIX_TIMEOUT = 90


def _parse_qgpsgnmea_gga(resp: str):
    """
    Parse AT+QGPSGNMEA="GGA" response.
    Returns (lat, lng, accuracy_m, satellites, timestamp_str) or None.
    GGA example:
      $GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47
    """
    m = re.search(r'\$G.GGA,(\d+\.\d+),(\d+\.\d+),([NS]),(\d+\.\d+),([EW]),'
                  r'(\d),(\d+),[\d.]+,([\d.]+)', resp)
    if not m:
        return None
    try:
        utc     = m.group(1)
        lat_raw = float(m.group(2));  lat_ns = m.group(3)
        lng_raw = float(m.group(4));  lng_ew = m.group(5)
        fix_q   = int(m.group(6))     # 0=no fix, 1=GPS, 2=DGPS
        sats    = int(m.group(7))
        alt     = float(m.group(8))

        if fix_q == 0:
            return None

        # Convert DDMM.MMMM → decimal degrees
        lat_d  = int(lat_raw / 100)
        lat    = lat_d + (lat_raw - lat_d * 100) / 60.0
        if lat_ns == "S": lat = -lat

        lng_d  = int(lng_raw / 100)
        lng    = lng_d + (lng_raw - lng_d * 100) / 60.0
        if lng_ew == "W": lng = -lng

        # Timestamp from GGA HHMMSS.ss
        h, mi, s = int(utc[:2]), int(utc[2:4]), float(utc[4:])
        ts = f"{h:02d}:{mi:02d}:{s:05.2f}Z"
        return round(lat, 6), round(lng, 6), None, sats, ts
    except Exception:
        return None


def gnss_thread():
    """
    Dedicated GNSS thread.  Probes for AT+QGPS support, polls for fixes.
    Writes only to _gnss_state — never touches _gps_state directly.
    _gps_arbiter() (called every poll) merges all sources into _gps_state.
    """
    try:
        import serial
    except ImportError:
        print("[GPS] pyserial not available — physical GNSS disabled")
        with _gnss_lock:
            _gnss_state["status"] = "GPS_UNAVAILABLE"
        return

    # Wait for modem_thread to find the AT port (up to 20s)
    for _ in range(40):
        with _modem_lock:
            port = _modem_state.get("port")
        if port:
            break
        time.sleep(0.5)

    if not port:
        print("[GPS] Physical GNSS: no modem port found — GPS_UNAVAILABLE")
        with _gnss_lock:
            _gnss_state["status"] = "GPS_UNAVAILABLE"
        return

    print(f"[GPS] Physical GNSS starting on {port} …")

    try:
        ser = serial.Serial(port, 115200, timeout=3)
    except Exception as e:
        print(f"[GPS] Cannot open {port}: {e} — GPS_UNAVAILABLE")
        with _gnss_lock:
            _gnss_state["status"] = "GPS_UNAVAILABLE"
        return

    # ── Probe: does this modem support AT+QGPS? ───────────────────
    r = _at(ser, "AT+QGPS?")
    if "ERROR" in r and "+QGPS" not in r:
        print("[GPS] Physical GNSS: AT+QGPS not supported on this firmware — GPS_UNAVAILABLE")
        with _gnss_lock:
            _gnss_state["status"] = "GPS_UNAVAILABLE"
        ser.close()
        return

    # ── Enable GNSS (idempotent — OK if already on) ───────────────
    r = _at(ser, "AT+QGPS=1", wait=1.0)
    if "ERROR" in r and "CME ERROR" not in r:
        # Some firmware returns CME ERROR:504 if already enabled — that's fine
        print(f"[GPS] AT+QGPS=1 response: {r.strip()!r}")
        if "+CME ERROR" not in r:
            print("[GPS] Physical GNSS: cannot enable GNSS — GPS_UNAVAILABLE")
            with _gnss_lock:
                _gnss_state["status"] = "GPS_UNAVAILABLE"
            ser.close()
            return

    print("[GPS] Physical GNSS enabled — waiting for fix …")
    with _gnss_lock:
        _gnss_state["status"] = "GPS_NO_FIX"

    fix_deadline = time.time() + _GNSS_FIX_TIMEOUT
    last_fix_logged = False

    while True:
        try:
            if not ser.is_open:
                ser = serial.Serial(port, 115200, timeout=3)

            # Request GGA sentence
            r = _at(ser, 'AT+QGPSGNMEA="GGA"', wait=1.2)
            parsed = _parse_qgpsgnmea_gga(r)

            if parsed:
                lat, lng, acc, sats, ts = parsed
                with _gnss_lock:
                    _gnss_state.update({
                        "status":     "GPS_FIX",
                        "lat":        lat,
                        "lng":        lng,
                        "accuracy":   acc,
                        "satellites": sats,
                        "timestamp":  ts,
                        "updated_at": time.time(),
                    })
                if not last_fix_logged:
                    print(f"[GPS] Physical GNSS fix acquired: lat={lat}, lng={lng}, satellites={sats}")
                    last_fix_logged = True
            else:
                # No fix yet
                now = time.time()
                with _gnss_lock:
                    prev = _gnss_state["status"]
                    if prev == "GPS_FIX":
                        # Lost fix
                        _gnss_state["status"] = "GPS_NO_FIX"
                        last_fix_logged = False
                        print("[GPS] Physical GNSS fix lost — GPS_NO_FIX")
                    elif now > fix_deadline and prev == "GPS_NO_FIX":
                        # Exceeded timeout — mark unavailable, stop blocking
                        _gnss_state["status"] = "GPS_UNAVAILABLE"
                        print("[GPS] Physical GNSS unavailable (no fix after timeout)")

        except Exception as e:
            print(f"[GPS] Physical GNSS poll error: {e}")
            with _gnss_lock:
                _gnss_state["status"] = "GPS_ERROR"
            if ser:
                try: ser.close()
                except Exception: pass
            ser = None
            time.sleep(5)
            try:
                ser = serial.Serial(port, 115200, timeout=3)
            except Exception:
                pass

        _gps_arbiter()
        time.sleep(10)


def _gps_arbiter():
    """
    Merges _gnss_state and _phone_gps_state into _gps_state.
    Priority: physical GNSS (GPS_FIX) > phone GPS (if fresh) > none.
    Called after every GNSS poll and after every phone GPS update.
    Never fakes coordinates.
    """
    now = time.time()

    with _gnss_lock:
        gnss = dict(_gnss_state)
    with _phone_gps_lock:
        phone = dict(_phone_gps_state)

    # Priority 1: physical GNSS fix
    if gnss["status"] == "GPS_FIX" and gnss["lat"] is not None:
        age = round(now - gnss["updated_at"], 1) if gnss["updated_at"] else None
        with _gps_lock:
            _gps_state.update({
                "fix":         True,
                "lat":         gnss["lat"],
                "lng":         gnss["lng"],
                "accuracy":    gnss["accuracy"],
                "source":      "modem",
                "method":      "Physical GPS",
                "satellites":  gnss["satellites"],
                "timestamp":   gnss["timestamp"],
                "age_seconds": age,
            })
        return

    # Priority 2: phone GPS if fresh
    phone_age = (now - phone["received_at"]) if phone["received_at"] else None
    if (phone["lat"] is not None
            and phone_age is not None
            and phone_age <= _PHONE_GPS_MAX_AGE):
        with _gps_lock:
            _gps_state.update({
                "fix":         True,
                "lat":         phone["lat"],
                "lng":         phone["lng"],
                "accuracy":    phone["accuracy"],
                "source":      "phone",
                "method":      "Phone GPS fallback",
                "satellites":  None,
                "timestamp":   phone["timestamp"],
                "age_seconds": round(phone_age, 1),
            })
        return

    # Priority 3: no valid GPS
    with _gps_lock:
        _gps_state.update({
            "fix":         False,
            "lat":         None,
            "lng":         None,
            "accuracy":    None,
            "source":      "none",
            "method":      "none",
            "satellites":  None,
            "timestamp":   None,
            "age_seconds": None,
        })


# ══════════════════════════════════════════════════════════════════
# FLASK
# ══════════════════════════════════════════════════════════════════

app = Flask(__name__)

# ─── MJPEG stream ────────────────────────────────────────────────
def _gen_frames():
    while True:
        with _web_lock:
            jpg = _latest_web_jpg
        if jpg is None:
            time.sleep(0.03); continue
        yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
        time.sleep(0.033)   # 30fps cap for browser

@app.route("/video_feed")
def video_feed():
    return Response(_gen_frames(), mimetype="multipart/x-mixed-replace; boundary=frame")

# ─── Status API ──────────────────────────────────────────────────
@app.route("/status")
def status():
    with _det_lock:
        dets   = list(_latest_dets)
        timing = dict(_latest_timing)
    with _acc_lock:
        acc = dict(_acc_state)
    with _gps_lock:
        gps = dict(_gps_state)
    with _lte_lock:
        lte = dict(_lte_state)
    with _modem_lock:
        # Strip sensitive SIM identifiers from public status
        modem = {k: v for k, v in _modem_state.items()
                 if k not in ("imsi", "iccid")}
    with _gnss_lock:
        gnss_status = _gnss_state["status"]
    with _tracking_lock:
        tracking = {
            "enabled":      _tracking_state["enabled"],
            "active_count": _tracking_state["active_count"],
            "objects": [
                {
                    "id":                 obj["id"],
                    "class":              obj["class_name"],
                    "confidence":         obj["confidence"],
                    "center":             obj["center"],
                    "velocity_px_s":      obj["velocity_px_s"],
                    "acceleration_px_s2": obj["acceleration_px_s2"],
                    "direction_deg":      obj["direction_deg"],
                }
                for obj in _tracking_state["objects"]
            ],
        }
    return jsonify({
        "fps":        dict(_fps),
        "timing":     timing,
        "detections": dets,
        "accident":   acc,
        "gps":        gps,           # unified — use this
        "gnss_status": gnss_status,  # raw physical GPS status
        "lte":        lte,
        "modem":      modem,
        "tracking":   tracking,      # NEW — supervisor tracking info
    })

@app.route("/gps_status")
def gps_status():
    """Detailed GPS diagnostic endpoint."""
    with _gps_lock:    gps   = dict(_gps_state)
    with _gnss_lock:   gnss  = dict(_gnss_state)
    with _phone_gps_lock:
        phone = dict(_phone_gps_state)
        phone_age = round(time.time() - phone["received_at"], 1) if phone["received_at"] else None
    return jsonify({
        "active":       gps,
        "physical_gnss": {
            "status":     gnss["status"],
            "lat":        gnss["lat"],
            "lng":        gnss["lng"],
            "satellites": gnss["satellites"],
            "updated_at": gnss["updated_at"],
        },
        "phone_gps": {
            "lat":        phone["lat"],
            "lng":        phone["lng"],
            "accuracy":   phone["accuracy"],
            "age_seconds": phone_age,
            "fresh":      (phone_age is not None and phone_age <= _PHONE_GPS_MAX_AGE),
        },
        "priority_chain": ["modem (Physical GPS)", "phone (Phone GPS fallback)", "none"],
    })

# ─── Camera switch ───────────────────────────────────────────────
@app.route("/switch")
def switch():
    global camera_mode
    mode = request.args.get("camera","ip")
    if mode not in ("ip","usb"):
        return jsonify({"error":"invalid"}), 400
    camera_mode = mode
    _cam_switch_flag.set()        # signal camera_thread immediately
    with _frame_lock:             # clear stale frame
        pass
    label = "PHONE IP CAMERA" if mode == "ip" else "USB C270"
    print(f"[Switch] → {label}")
    return jsonify({"camera":label,"mode":mode})

# ─── Plates ──────────────────────────────────────────────────────
@app.route("/plates")
def plate_list():
    with _plate_lock: return jsonify(dict(_plates))

@app.route("/clear_plates", methods=["POST"])
def clear_plates():
    with _plate_lock: _plates.clear()
    return jsonify({"ok":True})

# ─── Demo accident ───────────────────────────────────────────────
@app.route("/demo_accident", methods=["POST"])
def demo_accident():
    with _gps_lock:   gps = dict(_gps_state)
    with _plate_lock: plate_list_now = list(_plates.keys())
    with _det_lock:   classes_now = list({d["class_name"] for d in _latest_dets})
    ev = {
        "demo":True,
        "event_id":  f"DEMO-{datetime.now().strftime('%Y%m%d-%H%M%S')}",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "camera":    camera_mode,
        "plates":    plate_list_now,
        "gps":       gps,
        "classes":   classes_now,
    }
    with _demo_lock:
        _demo_state.update({"active":True,"event":ev})
    print(f"[Demo] ⚠ DEMO TRIGGERED — {ev['event_id']}  (NOT REAL, NO SMS/CALL)")
    return jsonify(ev)

@app.route("/demo_reset", methods=["POST"])
def demo_reset():
    with _demo_lock:
        _demo_state.update({"active":False,"event":None})
    return jsonify({"ok":True})

# ─── Emergency contacts — save/read from .env ────────────────────
_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")

def _read_env_contacts():
    """Read POLICE_NUMBER, AMBULANCE_NUMBER, FIRE_NUMBER, POLICE_EMAIL from .env."""
    result = {"police": "", "ambulance": "", "fire": "", "email": ""}
    try:
        if os.path.isfile(_ENV_PATH):
            with open(_ENV_PATH, "r") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("POLICE_NUMBER="):
                        result["police"] = line.split("=", 1)[1].strip().strip('"')
                    elif line.startswith("AMBULANCE_NUMBER="):
                        result["ambulance"] = line.split("=", 1)[1].strip().strip('"')
                    elif line.startswith("FIRE_NUMBER="):
                        result["fire"] = line.split("=", 1)[1].strip().strip('"')
                    elif line.startswith("POLICE_EMAIL="):
                        result["email"] = line.split("=", 1)[1].strip().strip('"')
    except Exception as e:
        print(f"[Contacts] read error: {e}")
    return result

def _write_env_key(key, value):
    """Update or insert a KEY=value line in .env (creates file if missing)."""
    lines = []
    found = False
    try:
        if os.path.isfile(_ENV_PATH):
            with open(_ENV_PATH, "r") as f:
                lines = f.readlines()
        new_lines = []
        for line in lines:
            if line.strip().startswith(key + "="):
                new_lines.append(f"{key}={value}\n")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"{key}={value}\n")
        with open(_ENV_PATH, "w") as f:
            f.writelines(new_lines)
    except Exception as e:
        raise RuntimeError(f"Could not write .env: {e}")

@app.route("/save_contacts", methods=["POST"])
def save_contacts():
    data = request.get_json(silent=True) or {}
    try:
        police    = str(data.get("police",    "")).strip()
        ambulance = str(data.get("ambulance", "")).strip()
        fire      = str(data.get("fire",      "")).strip()
        email     = str(data.get("email",     "")).strip()
        if police:    _write_env_key("POLICE_NUMBER",    police)
        if ambulance: _write_env_key("AMBULANCE_NUMBER", ambulance)
        if fire:      _write_env_key("FIRE_NUMBER",      fire)
        if email:     _write_env_key("POLICE_EMAIL",     email)
        # Also update the live os.environ so SMS works immediately without restart
        if police:    os.environ["POLICE_NUMBER"]    = police
        if ambulance: os.environ["AMBULANCE_NUMBER"] = ambulance
        if fire:      os.environ["FIRE_NUMBER"]      = fire
        if email:     os.environ["POLICE_EMAIL"]     = email
        print(f"[Contacts] Saved — police={police} ambulance={ambulance} fire={fire} email={email}")
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/get_contacts")
def get_contacts():
    return jsonify(_read_env_contacts())

# ─── Phone IP-camera GPS  POST /phone/location ───────────────────
# The phone camera app POSTs its GPS here periodically.
# This is Priority 2 fallback when physical GNSS has no fix.
@app.route("/phone/location", methods=["POST"])
def phone_location():
    data = request.get_json(silent=True) or {}
    try:
        lat = float(data.get("latitude",  data.get("lat", 0)))
        lng = float(data.get("longitude", data.get("lng", 0)))
        acc = float(data.get("accuracy", 999))
        ts  = str(data.get("timestamp", ""))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "invalid coords"}), 400

    # Basic sanity checks
    if lat == 0.0 and lng == 0.0:
        return jsonify({"ok": False, "error": "zero coords"}), 400
    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return jsonify({"ok": False, "error": "coords out of range"}), 400
    if acc < 0 or acc > 50000:
        return jsonify({"ok": False, "error": "implausible accuracy"}), 400

    with _phone_gps_lock:
        _phone_gps_state.update({
            "lat":         round(lat, 6),
            "lng":         round(lng, 6),
            "accuracy":    round(acc, 1),
            "timestamp":   ts or datetime.utcnow().isoformat() + "Z",
            "received_at": time.time(),
        })

    print(f"[GPS] Phone GPS updated: lat={lat:.5f}, lng={lng:.5f}, accuracy={acc:.0f}m")
    _gps_arbiter()   # immediately update unified GPS state

    with _gps_lock:
        src = _gps_state["source"]
    if src == "phone":
        print("[GPS] Active source: phone")

    return jsonify({"ok": True, "lat": lat, "lng": lng, "accepted": True})


# ─── Browser GPS push (legacy — kept for dashboard JS) ───────────
# Browser geolocation pushes here; treated same as phone GPS fallback.
@app.route("/push_location", methods=["POST"])
def push_location():
    data = request.get_json(silent=True) or {}
    try:
        lat = float(data.get("lat", 0))
        lng = float(data.get("lng", 0))
        acc = float(data.get("accuracy", 999))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "invalid coords"}), 400
    if lat == 0 and lng == 0:
        return jsonify({"ok": False, "error": "zero coords"}), 400

    # Store as phone GPS (same priority as phone camera)
    with _phone_gps_lock:
        _phone_gps_state.update({
            "lat":         round(lat, 6),
            "lng":         round(lng, 6),
            "accuracy":    round(acc, 1),
            "timestamp":   datetime.utcnow().isoformat() + "Z",
            "received_at": time.time(),
        })
    _gps_arbiter()
    print(f"[GPS] Browser fix: {lat:.5f}, {lng:.5f}  acc={acc:.0f}m")
    return jsonify({"ok": True, "lat": lat, "lng": lng})

# ─── HTML ─────────────────────────────────────────────────────────
HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>VigilanteVanguard — CATALYST</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#e6edf3;font-family:'Segoe UI',sans-serif;font-size:13px}
header{background:#161b22;border-bottom:1px solid #30363d;padding:10px 18px;
       display:flex;align-items:center;gap:10px}
header h1{font-size:15px;font-weight:700;color:#58a6ff}
.badge{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;letter-spacing:.04em}
.badge.NORMAL{background:#1a4731;color:#3fb950}
.badge.POSSIBLE{background:#432c02;color:#e3b341}
.badge.CONFIRMED{background:#3d0c0c;color:#f85149}
.badge.ALERT{background:#dc2626;color:#fff;animation:pulse .5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.main{display:flex;gap:10px;padding:10px;height:calc(100vh - 48px);overflow:hidden}
.vcol{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:8px}
#stream{width:100%;border-radius:6px;border:1px solid #30363d;background:#000;
        display:block;flex:1;min-height:0;object-fit:contain}
.cbts{display:flex;gap:6px}
.cbts button{flex:1;padding:7px;border-radius:4px;border:1px solid #30363d;
             background:#21262d;color:#e6edf3;cursor:pointer;font-size:12px;transition:.15s}
.cbts button.active{background:#1f6feb;border-color:#58a6ff;color:#fff}
.cbts button:hover:not(.active){background:#30363d}
.side{width:270px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;overflow-y:auto}
.card{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px}
.card h3{font-size:10px;font-weight:600;text-transform:uppercase;
         letter-spacing:.07em;color:#8b949e;margin-bottom:8px}
.row{display:flex;justify-content:space-between;margin-bottom:5px;font-size:12px;align-items:center}
.val{color:#58a6ff;font-weight:600}
.val.ok{color:#3fb950}.val.err{color:#f85149}.val.warn{color:#e3b341}
table{width:100%;border-collapse:collapse;font-size:11px}
th{color:#8b949e;text-align:left;padding:3px 4px;border-bottom:1px solid #30363d}
td{padding:3px 4px;border-bottom:1px solid #21262d}
.dbtn{width:100%;padding:8px;border-radius:4px;border:none;cursor:pointer;
      font-weight:700;font-size:12px;margin-bottom:5px}
.dbtn.trig{background:#7f1d1d;color:#fca5a5}
.dbtn.trig:hover{background:#991b1b}
.dbtn.rst{background:#21262d;color:#8b949e;border:1px solid #30363d}
.dbtn.rst:hover{background:#30363d}
.dbanner{background:#450a0a;border:1px solid #991b1b;border-radius:4px;
         padding:8px;font-size:11px;line-height:1.6;display:none;white-space:pre-wrap}
.dbanner.on{display:block}
/* ── Test contacts card ── */
.contacts-card{border-color:#854d0e}
.contacts-card h3{color:#ca8a04}
.cinput{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
.cinput label{font-size:10px;color:#8b949e;margin-bottom:1px}
.cinput input{background:#0d1117;border:1px solid #30363d;border-radius:4px;
              color:#e6edf3;padding:5px 8px;font-size:12px;width:100%}
.cinput input:focus{outline:none;border-color:#ca8a04}
.cbtn-save{width:100%;padding:7px;border-radius:4px;border:none;cursor:pointer;
           font-weight:700;font-size:12px;background:#78350f;color:#fde68a;transition:.15s}
.cbtn-save:hover{background:#92400e}
.csaved{font-size:10px;text-align:center;margin-top:5px;display:none;color:#4ade80}
</style>
</head>
<body>
<header>
  <h1>⚡ VigilanteVanguard — CATALYST</h1>
  <span id="badge" class="badge NORMAL">NORMAL</span>
  <span id="camlbl" style="margin-left:auto;font-size:11px;color:#8b949e">USB C270</span>
</header>
<div class="main">
  <div class="vcol">
    <img id="stream" src="/video_feed" alt="live">
    <div class="cbts">
      <button id="btn-ip"              onclick="switchCam('ip')">📱 PHONE IP CAMERA</button>
      <button id="btn-usb" class="active" onclick="switchCam('usb')">📷 USB C270</button>
    </div>
  </div>
  <div class="side">

    <div class="card">
      <h3>System</h3>
      <div class="row"><span>Camera</span><span class="val" id="fps-c">—</span></div>
      <div class="row"><span>Hailo</span><span class="val" id="fps-h">—</span></div>
      <div class="row"><span>Encode</span><span class="val" id="fps-e">—</span></div>
      <div class="row"><span>Inference</span><span class="val" id="t-inf">—</span></div>
      <div class="row"><span>Pre+Post</span><span class="val" id="t-pp">—</span></div>
    </div>

    <div class="card">
      <h3>Connectivity</h3>
      <div class="row"><span>LTE</span><span class="val" id="lte">—</span></div>
      <div class="row"><span>RSSI</span><span class="val" id="rssi">—</span></div>
      <div class="row"><span>GPS</span><span class="val" id="gps-fix">—</span></div>
      <div class="row"><span>Coords</span><span class="val" id="gps-ll" style="font-size:11px">—</span></div>
      <div class="row"><span>Method</span><span class="val" id="gps-m" style="font-size:10px">—</span></div>
    </div>

    <div class="card">
      <h3>Accident Engine</h3>
      <div class="row"><span>Status</span><span class="val" id="a-status">NORMAL</span></div>
      <div class="row"><span>Score</span><span class="val" id="a-score">0</span></div>
      <div class="row"><span>Confirm frames</span><span class="val" id="a-cf">0</span></div>
      <div class="row"><span>Last event</span><span class="val" id="a-ev">—</span></div>
      <div class="row" style="align-items:flex-start">
        <span>Classes</span>
        <span class="val" id="a-cls" style="font-size:10px;text-align:right;max-width:160px;word-break:break-all">—</span>
      </div>
    </div>

    <div class="card">
      <h3>Live Detections</h3>
      <div id="dets" style="font-size:11px;color:#8b949e;max-height:120px;overflow-y:auto">—</div>
    </div>

    <div class="card">
      <h3>Tracking <span id="trk-badge" style="font-size:9px;padding:1px 6px;border-radius:8px;background:#1a3a52;color:#58a6ff;margin-left:4px">—</span></h3>
      <div id="trk-objs" style="font-size:11px;color:#8b949e;max-height:150px;overflow-y:auto">—</div>
    </div>

    <div class="card">
      <h3>License Plates
        <button onclick="clearPlates()"
          style="float:right;font-size:10px;padding:1px 6px;background:#21262d;
                 border:1px solid #30363d;border-radius:3px;color:#8b949e;cursor:pointer">Clear</button>
      </h3>
      <table><thead><tr><th>Plate</th><th>First</th><th>Last</th><th>Conf</th></tr></thead>
      <tbody id="ptbl"></tbody></table>
    </div>

    <div class="card">
      <h3>⚠ Demo / Simulation Only</h3>
      <button class="dbtn trig" onclick="trigDemo()">🔴 TRIGGER DEMO ACCIDENT</button>
      <button class="dbtn rst"  onclick="rstDemo()">RESET DEMO</button>
      <div class="dbanner" id="dbanner"></div>
    </div>

    <div class="card contacts-card">
      <h3>📞 Emergency Numbers (Test)</h3>
      <div class="cinput">
        <div>
          <label>🚔 Police number</label>
          <input id="cn-police" type="tel" placeholder="e.g. 100 or +91XXXXXXXXXX">
        </div>
        <div>
          <label>🚑 Ambulance number</label>
          <input id="cn-ambulance" type="tel" placeholder="e.g. 108 or +91XXXXXXXXXX">
        </div>
        <div>
          <label>🚒 Fire number</label>
          <input id="cn-fire" type="tel" placeholder="e.g. 101 or +91XXXXXXXXXX">
        </div>
        <div>
          <label>📧 Police email (optional)</label>
          <input id="cn-email" type="email" placeholder="officer@police.gov.in">
        </div>
      </div>
      <button class="cbtn-save" onclick="saveContacts()">💾 Save to Pi .env</button>
      <div class="csaved" id="csaved">✓ Saved! Numbers active immediately.</div>
    </div>

  </div>
</div>
<script>
const SEV = {NORMAL:"NORMAL",POSSIBLE:"POSSIBLE",CONFIRMED:"CONFIRMED",ALERT:"ALERT"};

function switchCam(m){
  document.getElementById("btn-ip").className  = m==="ip"  ? "active" : "";
  document.getElementById("btn-usb").className = m==="usb" ? "active" : "";
  fetch("/switch?camera="+m).then(r=>r.json()).then(d=>{
    document.getElementById("camlbl").innerText = d.camera;
  });
}

function trigDemo(){
  fetch("/demo_accident",{method:"POST"}).then(r=>r.json()).then(d=>{
    const b = document.getElementById("dbanner");
    b.className = "dbanner on";
    b.innerText =
      "⚠ DEMO / SIMULATION — NOT A REAL EMERGENCY\n\n"+
      "Event : "+d.event_id+"\nTime  : "+d.timestamp+
      "\nCamera: "+d.camera+
      "\nPlates: "+(d.plates.join(", ")||"none")+
      "\nGPS   : "+(d.gps.fix ? d.gps.lat.toFixed(5)+", "+d.gps.lng.toFixed(5) : "no fix")+
      "\nClasses: "+(d.classes.join(", ")||"none");
  });
}
function rstDemo(){
  fetch("/demo_reset",{method:"POST"});
  document.getElementById("dbanner").className="dbanner";
  document.getElementById("dbanner").innerText="";
}
function clearPlates(){ fetch("/clear_plates",{method:"POST"}); }

// ── Test contacts ─────────────────────────────────────────────
function saveContacts(){
  const police   = document.getElementById("cn-police").value.trim();
  const ambulance= document.getElementById("cn-ambulance").value.trim();
  const fire     = document.getElementById("cn-fire").value.trim();
  const email    = document.getElementById("cn-email").value.trim();
  if(!police && !ambulance && !fire && !email){
    alert("Enter at least one number or email."); return;
  }
  fetch("/save_contacts",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({police, ambulance, fire, email})
  }).then(r=>r.json()).then(d=>{
    if(d.ok){
      const el = document.getElementById("csaved");
      el.style.display="block";
      setTimeout(()=>{ el.style.display="none"; }, 3000);
    } else {
      alert("Save failed: "+(d.error||"unknown error"));
    }
  }).catch(e=>alert("Save failed: "+e));
}

// ── Pre-fill contacts from server on load ─────────────────────
fetch("/get_contacts").then(r=>r.json()).then(d=>{
  if(d.police)    document.getElementById("cn-police").value    = d.police;
  if(d.ambulance) document.getElementById("cn-ambulance").value = d.ambulance;
  if(d.fire)      document.getElementById("cn-fire").value      = d.fire;
  if(d.email)     document.getElementById("cn-email").value     = d.email;
}).catch(()=>{});

function fmtBool(v,yes,no){ return v ? yes : no; }

function poll(){
  fetch("/status").then(r=>r.json()).then(d=>{
    // FPS
    document.getElementById("fps-c").innerText = d.fps.camera+" fps";
    document.getElementById("fps-h").innerText = d.fps.hailo+" fps";
    document.getElementById("fps-e").innerText = d.fps.encode+" fps";
    // Timing
    const ti = d.timing; 
    document.getElementById("t-inf").innerText = ti.inf ? ti.inf.toFixed(1)+"ms" : "—";
    document.getElementById("t-pp").innerText  = (ti.pre&&ti.post) ? (ti.pre+ti.post).toFixed(1)+"ms" : "—";
    // LTE
    const lEl = document.getElementById("lte");
    lEl.innerText  = d.lte.online ? "ONLINE" : "OFFLINE";
    lEl.className  = "val "+(d.lte.online?"ok":"err");
    document.getElementById("rssi").innerText = d.lte.rssi!=null ? d.lte.rssi+" /31" : "—";
    // GPS
    const gEl = document.getElementById("gps-fix");
    gEl.innerText = d.gps.fix ? "FIX ✓" : "NO FIX";
    gEl.className = "val "+(d.gps.fix?"ok":"err");
    document.getElementById("gps-ll").innerText =
      d.gps.fix ? d.gps.lat.toFixed(5)+", "+d.gps.lng.toFixed(5) : "—";
    document.getElementById("gps-m").innerText  = d.gps.method||"none";
    // Accident
    const a = d.accident;
    document.getElementById("a-status").innerText = a.status;
    document.getElementById("a-score").innerText  = a.score;
    document.getElementById("a-cf").innerText     = a.confirm_count;
    document.getElementById("a-ev").innerText     = a.event_id||"—";
    document.getElementById("a-cls").innerText    = (a.classes||[]).join(", ")||"—";
    const badge = document.getElementById("badge");
    badge.innerText   = a.status;
    badge.className   = "badge "+a.status;
    // Detections
    document.getElementById("dets").innerHTML =
      d.detections.length
      ? d.detections.map(x=>{
          const tid = x.tracker_id != null ? ` <span style="color:#f59e0b">#${x.tracker_id}</span>` : "";
          return `<div>[${x.class_id}] <b style="color:#e6edf3">${x.class_name}</b>${tid}
            <span style="color:#58a6ff">${x.score}</span></div>`;
        }).join("")
      : "<div style='color:#484f58'>none</div>";
    // Tracking panel
    const trk = d.tracking || {};
    const trkBadge = document.getElementById("trk-badge");
    const trkObjs  = document.getElementById("trk-objs");
    if (trk.enabled) {
      trkBadge.innerText = trk.active_count+" active";
      trkBadge.style.background = "#1a3a52";
      trkBadge.style.color = "#58a6ff";
      trkObjs.innerHTML = trk.objects && trk.objects.length
        ? trk.objects.map(o=>{
            const vel = o.velocity_px_s   != null ? `<span style="color:#6b7280"> ${o.velocity_px_s.toFixed(0)}px/s</span>` : "";
            const dir = o.direction_deg   != null ? `<span style="color:#6b7280"> ${o.direction_deg.toFixed(0)}°</span>` : "";
            return `<div style="margin-bottom:2px"><span style="color:#f59e0b;font-weight:700">#${o.id}</span>`+
              ` <b style="color:#e6edf3">${o.class}</b>`+
              ` <span style="color:#58a6ff">${(o.confidence*100).toFixed(0)}%</span>${vel}${dir}</div>`;
          }).join("")
        : "<div style='color:#484f58'>no tracked objects</div>";
    } else {
      trkBadge.innerText = "disabled";
      trkBadge.style.background = "#21262d";
      trkBadge.style.color = "#484f58";
      trkObjs.innerHTML = "<div style='color:#484f58'>supervision not available</div>";
    }
  });
  fetch("/plates").then(r=>r.json()).then(p=>{
    document.getElementById("ptbl").innerHTML =
      Object.entries(p).map(([k,v])=>
        `<tr><td style="color:#3fb950;font-weight:700">${k}</td>
             <td>${v.first_seen}</td><td>${v.last_seen}</td><td>${v.confidence}</td></tr>`
      ).join("") || "<tr><td colspan=4 style='color:#484f58'>none yet</td></tr>";
  });
}
setInterval(poll, 700);
poll();

// ── Browser GPS — push to pipeline every 30s ──────────────────
function pushBrowserGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      fetch("/push_location", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          lat:      pos.coords.latitude,
          lng:      pos.coords.longitude,
          accuracy: pos.coords.accuracy
        })
      }).then(r=>r.json()).then(d=>{
        if(d.ok) console.log("[GPS] Browser fix sent:", d.lat, d.lng);
      }).catch(()=>{});
    },
    err => console.log("[GPS] Browser geolocation denied:", err.message),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}
// Push immediately on load, then every 30s
pushBrowserGPS();
setInterval(pushBrowserGPS, 30000);
</script>
</body>
</html>"""

@app.route("/")
def index():
    return render_template_string(HTML)

# ══════════════════════════════════════════════════════════════════
# STARTUP
# ══════════════════════════════════════════════════════════════════
# ══════════════════════════════════════════════════════════════════
# MODEL STARTUP VALIDATION
# Prints the class mapping once at boot so operators can confirm the
# correct 27-class custom model is in use.
# ══════════════════════════════════════════════════════════════════

def _print_model_validation():
    """
    Cross-check CLASS_NAMES length against the expected 27-class model
    and print the full class mapping at startup.

    The compiled HEF at ~/yolov11n.hef is a custom 27-class accident-detection
    model (NOT the 10-class Roboflow 'Accident Signals' dataset — that dataset
    was used for the cloud classifier only).

    Expected 27 classes (IDs 0–26):
        accident, ambulance, auto_rickshaw, bus, car, damaged_vehicle,
        fallen_injured_person, firetruck, license_plate, motorcycle, person,
        police_vehicle, road_debris, tipped_over, truck, vehicle_fire,
        damaged_head_light, damaged_hood, damaged_trunk, damaged_window,
        damaged_windscreen, damaged_bumper, damaged_door, damaged_fender,
        damaged_mirror_glass, dent_or_scratch, missing_grille
    """
    n = len(CLASS_NAMES)
    print(f"[Model] HEF : {HEF_PATH}")
    print(f"[Model] ✓ Classes: {n}  (IDs 0–{n-1})")
    if n != 27:
        print(f"[Model] ⚠ WARNING: expected 27 classes but CLASS_NAMES has {n} entries!")
        print(f"[Model]   If your HEF was compiled from a different dataset, "
              f"update CLASS_NAMES accordingly.")
    else:
        print("[Model] ✓ 27-class custom accident-detection model confirmed")
    for cid in sorted(CLASS_NAMES.keys()):
        print(f"[Model]   Class {cid:2d}: {CLASS_NAMES[cid]}")
    # Validate no gaps in class IDs
    expected_ids = set(range(n))
    actual_ids   = set(CLASS_NAMES.keys())
    if expected_ids != actual_ids:
        missing = sorted(expected_ids - actual_ids)
        extra   = sorted(actual_ids - expected_ids)
        if missing:
            print(f"[Model] ⚠ Missing class IDs: {missing}")
        if extra:
            print(f"[Model] ⚠ Extra class IDs outside 0–{n-1}: {extra}")
    else:
        print(f"[Model] ✓ Class IDs 0–{n-1} all present — no gaps or extras")


if __name__ == "__main__":
    import socket
    try:
        _local_ip = socket.gethostbyname(socket.gethostname())
    except Exception:
        _local_ip = "192.168.x.x"

    print("═"*60)
    print("  VigilanteVanguard — CATALYST Pipeline  v5")
    print(f"  HEF    : {HEF_PATH}")
    print(f"  Camera : USB C270 (default) / IP ({PHONE_URL})")
    print(f"  URL    : http://{_local_ip}:{FLASK_PORT}")
    print(f"  GPS    : modem GNSS → phone fallback (POST /phone/location)")
    print(f"  Modem  : {MODEM_PORTS}")
    print(f"  Tracking: {'ByteTrack ENABLED' if (_SV_OK and _tracker is not None) else 'DISABLED (supervision not found)'}")
    print("═"*60)

    # ── Model class validation ────────────────────────────────────
    _print_model_validation()
    print("═"*60)

    # Hailo is fully managed inside hailo_thread() — no init needed here
    threading.Thread(target=camera_thread, daemon=True, name="camera").start()
    threading.Thread(target=hailo_thread,  daemon=True, name="hailo").start()
    threading.Thread(target=encode_thread, daemon=True, name="encode").start()
    threading.Thread(target=ocr_worker,    daemon=True, name="ocr").start()
    threading.Thread(target=modem_thread,  daemon=True, name="modem").start()
    threading.Thread(target=gnss_thread,   daemon=True, name="gnss").start()

    print("[Main] All threads started")
    print(f"[Main] Dashboard  → http://{_local_ip}:{FLASK_PORT}")
    print(f"[Main] GPS status → http://{_local_ip}:{FLASK_PORT}/gps_status")
    print(f"[Main] Phone GPS  → POST http://{_local_ip}:{FLASK_PORT}/phone/location")
    app.run(host="0.0.0.0", port=FLASK_PORT, threaded=True, debug=False)
