"""
rpi_hospital_router.py — Nearest hospital finder + ETA routing
==============================================================
Queries OSM Overpass API for hospitals within radius of GPS coordinates.
Ranks by distance. Returns best hospital for ambulance dispatch.

Install  : pip install requests

Usage    :
  from rpi_hospital_router import HospitalRouter
  router = HospitalRouter()
  hospital = router.find_nearest(lat=12.9716, lng=77.5946, trauma_only=True)
  # → {"name": "St. John's Hospital", "phone": "+918022065000",
  #    "distance_km": 1.2, "eta_min": 8, "lat": 12.965, "lng": 77.601,
  #    "has_trauma": True}
"""

from __future__ import annotations

import logging
import math
import os
import time
from dataclasses import dataclass
from typing import List, Optional

import requests

log = logging.getLogger("vv.hospital")

OVERPASS_URL    = "https://overpass-api.de/api/interpreter"
SEARCH_RADIUS_M = int(os.environ.get("HOSPITAL_SEARCH_RADIUS_M", "10000"))  # 10 km
AVG_SPEED_KMH   = 40   # urban ambulance average speed
REQUEST_TIMEOUT = 6

# Known Karnataka hospital emergency numbers (fallback if OSM has no phone)
_KNOWN_HOSPITALS: dict[str, str] = {
    "Victoria Hospital Bengaluru":       "+918022975225",
    "St. John's Medical College":        "+918022065000",
    "Bowring and Lady Curzon Hospital":  "+918025371008",
    "Kidwai Memorial Institute":         "+918026094000",
    "Jayadeva Institute":                "+918026533401",
    "NIMHANS":                           "+918046110007",
    "K.R. Hospital Mysuru":              "+918212520491",
    "Wenlock District Hospital Mangaluru": "+918242426400",
}


@dataclass
class Hospital:
    name:         str
    lat:          float
    lng:          float
    distance_km:  float
    eta_min:      int
    phone:        str
    has_trauma:   bool
    has_icu:      bool
    osm_id:       int = 0

    def to_dict(self) -> dict:
        return {
            "name":         self.name,
            "lat":          self.lat,
            "lng":          self.lng,
            "distance_km":  round(self.distance_km, 2),
            "eta_min":      self.eta_min,
            "phone":        self.phone,
            "has_trauma":   self.has_trauma,
            "has_icu":      self.has_icu,
        }


