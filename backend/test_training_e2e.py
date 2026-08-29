"""End-to-end training smoke test."""
import requests
import time

BASE = "http://localhost:8000/api/v1"

# 1. Scan disk
print("--- Scan disk ---")
r = requests.post(BASE + "/training/dataset/scan-disk")
d = r.json()
print(f"  scanned={d.get('scanned',0)}  registered={d.get('registered',0)}  total={d.get('total_samples',0)}")

# 2. Start training (3 epochs, quick)
print("--- Start training session ---")
r2 = requests.post(BASE + "/training/sessions/start", json={"epochs": 3, "description": "smoke-test"})
d2 = r2.json()
sess_id = d2.get("session_id", "?")
print(f"  session={sess_id}  status={d2.get('status','?')}")

# 3. Poll until done
for i in range(30):
    time.sleep(1)
    r3 = requests.get(BASE + f"/training/sessions/{sess_id}")
    d3 = r3.json()
    status = d3.get("status", "?")
    pct    = d3.get("progress_pct", 0)
    print(f"  [{i+1:2d}s] status={status}  progress={pct}%")
    if status in ("COMPLETED", "FAILED", "CANCELLED"):
        break

print(f"\nFinal metrics : {d3.get('final_metrics', {})}")
print(f"Hist index size: {d3.get('hist_index_size', '?')}")

# 4. Verify status endpoint
s = requests.get(BASE + "/training/status").json()
print(f"\nStatus endpoint: model_ready={s['model_ready']}  index={s['hist_index_size']}  labels={s['total_labels']}")
