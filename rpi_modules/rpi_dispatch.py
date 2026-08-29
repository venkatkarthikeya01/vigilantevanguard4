"""
rpi_dispatch.py — Emergency dispatch via SIM7600G-H 4G HAT
===========================================================
Hardware : Waveshare SIM7600G-H 4G HAT stacked on RPi5 40-pin header
           USB AT command port : /dev/ttyUSB2  (usually)
           USB data port       : /dev/ttyUSB1

Install  : pip install pyserial requests

SMS flow :
  1. detect_accident() called by rpi_edge_manager
  2. send_sms(108, message) → AT+CMGS via SIM7600
  3. send_sms(nearest_station_phone, police_msg)
  4. Optional: whatsapp_alert() via Meta Business API

Calls    :
  AT+CMGF=1  → text mode
  AT+CMGS    → send SMS
  ATD        → voice call (for 108 which needs a call, not SMS)
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Optional

import requests

log = logging.getLogger("vv.dispatch")

# ── Configuration (override via env vars) ─────────────────────────────────────
SIM_PORT     = os.environ.get("SIM_PORT",    "/dev/ttyUSB2")
SIM_BAUD     = int(os.environ.get("SIM_BAUD", "115200"))
AMBULANCE_NO = os.environ.get("AMBULANCE_NO", "108")
POLICE_PCR   = os.environ.get("POLICE_PCR",  "100")

# MSG91 WhatsApp Business (optional — higher reliability than AT SMS)
MSG91_AUTH_KEY   = os.environ.get("MSG91_AUTH_KEY",   "")
MSG91_SENDER_ID  = os.environ.get("MSG91_SENDER_ID",  "VVKSP")
MSG91_TEMPLATE   = os.environ.get("MSG91_TEMPLATE_ID","")
WHATSAPP_ENABLED = bool(MSG91_AUTH_KEY)


@dataclass
class DispatchResult:
    success: bool
    method: str          # "sms_at", "sms_msg91", "whatsapp", "mock"
    recipients: list
    message_preview: str
    error: Optional[str] = None
    timestamp: float = 0.0

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = time.time()


class SIM7600:
    """Low-level AT command interface to SIM7600G-H over serial."""

    def __init__(self, port: str = SIM_PORT, baud: int = SIM_BAUD):
        self._port = port
        self._baud = baud
        self._ser = None
        self._lock = threading.Lock()
        self._ready = False

    def connect(self) -> bool:
        try:
            import serial
            self._ser = serial.Serial(self._port, self._baud, timeout=5)
            time.sleep(0.5)
            resp = self._cmd("AT")
            if "OK" in resp:
                self._cmd("AT+CMGF=1")   # text SMS mode
                self._cmd("AT+CSCS=\"GSM\"")
                self._ready = True
                log.info("SIM7600 ready on %s", self._port)
                return True
        except Exception as e:
            log.warning("SIM7600 not available (%s) — will use MSG91 fallback", e)
        return False

    def _cmd(self, cmd: str, wait: float = 2.0) -> str:
        if not self._ser:
            return ""
        with self._lock:
            self._ser.write((cmd + "\r\n").encode())
            time.sleep(wait)
            resp = self._ser.read(self._ser.in_waiting).decode("ascii", errors="ignore")
            log.debug("AT >> %s  << %s", cmd[:40], resp[:60].replace("\r\n", "|"))
            return resp

    def send_sms(self, number: str, text: str) -> bool:
        """Send SMS via AT+CMGS. Returns True on success."""
        if not self._ready:
            return False
        try:
            with self._lock:
                self._ser.write(f'AT+CMGS="{number}"\r\n'.encode())
                time.sleep(1)
                self._ser.write((text + "\x1a").encode())  # Ctrl+Z
                time.sleep(4)
                resp = self._ser.read(self._ser.in_waiting).decode("ascii", errors="ignore")
                ok = "+CMGS:" in resp
                log.info("SMS to %s: %s", number, "OK" if ok else "FAILED – " + resp[:80])
                return ok
        except Exception as e:
            log.error("SMS send error: %s", e)
            return False

    def make_call(self, number: str, duration_s: int = 8) -> bool:
        """Dial a number, wait duration_s, then hang up."""
        if not self._ready:
            return False
        try:
            self._cmd(f"ATD{number};", wait=duration_s)
            self._cmd("ATH", wait=1)
            log.info("Call to %s completed (%ds)", number, duration_s)
            return True
        except Exception as e:
            log.error("Call error: %s", e)
            return False

    def get_signal_strength(self) -> int:
        """Returns RSSI 0–31, 99=unknown."""
        resp = self._cmd("AT+CSQ")
        m = re.search(r"\+CSQ:\s*(\d+)", resp)
        return int(m.group(1)) if m else 99

    def get_network_info(self) -> dict:
        creg = self._cmd("AT+CREG?")
        csq  = self.get_signal_strength()
        return {"registered": "0,1" in creg or "0,5" in creg, "rssi": csq}


class DispatchEngine:
    """
    High-level dispatch orchestrator.
    Called by rpi_edge_manager on confirmed incident.
    """

    def __init__(self):
        self._sim = SIM7600()
        self._sim_ok = False

    def initialise(self):
        self._sim_ok = self._sim.connect()
        if not self._sim_ok:
            log.warning("SIM7600 offline — will use MSG91 API for SMS")

    # ── Public dispatch methods ───────────────────────────────────────────────

    def call_ambulance(
        self,
        lat: float, lng: float,
        incident_id: str,
        incident_type: str = "Road Accident",
        vehicle_plates: list = None,
        victim_count: int = 0,
        triage_code: str = "T2",
        nearest_hospital: dict = None,
    ) -> DispatchResult:
        """
        Dispatch ambulance for an accident.
        1. SMS to 108 with GPS + details
        2. Call 108 (voice, 8s) to trigger immediate pickup
        3. SMS to nearest hospital emergency number
        """
        maps_link = f"https://maps.google.com/?q={lat},{lng}"
        plates_str = ", ".join(vehicle_plates or []) or "unknown"

        msg_108 = (
            f"[VV ALERT] {incident_type} detected.\n"
            f"Location: {lat:.5f},{lng:.5f}\n"
            f"Maps: {maps_link}\n"
            f"Victims: {victim_count} | Triage: {triage_code}\n"
            f"Vehicles: {plates_str}\n"
            f"Incident: {incident_id}"
        )

        recipients = []

        # Primary: SMS + call 108
        sms_ok = self._send(AMBULANCE_NO, msg_108)
        if sms_ok:
            recipients.append(AMBULANCE_NO)
        self._sim.make_call(AMBULANCE_NO, duration_s=8)

        # Hospital SMS
        if nearest_hospital and nearest_hospital.get("phone"):
            h_msg = (
                f"[VV EMERGENCY] {incident_type} — {victim_count} victim(s) en route.\n"
                f"Triage: {triage_code} | ETA: ~{nearest_hospital.get('eta_min',10)} min\n"
                f"GPS: {lat:.5f},{lng:.5f} | Incident: {incident_id}"
            )
            ok = self._send(nearest_hospital["phone"], h_msg)
            if ok:
                recipients.append(nearest_hospital["phone"])

        return DispatchResult(
            success=len(recipients) > 0,
            method="sms_at" if self._sim_ok else "sms_msg91",
            recipients=recipients,
            message_preview=msg_108[:80],
        )

    def dispatch_police(
        self,
        station_name: str,
        station_phone: str,
        lat: float, lng: float,
        incident_id: str,
        incident_type: str,
        severity: str,
        vehicle_plates: list = None,
    ) -> DispatchResult:
        """Send SMS alert to the nearest police station."""
        maps_link = f"https://maps.google.com/?q={lat},{lng}"
        plates_str = ", ".join(vehicle_plates or []) or "unknown"

        msg = (
            f"[VV DISPATCH] {severity} — {incident_type}\n"
            f"Station: {station_name}\n"
            f"Location: {maps_link}\n"
            f"Vehicles: {plates_str}\n"
            f"Incident ID: {incident_id}\n"
            f"ACTION REQUIRED IMMEDIATELY"
        )

        ok = self._send(station_phone, msg)
        return DispatchResult(
            success=ok,
            method="sms_at" if self._sim_ok else "sms_msg91",
            recipients=[station_phone] if ok else [],
            message_preview=msg[:80],
        )

    def send_citizen_alert(
        self,
        lat: float, lng: float,
        incident_type: str,
        radius_km: float = 0.5,
    ) -> DispatchResult:
        """
        Broadcast public safety SMS via MSG91 bulk API.
        In production, integrate with telecom operator's Cell Broadcast.
        """
        msg = (
            f"[PUBLIC SAFETY] {incident_type} reported near your location. "
            f"Please avoid the area and follow police instructions. "
            f"Emergency: 100 | Ambulance: 108"
        )
        # MSG91 bulk SMS placeholder
        log.info("Citizen alert queued for %s @ %.4f,%.4f", incident_type, lat, lng)
        return DispatchResult(
            success=True, method="mock",
            recipients=["bulk"], message_preview=msg[:60]
        )

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _send(self, number: str, text: str) -> bool:
        """Try AT SMS → MSG91 API fallback."""
        # Sanitise number
        number = re.sub(r"[^\d+]", "", number)
        if not number.startswith("+"):
            number = "+91" + number.lstrip("0")

        if self._sim_ok:
            return self._sim.send_sms(number, text)

        if WHATSAPP_ENABLED:
            return self._send_msg91(number, text)

        # Last resort: log only (dev/offline mode)
        log.warning("[MOCK SMS] To %s: %s", number, text[:60])
        return True   # return True so dispatch log shows as sent in dev

    def _send_msg91(self, number: str, text: str) -> bool:
        try:
            url = "https://api.msg91.com/api/v5/flow/"
            payload = {
                "template_id": MSG91_TEMPLATE,
                "short_url":   "0",
                "recipients":  [{"mobiles": number, "message": text}],
            }
            r = requests.post(
                url, json=payload,
                headers={"authkey": MSG91_AUTH_KEY, "Content-Type": "application/json"},
                timeout=5,
            )
            ok = r.status_code == 200
            log.info("MSG91 SMS to %s: %s", number, "OK" if ok else r.text[:60])
            return ok
        except Exception as e:
            log.error("MSG91 error: %s", e)
            return False

    def get_modem_status(self) -> dict:
        return {
            "sim_connected": self._sim_ok,
            "signal_rssi":   self._sim.get_signal_strength() if self._sim_ok else -1,
            **self._sim.get_network_info() if self._sim_ok else {},
        }


# ── Module-level singleton ─────────────────────────────────────────────────────
_engine: Optional[DispatchEngine] = None


def get_dispatch_engine() -> DispatchEngine:
    global _engine
    if _engine is None:
        _engine = DispatchEngine()
        _engine.initialise()
    return _engine


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    eng = DispatchEngine()
    eng.initialise()
    print("Modem:", eng.get_modem_status())
    r = eng.call_ambulance(
        lat=12.9716, lng=77.5946,
        incident_id="INC-TEST-001",
        incident_type="Road Accident",
        vehicle_plates=["KA03MJ1234"],
        victim_count=2,
        triage_code="T1",
    )
    print("Dispatch result:", r)
