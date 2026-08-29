import requests
BASE = "http://localhost:8000/api/v1"

s = requests.get(BASE+"/training/status").json()
print("=== TRAINING STATUS ===")
print("  model_ready        :", s["model_ready"])
print("  hist_index_size    :", s["hist_index_size"], "vectors")
print("  total_labels       :", s["total_labels"])
print("  detection_threshold:", s["detection_threshold"])
print("  distance_metric    :", s["distance_metric"])
print("  opencv_available   :", s["opencv_available"])
print()
print("  Per-label counts:")
for lbl, cnt in sorted(s["hist_by_label"].items(), key=lambda x: -x[1]):
    print("   ", lbl.ljust(25), cnt, "images")

h = requests.get(BASE+"/training/health").json()
print()
print("=== HEALTH ===")
print("  status :", h["status"])
ds = h["dataset_stats"]
print("  dataset: total=%d  verified=%d" % (ds["total"], ds["verified"]))
