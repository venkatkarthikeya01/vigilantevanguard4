"""
VigilanteVanguard Minimal Backend — Zoho Catalyst AppSail
Self-contained FastAPI app for KSP Datathon 2026.
No external imports beyond standard library + fastapi + uvicorn.
All Catalyst SDK calls are optional and fail-safe.
"""
import os
import sys
import time
import json
import base64
import hmac
import hashlib

# ── FastAPI bootstrap ──────────────────────────────────────────
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import uvicorn

# ── pydantic ──────────────────────────────────────────────────
try:
    from pydantic import BaseModel
    from typing import Optional, List
except ImportError:
    sys.exit(1)

# ── Catalyst SDK — completely optional ───────────────────────
_CATALYST_APP = None
_CATALYST_OK  = False

def _try_init_catalyst():
    global _CATALYST_APP, _CATALYST_OK
    try:
        import zcatalyst_sdk as catalyst
        _CATALYST_APP = catalyst.initialize()
        _CATALYST_OK = True
        print("[Catalyst] SDK initialized")
    except Exception as e:
        print(f"[Catalyst] SDK unavailable (OK in dev): {e}")

# ── In-memory storage (fallback when Catalyst not available) ──
_MEMORY_FIRS: list = []
_MEMORY_LOGS: list = []
_FIR_COUNTER = 0

# ── Token secret ──────────────────────────────────────────────
_TOKEN_SECRET = "vv_ksp_demo_2026"

# ── Demo users ────────────────────────────────────────────────
_USERS = {
    "admin@ksp.gov.in":              {"password": "admin123",       "role": "ADMINISTRATOR", "name": "Admin Officer",    "district_id": 5},
    "venkat.25cse@cambridge.edu.in": {"password": "Karthi@007",     "role": "ADMINISTRATOR", "name": "Venkat (Admin)",   "district_id": 5},
    "raj.kumar@ksp.gov.in":          {"password": "Inspector@123",  "role": "INVESTIGATOR",  "name": "Insp. Raj Kumar",  "district_id": 5},
    "priya.sharma@ksp.gov.in":       {"password": "Analyst@123",    "role": "ANALYST",       "name": "Priya Sharma",     "district_id": 1},
    "suresh.babu@ksp.gov.in":        {"password": "Supervisor@123", "role": "SUPERVISOR",    "name": "DSP Suresh Babu",  "district_id": 5},
    "inspector@ksp.gov.in":          {"password": "pass123",        "role": "INVESTIGATOR",  "name": "S.K. Ravi Kumar",  "district_id": 5},
    "analyst@ksp.gov.in":            {"password": "pass123",        "role": "ANALYST",       "name": "Priya Nair",       "district_id": 1},
    "supervisor@ksp.gov.in":         {"password": "pass123",        "role": "SUPERVISOR",    "name": "DSP Venkatesh",    "district_id": 5},
}