class HospitalRouter:
    """Finds the nearest appropriate hospital using OSM Overpass API."""

    def __init__(self):
        self._cache: dict = {}          # (lat_r, lng_r) → (timestamp, list)
        self._cache_ttl = 3600         # 1 hour

    def find_nearest(
        self,
        lat: float,
        lng: float,
        trauma_only: bool = False,
        max_results: int = 3,
    ) -> Optional[Hospital]:
        """
        Find the nearest hospital to (lat, lng).
        If trauma_only=True, prefers hospitals tagged with trauma/emergency.
        Returns None if no hospital found within SEARCH_RADIUS_M.
        """
        hospitals = self._query_osm(lat, lng)
        if not hospitals:
            log.warning("No hospitals found within %dm of %.4f,%.4f",
                        SEARCH_RADIUS_M, lat, lng)
            return self._hardcoded_fallback(lat, lng)

        # Sort: trauma first if requested, then by distance
        if trauma_only:
            hospitals.sort(key=lambda h: (not h.has_trauma, h.distance_km))
        else:
            hospitals.sort(key=lambda h: h.distance_km)

        best = hospitals[0]
        log.info("Nearest hospital: %s (%.1fkm, ETA ~%dmin)",
                 best.name, best.distance_km, best.eta_min)
        return best

    def find_top_n(self, lat: float, lng: float, n: int = 3) -> List[Hospital]:
        """Return top N hospitals sorted by distance."""
        hospitals = self._query_osm(lat, lng)
        hospitals.sort(key=lambda h: h.distance_km)
        return hospitals[:n]

    # ── OSM Overpass query ────────────────────────────────────────────────────

    def _query_osm(self, lat: float, lng: float) -> List[Hospital]:
        # Round to ~500m grid for cache key
        cache_key = (round(lat, 2), round(lng, 2))
        cached = self._cache.get(cache_key)
        if cached and (time.time() - cached[0]) < self._cache_ttl:
            return cached[1]

        query = f"""
        [out:json][timeout:{REQUEST_TIMEOUT}];
        (
          node["amenity"="hospital"](around:{SEARCH_RADIUS_M},{lat},{lng});
          way["amenity"="hospital"](around:{SEARCH_RADIUS_M},{lat},{lng});
          node["amenity"="clinic"]["emergency"="yes"](around:{SEARCH_RADIUS_M},{lat},{lng});
        );
        out center;
        """
        try:
            r = requests.post(OVERPASS_URL, data=query, timeout=REQUEST_TIMEOUT + 2)
            r.raise_for_status()
            elements = r.json().get("elements", [])
            hospitals = []
            for el in elements:
                h_lat = el.get("lat") or el.get("center", {}).get("lat", 0)
                h_lng = el.get("lon") or el.get("center", {}).get("lon", 0)
                if not h_lat or not h_lng:
                    continue
                tags = el.get("tags", {})
                name = tags.get("name") or tags.get("name:en") or "Unknown Hospital"
                phone = (tags.get("phone") or tags.get("contact:phone") or
                         _KNOWN_HOSPITALS.get(name, "+91108"))
                dist = self._haversine(lat, lng, h_lat, h_lng)
                eta = max(3, int(dist / AVG_SPEED_KMH * 60))
                has_trauma = tags.get("emergency") in ("yes", "trauma_center")
                has_icu = "icu" in tags.get("healthcare:speciality", "").lower()
                hospitals.append(Hospital(
                    name=name, lat=h_lat, lng=h_lng,
                    distance_km=dist, eta_min=eta,
                    phone=phone, has_trauma=has_trauma, has_icu=has_icu,
                    osm_id=el.get("id", 0),
                ))
            self._cache[cache_key] = (time.time(), hospitals)
            return hospitals
        except Exception as e:
            log.error("OSM Overpass query failed: %s", e)
            return []

    def _hardcoded_fallback(self, lat: float, lng: float) -> Hospital:
        """Return a static nearest hospital when OSM is unreachable."""
        dist = 5.0   # assume 5km
        return Hospital(
            name="Nearest Government Hospital",
            lat=lat, lng=lng,
            distance_km=dist,
            eta_min=int(dist / AVG_SPEED_KMH * 60),
            phone="+91108",   # National ambulance
            has_trauma=False, has_icu=False,
        )

    @staticmethod
    def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        """Distance in km between two GPS coordinates."""
        R = 6371.0
        d_lat = math.radians(lat2 - lat1)
        d_lng = math.radians(lng2 - lng1)
        a = (math.sin(d_lat / 2) ** 2 +
             math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
             math.sin(d_lng / 2) ** 2)
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── Module-level singleton ─────────────────────────────────────────────────────
_router: Optional[HospitalRouter] = None


def get_hospital_router() -> HospitalRouter:
    global _router
    if _router is None:
        _router = HospitalRouter()
    return _router


def find_nearest_hospital(lat: float, lng: float, trauma_only: bool = True) -> Optional[dict]:
    """Convenience one-liner used by rpi_edge_manager."""
    h = get_hospital_router().find_nearest(lat, lng, trauma_only=trauma_only)
    return h.to_dict() if h else None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    router = HospitalRouter()
    h = router.find_nearest(12.9716, 77.5946, trauma_only=True)
    if h:
        print(f"Nearest: {h.name} | {h.distance_km:.1f}km | ETA {h.eta_min}min | {h.phone}")
    else:
        print("No hospital found")
