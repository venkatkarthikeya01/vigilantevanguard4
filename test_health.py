import urllib.request
import json

BASE = "https://vv-backend-50044114869.development.catalystappsail.in"

# Test health endpoint
try:
    r = urllib.request.urlopen(BASE + "/api/health", timeout=15)
    print("HEALTH:", r.read().decode())
except Exception as e:
    print("HEALTH FAIL:", e)

# Test docs
try:
    r = urllib.request.urlopen(BASE + "/api/docs", timeout=15)
    print("DOCS: HTTP", r.getcode())
except urllib.error.HTTPError as e:
    print("DOCS: HTTP", e.code)
except Exception as e:
    print("DOCS FAIL:", e)
