"""
rpi_env_sensor.py — BME680 environmental sensor reader
=======================================================
Reads temperature, humidity, air pressure, and VOC/gas resistance
from the Bosch BME680 over I2C.

Hardware : BME680 breakout → RPi5 I2C
  VCC → Pin 1  (3.3V)
  GND → Pin 6  (GND)
  SDA → Pin 3  (GPIO2 / I2C1 SDA)
  SCL → Pin 5  (GPIO3 / I2C1 SCL)

Enable I2C: sudo raspi-config → Interface Options → I2C → Enable

Install  : pip install bme680 smbus2

Usage    :
  from rpi_env_sensor import EnvSensor
  sensor = EnvSensor()
  reading = sensor.read()
  # → {"temp_c": 28.4, "humidity_pct": 62.1, "pressure_hpa": 1013.2,
  #    "gas_ohm": 52000, "air_quality": "Good", "co_risk": False,
  #    "fog_detected": False, "timestamp": 1234567890.0}
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger("vv.env")

# Thresholds
TEMP_FIRE_THRESHOLD    = 65.0    # °C — abnormally high temp near camera → possible fire
GAS_CO_THRESHOLD       = 10000   # Ohms — very low resistance = high VOC/CO concentration
HUMIDITY_FOG_LOW       = 95.0    # % relative humidity → fog / heavy rain
PRESSURE_STORM_HPA     = 990.0   # hPa — low pressure storm warning


@dataclass
class EnvReading:
    temp_c:       float
    humidity_pct: float
    pressure_hpa: float
    gas_ohm:      int
    air_quality:  str    # "Good" | "Moderate" | "Poor" | "Hazardous"
    co_risk:      bool   # True if gas resistance suggests CO/VOC accumulation
    fog_detected: bool   # True if humidity suggests fog
    fire_heat:    bool   # True if ambient temp unusually high (fire nearby)
    timestamp:    float

    def to_dict(self) -> dict:
        return {
            "temp_c":       round(self.temp_c, 1),
            "humidity_pct": round(self.humidity_pct, 1),
            "pressure_hpa": round(self.pressure_hpa, 2),
            "gas_ohm":      self.gas_ohm,
            "air_quality":  self.air_quality,
            "co_risk":      self.co_risk,
            "fog_detected": self.fog_detected,
            "fire_heat":    self.fire_heat,
            "timestamp":    self.timestamp,
        }

    def incident_flags(self) -> list:
        """Return list of incident type hints based on sensor reading."""
        flags = []
        if self.co_risk:
            flags.append("Fire / Smoke")
        if self.fire_heat:
            flags.append("Fire / Smoke")
        if self.fog_detected:
            flags.append("Road Accident")   # fog increases accident risk
        return flags


class EnvSensor:
    """BME680 reader with graceful fallback when hardware is absent."""

    def __init__(self, i2c_addr: int = 0x76):
        self._addr = i2c_addr
        self._sensor = None
        self._last: Optional[EnvReading] = None
        self._init()

    def _init(self):
        try:
            import bme680
            self._sensor = bme680.BME680(i2c_addr=self._addr)
            self._sensor.set_humidity_oversample(bme680.OS_2X)
            self._sensor.set_pressure_oversample(bme680.OS_4X)
            self._sensor.set_temperature_oversample(bme680.OS_8X)
            self._sensor.set_filter(bme680.FILTER_SIZE_3)
            self._sensor.set_gas_status(bme680.ENABLE_GAS_MEAS)
            self._sensor.set_gas_heater_temperature(320)
            self._sensor.set_gas_heater_duration(150)
            self._sensor.select_gas_heater_profile(0)
            log.info("BME680 initialised at I2C addr 0x%02X", self._addr)
        except Exception as e:
            log.warning("BME680 not available (%s) — env sensor disabled", e)

    def read(self) -> EnvReading:
        """Take a single reading. Returns last cached value on error."""
        if self._sensor is None:
            return self._mock_reading()
        try:
            if self._sensor.get_sensor_data():
                temp     = self._sensor.data.temperature
                humidity = self._sensor.data.humidity
                pressure = self._sensor.data.pressure
                gas      = int(self._sensor.data.gas_resistance) if self._sensor.data.heat_stable else 50000

                air_q    = self._air_quality(gas)
                co_risk  = gas < GAS_CO_THRESHOLD
                fog      = humidity >= HUMIDITY_FOG_LOW
                fire_h   = temp >= TEMP_FIRE_THRESHOLD

                reading = EnvReading(
                    temp_c=temp, humidity_pct=humidity, pressure_hpa=pressure,
                    gas_ohm=gas, air_quality=air_q,
                    co_risk=co_risk, fog_detected=fog, fire_heat=fire_h,
                    timestamp=time.time(),
                )
                self._last = reading
                return reading
        except Exception as e:
            log.error("BME680 read error: %s", e)
        return self._last or self._mock_reading()

    def read_continuous(self, interval_s: float = 5.0):
        """Generator: yields readings every interval_s seconds."""
        while True:
            yield self.read()
            time.sleep(interval_s)

    @staticmethod
    def _air_quality(gas_ohm: int) -> str:
        if gas_ohm > 300_000: return "Good"
        if gas_ohm > 100_000: return "Moderate"
        if gas_ohm > 10_000:  return "Poor"
        return "Hazardous"

    @staticmethod
    def _mock_reading() -> EnvReading:
        """Safe default when no hardware present."""
        return EnvReading(
            temp_c=28.0, humidity_pct=60.0, pressure_hpa=1013.0,
            gas_ohm=150_000, air_quality="Good",
            co_risk=False, fog_detected=False, fire_heat=False,
            timestamp=time.time(),
        )


# ── Module-level singleton ─────────────────────────────────────────────────────
_sensor: Optional[EnvSensor] = None


def get_env_sensor() -> EnvSensor:
    global _sensor
    if _sensor is None:
        _sensor = EnvSensor()
    return _sensor


def read_environment() -> dict:
    """Convenience one-liner used by rpi_edge_manager."""
    return get_env_sensor().read().to_dict()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    s = EnvSensor()
    for _ in range(5):
        r = s.read()
        print(f"Temp={r.temp_c}°C  Hum={r.humidity_pct}%  "
              f"Gas={r.gas_ohm}Ω  AQ={r.air_quality}  "
              f"CO={r.co_risk}  Fog={r.fog_detected}")
        time.sleep(2)
