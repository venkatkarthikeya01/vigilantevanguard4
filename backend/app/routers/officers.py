"""
Officers API — VigilanteVanguard
Employee (police officer) management, lookup, and posting details.
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Optional
from datetime import date

from app.core.catalyst import CatalystDataStore, CatalystCache
from app.core.auth import AuthUser, verify_catalyst_token, require_admin

router = APIRouter()


class OfficerCreate(BaseModel):
    district_id: int
    unit_id: int
    rank_id: int
    designation_id: int
    kgid: str
    first_name: str
    last_name: Optional[str] = None
    employee_dob: Optional[date] = None
    gender_id: int = 1
    blood_group_id: Optional[int] = None
    appointment_date: Optional[date] = None


@router.get("/", summary="List officers with optional filters")
async def list_officers(
    district_id: Optional[int] = Query(None),
    unit_id: Optional[int] = Query(None),
    rank_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    conditions = ["e.Active = 1"]
    if district_id:
        conditions.append(f"e.DistrictID = {district_id}")
    if unit_id:
        conditions.append(f"e.UnitID = {unit_id}")
    if rank_id:
        conditions.append(f"e.RankID = {rank_id}")

    where = "WHERE " + " AND ".join(conditions)
    offset = (page - 1) * page_size

    rows = await CatalystDataStore.query(
        f"""
        SELECT e.EmployeeID, e.KGID, e.FirstName, e.LastName,
               r.RankName, dg.DesignationName,
               u.UnitName as station, d.DistrictName
        FROM Employee e
        LEFT JOIN Rank r          ON e.RankID         = r.RankID
        LEFT JOIN Designation dg  ON e.DesignationID  = dg.DesignationID
        LEFT JOIN Unit u          ON e.UnitID          = u.UnitID
        LEFT JOIN District d      ON e.DistrictID      = d.DistrictID
        {where}
        ORDER BY r.Hierarchy, e.FirstName
        LIMIT {page_size} OFFSET {offset}
        """
    )
    return {"data": rows, "page": page, "page_size": page_size}


@router.get("/{employee_id}", summary="Get officer detail")
async def get_officer(
    employee_id: int,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    cache_key = f"officer:{employee_id}"
    cached = await CatalystCache.get_json(cache_key)
    if cached:
        return cached

    rows = await CatalystDataStore.query(
        f"""
        SELECT e.*, r.RankName, dg.DesignationName,
               u.UnitName as station, d.DistrictName
        FROM Employee e
        LEFT JOIN Rank r         ON e.RankID        = r.RankID
        LEFT JOIN Designation dg ON e.DesignationID = dg.DesignationID
        LEFT JOIN Unit u         ON e.UnitID         = u.UnitID
        LEFT JOIN District d     ON e.DistrictID     = d.DistrictID
        WHERE e.EmployeeID = {employee_id}
        """
    )
    if not rows:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Officer not found")

    result = rows[0]
    await CatalystCache.set_json(cache_key, result, ttl_seconds=1800)
    return result


@router.post("/", summary="Register a new officer (Admin only)")
async def create_officer(
    data: OfficerCreate,
    current_user: AuthUser = Depends(require_admin),
):
    row = {
        "DistrictID":     data.district_id,
        "UnitID":         data.unit_id,
        "RankID":         data.rank_id,
        "DesignationID":  data.designation_id,
        "KGID":           data.kgid,
        "FirstName":      data.first_name,
        "LastName":       data.last_name,
        "EmployeeDOB":    data.employee_dob.isoformat() if data.employee_dob else None,
        "GenderID":       data.gender_id,
        "BloodGroupID":   data.blood_group_id,
        "AppointmentDate": data.appointment_date.isoformat() if data.appointment_date else None,
        "Active":         1,
    }
    result = await CatalystDataStore.insert("Employee", row)
    return {"message": "Officer registered", "employee_id": result.get("EmployeeID") or result.get("ROWID")}


@router.get("/ranks/all", summary="Get all police ranks")
async def get_ranks(current_user: AuthUser = Depends(verify_catalyst_token)):
    cached = await CatalystCache.get_json("ref:ranks")
    if cached:
        return cached
    rows = await CatalystDataStore.query("SELECT * FROM Rank WHERE Active=1 ORDER BY Hierarchy")
    await CatalystCache.set_json("ref:ranks", rows, ttl_seconds=86400)
    return rows


@router.get("/districts/all", summary="Get all Karnataka districts")
async def get_districts(current_user: AuthUser = Depends(verify_catalyst_token)):
    cached = await CatalystCache.get_json("ref:districts")
    if cached:
        return cached
    rows = await CatalystDataStore.query(
        "SELECT DistrictID, DistrictName FROM District WHERE Active=1 ORDER BY DistrictName"
    )
    await CatalystCache.set_json("ref:districts", rows, ttl_seconds=86400)
    return rows


@router.get("/units/all", summary="Get all police stations / units")
async def get_units(
    district_id: Optional[int] = Query(None),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    where = f"WHERE Active=1{f' AND DistrictID={district_id}' if district_id else ''}"
    cached = await CatalystCache.get_json(f"ref:units:d{district_id}")
    if cached:
        return cached
    rows = await CatalystDataStore.query(
        f"SELECT UnitID, UnitName, DistrictID FROM Unit {where} ORDER BY UnitName"
    )
    await CatalystCache.set_json(f"ref:units:d{district_id}", rows, ttl_seconds=86400)
    return rows
