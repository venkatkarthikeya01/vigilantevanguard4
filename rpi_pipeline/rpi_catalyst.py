"""
rpi_catalyst.py
────────────────────────────────────────────────────────────────
Zoho Catalyst integration for VigilanteVanguard.

RPi5 → Zoho Catalyst pipeline:
  1. Sends full incident payload (JSON) + snapshot image to Catalyst.
  2. Catalyst Cloud Function stores the incident in Catalyst Data Store,
     sends push notifications to police officer app (FCM via Catalyst),
     sends email to police station, and updates the live map dashboard.
  3. Police can Approve / Reject incidents from the dashboard.
  4. On approve/reject: the incident snapshot is saved to Catalyst FileStore
     as labeled training data and a retraining job is queued.

WHAT THIS MODULE DOES (runs on RPi5):
  - Builds the incident payload (GPS, severity, video URL, plates, etc.)
  - Uploads snapshot JPEG to Catalyst FileStore (incidents/ folder)
  - POST to CATALYST_WEBHOOK_URL (your Catalyst AppSail backend)
  - Retries up to 3 times on failure (network drop, timeout)
  - Non-blocking: runs in a background thread so it doesn't delay dispatch
  - Exposes upload_snapshot() for catalyst_pipeline.py to call on ALERT

WHAT THE CATALYST SIDE DOES (see catalyst_functions/):
  - receive_incident.js  — receives POST, stores in Data Store, triggers notifications
  - approve_incident.js  — approves/rejects, labels image, queues retraining
  - trigger_training.js  — Catalyst Cron: fires RPi /retrain when N new samples ready
  - push_notify.js       — FCM push notification to police app
  - email_alert.js       — Zoho Catalyst Email to police station

ENVIRONMENT VARIABLES (add to .env):
  CATALYST_WEBHOOK_URL      https://your-app.catalystappsail.in/api/v1/rpi/incident
  CATALYST_FILESTORE_URL    https://api.catalyst.zoho.com/baas/v1/project/<id>/folder/<folder_id>/file
  CATALYST_CLIENT_ID        from Zoho API Console (OAuth2 Client Credentials)
  CATALYST_CLIENT_SECRET    from Zoho API Console
  CATALYST_REFRESH_TOKEN    generated once via OAuth2 flow
  CATALYST_PROJECT_ID       your Catalyst project numeric ID
  CATALYST_FOLDER_ID        FileStore folder ID for incident snapshots
  CATALYST_ENABLED          true/false (default: true)

INSTALL:
  pip install requests  (already in requirements.txt)
"""

from __future__ import annotations
import os
import json
import time
import threading
import logging
from datetime import datetime, timezone
from typing import Optional

import requests

logger = logging.getLogger("rpi_catalyst")

# ── Configuration ────────────────────────────────────────────────
CATALYST_ENABLED       = os.environ.get("CATALYST_ENABLED", "true").lower() == "true"
CATALYST_WEBHOOK_URL   = os.environ.get("CATALYST_WEBHOOK_URL", "")
CATALYST_CLIENT_ID     = os.environ.get("CATALYST_CLIENT_ID", "")
CATALYST_CLIENT_SECRET = os.environ.get("CATALYST_CLIENT_SECRET", "")
CATALYST_REFRESH_TOKEN = os.environ.get("CATALYST_REFRESH_TOKEN", "")
CATALYST_PROJECT_ID    = os.environ.get("CATALYST_PROJECT_ID", "")
# FileStore: folder ID in Catalyst where incident snapshot JPEGs are stored
CATALYST_FOLDER_ID     = os.environ.get("CATALYST_FOLDER_ID", "")
# Full FileStore upload URL (built from project + folder)
#   https://api.catalyst.zoho.com/baas/v1/project/<id>/folder/<folder_id>/file
CATALYST_FILESTORE_URL = os.environ.get(
    "CATALYST_FILESTORE_URL",
    f"https://api.catalyst.zoho.com/baas/v1/project/{os.environ.get('CATALYST_PROJECT_ID','')}/folder/{os.environ.get('CATALYST_FOLDER_ID','')}/file"
    if os.environ.get("CATALYST_PROJECT_ID") and os.environ.get("CATALYST_FOLDER_ID")
    else ""
)
# Shared HMAC-SHA256 secret — must match RPI_WEBHOOK_SECRET in Catalyst .env
RPI_WEBHOOK_SECRET     = os.environ.get("RPI_WEBHOOK_SECRET", "rpi5_vv_default_secret_change_me")

