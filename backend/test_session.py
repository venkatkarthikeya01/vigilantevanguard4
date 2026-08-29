import requests, time
BASE = "http://localhost:8000/api/v1"
r2 = requests.post(BASE+"/training/sessions/start", json={"epochs":3,"description":"test2"})
d2 = r2.json()
sess_id = d2["session"]["session_id"]
print("started:", sess_id)
for i in range(25):
    time.sleep(1)
    r3 = requests.get(BASE+"/training/sessions/"+sess_id)
    d3 = r3.json()
    status = d3["status"]
    pct = d3.get("progress_pct",0)
    epoch = d3.get("current_epoch",0)
    total_epochs = d3.get("epochs",0)
    print(f"  [{i+1}s] status={status}  pct={pct}  epoch={epoch}/{total_epochs}")
    if status in ("COMPLETED","FAILED","CANCELLED"):
        break
print("Done! hist_index_size:", d3.get("hist_index_size","?"))
fm = d3.get("final_metrics",{})
print("Final mAP50:", fm.get("mAP50","?"))
