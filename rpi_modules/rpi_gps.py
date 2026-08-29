"""
rpi_gps.py — GPS reader for VigilanteVanguard RPi5 edge unit
=============================================================
Hardware : u-blox NEO-M8N connected to UART (/dev/ttyS0, 9600 baud)
           OR read via gpsd daemon (preferred for reliability)

Install  : sudo apt install gpsd gpsd-clients
           pip install gps3 pyserial

Wiring   :
  NEO-M8N TX  →  RPi5 Pin 10 (GPIO15 / UART0 RX)
  NEO-M8N RX  →  RPi5 Pin  8 (GPIO14 / UART0 TX)
  NEO-M8N VCC →  RPi5 Pin  1 (3.3V)
  NEO-M8N GND →  RPi5 Pin  6 (GND)

Usage    :
  from rpi_gps import GPSReader
  gps = GPSReader()
  gps.start()
  loc = gps.get_location()   # → {"lat": 12.97, "lng": 77.59, "accuracy": 3.2, ...}
"""

from __future__ import annotations

import threading
import time
import logging
from dataclasses import dataclass, field
from typing import Optional

log = logging.getLogger("vv.gps")


@dataclass
class GPSFix:
    lat: float = 0.0
    lng: float = 0.0
    altitude: float = 0.0
    speed_kmh: float = 0.0          # vehicle speed at incident
    heading: float = 0.0            # degrees true north
    accuracy: float = 999.0         # horizontal accuracy in metres
    satellites: int = 0
    timestamp: float = field(default_factory=time.time)
    valid: bool = False

    def to_dict(self) -> dict:
        return {
            "lat": round(self.lat, 7),
            "lng": round(self.lng, 7),
            "altitude": round(self.altitude, 1),
            "speed_kmh": round(self.speed_kmh, 1),
            "heading": round(self.heading, 1),
            "accuracy_m": round(self.accuracy, 1),
            "satellites": self.satellites,
            "gps_timestamp": self.timestamp,
            "fix_valid": self.valid,
        }