_MAX_RETRIES   = 3
_RETRY_DELAY   = 5     # seconds between retries
_TIMEOUT       = 15    # HTTP request timeout (seconds)

# ── OAuth2 token cache ────────────────────────────────────────────
_token_cache: dict = {"access_token": "", "expires_at": 0}
_token_lock   = threading.Lock()


def _get_access_token() -> str:
    """
    Returns a valid Zoho OAuth2 access token.
    Auto-refreshes using the refresh token if expired.
    """
    with _token_lock:
        now = time.time()
        if _token_cache["access_token"] and now < _token_cache["expires_at"] - 60:
            return _token_cache["access_token"]

        # Refresh the token
        if not CATALYST_CLIENT_ID or not CATALYST_CLIENT_SECRET or not CATALYST_REFRESH_TOKEN:
            logger.warning("[Catalyst] OAuth2 credentials not set — using unauthenticated mode")
            return ""

        try:
            resp = requests.post(
                "https://accounts.zoho.in/oauth/v2/token",
                data={
                    "grant_type":    "refresh_token",
                    "client_id":     CATALYST_CLIENT_ID,
                    "client_secret": CATALYST_CLIENT_SECRET,
                    "refresh_token": CATALYST_REFRESH_TOKEN,
                },
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            _token_cache["access_token"] = data["access_token"]
            _token_cache["expires_at"]   = now + data.get("expires_in", 3600)
            logger.info("[Catalyst] OAuth2 token refreshed")
            return _token_cache["access_token"]

        except Exception as exc:
            logger.error(f"[Catalyst] Token refresh failed: {exc}")
            return ""


# ── Payload builder ───────────────────────────────────────────────

def _build_payload(
    incident_id:    str,
    severity_label: str,
    severity_score: int,
    incident_type:  str,
    description:    str,
    lat:            float,
    lng:            float,
    address_short:  str,
    address_full:   str,
    maps_short_url: str,
    plates:         list,
    video_url:      Optional[str],
    all_classes:    list,
    vehicle_count:  int,
    person_down:    bool,
    fire_detected:  bool,
    rollover:       bool,
    dispatch_actions: list,
    camera_id:      str,
) -> dict:
    """Builds the full JSON payload to send to Catalyst."""
    return {
        "source":          "VigilanteVanguard_RPi5",
        "camera_id":       camera_id,
        "incident_id":     incident_id,
        "timestamp_utc":   datetime.now(timezone.utc).isoformat(),
        "timestamp_local": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),

        # ── Severity ──
        "severity": {
            "label": severity_label,    # CRITICAL / HIGH / MEDIUM / LOW / MONITOR
            "score": severity_score,    # 4 / 3 / 2 / 1 / 0
        },

        # ── Incident details ──
        "incident": {
            "type":           incident_type,
            "description":    description,
            "all_classes":    all_classes,
            "vehicle_count":  vehicle_count,
            "person_down":    person_down,
            "fire_detected":  fire_detected,
            "rollover":       rollover,
            "plates":         plates,
        },

        # ── Location ──
        "location": {
            "lat":          lat,
            "lng":          lng,
            "address_short":address_short,
            "address_full": address_full,
            "maps_url":     maps_short_url,
            "google_maps":  f"https://maps.google.com/?q={lat},{lng}",
        },

        # ── Video ──
        "video": {
            "cloud_url":    video_url or "",
            "available":    bool(video_url),
        },

        # ── Dispatch actions taken ──
        "dispatch": {
            "actions": dispatch_actions,
        },
    }


# ── HTTP push ─────────────────────────────────────────────────────

