"""
FIR Management API — VigilanteVanguard
Handles CaseMaster CRUD, CrimeNo generation, and monthly table routing.
Monthly table format: fir_YYYY_MM (e.g. fir_2026_06 for June 2026)
All writes go to the current month's table AND the master CaseMaster table.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from typing import Optional, List
from pydantic import BaseModel, Field
from datetime import date, datetime
import json

from app.core.catalyst import CatalystDataStore, CatalystCache, CatalystNoSQL
from app.core.auth import AuthUser, verify_catalyst_token, require_investigator

router = APIRouter()


# ─── Monthly Table Helper ─────────────────────────────────────

def monthly_table_name(dt: datetime | date | None = None) -> str:
    """
    Returns the monthly partition table name for a given date.
    Format: fir_YYYY_MM  e.g. fir_2026_06
    Defaults to current month if dt is None.
    """
    d = dt or datetime.utcnow()
    if isinstance(d, datetime):
        return f"fir_{d.year}_{d.month:02d}"
    return f"fir_{d.year}_{d.month:02d}"


# ─── Pydantic Models ──────────────────────────────────────────

class FIRCreate(BaseModel):
    police_station_id: int
    case_category_id: int = 1
    gravity_offence_id: Optional[int] = None
    crime_major_head_id: int
    crime_minor_head_id: Optional[int] = None
    incident_from_date: datetime
    incident_to_date: Optional[datetime] = None
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    brief_facts: str
    act_sections: List[dict] = []
    complainants: List[dict] = []
    victims: List[dict] = []
    accused: List[dict] = []


class FIRResponse(BaseModel):
    case_master_id: int
    crime_no: str
    case_no: str
    monthly_table: str
    crime_registered_date: date
    police_station_id: int
    case_category: str
    crime_major_head: str
    brief_facts: str
    case_status: str
    latitude: Optional[float]
    longitude: Optional[float]
    created_at: datetime


class FIRUpdate(BaseModel):
    case_status_id: Optional[int] = None
    court_id: Optional[int] = None
    brief_facts: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


# ─── Crime Number Generator ────────────────────────────────────

def generate_crime_no(category_code: str, district_id: int, unit_id: int, year: int, serial: int) -> str:
    """
    Karnataka Police CrimeNo format:
    CategoryCode(1) + DistrictID(4) + UnitID(4) + Year(4) + Serial(5)
    Example: 104430006202600001
    """
    return f"{category_code}{district_id:04d}{unit_id:04d}{year:04d}{serial:05d}"


# ─── Endpoints ────────────────────────────────────────────────

@router.post("/", response_model=FIRResponse, summary="Register a new FIR")
async def create_fir(
    fir: FIRCreate,
    background_tasks: BackgroundTasks,
    current_user: AuthUser = Depends(require_investigator),
):
    """
    Register a new FIR.
    - Writes to CaseMaster (master table)
    - Also writes to fir_YYYY_MM monthly partition (for month-specific reporting)
    - Triggers audit log entry in Catalyst NoSQL
    - Invalidates dashboard cache for the district
    """
    today = date.today()
    table = monthly_table_name(today)

    # Count existing FIRs at this station this year for serial number
    serial = 1
    try:
        serial_result = await CatalystDataStore.query(
            f"SELECT COUNT(*) as cnt FROM CaseMaster "
            f"WHERE PoliceStationID = {fir.police_station_id} "
            f"AND YEAR(CrimeRegisteredDate) = {today.year} "
            f"AND CaseCategoryID = {fir.case_category_id}"
        )
        serial = (serial_result[0].get("cnt", 0) or 0) + 1
    except Exception:
        serial = 1  # DataStore not available — use 1, still works

    # Get district ID for the station
    district_id = 5  # default Bengaluru
    try:
        station_result = await CatalystDataStore.query(
            f"SELECT DistrictID FROM Unit WHERE UnitID = {fir.police_station_id}"
        )
        if station_result:
            district_id = station_result[0]["DistrictID"]
    except Exception:
        district_id = fir.police_station_id  # use station_id as fallback

    category_code = str(fir.case_category_id)
    crime_no = generate_crime_no(category_code, district_id, fir.police_station_id, today.year, serial)
    case_no = f"{today.year}{serial:05d}"

    # Build the row dict — goes to BOTH CaseMaster AND monthly table
    row = {
        "CrimeNo": crime_no,
        "CaseNo": case_no,
        "MonthlyTable": table,
        "CrimeRegisteredDate": today.isoformat(),
        "PolicePersonID": int(current_user.user_id) if current_user.user_id.isdigit() else 1,
        "PoliceStationID": fir.police_station_id,
        "CaseCategoryID": fir.case_category_id,
        "GravityOffenceID": fir.gravity_offence_id,
        "CrimeMajorHeadID": fir.crime_major_head_id,
        "CrimeMinorHeadID": fir.crime_minor_head_id,
        "CaseStatusID": 1,
        "IncidentFromDate": fir.incident_from_date.isoformat(),
        "IncidentToDate": fir.incident_to_date.isoformat() if fir.incident_to_date else None,
        "Latitude": fir.latitude,
        "Longitude": fir.longitude,
        "BriefFacts": fir.brief_facts,
        "CreatedByUserID": current_user.user_id,
        "CreatedAt": datetime.utcnow().isoformat(),
    }

    # ── Write to master CaseMaster table ──
    case_id = 1
    try:
        result = await CatalystDataStore.insert("CaseMaster", row)
        case_id = result.get("CaseMasterID") or result.get("ROWID") or 1
    except Exception as e:
        print(f"[WARN] CaseMaster insert failed: {e}")
        # Generate a deterministic ID from crime_no for offline mode
        case_id = abs(hash(crime_no)) % 100000

    # ── Write to monthly partition table ──
    monthly_row = {**row, "CaseMasterID": case_id}
    try:
        await CatalystDataStore.insert(table, monthly_row)
    except Exception as e:
        print(f"[WARN] Monthly table {table} insert failed (table may not exist yet): {e}")
        # Monthly table may not exist — log to NoSQL instead
        background_tasks.add_task(_log_monthly_fallback, table, monthly_row)

    # ── Write related tables ──
    for section in fir.act_sections:
        try:
            await CatalystDataStore.insert("ActSectionAssociation", {"CaseMasterID": case_id, **section})
        except Exception:
            pass
    for complainant in fir.complainants:
        try:
            await CatalystDataStore.insert("ComplainantDetails", {"CaseMasterID": case_id, **complainant})
        except Exception:
            pass
    for victim in fir.victims:
        try:
            await CatalystDataStore.insert("Victim", {"CaseMasterID": case_id, **victim})
        except Exception:
            pass
    for acc in fir.accused:
        try:
            await CatalystDataStore.insert("Accused", {"CaseMasterID": case_id, **acc})
        except Exception:
            pass

    # ── Invalidate cache ──
    background_tasks.add_task(CatalystCache.delete, f"dashboard:district:{district_id}")
    background_tasks.add_task(CatalystCache.delete, f"firs:month:{today.year}:{today.month}")

    # ── Audit log to Catalyst NoSQL ──
    background_tasks.add_task(
        CatalystNoSQL.insert, "audit_log", {
            "key": f"fir_created:{crime_no}:{int(datetime.utcnow().timestamp())}",
            "event": "FIR_CREATED",
            "case_id": case_id,
            "crime_no": crime_no,
            "monthly_table": table,
            "user_id": current_user.user_id,
            "user_email": current_user.email,
            "district_id": district_id,
            "station_id": fir.police_station_id,
            "lat": fir.latitude,
            "lng": fir.longitude,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    return FIRResponse(
        case_master_id=case_id,
        crime_no=crime_no,
        case_no=case_no,
        monthly_table=table,
        crime_registered_date=today,
        police_station_id=fir.police_station_id,
        case_category="FIR",
        crime_major_head="",
        brief_facts=fir.brief_facts,
        case_status="Under Investigation",
        latitude=fir.latitude,
        longitude=fir.longitude,
        created_at=datetime.utcnow(),
    )


async def _log_monthly_fallback(table: str, row: dict):
    """Fallback: if monthly table doesn't exist in DataStore, persist to NoSQL."""
    try:
        await CatalystNoSQL.insert("fir_monthly_overflow", {
            "key": f"{table}:{row.get('CrimeNo', 'unknown')}",
            "table": table,
            "data": json.dumps(row),
            "ts": datetime.utcnow().isoformat(),
        })
    except Exception:
        pass