class GPSReader:
    """
    Thread-safe GPS reader. Tries gpsd first, falls back to direct UART NMEA.
    Always returns the last known fix — never blocks the caller.
    """

    def __init__(self, uart_port: str = "/dev/ttyS0", baud: int = 9600):
        self._uart_port = uart_port
        self._baud = baud
        self._fix = GPSFix()
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self):
        """Start background GPS polling thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="vv-gps")
        self._thread.start()
        log.info("GPS reader started")

    def stop(self):
        self._running = False

    def get_location(self) -> dict:
        """Return the latest GPS fix as a dict. Thread-safe."""
        with self._lock:
            return self._fix.to_dict()

    def get_fix(self) -> GPSFix:
        with self._lock:
            import copy
            return copy.copy(self._fix)

    def wait_for_fix(self, timeout: float = 60.0) -> bool:
        """Block until a valid fix is obtained or timeout expires."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                if self._fix.valid:
                    return True
            time.sleep(0.5)
        return False

    # ── Internal polling ─────────────────────────────────────────────────────

    def _run(self):
        """Try gpsd first; fall back to direct NMEA over UART."""
        if self._try_gpsd():
            return
        log.warning("gpsd unavailable — falling back to direct UART NMEA")
        self._read_uart_nmea()

    def _try_gpsd(self) -> bool:
        """Poll gpsd daemon. Returns True if gpsd is available and running."""
        try:
            import gps as gpsd_lib  # gps3 package
            session = gpsd_lib.gps(mode=gpsd_lib.WATCH_ENABLE | gpsd_lib.WATCH_NEWSTYLE)
            log.info("Connected to gpsd")
            while self._running:
                try:
                    report = session.next()
                    if report["class"] == "TPV":
                        fix = GPSFix()
                        fix.lat = getattr(report, "lat", 0.0) or 0.0
                        fix.lng = getattr(report, "lon", 0.0) or 0.0
                        fix.altitude = getattr(report, "alt", 0.0) or 0.0
                        fix.speed_kmh = (getattr(report, "speed", 0.0) or 0.0) * 3.6
                        fix.heading = getattr(report, "track", 0.0) or 0.0
                        fix.accuracy = getattr(report, "eph", 999.0) or 999.0
                        fix.timestamp = time.time()
                        fix.valid = fix.lat != 0.0 and fix.lng != 0.0
                        with self._lock:
                            self._fix = fix
                    elif report["class"] == "SKY":
                        sats = len([s for s in (report.satellites or []) if s.used])
                        with self._lock:
                            self._fix.satellites = sats
                except StopIteration:
                    break
                except Exception as e:
                    log.debug("gpsd report error: %s", e)
                    time.sleep(0.1)
            return True
        except Exception as e:
            log.debug("gpsd not available: %s", e)
            return False

    def _read_uart_nmea(self):
        """Direct UART NMEA-0183 parsing fallback."""
        try:
            import serial
            ser = serial.Serial(self._uart_port, self._baud, timeout=1)
            log.info("UART GPS opened on %s", self._uart_port)
            while self._running:
                try:
                    line = ser.readline().decode("ascii", errors="ignore").strip()
                    if line.startswith("$GNGGA") or line.startswith("$GPGGA"):
                        self._parse_gga(line)
                    elif line.startswith("$GNRMC") or line.startswith("$GPRMC"):
                        self._parse_rmc(line)
                except Exception as e:
                    log.debug("NMEA parse error: %s", e)
        except Exception as e:
            log.error("Cannot open UART GPS: %s", e)
            # Demo mode — return a static Bengaluru coordinate
            log.warning("GPS unavailable — using static demo location (Bengaluru)")
            with self._lock:
                self._fix = GPSFix(
                    lat=12.9716, lng=77.5946,
                    accuracy=50.0, valid=True,
                    satellites=0,
                )

    def _parse_gga(self, sentence: str):
        """Parse $GPGGA sentence for position + satellites + accuracy."""
        try:
            parts = sentence.split(",")
            if len(parts) < 10 or parts[2] == "":
                return
            lat_raw, lat_dir = parts[2], parts[3]
            lng_raw, lng_dir = parts[4], parts[5]
            quality = int(parts[6]) if parts[6] else 0
            sats = int(parts[7]) if parts[7] else 0
            hdop = float(parts[8]) if parts[8] else 99.9
            alt = float(parts[9]) if parts[9] else 0.0

            lat = self._dm_to_dd(lat_raw, lat_dir)
            lng = self._dm_to_dd(lng_raw, lng_dir)

            with self._lock:
                self._fix.lat = lat
                self._fix.lng = lng
                self._fix.altitude = alt
                self._fix.satellites = sats
                self._fix.accuracy = hdop * 5.0   # rough estimate
                self._fix.valid = quality > 0
                self._fix.timestamp = time.time()
        except Exception as e:
            log.debug("GGA parse failed: %s", e)

    def _parse_rmc(self, sentence: str):
        """Parse $GPRMC for speed + heading."""
        try:
            parts = sentence.split(",")
            if len(parts) < 9 or parts[2] != "A":
                return
            speed_knots = float(parts[7]) if parts[7] else 0.0
            heading = float(parts[8]) if parts[8] else 0.0
            with self._lock:
                self._fix.speed_kmh = speed_knots * 1.852
                self._fix.heading = heading
        except Exception as e:
            log.debug("RMC parse failed: %s", e)

    @staticmethod
    def _dm_to_dd(dm: str, direction: str) -> float:
        """Convert NMEA degrees-minutes to decimal degrees."""
        if not dm:
            return 0.0
        dot = dm.index(".")
        degrees = float(dm[:dot - 2])
        minutes = float(dm[dot - 2:])
        dd = degrees + minutes / 60.0
        if direction in ("S", "W"):
            dd = -dd
        return dd


# ── Module-level singleton ─────────────────────────────────────────────────────
_reader: Optional[GPSReader] = None


def get_gps_reader() -> GPSReader:
    global _reader
    if _reader is None:
        _reader = GPSReader()
        _reader.start()
    return _reader


def get_current_location() -> dict:
    """
    Convenience function — returns latest GPS fix dict.
    Safe to call from any thread at any time.
    """
    return get_gps_reader().get_location()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    r = GPSReader()
    r.start()
    print("Waiting for GPS fix (max 30s)…")
    got_fix = r.wait_for_fix(30)
    if got_fix:
        print("Fix:", r.get_location())
    else:
        print("No fix — current state:", r.get_location())