def _make_hmac_signature(body: bytes) -> str:
    """HMAC-SHA256 sign the request body for X-VV-Signature header."""
    import hmac as _hmac
    import hashlib as _hashlib
    sig = _hmac.new(RPI_WEBHOOK_SECRET.encode(), body, _hashlib.sha256).hexdigest()
    return f"sha256={sig}"


def _push_to_catalyst(payload: dict) -> bool:
    """
    POST the incident payload to the Catalyst AppSail backend / Cloud Function.
    Signed with HMAC-SHA256 via X-VV-Signature header.
    Returns True on success, False on failure.
    """
    if not CATALYST_WEBHOOK_URL:
        logger.warning("[Catalyst] CATALYST_WEBHOOK_URL not set — skipping push")
        return False

    body_bytes = json.dumps(payload).encode()

    headers = {
        "Content-Type":   "application/json",
        "X-VV-Source":    "rpi5",
        "X-VV-Signature": _make_hmac_signature(body_bytes),
    }

    # OAuth2 token is optional — only needed for Cloud Function auth (Option B)
    token = _get_access_token()
    if token:
        headers["Authorization"] = f"Zoho-oauthtoken {token}"

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            resp = requests.post(
                CATALYST_WEBHOOK_URL,
                data    = body_bytes,        # use pre-serialised bytes (HMAC already computed)
                headers = headers,
                timeout = _TIMEOUT,
            )
            if resp.status_code in (200, 201, 202):
                logger.info(f"[Catalyst] ✓ Incident {payload['incident_id']} pushed  "
                            f"(HTTP {resp.status_code})")
                return True
            else:
                logger.warning(f"[Catalyst] Attempt {attempt}: HTTP {resp.status_code} — {resp.text[:120]}")

        except requests.exceptions.Timeout:
            logger.warning(f"[Catalyst] Attempt {attempt}: Timeout after {_TIMEOUT}s")
        except requests.exceptions.ConnectionError:
            logger.warning(f"[Catalyst] Attempt {attempt}: Connection error (no WiFi?)")
        except Exception as exc:
            logger.warning(f"[Catalyst] Attempt {attempt}: {exc}")

        if attempt < _MAX_RETRIES:
            time.sleep(_RETRY_DELAY)

    logger.error(f"[Catalyst] Failed to push {payload['incident_id']} after {_MAX_RETRIES} attempts")
    return False


# ── FileStore snapshot upload ─────────────────────────────────────

def upload_snapshot(incident_id: str, jpeg_bytes: bytes) -> Optional[str]:
    """
    Upload a JPEG snapshot to Catalyst FileStore.

    The file is stored as:
        incidents/<incident_id>.jpg

    Returns the public download URL on success, or None on failure.
    Called from catalyst_pipeline.py immediately after an ALERT is raised.
    """
    if not CATALYST_ENABLED or not jpeg_bytes:
        return None

    # Build filestore URL from env; skip silently if not configured
    url = CATALYST_FILESTORE_URL
    if not url or "folder//file" in url:
        logger.debug("[Catalyst] FileStore not configured — snapshot skipped")
        return None

    token = _get_access_token()
    if not token:
        logger.warning("[Catalyst] No OAuth token — snapshot upload skipped")
        return None

    filename = f"{incident_id}.jpg"
    headers  = {"Authorization": f"Zoho-oauthtoken {token}"}

    try:
        resp = requests.post(
            url,
            headers = headers,
            files   = {"content": (filename, jpeg_bytes, "image/jpeg")},
            data    = {"filename": filename},
            timeout = 30,
        )
        if resp.status_code in (200, 201):
            data      = resp.json()
            # Catalyst FileStore returns the file details under data.fileDetails
            file_id   = (data.get("data", {}) or {}).get("fileDetails", {}).get("file_id", "")
            # Build a direct download URL
            dl_url = (
                f"https://api.catalyst.zoho.com/baas/v1/project/{CATALYST_PROJECT_ID}"
                f"/folder/{CATALYST_FOLDER_ID}/file/{file_id}"
            ) if file_id else ""
            logger.info(f"[Catalyst] ✓ Snapshot uploaded: {filename}  file_id={file_id}")
            return dl_url or None
        else:
            logger.warning(f"[Catalyst] Snapshot upload failed HTTP {resp.status_code}: {resp.text[:120]}")
            return None
    except Exception as exc:
        logger.warning(f"[Catalyst] Snapshot upload error: {exc}")
        return None