@router.get("/{crime_no}", response_model=FIRResponse, summary="Get FIR by Crime Number")
async def get_fir(
    crime_no: str,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """Retrieve a FIR by CrimeNo. Checks Catalyst Cache first."""
    cache_key = f"fir:{crime_no}"
    try:
        cached = await CatalystCache.get_json(cache_key)
        if cached:
            return FIRResponse(**cached)
    except Exception:
        pass

    try:
        results = await CatalystDataStore.query(
            f"SELECT * FROM CaseMaster WHERE CrimeNo = '{crime_no}'"
        )
    except Exception:
        results = []

    if not results:
        raise HTTPException(status_code=404, detail=f"FIR {crime_no} not found")

    row = results[0]
    response = FIRResponse(
        case_master_id=row.get("CaseMasterID", 0),
        crime_no=row.get("CrimeNo", crime_no),
        case_no=row.get("CaseNo", ""),
        monthly_table=row.get("MonthlyTable", monthly_table_name()),
        crime_registered_date=row.get("CrimeRegisteredDate", date.today()),
        police_station_id=row.get("PoliceStationID", 0),
        case_category="FIR",
        crime_major_head="",
        brief_facts=row.get("BriefFacts", ""),
        case_status="Under Investigation",
        latitude=row.get("Latitude"),
        longitude=row.get("Longitude"),
        created_at=row.get("CreatedAt", datetime.utcnow()),
    )
    try:
        await CatalystCache.set_json(cache_key, response.dict(), ttl_seconds=1800)
    except Exception:
        pass
    return response


@router.get("/", summary="List FIRs — optionally filtered by month")
async def list_firs(
    district_id: Optional[int] = Query(None),
    station_id: Optional[int] = Query(None),
    crime_head_id: Optional[int] = Query(None),
    status_id: Optional[int] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    List FIRs. If year+month are given, queries the monthly partition table.
    Otherwise queries the master CaseMaster table.
    Results cached in Catalyst Cache for 5 minutes.
    """
    # Decide which table to query
    if year and month:
        source_table = f"fir_{year}_{month:02d}"
        cache_key = f"firs:month:{year}:{month}:p{page}"
    else:
        source_table = "CaseMaster"
        cache_key = f"firs:all:p{page}:{district_id}:{station_id}"

    # Try cache first
    try:
        cached = await CatalystCache.get_json(cache_key)
        if cached:
            return cached
    except Exception:
        pass

    conditions = []
    if district_id:
        conditions.append(f"u.DistrictID = {district_id}")
    if station_id:
        conditions.append(f"cm.PoliceStationID = {station_id}")
    if crime_head_id:
        conditions.append(f"cm.CrimeMajorHeadID = {crime_head_id}")
    if status_id:
        conditions.append(f"cm.CaseStatusID = {status_id}")
    if from_date:
        conditions.append(f"cm.CrimeRegisteredDate >= '{from_date.isoformat()}'")
    if to_date:
        conditions.append(f"cm.CrimeRegisteredDate <= '{to_date.isoformat()}'")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * page_size

    try:
        rows = await CatalystDataStore.query(
            f"SELECT cm.CaseMasterID, cm.CrimeNo, cm.CaseNo, cm.CrimeRegisteredDate, "
            f"cm.PoliceStationID, cm.BriefFacts, cm.Latitude, cm.Longitude, "
            f"cm.CrimeMajorHeadID, cm.CaseStatusID, cm.MonthlyTable "
            f"FROM {source_table} cm "
            f"LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID "
            f"{where} "
            f"ORDER BY cm.CrimeRegisteredDate DESC "
            f"LIMIT {page_size} OFFSET {offset}"
        )
    except Exception as e:
        rows = []
        print(f"[WARN] FIR list query failed ({source_table}): {e}")

    result = {"data": rows, "page": page, "page_size": page_size, "source_table": source_table}
    try:
        await CatalystCache.set_json(cache_key, result, ttl_seconds=300)
    except Exception:
        pass
    return result


@router.patch("/{case_id}", summary="Update FIR status or details")
async def update_fir(
    case_id: int,
    update: FIRUpdate,
    current_user: AuthUser = Depends(require_investigator),
):
    """Update FIR fields — status, court assignment, GPS location, brief facts."""
    data = {k: v for k, v in update.dict().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No update fields provided")
    try:
        await CatalystDataStore.update("CaseMaster", case_id, data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")
    return {"message": "FIR updated successfully", "case_id": case_id}


@router.get("/monthly/summary", summary="Get FIR count summary for current month")
async def monthly_summary(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Return summary counts for the specified month's FIR table.
    Defaults to current month.
    """
    now = datetime.utcnow()
    y = year or now.year
    m = month or now.month
    table = f"fir_{y}_{m:02d}"
    cache_key = f"fir_summary:{y}:{m}"
    try:
        cached = await CatalystCache.get_json(cache_key)
        if cached:
            return cached
    except Exception:
        pass

    try:
        rows = await CatalystDataStore.query(
            f"SELECT CaseCategoryID, CrimeMajorHeadID, COUNT(*) as cnt "
            f"FROM {table} GROUP BY CaseCategoryID, CrimeMajorHeadID"
        )
        total = await CatalystDataStore.query(f"SELECT COUNT(*) as total FROM {table}")
        result = {
            "table": table,
            "year": y,
            "month": m,
            "total": total[0].get("total", 0) if total else 0,
            "by_head": rows,
        }
    except Exception as e:
        result = {
            "table": table,
            "year": y,
            "month": m,
            "total": 0,
            "by_head": [],
            "note": f"Table may not exist yet: {e}",
        }
    try:
        await CatalystCache.set_json(cache_key, result, ttl_seconds=300)
    except Exception:
        pass
    return result
