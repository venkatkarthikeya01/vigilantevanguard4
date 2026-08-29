"""Quick smoke-test: sends 3 real road_accident images to the debug/detect endpoint."""
import os
import requests

BASE = "http://localhost:8000/api/v1"
FOLDER = os.path.join(os.path.dirname(__file__), "training_data", "road_accident")

images = [f for f in os.listdir(FOLDER) if f.lower().endswith((".jpg", ".jpeg", ".png"))][:5]

print(f"Testing {len(images)} road_accident images against trained model\n")
for fname in images:
    path = os.path.join(FOLDER, fname)
    with open(path, "rb") as f:
        r = requests.post(f"{BASE}/training/debug/detect", files={"file": (fname, f, "image/jpeg")})
    d = r.json()
    if "error" in d:
        print(f"  ERROR: {d['error']}")
        continue
    triggered = "[TRIGGERED]" if d["triggered"] else "[no trigger]"
    print(f"  {fname[:50]:<50}  {d['best_match']:<22} {round(d['best_confidence']*100):3d}%  dist={d['best_distance']:.3f}  {triggered}")

# Also test /training/status
s = requests.get(f"{BASE}/training/status").json()
print(f"\nModel status: ready={s['model_ready']}  index={s['hist_index_size']} vectors  labels={s['total_labels']}")