def _make_token(email: str, user: dict, uid: str) -> str:
    payload = json.dumps({"user_id": uid, "email": email, "role": user["role"],
                          "display_name": user["name"], "district_id": user["district_id"], "type": "vv_demo"})
    b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    sig = hmac.new(_TOKEN_SECRET.encode(), b64.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{b64}.{sig}"

def _decode_token(token: str) -> Optional[dict]:
    if "." not in token:
        return None
    b64, sig = token.rsplit(".", 1)
    pad = 4 - len(b64) % 4
    if pad != 4:
        b64_padded = b64 + "=" * pad
    else:
        b64_padded = b64
    try:
        payload = json.loads(base64.urlsafe_b64decode(b64_padded).decode())
    except Exception:
        return None
    if payload.get("type") != "vv_demo":
        return None
    expected = hmac.new(_TOKEN_SECRET.encode(), b64.encode(), hashlib.sha256).hexdigest()[:16]
    if not hmac.compare_digest(sig, expected):
        return None
    return payload

def _monthly_table() -> str:
    now = time.gmtime()
    return f"fir_{now.tm_year}_{now.tm_mon:02d}"

def _gen_crime_no(district_id: int, station_id: int, year: int, serial: int) -> str:
    return f"1{district_id:04d}{station_id:04d}{year:04d}{serial:05d}"

async def _ds_insert(table: str, row: dict) -> dict:
    if _CATALYST_OK and _CATALYST_APP:
        try:
            return _CATALYST_APP.datastore().table(table).insert_row(row)
        except Exception as e:
            print(f"[DS] insert {table} failed: {e}")
    return row

async def _nosql_insert(table: str, doc: dict):
    if _CATALYST_OK and _CATALYST_APP:
        try:
            _CATALYST_APP.nosql().table(table).insert_row(doc)
            return
        except Exception as e:
            print(f"[NoSQL] insert {table} failed: {e}")
    _MEMORY_LOGS.append(doc)

async def _ds_query(sql: str) -> list:
    if _CATALYST_OK and _CATALYST_APP:
        try:
            return _CATALYST_APP.zcql().execute_query(sql)
        except Exception as e:
            print(f"[DS] query failed: {e}")
    return []


# ── App setup ─────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    _try_init_catalyst()
    print(f"[OK] VigilanteVanguard v4.1 started — Python {sys.version.split()[0]}")
    yield
    print("[OK] stopped")

app = FastAPI(
    title="VigilanteVanguard API",
    description="Karnataka State Police Datathon 2026 — Zoho Catalyst AppSail",
    version="4.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)

@app.middleware("http")
async def log_request(request: Request, call_next):
    t0 = time.time()
    token = request.headers.get("authorization", "")
    user = "anonymous"
    if "." in token:
        try:
            p = _decode_token(token.replace("Bearer ", ""))
            if p:
                user = p.get("email", "anonymous")
        except Exception:
            pass
    resp = await call_next(request)
    ms = round((time.time() - t0) * 1000)
    ip = request.headers.get("x-forwarded-for", getattr(request.client, "host", "?"))
    print(f"[{resp.status_code}] {request.method} {request.url.path} {ms}ms user={user} ip={ip}")
    log = {"key": f"al:{int(time.time()*1000)}:{os.urandom(3).hex()}", "method": request.method,
           "path": str(request.url.path), "status": resp.status_code, "user": user, "ip": ip,
           "ms": ms, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    await _nosql_insert("access_log", log)
    return resp


# ── Models ────────────────────────────────────────────────────
class LoginReq(BaseModel):
    email: str
    password: str

class FIRCreate(BaseModel):
    police_station_id: int = 5
    case_category_id: int = 1
    gravity_offence_id: Optional[int] = None
    crime_major_head_id: int = 1
    crime_minor_head_id: Optional[int] = None
    incident_from_date: str = ""
    incident_to_date: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    brief_facts: str = ""
    act_sections: List[dict] = []
    complainants: List[dict] = []
    victims: List[dict] = []
    accused: List[dict] = []

class AIQuery(BaseModel):
    query: str
    language: str = "en"


# ── Health ────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "healthy", "service": "VigilanteVanguard", "version": "4.1.0",
            "platform": "Zoho Catalyst AppSail", "catalyst_sdk": _CATALYST_OK,
            "python": sys.version.split()[0], "in_memory_firs": len(_MEMORY_FIRS)}


# ── Auth ──────────────────────────────────────────────────────
@app.post("/api/v1/auth/login")
async def login(data: LoginReq):
    email = data.email.lower().strip()
    u = _USERS.get(email)
    if not u or u["password"] != data.password:
        raise HTTPException(401, "Invalid credentials")
    uid = str(list(_USERS.keys()).index(email) + 1)
    token = _make_token(email, u, uid)
    return {"token": token, "user": {"user_id": uid, "email": email, "role": u["role"],
                                     "display_name": u["name"], "district_id": u["district_id"]}}

@app.get("/api/v1/auth/me")
async def me():
    return {"user_id": "1", "email": "admin@ksp.gov.in", "role": "ADMINISTRATOR",
            "display_name": "Admin Officer", "district_id": 5}


# ── FIR ───────────────────────────────────────────────────────
@app.post("/api/v1/fir/")
async def create_fir(fir: FIRCreate, request: Request):
    global _FIR_COUNTER
    _FIR_COUNTER += 1
    now = time.gmtime()
    today = f"{now.tm_year}-{now.tm_mon:02d}-{now.tm_mday:02d}"
    table = _monthly_table()
    crime_no = _gen_crime_no(fir.police_station_id, fir.police_station_id, now.tm_year, _FIR_COUNTER)
    case_no = f"{now.tm_year}{_FIR_COUNTER:05d}"
    case_id = abs(hash(crime_no)) % 100000

    row = {
        "CrimeNo": crime_no, "CaseNo": case_no, "MonthlyTable": table,
        "CrimeRegisteredDate": today, "PoliceStationID": fir.police_station_id,
        "CaseCategoryID": fir.case_category_id, "CrimeMajorHeadID": fir.crime_major_head_id,
        "CaseStatusID": 1, "IncidentFromDate": fir.incident_from_date,
        "Latitude": fir.latitude, "Longitude": fir.longitude,
        "BriefFacts": fir.brief_facts, "CreatedAt": today,
    }
    _MEMORY_FIRS.append(row)

    # Write to Catalyst Data Store (best-effort)
    await _ds_insert("CaseMaster", row)
    await _ds_insert(table, {**row, "CaseMasterID": case_id})

    # Audit log
    await _nosql_insert("audit_log", {
        "key": f"fir:{crime_no}:{int(time.time())}",
        "event": "FIR_CREATED", "crime_no": crime_no, "table": table,
        "lat": fir.latitude, "lng": fir.longitude,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })

    return {"case_master_id": case_id, "crime_no": crime_no, "case_no": case_no,
            "monthly_table": table, "crime_registered_date": today,
            "police_station_id": fir.police_station_id, "case_category": "FIR",
            "crime_major_head": "", "brief_facts": fir.brief_facts,
            "case_status": "Under Investigation", "latitude": fir.latitude,
            "longitude": fir.longitude, "created_at": today}

@app.get("/api/v1/fir/")
async def list_firs(page: int = 1, page_size: int = 20,
                    year: Optional[int] = None, month: Optional[int] = None):
    # Try Catalyst DataStore first
    rows = await _ds_query("SELECT * FROM CaseMaster ORDER BY CrimeRegisteredDate DESC LIMIT 100")
    if not rows:
        rows = _MEMORY_FIRS
    offset = (page - 1) * page_size
    return {"data": rows[offset:offset+page_size], "page": page, "page_size": page_size,
            "total": len(rows)}

@app.get("/api/v1/fir/monthly/summary")
async def monthly_summary(year: Optional[int] = None, month: Optional[int] = None):
    now = time.gmtime()
    y, m = year or now.tm_year, month or now.tm_mon
    table = f"fir_{y}_{m:02d}"
    month_firs = [f for f in _MEMORY_FIRS if f.get("MonthlyTable") == table]
    return {"table": table, "year": y, "month": m,
            "total": len(month_firs), "by_head": []}


# ── AI ────────────────────────────────────────────────────────
@app.post("/api/v1/ai/query")
async def ai_query(q: AIQuery):
    """Minimal AI endpoint — returns structured KSP intelligence."""
    query = q.query.lower()
    lang = q.language
    response = _generate_ksp_response(query)
    return {"response": response, "language": lang, "source": "embedded-ksp-2026"}

def _generate_ksp_response(query: str) -> str:
    """Simple keyword-based KSP intelligence engine."""
    ksp_data = {
        "murder": "Karnataka reported 98 murders in Jan 2026, 113 in Jun 2026. Bengaluru City had the highest at 13-17 per month. Major motives: personal disputes (38%), property (22%), communal (8%).",
        "theft": "Theft is the highest-volume crime. Jan 2026: 2,867 cases statewide. Bengaluru City alone: 498 cases in Jan, 710 in Mar 2026.",
        "cyber": "Cyber crimes: Jan 680 cases, declining trend — Jun 496 cases. Online fraud dominates (78%). Bengaluru City: 213 cases in Jan 2026.",
        "ndps": "NDPS cases: Jan 729, Jun 640. Shivamogga highest NDPS activity (37-88/month). Ganja, brown sugar most seized.",
        "pocso": "POCSO cases rising — Jan 593 to Jun 699. Tumakuru, Belagavi, Davanagere highest districts.",
        "scst": "SC/ST POA cases: Jan 436 to Jun 518 (rising). Ballari, Raichur, Bidar most affected districts.",
        "bengaluru": "Bengaluru City is Karnataka's highest crime district. Jan: 498 theft, 213 cyber, 85 POCSO, 446 hurt, 13 murder. City + South + District zones account for ~38% of state crime.",
        "hotspot": "Crime hotspots: Bengaluru (all zones), Belagavi District, Tumakuru, Shivamogga, Davanagere.",
        "trend": "2026 Trend: Cyber crime declining (-27% Jan-Jun), POCSO rising (+18%), murder stable, theft rising (+14%), hurt rising (+9%).",
    }
    for key, response in ksp_data.items():
        if key in query:
            return response
    return f"Karnataka State Police 2026 Intelligence: Query '{query}' — Jan to Jun 2026 data shows 7 major crime categories tracked across 38 districts/units. Ask about murder, theft, cyber, NDPS, POCSO, or specific districts like Bengaluru, Mysuru, Hubballi."


# ── Analytics ─────────────────────────────────────────────────
@app.get("/api/v1/analytics/summary")
async def analytics_summary():
    return {
        "total_cases": {"jan": 6842, "feb": 7234, "mar": 7891, "apr": 6234, "may": 7102, "jun": 7456},
        "murder": {"jan": 98, "feb": 75, "mar": 81, "apr": 78, "may": 94, "jun": 113},
        "cyber": {"jan": 680, "feb": 612, "mar": 703, "apr": 502, "may": 510, "jun": 496},
        "ndps": {"jan": 729, "feb": 689, "mar": 820, "apr": 490, "may": 423, "jun": 640},
        "pocso": {"jan": 593, "feb": 601, "mar": 680, "apr": 740, "may": 758, "jun": 699},
    }


# ── Logs ──────────────────────────────────────────────────────
@app.get("/api/v1/logs")
async def get_logs(limit: int = 100):
    nosql_logs = []
    if _CATALYST_OK and _CATALYST_APP:
        try:
            nosql_logs = _CATALYST_APP.nosql().table("access_log").get_rows_by_filter("") or []
        except Exception:
            pass
    all_logs = nosql_logs or _MEMORY_LOGS
    return {"logs": all_logs[-limit:], "total": len(all_logs),
            "source": "catalyst_nosql" if nosql_logs else "in_memory"}


# ── Search ────────────────────────────────────────────────────
@app.get("/api/v1/search/")
async def search(q: str = ""):
    results = [f for f in _MEMORY_FIRS if q.lower() in json.dumps(f).lower()]
    db_results = await _ds_query(f"SELECT * FROM CaseMaster WHERE BriefFacts LIKE '%{q}%' LIMIT 20")
    return {"results": db_results or results, "query": q, "total": len(db_results or results)}


# ── Entry point ────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
