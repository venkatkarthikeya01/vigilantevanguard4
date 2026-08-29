"""
rpi.py — VigilanteVanguard RPi5 Edge Unit Integration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Receives real-time road accident incident data from the RPi5 field
unit (via rpi_catalyst.py) and injects it into the existing
VigilanteVanguard incident pipeline.

Flow:
  RPi5 (rpi_catalyst.py)
      │  HTTPS POST  /api/v1/rpi/incident
      ▼
  This router (rpi.py)
      ├── Validates the HMAC-signed payload
      ├── Converts RPi severity → CCTV severity format
      ├── Calls _new_incident() from cctv.py → auto-creates notification
      ├── Broadcasts via WebSocket to all connected police dashboards
      ├── Writes to Catalyst Data Store (RpiIncidentTable)
      ├── Sends push notification via CatalystPush
      └── Sends email alert via CatalystMail (HIGH + CRITICAL)

Endpoints:
  POST /api/v1/rpi/incident          — receive new incident from RPi5
  PATCH /api/v1/rpi/incident/{id}/video — update video URL after upload
  GET  /api/v1/rpi/incidents          — list all RPi5 incidents
  GET  /api/v1/rpi/health             — RPi5 integration status
  POST /api/v1/rpi/device/register    — register police officer FCM token

Auth:
  RPi5 sends X-VV-Signature header = HMAC-SHA256(body, RPI_WEBHOOK_SECRET)
  Officers use normal Bearer token for read endpoints.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ── Shared incident store from cctv module ────────────────────────
# We inject RPi5 incidents directly into the same _INCIDENTS list
# so the police dashboard sees them alongside CCTV detections.
try:
    from app.routers.cctv import (
        _new_incident,
        _INCIDENTS,
        _NOTIFICATIONS,
        _WS_MANAGER,
        DEMO_CAMERAS,
        POLICE_STATIONS,
        _nearest_station,
        _compute_severity,
        AIDetectionEngine,
    )
    _CCTV_AVAILABLE = True
except Exception as _e:
    _CCTV_AVAILABLE = False
    print(f"[RPi] CCTV module not available: {_e} — running standalone")
    _INCIDENTS: List[Dict[str, Any]] = []
    _NOTIFICATIONS: List[Dict[str, Any]] = []
    DEMO_CAMERAS: List[Dict[str, Any]] = []
    POLICE_STATIONS: List[Dict[str, Any]] = []

    def _nearest_station(lat, lng): return None
    def _compute_severity(itype, conf): return {"level": "HIGH", "score": 70, "colour": "#f97316", "description": "", "response_eta_minutes": 10}
    class _WS_MANAGER:  # type: ignore
        @staticmethod
        async def broadcast(msg): pass

# ── Catalyst services ─────────────────────────────────────────────
try:
    from app.core.catalyst import CatalystDataStore, CatalystPush, CatalystMail
    _CATALYST_AVAILABLE = True
except Exception:
    _CATALYST_AVAILABLE = False

# ── Configuration ─────────────────────────────────────────────────
RPI_WEBHOOK_SECRET = os.environ.get("VV_WEBHOOK_SECRET", os.environ.get("RPI_WEBHOOK_SECRET", "rpi5_vv_default_secret_change_me"))
RPI_TABLE          = "RpiIncidentTable"
DEVICE_TABLE       = "DeviceTokenTable"
POLICE_EMAIL       = os.environ.get("POLICE_STATION_EMAIL", "police@station.gov.in")

# In-memory store (fallback when Catalyst not available)
_RPI_INCIDENTS: List[Dict[str, Any]] = []
_RPI_INCIDENT_COUNTER = 0

# ── Severity mapping: RPi5 label → CCTV score ─────────────────────
# RPi5 uses 5-level: CRITICAL/HIGH/MEDIUM/LOW/MONITOR
# CCTV uses 0-100 score. Map to midpoints so _compute_severity is consistent.
_RPi_TO_CCTV_TYPE = {
    "car_accident":       "Road Accident",
    "bike_accident":      "Road Accident",
    "truck_accident":     "Road Accident",
    "bus_accident":       "Road Accident",
    "auto_accident":      "Road Accident",
    "pedestrian_hit":     "Person Unconscious",
    "person_down":        "Person Unconscious",
    "multi_vehicle":      "Vehicle Collision",
    "vehicle_fire":       "Fire / Smoke",
    "vehicle_rollover":   "Vehicle Collision",
    "head_on":            "Vehicle Collision",
    "rear_end":           "Vehicle Collision",
    "road_debris":        "Suspicious Activity",
    "vehicle_normal":     "Suspicious Activity",
    "traffic_congestion": "Suspicious Activity",
}

_RPi_SEVERITY_SCORE = {
    "CRITICAL": 90,
    "HIGH":     72,
    "MEDIUM":   50,
    "LOW":      25,
    "MONITOR":  10,
}

# ── Router ────────────────────────────────────────────────────────
router = APIRouter(prefix="/api/v1/rpi", tags=["RPi5 Integration"])


# ── Pydantic models ───────────────────────────────────────────────

class RpiSeverity(BaseModel):
    label: str   # CRITICAL / HIGH / MEDIUM / LOW / MONITOR
    score: int   # 0–4

class RpiIncident(BaseModel):
    type:           str
    description:    str
    all_classes:    List[str] = []
    vehicle_count:  int       = 0
    person_down:    bool      = False
    fire_detected:  bool      = False
    rollover:       bool      = False
    plates:         List[str] = []

class RpiLocation(BaseModel):
    lat:           float
    lng:           float
    address_short: str   = ""
    address_full:  str   = ""
    maps_url:      str   = ""
    google_maps:   str   = ""

class RpiVideo(BaseModel):
    cloud_url:  str  = ""
    available:  bool = False

class RpiDispatch(BaseModel):
    actions: List[str] = []

class RpiIncidentPayload(BaseModel):
    """Full incident payload from rpi_catalyst.py."""
    source:          str               = "VigilanteVanguard_RPi5"
    camera_id:       str               = "CAM0"
    incident_id:     str
    timestamp_utc:   str               = ""
    timestamp_local: str               = ""
    severity:        RpiSeverity
    incident:        RpiIncident
    location:        RpiLocation
    video:           RpiVideo          = RpiVideo()
    dispatch:        RpiDispatch       = RpiDispatch()

class VideoUpdateReq(BaseModel):
    video_url:   str
    update_type: str = "video_ready"

class DeviceRegisterReq(BaseModel):
    officer_name: str
    station:      str = ""
    fcm_token:    str


# ── HMAC verification ─────────────────────────────────────────────

def _verify_signature(body: bytes, signature: str) -> bool:
    """
    Verify HMAC-SHA256 signature from RPi5.
    RPi5 sends: X-VV-Signature: sha256=<hex>
    """
    if not signature:
        # No signature — allow in dev mode (no CATALYST_PROJECT_ID set)
        is_dev = not os.environ.get("VV_PROJECT_ID", os.environ.get("CATALYST_PROJECT_ID", "")).strip().isdigit()
        if is_dev:
            return True
        return False
    try:
        sig_val = signature.replace("sha256=", "")
        expected = hmac.new(
            RPI_WEBHOOK_SECRET.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(sig_val, expected)
    except Exception:
        return False


# ── Map RPi5 payload → CCTV incident ──────────────────────────────

def _rpi_to_cctv_incident(payload: RpiIncidentPayload) -> Dict[str, Any]:
    """
    Convert RPi5 payload into the CCTV incident dict format.
    Reuses _new_incident() if available, or builds manually.
    """
    itype      = _RPi_TO_CCTV_TYPE.get(payload.incident.type, "Road Accident")
    conf_score = _RPi_SEVERITY_SCORE.get(payload.severity.label, 70)
    confidence = round(conf_score / 100.0, 2)

    lat = payload.location.lat
    lng = payload.location.lng
    address = payload.location.address_short or payload.location.address_full or f"{lat:.5f}, {lng:.5f}"

    ts = payload.timestamp_utc or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    nearest_station = _nearest_station(lat, lng) if POLICE_STATIONS else None
    severity = _compute_severity(itype, confidence)

    # Override severity level with RPi's actual assessment (more accurate)
    severity["level"]  = payload.severity.label if payload.severity.label != "MONITOR" else "LOW"
    severity["score"]  = conf_score
    severity["colour"] = {
        "CRITICAL": "#dc2626", "HIGH": "#f97316",
        "MEDIUM": "#f59e0b",   "LOW": "#6b7280",
    }.get(payload.severity.label, "#6b7280")

    plates_str = ", ".join(payload.incident.plates) if payload.incident.plates else ""

    global _RPI_INCIDENT_COUNTER
    _RPI_INCIDENT_COUNTER += 1

    inc: Dict[str, Any] = {
        "incident_id":        f"RPI-{payload.incident_id}",
        "rpi_incident_id":    payload.incident_id,
        "incident_type":      itype,
        "rpi_incident_type":  payload.incident.type,
        "confidence":         confidence,
        "camera_id":          payload.camera_id,
        "camera_name":        f"RPi5 Edge Unit ({payload.camera_id})",
        "camera_location":    address,
        "video_path":         "",
        "snapshot":           _rpi_snapshot_svg(payload),  # SVG placeholder
        "ai_summary":         _build_summary(payload),
        "latitude":           lat,
        "longitude":          lng,
        "timestamp":          ts,
        "timestamp_local":    payload.timestamp_local,
        "status":             "PENDING",
        "source":             "rpi5",                       # tag so dashboard can filter
        "assigned_station":   nearest_station["name"] if nearest_station else "Nearest Station",
        "assigned_station_id":   nearest_station["id"]   if nearest_station else None,
        "assigned_station_phone": nearest_station.get("phone","") if nearest_station else "",
        "dispatch_recommended": payload.severity.score >= 2,
        "confirmed_by":       None,
        "confirmed_at":       None,
        "district":           "",
        "zone":               "",
        "severity":           severity,
        "location": {
            "lat":          lat,
            "lng":          lng,
            "address":      address,
            "address_full": payload.location.address_full,
            "district":     "",
            "zone":         "",
            "maps_url":     payload.location.maps_url or payload.location.google_maps,
            "maps_embed":   f"https://maps.google.com/maps?q={lat},{lng}&z=16&output=embed",
        },
        # RPi-specific extras
        "rpi": {
            "plates":          payload.incident.plates,
            "all_classes":     payload.incident.all_classes,
            "vehicle_count":   payload.incident.vehicle_count,
            "person_down":     payload.incident.person_down,
            "fire_detected":   payload.incident.fire_detected,
            "rollover":        payload.incident.rollover,
            "dispatch_actions": payload.dispatch.actions,
            "video_url":       payload.video.cloud_url,
            "video_available": payload.video.available,
            "description":     payload.incident.description,
        },
    }
    return inc


def _build_summary(p: RpiIncidentPayload) -> str:
    """Build a plain-English AI summary for the police dashboard."""
    loc    = p.location.address_short or f"{p.location.lat:.5f}, {p.location.lng:.5f}"
    itype  = p.incident.type.replace("_", " ").title()
    sev    = p.severity.label
    plates = (", ".join(p.incident.plates[:3]) + ("…" if len(p.incident.plates) > 3 else "")
              ) if p.incident.plates else "not detected"

    extra = []
    if p.incident.fire_detected:  extra.append("vehicle fire")
    if p.incident.rollover:       extra.append("vehicle overturned")
    if p.incident.person_down:    extra.append("person on road")
    extra_str = f" — {', '.join(extra)}" if extra else ""

    video_str = (f" Footage: {p.video.cloud_url}" if p.video.cloud_url
                 else " Footage uploading to cloud.")

    return (
        f"[RPi5 Field Unit] {sev} severity {itype} detected at {loc}{extra_str}. "
        f"Vehicles detected: {p.incident.vehicle_count}. Plates: {plates}. "
        f"Dispatch actions: {', '.join(p.dispatch.actions) or 'logged only'}."
        f"{video_str}"
    )


def _rpi_snapshot_svg(p: RpiIncidentPayload) -> str:
    """SVG placeholder thumbnail for the dashboard until real video is available."""
    import base64
    col_map = {
        "CRITICAL": "#dc2626", "HIGH": "#f97316",
        "MEDIUM": "#f59e0b",   "LOW": "#6b7280", "MONITOR": "#2196F3",
    }
    col = col_map.get(p.severity.label, "#374151")
    itype_display = p.incident.type.replace("_", " ").upper()
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#111827"/>
  <rect width="320" height="180" fill="{col}" opacity="0.15"/>
  <text x="160" y="55" font-family="monospace" font-size="10" fill="#9ca3af" text-anchor="middle">RPi5 FIELD UNIT — {p.camera_id}</text>
  <text x="160" y="80" font-family="monospace" font-size="12" fill="white" font-weight="bold" text-anchor="middle">{itype_display}</text>
  <text x="160" y="100" font-family="monospace" font-size="10" fill="{col}" text-anchor="middle">{p.severity.label}</text>
  <text x="160" y="118" font-family="monospace" font-size="9" fill="#6b7280" text-anchor="middle">{p.location.address_short[:40] if p.location.address_short else "GPS: " + str(round(p.location.lat,4)) + ", " + str(round(p.location.lng,4))}</text>
  <text x="160" y="140" font-family="monospace" font-size="9" fill="#4b5563" text-anchor="middle">{p.incident_id}</text>
  <rect x="10" y="10" width="60" height="16" rx="3" fill="{col}" opacity="0.8"/>
  <text x="15" y="22" font-family="monospace" font-size="9" fill="white">● RPI5</text>
</svg>'''
    b64 = base64.b64encode(svg.encode()).decode()
    return f"data:image/svg+xml;base64,{b64}"


# ── Catalyst DataStore helpers ────────────────────────────────────

async def _store_rpi_incident(payload: RpiIncidentPayload, incident: Dict) -> Optional[str]:
    """Persist the full RPi5 incident to Catalyst Data Store."""
    if not _CATALYST_AVAILABLE:
        _RPI_INCIDENTS.append(incident)
        return None
    try:
        row = {
            "incident_id":      payload.incident_id,
            "rpi_incident_id":  payload.incident_id,
            "camera_id":        payload.camera_id,
            "severity_label":   payload.severity.label,
            "severity_score":   payload.severity.score,
            "incident_type":    payload.incident.type,
            "description":      payload.incident.description,
            "lat":              payload.location.lat,
            "lng":              payload.location.lng,
            "address_short":    payload.location.address_short,
            "address_full":     payload.location.address_full,
            "maps_url":         payload.location.maps_url,
            "plates":           json.dumps(payload.incident.plates),
            "video_url":        payload.video.cloud_url,
            "all_classes":      json.dumps(payload.incident.all_classes),
            "vehicle_count":    payload.incident.vehicle_count,
            "person_down":      str(payload.incident.person_down),
            "fire_detected":    str(payload.incident.fire_detected),
            "rollover":         str(payload.incident.rollover),
            "dispatch_actions": json.dumps(payload.dispatch.actions),
            "timestamp_utc":    payload.timestamp_utc,
            "timestamp_local":  payload.timestamp_local,
            "raw_payload":      json.dumps(payload.model_dump())[:4000],
        }
        result = await CatalystDataStore.insert(RPI_TABLE, row)
        return str(result.get("ROWID", ""))
    except Exception as exc:
        print(f"[RPi] DataStore insert failed: {exc}")
        _RPI_INCIDENTS.append(incident)
        return None


async def _send_push_notification(payload: RpiIncidentPayload):
    """Send FCM push to all registered police officer devices."""
    if not _CATALYST_AVAILABLE:
        return
    try:
        # Get all active device tokens
        tokens = await CatalystDataStore.query(
            f"SELECT fcm_token, officer_name FROM {DEVICE_TABLE} WHERE active = 'true'"
        )
        if not tokens:
            return

        emoji = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🟢", "MONITOR": "🔵"}
        e     = emoji.get(payload.severity.label, "⚠️")
        title = f"{e} {payload.severity.label} ROAD ACCIDENT — RPi5 Alert"
        body  = (
            f"{payload.incident.type.replace('_',' ').upper()} — "
            f"{payload.location.address_short or str(round(payload.location.lat,4))+', '+str(round(payload.location.lng,4))}"
        )
        if payload.incident.person_down:    body += " | ⚠️ Person on road"
        if payload.incident.fire_detected:  body += " | 🔥 Fire"

        data = {
            "incident_id":   payload.incident_id,
            "severity":      payload.severity.label,
            "incident_type": payload.incident.type,
            "lat":           str(payload.location.lat),
            "lng":           str(payload.location.lng),
            "maps_url":      payload.location.maps_url,
            "video_url":     payload.video.cloud_url,
            "screen":        "IncidentDetail",
        }
        for row in tokens:
            token_data = row.get(DEVICE_TABLE, row)
            fcm = token_data.get("fcm_token") if isinstance(token_data, dict) else None
            if fcm:
                try:
                    await CatalystPush.notify(
                        device_token = fcm,
                        title        = title,
                        body         = body,
                        data         = data,
                    )
                except Exception as push_err:
                    print(f"[RPi] Push failed for token ...{fcm[-8:]}: {push_err}")
    except Exception as exc:
        print(f"[RPi] Push notification error: {exc}")


async def _send_email_alert(payload: RpiIncidentPayload):
    """Send HTML email to police station for HIGH and CRITICAL incidents."""
    if not _CATALYST_AVAILABLE:
        return
    try:
        loc       = payload.location.address_full or payload.location.address_short
        maps_url  = payload.location.maps_url or payload.location.google_maps
        plates    = ", ".join(payload.incident.plates) if payload.incident.plates else "Not detected"
        video_sec = (
            f'<p><strong>📹 Footage:</strong> <a href="{payload.video.cloud_url}">▶ Watch Video</a></p>'
            if payload.video.cloud_url
            else "<p><strong>📹 Footage:</strong> Upload in progress — check dashboard.</p>"
        )
        warnings = "".join([
            '<p style="color:#c62828;">⚠️ <strong>Person lying on road — urgent medical help needed</strong></p>' if payload.incident.person_down  else "",
            '<p style="color:#c62828;">🔥 <strong>Vehicle fire detected</strong></p>'                           if payload.incident.fire_detected else "",
            '<p style="color:#c62828;">🔄 <strong>Vehicle rollover detected</strong></p>'                       if payload.incident.rollover      else "",
        ])
        col_map = {"CRITICAL":"#c62828","HIGH":"#e65100","MEDIUM":"#f57f17","LOW":"#2e7d32"}
        col     = col_map.get(payload.severity.label, "#555")

        html = f"""<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;">
