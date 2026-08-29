"""
generate_training_data.py — VigilanteVanguard AI Training Data Generator
─────────────────────────────────────────────────────────────────────────
Generates synthetic labelled images for each incident category that
doesn't yet have enough training data.

Each category gets 15 synthetic images using OpenCV drawing primitives
that visually represent the scene type (colour palette, shapes, text labels).

Run:
    python generate_training_data.py
"""

import os
import sys
import numpy as np

try:
    import cv2
except ImportError:
    sys.exit("cv2 required — pip install opencv-python-headless")

TRAINING_DATA_DIR = os.path.join(os.path.dirname(__file__), "training_data")
IMAGES_PER_CLASS  = 15   # how many images to synthesise per category

# ─── Category definitions ─────────────────────────────────────────────────────
# Each entry: (folder_name, bg_colour_BGR, fg_colour_BGR, description, scene_fn)
#
#  scene_fn(img, rng) → draws incident-specific shapes onto the image in-place

def _scene_fire_smoke(img, rng):
    h, w = img.shape[:2]
    # Yellow/orange flame triangles
    for _ in range(rng.integers(4, 8)):
        cx = int(rng.integers(w//4, 3*w//4))
        cy = int(rng.integers(h//3, 2*h//3))
        size = int(rng.integers(20, 60))
        pts = np.array([[cx, cy-size], [cx-size//2, cy+size//2], [cx+size//2, cy+size//2]])
        col = (int(rng.integers(0, 60)), int(rng.integers(60, 150)), int(rng.integers(180, 255)))
        cv2.fillPoly(img, [pts], col)
    # Grey smoke circles
    for _ in range(rng.integers(5, 12)):
        cx = int(rng.integers(10, w-10))
        cy = int(rng.integers(0, h//2))
        r  = int(rng.integers(15, 45))
        gray = int(rng.integers(120, 200))
        cv2.circle(img, (cx, cy), r, (gray, gray, gray), -1)

def _scene_physical_fight(img, rng):
    h, w = img.shape[:2]
    # Two stick figures close together
    for i, offset in enumerate([-40, 40]):
        cx = w//2 + offset
        cy_head = h//3
        cv2.circle(img, (cx, cy_head), 18, (200, 160, 120), -1)
        cv2.line(img, (cx, cy_head+18), (cx, cy_head+65), (100, 100, 200), 4)
        cv2.line(img, (cx, cy_head+30), (cx+35*(1 if i==0 else -1), cy_head+50), (100,100,200), 3)
        cv2.line(img, (cx, cy_head+65), (cx-20, cy_head+110), (100,100,200), 3)
        cv2.line(img, (cx, cy_head+65), (cx+20, cy_head+110), (100,100,200), 3)
    # Red impact marks
    for _ in range(rng.integers(3, 6)):
        cx = int(rng.integers(w//3, 2*w//3))
        cy = int(rng.integers(h//4, 3*h//4))
        cv2.circle(img, (cx, cy), int(rng.integers(5, 15)), (0, 0, 220), -1)

def _scene_weapon_detected(img, rng):
    h, w = img.shape[:2]
    # Gun silhouette
    gx, gy = w//3, h//2
    cv2.rectangle(img, (gx, gy-10), (gx+80, gy+10), (40, 40, 40), -1)  # barrel
    cv2.rectangle(img, (gx+60, gy+10), (gx+90, gy+50), (60, 60, 60), -1)  # grip
    # Red bounding box overlay
    bx1, by1, bx2, by2 = gx-10, gy-30, gx+100, gy+60
    cv2.rectangle(img, (bx1, by1), (bx2, by2), (0, 0, 255), 3)
    cv2.putText(img, "WEAPON", (bx1, by1-8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,0,255), 2)

def _scene_theft_robbery(img, rng):
    h, w = img.shape[:2]
    # Person + bag being grabbed
    cx = w//2
    cv2.circle(img, (cx, h//4), 20, (200, 160, 120), -1)
    cv2.line(img, (cx, h//4+20), (cx, h//4+80), (80, 80, 180), 4)
    # Bag
    cv2.rectangle(img, (cx+10, h//4+40), (cx+50, h//4+80), (20, 100, 200), -1)
    # Arrow showing snatch direction
    cv2.arrowedLine(img, (cx+50, h//4+60), (cx+110, h//4+40), (0, 0, 255), 3)
    # Alert text
    cv2.putText(img, "ALERT", (w//4, 3*h//4), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0,0,255), 3)

def _scene_person_unconscious(img, rng):
    h, w = img.shape[:2]
    # Horizontal lying person on ground
    gy = 2*h//3
    cv2.ellipse(img, (w//2, gy), (70, 20), 0, 0, 360, (200, 160, 120), -1)  # body
    cv2.circle(img, (w//2 + 75, gy), 18, (200, 160, 120), -1)  # head
    # Ground line
    cv2.line(img, (0, gy+22), (w, gy+22), (80, 60, 40), 3)
    # SOS indicator
    cv2.putText(img, "SOS", (w//4, h//4), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 255), 4)

def _scene_suspicious_activity(img, rng):
    h, w = img.shape[:2]
    # Hooded figure
    cx = w//2
    cv2.circle(img, (cx, h//3), 22, (50, 50, 50), -1)   # dark hood
    cv2.line(img, (cx, h//3+22), (cx, h//3+90), (60, 60, 60), 5)
    cv2.line(img, (cx, h//3+40), (cx-35, h//3+70), (60,60,60), 3)
    cv2.line(img, (cx, h//3+40), (cx+35, h//3+70), (60,60,60), 3)
    # Question-mark overlay
    cv2.putText(img, "?", (cx+40, h//3), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 200, 255), 5)
    # Dotted border
    for i in range(0, w, 20):
        cv2.circle(img, (i, 5), 2, (0, 200, 255), -1)
        cv2.circle(img, (i, h-5), 2, (0, 200, 255), -1)

def _scene_vehicle_collision(img, rng):
    h, w = img.shape[:2]
    # Two cars colliding
    # Car 1
    cv2.rectangle(img, (w//4, h//2-25), (w//2-10, h//2+25), (40, 80, 200), -1)
    cv2.rectangle(img, (w//4+15, h//2-45), (w//2-25, h//2-25), (60, 100, 220), -1)
    # Car 2 (tilted)
    pts2 = np.array([[w//2, h//2-30],[3*w//4, h//2-20],[3*w//4-5, h//2+30],[w//2+5, h//2+25]])
    cv2.fillPoly(img, [pts2], (200, 80, 40))
    # Impact explosion
    cv2.circle(img, (w//2, h//2), 30, (0, 100, 255), -1)
    # Alert
    cv2.putText(img, "CRASH", (w//4-10, h//4), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0,0,255), 3)

def _scene_normal_no_incident(img, rng):
    h, w = img.shape[:2]
    # Road
    cv2.rectangle(img, (0, h//2), (w, h), (50, 50, 50), -1)
    # Lane markings
    for i in range(0, w, 60):
        cv2.rectangle(img, (i, h*2//3-3), (i+30, h*2//3+3), (255, 255, 255), -1)
    # Building silhouettes
    for bx in [20, 100, 180, 260, 340]:
        bh = int(rng.integers(60, 140))
        cv2.rectangle(img, (bx, h//2-bh), (bx+55, h//2), (100, 100, 120), -1)
        # windows
        for wy in range(h//2-bh+10, h//2-10, 20):
            for wx in range(bx+5, bx+50, 15):
                cv2.rectangle(img, (wx, wy), (wx+8, wy+10), (240, 220, 120), -1)
    # Green status
    cv2.putText(img, "NORMAL", (w//3, h-20), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 200, 50), 2)

# --- Category registry ---

CATEGORIES = [
    ("fire___smoke",          (10, 10, 30),    (0, 100, 255),   "Fire / Smoke",          _scene_fire_smoke),
    ("physical_fight",        (20, 20, 40),    (60, 60, 220),   "Physical Fight",        _scene_physical_fight),
    ("weapon_detected",       (10, 10, 20),    (40, 40, 40),    "Weapon Detected",       _scene_weapon_detected),
    ("theft___robbery",       (15, 15, 40),    (20, 60, 180),   "Theft / Robbery",       _scene_theft_robbery),
    ("person_unconscious",    (10, 30, 10),    (30, 80, 30),    "Person Unconscious",    _scene_person_unconscious),
    ("suspicious_activity",   (20, 20, 30),    (50, 50, 60),    "Suspicious Activity",   _scene_suspicious_activity),
    ("vehicle_collision",     (10, 20, 40),    (40, 80, 200),   "Vehicle Collision",     _scene_vehicle_collision),
    ("normal___no_incident",  (60, 100, 60),   (80, 120, 80),   "Normal / No Incident",  _scene_normal_no_incident),
]

def _has_enough_images(folder_path: str, minimum: int = 10) -> bool:
    if not os.path.exists(folder_path):
        return False
    exts = {".jpg", ".jpeg", ".png"}
    count = sum(
        1 for f in os.listdir(folder_path)
        if os.path.splitext(f)[1].lower() in exts
        and not f.endswith("_thumb.jpg")
    )
    return count >= minimum


def generate_for_category(folder_name: str, bg: tuple, fg: tuple, label: str, scene_fn, n: int = IMAGES_PER_CLASS):
    folder_path = os.path.join(TRAINING_DATA_DIR, folder_name)
    os.makedirs(folder_path, exist_ok=True)

    if _has_enough_images(folder_path, minimum=n):
        print(f"  [SKIP] {label:30s} -- already has >={n} images, skipping")
        return 0

    rng = np.random.default_rng(abs(hash(folder_name)) % (2**31))
    generated = 0

    for i in range(n):
        h, w = 480, 640
        # Create base image with slight noise for visual variety
        img = np.full((h, w, 3), bg, dtype=np.uint8)
        noise = rng.integers(-20, 20, (h, w, 3), dtype=np.int16)
        img = np.clip(img + noise.astype(np.int16), 0, 255).astype(np.uint8)

        # Add gradient sky/ground
        for y in range(h//2):
            alpha = y / (h//2)
            blend_col = tuple(int(bg[c] * (1 - alpha * 0.5)) for c in range(3))
            img[y, :] = blend_col

        # Draw the scene
        try:
            scene_fn(img, rng)
        except Exception as e:
            print(f"    [warn] scene_fn error for {label} img {i}: {e}")

        # Add label watermark
        cv2.putText(
            img, label, (10, h - 10),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1, cv2.LINE_AA
        )

        # Add image index number
        cv2.putText(
            img, f"#{i+1:03d}", (w - 70, 25),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1
        )

        fname = f"synthetic_{folder_name}_{i+1:03d}.jpg"
        out_path = os.path.join(folder_path, fname)
        cv2.imwrite(out_path, img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        generated += 1

    print(f"  [OK] {label:30s} -- generated {generated} synthetic images -> {folder_path}")
    return generated


def main():
    print("=" * 65)
    print("  VigilanteVanguard - Training Data Generator")
    print("=" * 65)
    print(f"  Output: {TRAINING_DATA_DIR}")
    print(f"  Images per category: {IMAGES_PER_CLASS}")
    print()

    total = 0
    for folder_name, bg, fg, label, scene_fn in CATEGORIES:
        n = generate_for_category(folder_name, bg, fg, label, scene_fn)
        total += n

    # Count existing road_accident images
    ra_path = os.path.join(TRAINING_DATA_DIR, "road_accident")
    ra_count = 0
    if os.path.exists(ra_path):
        ra_count = sum(1 for f in os.listdir(ra_path)
                       if os.path.splitext(f)[1].lower() in {".jpg",".jpeg",".png"}
                       and not f.endswith("_thumb.jpg"))
    print()
    print(f"  [OK] Road Accident              -- {ra_count} existing images (real dataset)")
    print()
    print(f"  Total new synthetic images generated: {total}")
    print("=" * 65)


if __name__ == "__main__":
    main()
