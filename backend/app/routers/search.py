"""
Search API — VigilanteVanguard
Full-text search across FIRs, accused, victims, locations via Catalyst Data Store Search.
"""
from fastapi import APIRouter, Depends, Query
from typing import Optional

from app.core.catalyst import CatalystDataStore, CatalystCache
from app.core.auth import AuthUser, verify_catalyst_token

router = APIRouter()


@router.get("/", summary="Universal search across all crime records")
async def universal_search(
    q: str = Query(..., min_length=2, description="Search query"),
    entity: Optional[str] = Query(None, description="fir | accused | victim | station"),
    district_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Searches across FIR numbers, accused names, victim names, and
    police station names using Catalyst Data Store Search.
    """
    cache_key = f"search:{q}:{entity}:{district_id}:{page}"
    cached = await CatalystCache.get_json(cache_key)
    if cached:
        return cached

    results = []
    q_safe = q.replace("'", "''")
    dist_filter = f"AND u.DistrictID = {district_id}" if district_id else ""

    if not entity or entity == "fir":
        rows = await CatalystDataStore.query(
            f"""
            SELECT cm.CaseMasterID, cm.CrimeNo, cm.CrimeRegisteredDate,
                   cm.BriefFacts, u.UnitName as station,
                   ch.CrimeGroupName as crime_head, 'fir' as entity_type
            FROM CaseMaster cm
            LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
            LEFT JOIN CrimeHead ch ON cm.CrimeMajorHeadID = ch.CrimeHeadID
            WHERE (cm.CrimeNo LIKE '%{q_safe}%' OR cm.BriefFacts LIKE '%{q_safe}%')
            {dist_filter}
            LIMIT {page_size}
            """
        )
        results.extend(rows)

    if not entity or entity == "accused":
        rows = await CatalystDataStore.query(
            f"""
            SELECT a.AccusedMasterID, a.AccusedName, a.AgeYear, a.PersonID,
                   cm.CrimeNo, 'accused' as entity_type
            FROM Accused a
            JOIN CaseMaster cm ON a.CaseMasterID = cm.CaseMasterID
            LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
            WHERE a.AccusedName LIKE '%{q_safe}%'
            {dist_filter}
            LIMIT {page_size}
            """
        )
        results.extend(rows)

    if not entity or entity == "victim":
        rows = await CatalystDataStore.query(
            f"""
            SELECT v.VictimMasterID, v.VictimName, v.AgeYear,
                   cm.CrimeNo, 'victim' as entity_type
            FROM Victim v
            JOIN CaseMaster cm ON v.CaseMasterID = cm.CaseMasterID
            LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
            WHERE v.VictimName LIKE '%{q_safe}%'
            {dist_filter}
            LIMIT {page_size}
            """
        )
        results.extend(rows)

    if not entity or entity == "station":
        rows = await CatalystDataStore.query(
            f"""
            SELECT u.UnitID, u.UnitName, d.DistrictName, 'station' as entity_type
            FROM Unit u
            LEFT JOIN District d ON u.DistrictID = d.DistrictID
            WHERE u.UnitName LIKE '%{q_safe}%' AND u.Active = 1
            LIMIT {page_size}
            """
        )
        results.extend(rows)

    response = {
        "query": q,
        "entity_filter": entity,
        "total": len(results),
        "results": results,
    }
    await CatalystCache.set_json(cache_key, response, ttl_seconds=120)
    return response


@router.get("/ipc-sections", summary="Search IPC/BNS sections by keyword")
async def search_sections(
    q: str = Query(..., min_length=2),
    act_code: Optional[str] = Query(None),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    q_safe = q.replace("'", "''")
    act_filter = f"AND s.ActCode = '{act_code}'" if act_code else ""
    rows = await CatalystDataStore.query(
        f"""
        SELECT s.ActCode, s.SectionCode, s.SectionDescription, a.ShortName as act_name
        FROM Section s
        JOIN Act a ON s.ActCode = a.ActCode
        WHERE (s.SectionCode LIKE '%{q_safe}%' OR s.SectionDescription LIKE '%{q_safe}%')
        {act_filter}
        AND s.Active = 1
        LIMIT 30
        """
    )
    return {"query": q, "results": rows}


@router.get("/crime-heads", summary="Get all crime major/minor heads")
async def get_crime_heads(current_user: AuthUser = Depends(verify_catalyst_token)):
    cached = await CatalystCache.get_json("ref:crime_heads")
    if cached:
        return cached
    major = await CatalystDataStore.query(
        "SELECT CrimeHeadID, CrimeGroupName FROM CrimeHead WHERE Active=1 ORDER BY CrimeHeadID"
    )
    minor = await CatalystDataStore.query(
        "SELECT CrimeSubHeadID, CrimeHeadID, CrimeHeadName, SeqID FROM CrimeSubHead ORDER BY CrimeHeadID, SeqID"
    )
    result = {"major_heads": major, "sub_heads": minor}
    await CatalystCache.set_json("ref:crime_heads", result, ttl_seconds=86400)
    return result
