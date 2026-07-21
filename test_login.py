import urllib.request
import json

URL = "https://vv-backend-50044114869.development.catalystappsail.in/api/v1/auth/login"

accounts = [
    ("admin@ksp.gov.in", "admin123"),
    ("venkat.25cse@cambridge.edu.in", "Karthi@007"),
    ("raj.kumar@ksp.gov.in", "Inspector@123"),
    ("priya.sharma@ksp.gov.in", "Analyst@123"),
    ("suresh.babu@ksp.gov.in", "Supervisor@123"),
]

print(f"\nTesting login on: {URL}\n")
for email, password in accounts:
    try:
        body = json.dumps({"email": email, "password": password}).encode()
        req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json"})
        r = urllib.request.urlopen(req, timeout=30)
        d = json.loads(r.read())
        token_preview = d["token"][:20] + "..."
        print(f"  PASS  {email}")
        print(f"        role={d['user']['role']}  name={d['user']['display_name']}")
        print(f"        token={token_preview}")
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  FAIL  {email} -> HTTP {e.code}: {body}")
    except Exception as e:
        print(f"  ERROR {email} -> {e}")
    print()

print("Done.")