<div style="background:#1a237e;padding:18px 28px;border-radius:8px 8px 0 0;">
  <h2 style="color:#fff;margin:0;">🚨 VigilanteVanguard — RPi5 Road Accident Alert</h2>
  <p style="color:#9fa8da;margin:4px 0 0;font-size:13px;">Automated Edge Unit Detection — {payload.camera_id}</p>
</div>
<div style="background:#fff;padding:22px 28px;border-radius:0 0 8px 8px;box-shadow:0 2px 8px rgba(0,0,0,.1);">
  <p><strong>Severity:</strong> <span style="background:{col};color:#fff;padding:4px 14px;border-radius:4px;font-weight:bold;">{payload.severity.label}</span></p>
  <p><strong>Incident ID:</strong> {payload.incident_id}</p>
  <p><strong>Type:</strong> {payload.incident.type.replace('_',' ').upper()}</p>
  <p><strong>Time:</strong> {payload.timestamp_local}</p>
  <p><strong>Description:</strong> {payload.incident.description}</p>
  <hr style="border-top:1px solid #e0e0e0;">
  <h3 style="color:#1a237e;">📍 Location</h3>
  <p>{loc or "GPS only"}</p>
  <p><strong>GPS:</strong> {payload.location.lat:.6f}, {payload.location.lng:.6f}</p>
  <a href="{maps_url}" style="background:#1565c0;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;display:inline-block;">📌 Google Maps</a>
  <hr style="border-top:1px solid #e0e0e0;margin:16px 0;">
  <h3 style="color:#1a237e;">🚗 Details</h3>
  <p><strong>Vehicles:</strong> {payload.incident.vehicle_count} &nbsp; <strong>Plates:</strong> {plates}</p>
  {warnings}
  <hr style="border-top:1px solid #e0e0e0;margin:16px 0;">
  {video_sec}
  <p style="font-size:11px;color:#9e9e9e;text-align:center;">Auto-alert from VigilanteVanguard RPi5 • {payload.incident_id} • Do not reply</p>