# ── Public API ────────────────────────────────────────────────────

def push_to_catalyst(
    incident_id:    str,
    severity_result,               # SeverityResult from severity_engine.py
    lat:            float,
    lng:            float,
    address_short:  str   = "",
    address_full:   str   = "",
    maps_short_url: str   = "",
    plates:         list  = None,
    video_url:      Optional[str] = None,
    snapshot_url:   Optional[str] = None,
    camera_id:      str   = "CAM0",
    blocking:       bool  = False,
) -> None:
    """
    Push a full incident record to Zoho Catalyst in a background thread.

    Called from rpi_dispatch.py after dispatch is complete.
    Non-blocking by default — won't delay voice calls or SMS.

    Args:
        incident_id     : short UUID e.g. "A3F2B1C9"
        severity_result : SeverityResult from severity_engine.py
        lat, lng        : GPS coordinates
        address_short   : "MG Road, Bengaluru"
        address_full    : full street address
        maps_short_url  : TinyURL link
        plates          : list of detected plate strings
        video_url       : Cloudinary / Backblaze public HTTPS URL
        camera_id       : camera identifier string
        blocking        : if True, waits for the push to complete (default False)
    """
    if not CATALYST_ENABLED:
        return

    payload = _build_payload(
        incident_id    = incident_id,
        severity_label = severity_result.severity_label,
        severity_score = severity_result.severity_score,
        incident_type  = getattr(severity_result, "incident_type", None) or severity_result.primary_class,
        description    = severity_result.description,
        lat            = lat,
        lng            = lng,
        address_short  = address_short,
        address_full   = address_full,
        maps_short_url = maps_short_url,
        plates         = plates or [],
        video_url      = video_url,
        all_classes    = severity_result.all_classes,
        vehicle_count  = severity_result.vehicle_count,
        person_down    = severity_result.person_down,
        fire_detected  = severity_result.fire_detected,
        rollover       = severity_result.rollover_detected,
        dispatch_actions = severity_result.dispatch_actions,
        camera_id      = camera_id,
    )
    # Include snapshot URL in payload if provided
    if snapshot_url:
        payload["snapshot_url"] = snapshot_url

    print(f"[Catalyst] Queuing push → incident {incident_id}  severity={severity_result.severity_label}")

    if blocking:
        _push_to_catalyst(payload)
    else:
        t = threading.Thread(
            target = _push_to_catalyst,
            args   = (payload,),
            daemon = True,
            name   = f"catalyst-push-{incident_id}",
        )
        t.start()


def update_video_url(incident_id: str, video_url: str) -> None:
    """
    Call this after the cloud video upload finishes to patch the video URL
    in Catalyst Data Store (PATCH to the same Cloud Function with update flag).
    """
    if not CATALYST_ENABLED or not CATALYST_WEBHOOK_URL or not video_url:
        return

    update_url = CATALYST_WEBHOOK_URL.replace(
        "receive_incident", "update_incident"
    )

    payload = {
        "incident_id": incident_id,
        "video_url":   video_url,
        "update_type": "video_ready",
    }

    def _do_update():
        token = _get_access_token()
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Zoho-oauthtoken {token}"
        try:
            resp = requests.patch(update_url, json=payload,
                                  headers=headers, timeout=_TIMEOUT)
            if resp.status_code in (200, 201, 202):
                print(f"[Catalyst] ✓ Video URL updated for {incident_id}")
            else:
                print(f"[Catalyst] Video URL update failed: HTTP {resp.status_code}")
        except Exception as exc:
            print(f"[Catalyst] Video URL update error: {exc}")

    threading.Thread(target=_do_update, daemon=True).start()
