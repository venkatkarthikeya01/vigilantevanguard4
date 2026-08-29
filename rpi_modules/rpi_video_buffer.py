"""
rpi_video_buffer.py — Circular pre/post-event video recorder
=============================================================
Records a rolling 30-second buffer in RAM at all times.
On accident detection: saves 30s BEFORE + 60s AFTER to NVMe as MP4.

Hardware : CSI Camera (picamera2) OR USB camera (OpenCV)
Install  : sudo apt install python3-picamera2 ffmpeg
           pip install opencv-python-headless

Usage    :
  from rpi_video_buffer import VideoBuffer
  buf = VideoBuffer(camera_source=0)   # 0=USB cam, "csi"=CSI cam
  buf.start()
  # ... accident detected ...
  clip_path = buf.save_event_clip("INC-0001", pre_s=30, post_s=60)
  # → "/mnt/nvme/recordings/INC-0001_2026-08-08T13-52-33.mp4"
"""

from __future__ import annotations

import collections
import io
import logging
import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Deque, Optional, Tuple

log = logging.getLogger("vv.video")

RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/mnt/nvme/recordings")
FPS            = int(os.environ.get("RECORDING_FPS", "15"))       # 15fps = good balance
RESOLUTION     = (int(os.environ.get("CAM_W", "1280")),
                  int(os.environ.get("CAM_H", "720")))
PRE_BUFFER_S   = 30    # seconds of pre-event frames to keep in RAM
MAX_BUFFER_FRAMES = PRE_BUFFER_S * FPS


@dataclass
class FrameEntry:
    data: bytes          # JPEG bytes
    timestamp: float     # Unix time


