"""
run_training_pipeline.py
========================
Full VigilanteVanguard AI training pipeline.

Steps:
  1. Start the FastAPI backend
  2. Scan ALL images from training_data/ folders on disk
  3. Print every image found, per label
  4. Start a training session (indexes all images into the feature store)
  5. Poll until COMPLETED, showing live epoch progress
  6. Print final per-label index counts and metrics
  7. Save histogram index to disk (survives server restarts)

Usage:
    python run_training_pipeline.py
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE_URL   = "http://localhost:8000"
POLL_EVERY = 2
MAX_WAIT   = 90
EPOCHS     = 30          # more epochs = smoother progress display

# ── helpers ──────────────────────────────────────────────────────────────────

def _get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE_URL}{path}", timeout=15) as r:
        return json.loads(r.read())

def _post(path: str, body: dict = None) -> dict:
    data = json.dumps(body or {}).encode()
    req  = urllib.request.Request(
        f"{BASE_URL}{path}", data=data,
        headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def wait_for_server(max_seconds: int = MAX_WAIT) -> bool:
    print(f"  Waiting up to {max_seconds}s for backend to start...")
    deadline = time.time() + max_seconds
    while time.time() < deadline:
        try:
            _get("/api/health")
            return True
        except Exception:
            time.sleep(1)
    return False

def print_sep(char="=", width=68):
    print(char * width)

# ── main ─────────────────────────────────────────────────────────────────────

def main():
    print_sep()
    print("  VigilanteVanguard - AI Training Pipeline")
    print("  Training ALL images from disk into the feature index")
    print_sep()

    # ── 1. Show what images are already on disk ────────────────────────────
    TRAINING_DIR = os.path.join(os.path.dirname(__file__), "training_data")
    IMAGE_EXTS   = {".jpg", ".jpeg", ".png"}

    print("\n[PRE-FLIGHT] Images found on disk:")
    total_on_disk = 0
    label_counts  = {}
    for folder in sorted(os.listdir(TRAINING_DIR)):
        folder_path = os.path.join(TRAINING_DIR, folder)
        if not os.path.isdir(folder_path) or folder in ("runs",):
            continue
        imgs = [
            f for f in os.listdir(folder_path)
            if os.path.splitext(f)[1].lower() in IMAGE_EXTS
            and not f.endswith("_thumb.jpg")
        ]
        if not imgs:
            continue
        label_counts[folder] = len(imgs)
        total_on_disk += len(imgs)
        print(f"  {folder:<30}  {len(imgs):>4} images")
        for img in sorted(imgs)[:5]:                   # show first 5 filenames
            print(f"    - {img}")
        if len(imgs) > 5:
            print(f"    ... and {len(imgs)-5} more")

    print(f"\n  TOTAL: {total_on_disk} images across {len(label_counts)} label folders")
    print_sep("-")

    # ── 2. Launch backend ─────────────────────────────────────────────────
    print("\n[1/4] Starting backend server...")
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app",
         "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"],
        cwd=backend_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    if not wait_for_server():
        print("  ERROR: server did not start in time")
        proc.terminate()
        sys.exit(1)
    print(f"  Backend healthy at {BASE_URL}")

    try:
        # ── 3. Scan disk — register every image ──────────────────────────
        print("\n[2/4] Scanning training_data/ — registering all images...")
        scan  = _post("/api/v1/training/dataset/scan-disk")
        stats = scan.get("dataset_stats", {})

        print(f"  Files scanned  : {scan.get('scanned', 0)}")
        print(f"  Newly registered: {scan.get('registered', 0)}")
        print(f"  Already known  : {scan.get('skipped', 0)}")
        print(f"  Errors         : {scan.get('errors', 0)}")
        print(f"  Total dataset  : {stats.get('total', 0)} samples | {stats.get('verified', 0)} verified")

        by_lbl = stats.get("by_label", {})
        if by_lbl:
            print("\n  Verified samples per label:")
            for lbl, cnt in sorted(by_lbl.items(), key=lambda x: -x[1]):
                bar = "#" * min(30, cnt)
                print(f"    {lbl:<28} {cnt:>4}  {bar}")

        print_sep("-")

        # ── 4. Start training ─────────────────────────────────────────────
        print(f"\n[3/4] Starting training session (epochs={EPOCHS})...")
        start      = _post("/api/v1/training/sessions/start", {
            "epochs":            EPOCHS,
            "model_base":        "yolov8n",
            "description":       f"Full disk training — {stats.get('total', 0)} images",
            "use_verified_only": True,
        })
        session_id = start["session"]["session_id"]
        n_samples  = start["session"]["dataset_size"]
        print(f"  Session ID : {session_id}")
        print(f"  Samples    : {n_samples} verified images")
        print_sep("-")

        # ── 5. Poll progress ─────────────────────────────────────────────
        print(f"\n[4/4] Training in progress — watching {n_samples} images...")
        print(f"  {'Epoch':>6}  {'%':>4}  {'Loss':>8}  {'mAP50':>7}  {'Prec':>7}  {'Rec':>7}  Status")
        print(f"  {'-'*6}  {'-'*4}  {'-'*8}  {'-'*7}  {'-'*7}  {'-'*7}  ------")
        last_epoch = -1
        while True:
            time.sleep(POLL_EVERY)
            sess     = _get(f"/api/v1/training/sessions/{session_id}")
            status   = sess.get("status", "?")
            epoch    = sess.get("current_epoch", 0)
            progress = sess.get("progress_pct", 0)
            m        = sess.get("latest_metrics", {})

            if epoch != last_epoch:
                last_epoch = epoch
                print(f"  {epoch:>6}/{EPOCHS}  {progress:>3}%  "
                      f"{m.get('loss',0):>8.4f}  "
                      f"{m.get('mAP50',0)*100:>6.1f}%  "
                      f"{m.get('precision',0)*100:>6.1f}%  "
                      f"{m.get('recall',0)*100:>6.1f}%  "
                      f"[{status}]")

            if status in ("COMPLETED", "FAILED", "CANCELLED"):
                break

        # ── 6. Results ───────────────────────────────────────────────────
        print()
        print_sep()
        if status == "COMPLETED":
            final    = sess.get("final_metrics", {})
            hist_sz  = sess.get("hist_index_size", 0)

            print("  TRAINING COMPLETE")
            print_sep("-")
            print(f"  Session    : {session_id}")
            print(f"  Samples    : {n_samples} images")
            print(f"  Loss       : {final.get('loss', 0):.4f}")
            print(f"  mAP@50     : {final.get('mAP50', 0)*100:.1f}%")
            print(f"  mAP@95     : {final.get('mAP95', 0)*100:.1f}%")
            print(f"  Precision  : {final.get('precision', 0)*100:.1f}%")
            print(f"  Recall     : {final.get('recall', 0)*100:.1f}%")
            print_sep("-")
            print(f"  Feature index size : {hist_sz} vectors (saved to disk)")
            print()

            # Verify index from status endpoint
            status_data = _get("/api/v1/training/status")
            by_lbl2 = status_data.get("hist_by_label", {})
            print("  Index breakdown (vectors per label):")
            for lbl, cnt in sorted(by_lbl2.items(), key=lambda x: -x[1]):
                bar = "#" * min(40, cnt // 2)
                print(f"    {lbl:<28} {cnt:>4}  {bar}")

            print_sep()
            print()
            print("  The trained model is now ACTIVE.")
            print("  Every frame from your IP camera will be compared against")
            print(f"  {hist_sz} stored feature vectors using cosine nearest-neighbour.")
            print()
            print("  Next steps:")
            print("  1. Start the server:  python -m uvicorn main:app --port 8000")
            print("  2. Open the app and go to AI CCTV page")
            print("  3. Connect your IP camera (IP Webcam app on phone)")
            print("  4. Show accident footage — the model will flag it")
            print()
            print("  To test without the UI:")
            print("  POST http://localhost:8000/api/v1/training/debug/detect")
            print("  with your accident image as multipart 'file' field")
            print_sep()
        else:
            print(f"  Training ended: {status}")
            print(f"  Error: {sess.get('error', 'unknown')}")
            print_sep()

    finally:
        proc.terminate()
        proc.wait()
        print("\n  Backend stopped.")


if __name__ == "__main__":
    main()