</div>
</body></html>"""

        await CatalystMail.send(
            to       = [POLICE_EMAIL],
            subject  = f"[{payload.severity.label}] RPi5 Road Accident — {payload.location.address_short or payload.incident.type} [{payload.incident_id}]",
            body     = html,
            is_html  = True,
        )
        print(f"[RPi] Email sent to {POLICE_EMAIL} for incident {payload.incident_id}")
    except Exception as exc:
        print(f"[RPi] Email error: {exc}")


# ═══════════════════════════════════════════════════════════════════
#  REST ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@router.get("/health")
async def rpi_health():
    """Health check for the RPi5 integration module."""
    return {
        "status":            "active",
        "module":            "RPi5 Edge Unit Integration",
        "version":           "1.0.0",
        "cctv_pipeline":     _CCTV_AVAILABLE,
        "catalyst_services": _CATALYST_AVAILABLE,
        "rpi_incidents":     len(_RPI_INCIDENTS),
        "webhook_auth":      "hmac-sha256",
        "endpoint":          "POST /api/v1/rpi/incident",
    }


@router.post("/incident")
async def receive_rpi_incident(
    request:     Request,
    x_vv_signature: Optional[str] = Header(None, alias="X-VV-Signature"),
):
    """
    Receive a road accident incident from the RPi5 field unit.

    Called by rpi_catalyst.py → push_to_catalyst() on the RPi5.
    HMAC-SHA256 authenticated via X-VV-Signature header.
    """
    # ── Read raw body for signature check ────────────────────────
    body = await request.body()

    # ── Verify HMAC signature ─────────────────────────────────────
    if not _verify_signature(body, x_vv_signature or ""):
        raise HTTPException(401, "Invalid or missing X-VV-Signature")

    # ── Parse payload ─────────────────────────────────────────────
    try:
        data = json.loads(body)
        payload = RpiIncidentPayload(**data)
    except Exception as exc:
        raise HTTPException(400, f"Invalid payload: {exc}")

    print(f"[RPi] ← Incident {payload.incident_id}  severity={payload.severity.label}  "
          f"type={payload.incident.type}  cam={payload.camera_id}")

    # ── Convert to CCTV incident format ──────────────────────────
    incident = _rpi_to_cctv_incident(payload)

    # ── Inject into shared CCTV _INCIDENTS list ───────────────────
    # Police dashboard reads from this list for notifications + map pins
    if _CCTV_AVAILABLE:
        _INCIDENTS.insert(0, incident)
        # Auto-create police notification (same as CCTV incidents)
        from app.routers.cctv import _make_notification
        _make_notification(incident)
    else:
        _RPI_INCIDENTS.insert(0, incident)

    # ── Register RPi5 camera if not already registered ───────────
    cam_id = payload.camera_id
    if _CCTV_AVAILABLE and not any(c["camera_id"] == cam_id for c in DEMO_CAMERAS):
        DEMO_CAMERAS.append({
            "camera_id":   cam_id,
            "name":        f"RPi5 Field Unit ({cam_id})",
            "location":    payload.location.address_short or f"{payload.location.lat:.4f}, {payload.location.lng:.4f}",
            "lat":         payload.location.lat,
            "lng":         payload.location.lng,
            "source_type": "rpi5",
            "source_url":  "",
            "district":    "",
            "zone":        "",
            "status":      "active",
            "last_seen":   payload.timestamp_utc,
        })

    # ── Broadcast via WebSocket to all dashboard clients ──────────
    # NOTE: the hook (useCCTVSocket.ts) listens for msg.event not msg.type.
    # We send both so it works regardless of which field the client reads.
    _inc_ws = {
        "incident_id":    incident["incident_id"],
        "incident_type":  incident["incident_type"],
        "confidence":     incident["confidence"],
        "severity": {
            "level":       incident["severity"]["level"],
            "score":       incident["severity"]["score"],
            "colour":      incident["severity"]["colour"],
            "description": incident["severity"].get("description", ""),
        },
        "camera_id":      incident["camera_id"],
        "camera_name":    incident["camera_name"],
        "camera_location":incident["camera_location"],
        "latitude":       incident["latitude"],
        "longitude":      incident["longitude"],
        "timestamp":      incident["timestamp"],
        "timestamp_local":incident.get("timestamp_local", ""),
        "ai_summary":     incident["ai_summary"],
        "snapshot":       incident["snapshot"],
        "status":         "PENDING",
        "source":         "rpi5",
        "assigned_station": incident["assigned_station"],
        "dispatch_recommended": incident.get("dispatch_recommended", False),
        "video_path":     "",
        "video_url":      payload.video.cloud_url,
        "maps_url":       payload.location.maps_url or payload.location.google_maps,
        "rpi":            incident["rpi"],
    }
    ws_payload = {
        "event":       "NEW_INCIDENT",   # ← useCCTVSocket.ts listens on msg.event
        "type":        "NEW_INCIDENT",   # ← kept for any legacy clients
        "source":      "rpi5",
        "incident_id": incident["incident_id"],
        "incident":    _inc_ws,
    }
    try:
        await _WS_MANAGER.broadcast(ws_payload)
    except Exception as ws_err:
        print(f"[RPi] WebSocket broadcast error: {ws_err}")

    # ── Persist to Catalyst Data Store (async) ────────────────────
    import asyncio
    asyncio.create_task(_store_rpi_incident(payload, incident))

    # ── Push notification (async, non-blocking) ───────────────────
    # Only for MEDIUM and above
    if payload.severity.score >= 2:
        asyncio.create_task(_send_push_notification(payload))

    # ── Email alert (async, non-blocking) ─────────────────────────
    # Only for HIGH and CRITICAL
    if payload.severity.score >= 3:
        asyncio.create_task(_send_email_alert(payload))

    return JSONResponse(status_code=200, content={
        "status":         "received",
        "incident_id":    payload.incident_id,
        "dashboard_id":   incident["incident_id"],
        "severity":       payload.severity.label,
        "cctv_injected":  _CCTV_AVAILABLE,
        "ws_clients":     getattr(_WS_MANAGER, "connected_count", 0),
    })


@router.patch("/incident/{incident_id}/video")
async def update_video_url(incident_id: str, req: VideoUpdateReq):
    """
    Update the video URL for an existing RPi5 incident after cloud upload completes.
    Called by rpi_catalyst.update_video_url() on the RPi5.
    """
    full_id  = f"RPI-{incident_id}"
    found    = False

    # Update in shared CCTV incidents
    for inc in _INCIDENTS:
        if inc.get("rpi_incident_id") == incident_id or inc.get("incident_id") == full_id:
            inc["rpi"]["video_url"]      = req.video_url
            inc["rpi"]["video_available"] = True
            inc["ai_summary"] += f" Footage: {req.video_url}"
            found = True
            break

    # Update in local fallback store
    for inc in _RPI_INCIDENTS:
        if inc.get("rpi_incident_id") == incident_id:
            inc["rpi"]["video_url"]      = req.video_url
            inc["rpi"]["video_available"] = True
            found = True
            break

    # Update in Catalyst Data Store
    if _CATALYST_AVAILABLE:
        try:
            rows = await CatalystDataStore.query(
                f"SELECT ROWID FROM {RPI_TABLE} WHERE incident_id = '{incident_id}' LIMIT 1"
            )
            if rows:
                row_data = rows[0]
                row_id   = row_data.get(RPI_TABLE, row_data).get("ROWID") if isinstance(row_data, dict) else None
                if row_id:
                    await CatalystDataStore.update(RPI_TABLE, int(row_id), {"video_url": req.video_url})
                    found = True
        except Exception as exc:
            print(f"[RPi] Video URL update error: {exc}")

    # Broadcast video-ready event via WebSocket
    if found:
        try:
            import asyncio
            asyncio.create_task(_WS_MANAGER.broadcast({
                "type":        "VIDEO_READY",
                "source":      "rpi5",
                "incident_id": full_id,
                "video_url":   req.video_url,
            }))
        except Exception:
            pass

    return JSONResponse(status_code=200 if found else 404, content={
        "status":      "updated" if found else "not_found",
        "incident_id": incident_id,
        "video_url":   req.video_url,
    })


@router.get("/incidents")
async def list_rpi_incidents(
    limit:    int = 50,
    severity: Optional[str] = None,
):
    """
    List all RPi5 incidents (from shared store or local fallback).
    Optionally filter by severity label.
    """
    source  = _INCIDENTS if _CCTV_AVAILABLE else _RPI_INCIDENTS
    results = [i for i in source if i.get("source") == "rpi5"]

    if severity:
        results = [i for i in results if i.get("severity", {}).get("level") == severity.upper()]

    return {
        "incidents": results[:limit],
        "total":     len(results),
        "source":    "cctv_shared" if _CCTV_AVAILABLE else "rpi_local",
    }


# ═══════════════════════════════════════════════════════════════════
#  FOOTAGE ENDPOINTS
#  Police officers use these to browse + download evidence videos
#  stored on the RPi5's NVMe SSD and uploaded to Cloudinary/Backblaze.
# ═══════════════════════════════════════════════════════════════════

def _split_into_chunks(video_url: str, incident_id: str,
                       duration_minutes: int = 5) -> List[Dict[str, Any]]:
    """
    For a given cloud video URL, generate the list of 5-minute chunk
    descriptors.  The actual splitting happens on the RPi5 side
    (rpi_video_buffer saves a 90-second clip per incident by default).
    For longer recordings the RPi5 names them with a chunk suffix.

    Convention the RPi5 follows:
      INC-{id}_YYYYMMDD_HHMMSS_part{N}.mp4   (N = 1, 2, 3 …)
    If no part suffix exists the video is treated as a single chunk.

    Returns a list of dicts:
      { "chunk": 1, "label": "Part 1 (0:00 – 5:00)", "url": "…", "size_mb": null }
    """
    if not video_url:
        return []

    chunks: List[Dict[str, Any]] = []

    # Check whether the URL contains a _partN suffix pattern
    import re
    base_match = re.match(r"^(.*INC-[^_]+_\d{8}_\d{6})(_part(\d+))?(\.mp4.*)$", video_url)
    if base_match:
        base  = base_match.group(1)
        ext   = base_match.group(4)
        # Try to enumerate up to 12 parts (12 × 5 min = 60 min max)
        for n in range(1, 13):
            chunk_url = f"{base}_part{n}{ext}"
            # We can't HEAD-check from backend without hitting the CDN,
            # so we return all possible URLs and let the browser determine
            # which actually exist (404 = doesn't exist).
            start_min = (n - 1) * duration_minutes
            end_min   = n * duration_minutes
            chunks.append({
                "chunk":    n,
                "label":    f"Part {n}  ({start_min}:00 – {end_min}:00 min)",
                "url":      chunk_url,
                "incident_id": incident_id,
                "size_mb":  None,
                "exists":   None,   # unknown until client fetches
            })
    else:
        # Single file — return as one chunk
        chunks.append({
            "chunk":    1,
            "label":    "Full recording",
            "url":      video_url,
            "incident_id": incident_id,
            "size_mb":  None,
            "exists":   True,
        })

    return chunks


@router.get("/footage")
async def list_footage(
    camera_id:       Optional[str] = None,
    severity:        Optional[str] = None,
    limit:           int           = 100,
    chunk_minutes:   int           = 5,
):
    """
    List all evidence footage available for download / playback, grouped
    by incident. Police officers call this from the Footage Download page.

    Each incident entry includes:
      • incident metadata (id, severity, timestamp, location)
      • video_url — the main cloud URL (Cloudinary / Backblaze)
      • chunks    — list of 5-minute (or full) download links

    Query params:
      camera_id      — filter by RPi5 camera ID (e.g. "CAM0")
      severity       — filter by severity label (e.g. "HIGH")
      limit          — max incidents to return (default 100)
      chunk_minutes  — chunk size in minutes for split URLs (default 5)
    """
    source  = _INCIDENTS if _CCTV_AVAILABLE else _RPI_INCIDENTS
    results = [i for i in source if i.get("source") == "rpi5"]

    # Pull from Catalyst DataStore if available (survives restarts)
    if _CATALYST_AVAILABLE:
        try:
            where_parts = ["video_url != ''", "video_url IS NOT NULL"]
            if camera_id:
                where_parts.append(f"camera_id = '{camera_id}'")
            if severity:
                where_parts.append(f"severity_label = '{severity.upper()}'")
            where  = " AND ".join(where_parts)
            rows   = await CatalystDataStore.query(
                f"SELECT * FROM {RPI_TABLE} WHERE {where} ORDER BY ROWID DESC LIMIT {limit}"
            )
            db_results = []
            for row in rows:
                r = row.get(RPI_TABLE, row) if isinstance(row, dict) else {}
                inc_id    = r.get("incident_id", "")
                vid_url   = r.get("video_url",   "")
                db_results.append({
                    "incident_id":   inc_id,
                    "camera_id":     r.get("camera_id",      ""),
                    "severity":      r.get("severity_label",  ""),
                    "incident_type": r.get("incident_type",   ""),
                    "description":   r.get("description",     ""),
                    "timestamp":     r.get("timestamp_local", r.get("timestamp_utc", "")),
                    "address":       r.get("address_short",   ""),
                    "lat":           r.get("lat",             0),
                    "lng":           r.get("lng",             0),
                    "plates":        json.loads(r.get("plates", "[]")) if r.get("plates") else [],
                    "video_url":     vid_url,
                    "chunks":        _split_into_chunks(vid_url, inc_id, chunk_minutes),
                    "source":        "catalyst_db",
                })
            if db_results:
                return {
                    "footage":        db_results,
                    "total":          len(db_results),
                    "chunk_minutes":  chunk_minutes,
                    "source":         "catalyst_db",
                }
        except Exception as exc:
            print(f"[RPi] Footage DataStore query error: {exc}")
            # Fall through to in-memory

    # In-memory fallback
    if camera_id:
        results = [i for i in results if i.get("camera_id") == camera_id]
    if severity:
        results = [i for i in results if i.get("severity", {}).get("level") == severity.upper()]

    footage = []
    for inc in results[:limit]:
        rpi      = inc.get("rpi", {})
        vid_url  = rpi.get("video_url", "")
        inc_id   = inc.get("rpi_incident_id", inc.get("incident_id", ""))
        footage.append({
            "incident_id":   inc_id,
            "camera_id":     inc.get("camera_id", ""),
            "severity":      inc.get("severity", {}).get("level", ""),
            "incident_type": inc.get("rpi_incident_type", inc.get("incident_type", "")),
            "description":   rpi.get("description", ""),
            "timestamp":     inc.get("timestamp_local", inc.get("timestamp", "")),
            "address":       inc.get("camera_location", ""),
            "lat":           inc.get("latitude",  0),
            "lng":           inc.get("longitude", 0),
            "plates":        rpi.get("plates",    []),
            "video_url":     vid_url,
            "chunks":        _split_into_chunks(vid_url, inc_id, chunk_minutes),
            "source":        "memory",
        })

    return {
        "footage":       footage,
        "total":         len(footage),
        "chunk_minutes": chunk_minutes,
        "source":        "memory",
    }


@router.get("/footage/cameras")
async def list_footage_cameras():
    """
    Return the list of camera IDs that have at least one recorded incident
    with footage. Used to populate the camera filter dropdown on the
    Footage Download page.
    """
    source  = _INCIDENTS if _CCTV_AVAILABLE else _RPI_INCIDENTS
    cam_ids: set = set()

    for inc in source:
        if inc.get("source") == "rpi5" and inc.get("rpi", {}).get("video_url"):
            cam_ids.add(inc["camera_id"])

    if _CATALYST_AVAILABLE:
        try:
            rows = await CatalystDataStore.query(
                f"SELECT DISTINCT camera_id FROM {RPI_TABLE} WHERE video_url != ''"
            )
            for row in rows:
                r = row.get(RPI_TABLE, row) if isinstance(row, dict) else {}
                if r.get("camera_id"):
                    cam_ids.add(r["camera_id"])
        except Exception:
            pass

    return {"cameras": sorted(cam_ids)}


@router.post("/device/register")
async def register_device(req: DeviceRegisterReq):
    """
    Register a police officer's phone for FCM push notifications.
    Called by the police mobile app on first launch or token refresh.
    """
    if not req.fcm_token:
        raise HTTPException(400, "fcm_token is required")

    row = {
        "officer_name":  req.officer_name,
        "station":       req.station or "Unknown Station",
        "fcm_token":     req.fcm_token,
        "active":        "true",
        "registered_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    row_id = None
    if _CATALYST_AVAILABLE:
        try:
            # Check if already registered — update if so
            existing = await CatalystDataStore.query(
                f"SELECT ROWID FROM {DEVICE_TABLE} WHERE fcm_token = '{req.fcm_token}' LIMIT 1"
            )
            if existing:
                ex_data = existing[0]
                ex_id   = ex_data.get(DEVICE_TABLE, ex_data).get("ROWID") if isinstance(ex_data, dict) else None
                if ex_id:
                    await CatalystDataStore.update(DEVICE_TABLE, int(ex_id), row)
                    row_id = ex_id
                    print(f"[RPi] Device token updated: {req.officer_name}")
            else:
                result = await CatalystDataStore.insert(DEVICE_TABLE, row)
                row_id = result.get("ROWID")
                print(f"[RPi] New device registered: {req.officer_name}")
        except Exception as exc:
            print(f"[RPi] Device register error: {exc}")

    return {
        "status":   "registered",
        "row_id":   row_id,
        "officer":  req.officer_name,
        "station":  req.station,
    }


class TestContactsReq(BaseModel):
    POLICE_NUMBER:    str = "100"
    AMBULANCE_NUMBER: str = "108"
    FIRE_NUMBER:      str = "101"
    EXTRA_NUMBER:     str = ""
    EXTRA_NAME:       str = "Friend"


@router.post("/test-contacts")
async def update_test_contacts(req: TestContactsReq):
    """
    Update emergency contact numbers in the RPi5 .env file for testing.
    Called from the SOS page "Push to RPi5" button.
    Replaces POLICE_NUMBER, AMBULANCE_NUMBER, FIRE_NUMBER in the .env
    so SMS/calls go to test friends instead of real emergency services.
    """
    import re

    env_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "..", ".env"
    )
    # Try common RPi5 paths
    candidates = [
        env_path,
        "/home/karthikeya/vigilante_vanguard_rpi/.env",
        os.environ.get("VV_ENV_PATH", ""),
    ]
    env_file = next((p for p in candidates if p and os.path.isfile(p)), None)

    updates = {
        "POLICE_NUMBER":    req.POLICE_NUMBER    or "100",
        "AMBULANCE_NUMBER": req.AMBULANCE_NUMBER or "108",
        "FIRE_NUMBER":      req.FIRE_NUMBER      or "101",
    }
    if req.EXTRA_NUMBER:
        updates["EXTRA_TEST_NUMBER"] = req.EXTRA_NUMBER
        updates["EXTRA_TEST_NAME"]   = req.EXTRA_NAME

    written = []
    if env_file:
        try:
            with open(env_file, "r") as f:
                lines = f.readlines()

            new_lines = []
            replaced  = set()
            for line in lines:
                matched = False
                for key, val in updates.items():
                    if re.match(rf"^\s*{key}\s*=", line):
                        new_lines.append(f"{key}={val}\n")
                        replaced.add(key)
                        matched = True
                        break
                if not matched:
                    new_lines.append(line)

            # Append any keys that weren't already in the file
            for key, val in updates.items():
                if key not in replaced:
                    new_lines.append(f"{key}={val}\n")

            with open(env_file, "w") as f:
                f.writelines(new_lines)
            written = list(updates.keys())
            print(f"[RPi] Test contacts written to {env_file}: {updates}")
        except Exception as exc:
            print(f"[RPi] Could not write test contacts: {exc}")
            return {"status": "error", "detail": str(exc), "env_file": env_file}
    else:
        print("[RPi] No .env file found — test contacts not persisted to disk")

    return {
        "status":   "ok",
        "written":  written,
        "numbers":  updates,
        "env_file": env_file or "not found — restart pipeline manually",
        "note":     "Restart catalyst_pipeline.py on the RPi5 to apply changes",
    }
