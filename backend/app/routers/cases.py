"""
Cases API — VigilanteVanguard
Accused, Victim, Complainant, ArrestSurrender, ChargesheetDetails management.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime

from app.core.catalyst import CatalystDataStore, CatalystCache
from app.core.auth import AuthUser, verify_catalyst_token, require_investigator

router = APIRouter()


# ─── Pydantic Models ─────────────────────────────────────────

class AccusedCreate(BaseModel):
    case_master_id: int
    accused_name: Optional[str] = None
    age_year: Optional[int] = None
    gender_id: Optional[int] = None
    person_id: Optional[str] = None      # A1, A2, A3...
    is_known: bool = True
    nationality: Optional[str] = "Indian"
    address: Optional[str] = None


class VictimCreate(BaseModel):
    case_master_id: int
    victim_name: str
    age_year: Optional[int] = None
    gender_id: Optional[int] = None
    victim_police: bool = False
    injury: Optional[str] = None


class ArrestCreate(BaseModel):
    case_master_id: int
    accused_master_id: int
    arrest_surrender_type_id: int = 1    # 1=Arrest, 2=Surrender
    arrest_surrender_date: date
    district_id: Optional[int] = None
    police_station_id: Optional[int] = None
    io_id: Optional[int] = None
    court_id: Optional[int] = None


class ChargesheetCreate(BaseModel):
    case_master_id: int
    csdate: datetime
    cstype: str = "A"                    # A=Chargesheet, B=False Case, C=Undetected
    police_person_id: Optional[int] = None


# ─── Accused ─────────────────────────────────────────────────

@router.post("/accused", summary="Add accused to a case")
async def add_accused(
    data: AccusedCreate,
    current_user: AuthUser = Depends(require_investigator),
):
    row = {
        "CaseMasterID": data.case_master_id,
        "AccusedName": data.accused_name,
        "AgeYear": data.age_year,
        "GenderID": data.gender_id,
        "PersonID": data.person_id,
        "IsKnown": 1 if data.is_known else 0,
        "Nationality": data.nationality,
        "Address": data.address,
    }
    result = await CatalystDataStore.insert("Accused", row)
    await CatalystCache.delete(f"case:{data.case_master_id}:accused")
    return {"message": "Accused added", "accused_id": result.get("AccusedMasterID") or result.get("ROWID")}


@router.get("/{case_id}/accused", summary="Get all accused for a case")
async def get_accused(
    case_id: int,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    cache_key = f"case:{case_id}:accused"
    cached = await CatalystCache.get_json(cache_key)
    if cached:
        return cached
    rows = await CatalystDataStore.query(
        f"SELECT * FROM Accused WHERE CaseMasterID = {case_id} ORDER BY PersonID"
    )
    await CatalystCache.set_json(cache_key, rows, ttl_seconds=600)
    return rows


# ─── Victims ─────────────────────────────────────────────────

@router.post("/victims", summary="Add victim to a case")
async def add_victim(
    data: VictimCreate,
    current_user: AuthUser = Depends(require_investigator),
):
    row = {
        "CaseMasterID": data.case_master_id,
        "VictimName": data.victim_name,
        "AgeYear": data.age_year,
        "GenderID": data.gender_id,
        "VictimPolice": 1 if data.victim_police else 0,
        "Injury": data.injury,
    }
    result = await CatalystDataStore.insert("Victim", row)
    return {"message": "Victim added", "victim_id": result.get("VictimMasterID") or result.get("ROWID")}


@router.get("/{case_id}/victims", summary="Get all victims for a case")
async def get_victims(
    case_id: int,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    return await CatalystDataStore.query(
        f"SELECT * FROM Victim WHERE CaseMasterID = {case_id}"
    )


# ─── Arrests ─────────────────────────────────────────────────

@router.post("/arrests", summary="Record an arrest or surrender")
async def add_arrest(
    data: ArrestCreate,
    current_user: AuthUser = Depends(require_investigator),
):
    row = {
        "CaseMasterID": data.case_master_id,
        "AccusedMasterID": data.accused_master_id,
        "ArrestSurrenderTypeID": data.arrest_surrender_type_id,
        "ArrestSurrenderDate": data.arrest_surrender_date.isoformat(),
        "ArrestSurrenderDistrictId": data.district_id,
        "PoliceStationID": data.police_station_id,
        "IOID": data.io_id,
        "CourtID": data.court_id,
        "IsAccused": 1,
    }
    result = await CatalystDataStore.insert("ArrestSurrender", row)
    return {"message": "Arrest recorded", "arrest_id": result.get("ArrestSurrenderID") or result.get("ROWID")}


@router.get("/{case_id}/arrests", summary="Get arrests for a case")
async def get_arrests(
    case_id: int,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    return await CatalystDataStore.query(
        f"""
        SELECT ar.*, e.FirstName as io_name, d.DistrictName
        FROM ArrestSurrender ar
        LEFT JOIN Employee e ON ar.IOID = e.EmployeeID
        LEFT JOIN District d ON ar.ArrestSurrenderDistrictId = d.DistrictID
        WHERE ar.CaseMasterID = {case_id}
        ORDER BY ar.ArrestSurrenderDate DESC
        """
    )


# ─── Chargesheet ─────────────────────────────────────────────

@router.post("/chargesheet", summary="File a chargesheet")
async def file_chargesheet(
    data: ChargesheetCreate,
    current_user: AuthUser = Depends(require_investigator),
):
    row = {
        "CaseMasterID": data.case_master_id,
        "csdate": data.csdate.isoformat(),
        "cstype": data.cstype,
        "PolicePersonID": data.police_person_id,
    }
    result = await CatalystDataStore.insert("ChargesheetDetails", row)
    # Update case status to Charge Sheeted (ID=2)
    await CatalystDataStore.update("CaseMaster", data.case_master_id, {"CaseStatusID": 2})
    await CatalystCache.delete(f"fir:{data.case_master_id}")
    return {"message": "Chargesheet filed", "cs_id": result.get("CSID") or result.get("ROWID")}


# ─── Full Case Detail ─────────────────────────────────────────

@router.get("/{case_id}", summary="Get full case detail with all linked records")
async def get_case_detail(
    case_id: int,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    cache_key = f"case:full:{case_id}"
    cached = await CatalystCache.get_json(cache_key)
    if cached:
        return cached

    case_rows = await CatalystDataStore.query(
        f"""
        SELECT cm.*, u.UnitName as station_name, d.DistrictName,
               ch.CrimeGroupName as major_head,
               cs.CrimeHeadName as minor_head,
               csm.CaseStatusName as status_name,
               go.LookupValue as gravity,
               cc.LookupValue as case_category
        FROM CaseMaster cm
        LEFT JOIN Unit u      ON cm.PoliceStationID  = u.UnitID
        LEFT JOIN District d  ON u.DistrictID         = d.DistrictID
        LEFT JOIN CrimeHead ch ON cm.CrimeMajorHeadID = ch.CrimeHeadID
        LEFT JOIN CrimeSubHead cs ON cm.CrimeMinorHeadID = cs.CrimeSubHeadID
        LEFT JOIN CaseStatusMaster csm ON cm.CaseStatusID = csm.CaseStatusID
        LEFT JOIN GravityOffence go ON cm.GravityOffenceID = go.GravityOffenceID
        LEFT JOIN CaseCategory cc ON cm.CaseCategoryID = cc.CaseCategoryID
        WHERE cm.CaseMasterID = {case_id}
        """
    )
    if not case_rows:
        raise HTTPException(status_code=404, detail="Case not found")

    accused  = await CatalystDataStore.query(f"SELECT * FROM Accused WHERE CaseMasterID = {case_id}")
    victims  = await CatalystDataStore.query(f"SELECT * FROM Victim WHERE CaseMasterID = {case_id}")
    sections = await CatalystDataStore.query(
        f"""
        SELECT asa.*, a.ActDescription, s.SectionDescription
        FROM ActSectionAssociation asa
        LEFT JOIN Act a ON asa.ActID = a.ActCode
        LEFT JOIN Section s ON asa.ActID = s.ActCode AND asa.SectionID = s.SectionCode
        WHERE asa.CaseMasterID = {case_id}
        """
    )

    result = {
        **case_rows[0],
        "accused": accused,
        "victims": victims,
        "act_sections": sections,
    }
    await CatalystCache.set_json(cache_key, result, ttl_seconds=300)
    return result