class VideoBuffer:
    """
    Thread-safe circular frame buffer + event clip writer.

    Architecture:
      - Capture thread continuously writes JPEG frames into a deque(maxlen=450)
        (30s @ 15fps = 450 frames, ~40–80 MB RAM)
      - On event: snapshot deque, continue capturing post-event frames,
        then pipe all frames to ffmpeg to produce MP4
    """

    def __init__(
        self,
        camera_source: int | str = 0,
        fps: int = FPS,
        resolution: Tuple[int, int] = RESOLUTION,
        recordings_dir: str = RECORDINGS_DIR,
    ):
        self._source = camera_source
        self._fps = fps
        self._resolution = resolution
        self._recordings_dir = recordings_dir
        self._buffer: Deque[FrameEntry] = collections.deque(maxlen=MAX_BUFFER_FRAMES)
        self._lock = threading.Lock()
        self._running = False
        self._cap_thread: Optional[threading.Thread] = None
        self._cap = None       # OpenCV VideoCapture or picamera2 instance
        self._use_picam = camera_source == "csi"

        os.makedirs(recordings_dir, exist_ok=True)

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self):
        """Start the background capture thread."""
        if self._running:
            return
        self._running = True
        self._cap_thread = threading.Thread(
            target=self._capture_loop, daemon=True, name="vv-video-buf"
        )
        self._cap_thread.start()
        log.info("VideoBuffer started: source=%s fps=%d res=%s",
                 self._source, self._fps, self._resolution)

    def stop(self):
        self._running = False

    def get_latest_frame(self) -> Optional[bytes]:
        """Return the most recent JPEG frame bytes (for AI detection)."""
        with self._lock:
            if self._buffer:
                return self._buffer[-1].data
        return None

    def save_event_clip(
        self,
        incident_id: str,
        pre_s: int = 30,
        post_s: int = 60,
    ) -> Optional[str]:
        """
        Snapshot current buffer (pre-event) then capture post_s more seconds,
        then write everything to MP4 via ffmpeg pipe.
        Returns the output file path.
        """
        log.info("Saving event clip for %s (pre=%ds post=%ds)", incident_id, pre_s, post_s)

        # Snapshot pre-event frames
        with self._lock:
            pre_frames = list(self._buffer)[-pre_s * self._fps:]

        # Capture post-event frames
        post_frames = self._capture_post_event(post_s)

        all_frames = pre_frames + post_frames
        if not all_frames:
            log.warning("No frames to save for %s", incident_id)
            return None

        ts = time.strftime("%Y-%m-%dT%H-%M-%S", time.gmtime())
        filename = f"{incident_id}_{ts}.mp4"
        out_path = os.path.join(self._recordings_dir, filename)

        self._write_mp4(all_frames, out_path)
        log.info("Clip saved: %s (%d frames)", out_path, len(all_frames))
        return out_path

    def snapshot_jpeg(self) -> Optional[bytes]:
        """Return annotated snapshot JPEG for incident record."""
        return self.get_latest_frame()

    # ── Internal capture ──────────────────────────────────────────────────────

    def _capture_loop(self):
        if self._use_picam:
            self._capture_picam2()
        else:
            self._capture_opencv()

    def _capture_opencv(self):
        try:
            import cv2
            self._cap = cv2.VideoCapture(self._source)
            self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._resolution[0])
            self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._resolution[1])
            self._cap.set(cv2.CAP_PROP_FPS, self._fps)
            interval = 1.0 / self._fps
            log.info("OpenCV capture started on source %s", self._source)

            while self._running:
                t0 = time.time()
                ret, frame = self._cap.read()
                if not ret:
                    time.sleep(0.1)
                    continue
                _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                entry = FrameEntry(data=jpeg.tobytes(), timestamp=time.time())
                with self._lock:
                    self._buffer.append(entry)
                elapsed = time.time() - t0
                sleep_t = max(0, interval - elapsed)
                time.sleep(sleep_t)
        except Exception as e:
            log.error("OpenCV capture error: %s", e)
        finally:
            if self._cap:
                self._cap.release()

    def _capture_picam2(self):
        try:
            from picamera2 import Picamera2
            import libcamera
            picam = Picamera2()
            config = picam.create_video_configuration(
                main={"size": self._resolution, "format": "RGB888"},
                controls={"FrameRate": self._fps},
            )
            picam.configure(config)
            picam.start()
            log.info("picamera2 capture started")
            interval = 1.0 / self._fps

            while self._running:
                t0 = time.time()
                frame = picam.capture_array()
                import cv2
                _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                entry = FrameEntry(data=jpeg.tobytes(), timestamp=time.time())
                with self._lock:
                    self._buffer.append(entry)
                elapsed = time.time() - t0
                time.sleep(max(0, interval - elapsed))
        except Exception as e:
            log.error("picamera2 capture error: %s", e)

    def _capture_post_event(self, duration_s: int) -> list:
        """Collect live frames for duration_s seconds."""
        frames = []
        deadline = time.time() + duration_s
        interval = 1.0 / self._fps
        while time.time() < deadline:
            t0 = time.time()
            f = self.get_latest_frame()
            if f:
                frames.append(FrameEntry(data=f, timestamp=time.time()))
            time.sleep(max(0, interval - (time.time() - t0)))
        return frames

    def _write_mp4(self, frames: list, out_path: str):
        """Pipe JPEG frames to ffmpeg to create an MP4."""
        try:
            cmd = [
                "ffmpeg", "-y",
                "-framerate", str(self._fps),
                "-f", "image2pipe",
                "-vcodec", "mjpeg",
                "-i", "pipe:0",
                "-vcodec", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-movflags", "+faststart",
                out_path,
            ]
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            for entry in frames:
                proc.stdin.write(entry.data)
            proc.stdin.close()
            proc.wait(timeout=120)
        except Exception as e:
            log.error("ffmpeg write error: %s", e)


# ── Module-level singleton ─────────────────────────────────────────────────────
_buffer: Optional[VideoBuffer] = None


def get_video_buffer(source: int | str = 0) -> VideoBuffer:
    global _buffer
    if _buffer is None:
        _buffer = VideoBuffer(camera_source=source)
        _buffer.start()
    return _buffer


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    buf = VideoBuffer(camera_source=0)
    buf.start()
    print("Buffering for 35s then saving test clip…")
    time.sleep(35)
    path = buf.save_event_clip("TEST-001", pre_s=20, post_s=10)
    print("Saved to:", path)
    buf.stop()
