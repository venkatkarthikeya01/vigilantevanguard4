"""
Crime Analytics API — VigilanteVanguard
Powers dashboard charts, district comparisons, trend analysis.
Uses real KSP data seeded from Monthly Crime Review PDFs (Jan–Jun 2026).
"""
from fastapi import APIRouter, Depends, Query
from typing import Optional
from datetime import date

from app.core.catalyst import CatalystDataStore, CatalystCache
from app.core.auth import AuthUser, verify_catalyst_token

router = APIRouter()


@router.get("/dashboard/summary", summary="Top-level crime dashboard summary")
async def dashboard_summary(
    district_id: Optional[int] = Query(None),
    year: int = Query(2026),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Returns aggregated crime counts for the dashboard widgets.
    Results served from Catalyst Cache (TTL: 1 hour).
    """
    cache_key = f"dashboard:summary:d{district_id}:y{year}"
    cached = await CatalystCache.get_json(cache_key)
    if cached:
        return cached

    district_filter = f"AND u.DistrictID = {district_id}" if district_id else ""
    sql = f"""
        SELECT ch.CrimeGroupName as crime_head, COUNT(*) as total
        FROM CaseMaster cm
        LEFT JOIN CrimeHead ch ON cm.CrimeMajorHeadID = ch.CrimeHeadID
        LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
        WHERE YEAR(cm.CrimeRegisteredDate) = {year}
        {district_filter}
        GROUP BY ch.CrimeGroupName
        ORDER BY total DESC
    """
    rows = await CatalystDataStore.query(sql)
    result = {"year": year, "district_id": district_id, "crime_summary": rows}
    await CatalystCache.set_json(cache_key, result, ttl_seconds=3600)
    return result


@router.get("/monthly-trend", summary="Monthly crime trend for chart rendering")
async def monthly_trend(
    crime_head: Optional[str] = Query(None),
    district_id: Optional[int] = Query(None),
    year: int = Query(2026),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Returns monthly crime counts for trend visualisation.
    Data seeded from official KSP Crime Review PDFs (Jan–Jun 2026).
    """
    cache_key = f"trend:{crime_head}:d{district_id}:y{year}"
    cached = await CatalystCache.get_json(cache_key)
    if cached:
        return cached

    filters = [f"Year = {year}"]
    if crime_head:
        filters.append(f"CrimeHeadCode = '{crime_head}'")
    if district_id:
        filters.append(f"UnitID = {district_id}")

    where = "WHERE " + " AND ".join(filters)
    sql = f"""
        SELECT Month, SUM(CaseCount) as total
        FROM MonthlyCrimeStat
        {where}
        GROUP BY Month ORDER BY Month
    """
    rows = await CatalystDataStore.query(sql)
    result = {"year": year, "crime_head": crime_head, "monthly_data": rows}
    await CatalystCache.set_json(cache_key, result, ttl_seconds=3600)
    return result


@router.get("/district-comparison", summary="District-wise crime comparison")
async def district_comparison(
    crime_head: str = Query("MURDER_TOTAL"),
    month: int = Query(1),
    year: int = Query(2026),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Returns district-wise crime counts for the choropleth map layer.
    Data from real KSP Monthly Crime Review seed.
    """
    sql = f"""
        SELECT d.DistrictName, SUM(mcs.CaseCount) as count
        FROM MonthlyCrimeStat mcs
        JOIN Unit u ON mcs.UnitID = u.UnitID
        JOIN District d ON u.DistrictID = d.DistrictID
        WHERE mcs.CrimeHeadCode = '{crime_head}'
        AND mcs.Month = {month}
        AND mcs.Year = {year}
        GROUP BY d.DistrictName
        ORDER BY count DESC
    """
    rows = await CatalystDataStore.query(sql)
    return {"crime_head": crime_head, "month": month, "year": year, "districts": rows}


@router.get("/top-crime-districts", summary="Top districts by crime volume")
async def top_crime_districts(
    limit: int = Query(10, ge=1, le=38),
    year: int = Query(2026),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    sql = f"""
        SELECT d.DistrictName, SUM(mcs.CaseCount) as total_crimes
        FROM MonthlyCrimeStat mcs
        JOIN Unit u ON mcs.UnitID = u.UnitID
        JOIN District d ON u.DistrictID = d.DistrictID
        WHERE mcs.Year = {year}
        GROUP BY d.DistrictName
        ORDER BY total_crimes DESC
        LIMIT {limit}
    """
    rows = await CatalystDataStore.query(sql)
    return {"year": year, "top_districts": rows}


@router.get("/crime-heatmap-data", summary="GeoJSON data for Google Maps heatmap")
async def crime_heatmap_data(
    district_id: Optional[int] = Query(None),
    crime_head_id: Optional[int] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Returns GeoJSON FeatureCollection for Google Maps crime heatmap.
    Only includes FIRs with lat/lon coordinates.
    """
    conditions = ["cm.Latitude IS NOT NULL", "cm.Longitude IS NOT NULL"]
    if district_id:
        conditions.append(f"u.DistrictID = {district_id}")
    if crime_head_id:
        conditions.append(f"cm.CrimeMajorHeadID = {crime_head_id}")
    if from_date:
        conditions.append(f"cm.CrimeRegisteredDate >= '{from_date}'")
    if to_date:
        conditions.append(f"cm.CrimeRegisteredDate <= '{to_date}'")

    sql = f"""
        SELECT cm.CaseMasterID, cm.CrimeNo, cm.Latitude, cm.Longitude,
               cm.CrimeRegisteredDate, ch.CrimeGroupName,
               u.UnitName as police_station
        FROM CaseMaster cm
        LEFT JOIN CrimeHead ch ON cm.CrimeMajorHeadID = ch.CrimeHeadID
        LEFT JOIN Unit u ON cm.PoliceStationID = u.UnitID
        WHERE {' AND '.join(conditions)}
        LIMIT 2000
    """
    rows = await CatalystDataStore.query(sql)

    features = [
        {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [row["Longitude"], row["Latitude"]]
            },
            "properties": {
                "case_id": row["CaseMasterID"],
                "crime_no": row["CrimeNo"],
                "crime_head": row.get("CrimeGroupName", "Unknown"),
                "station": row.get("police_station", ""),
                "date": str(row.get("CrimeRegisteredDate", "")),
            }
        }
        for row in rows
    ]

    return {
        "type": "FeatureCollection",
        "features": features,
        "total": len(features),
    }


@router.get("/ksp-stats-2026", summary="Official KSP crime statistics Jan–Jun 2026")
async def ksp_official_stats_2026(
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Returns the summarised crime statistics directly from the imported KSP
    Monthly Crime Review PDFs (January to June 2026).
    """
    return {
        "source": "Karnataka State Police — CCTNS Monthly Crime Review",
        "period": "January–June 2026",
        "monthly_summary": [
            {"month": "January 2026",  "murder": 98,  "dacoity": 6,  "robbery": 92,  "theft": 1742, "cyber_crime": 1259, "ndps": 1397, "pocso": 316},
            {"month": "February 2026", "murder": 73,  "dacoity": 14, "robbery": 86,  "theft": 1637, "cyber_crime": 1028, "ndps": 980,  "pocso": 341},
            {"month": "March 2026",    "murder": 104, "dacoity": 18, "robbery": None, "theft": None, "cyber_crime": None, "ndps": None,  "pocso": None},
            {"month": "April 2026",    "murder": 78,  "dacoity": 7,  "robbery": None, "theft": None, "cyber_crime": None, "ndps": None,  "pocso": None},
            {"month": "May 2026",      "murder": 94,  "dacoity": 15, "robbery": None, "theft": None, "cyber_crime": None, "ndps": None,  "pocso": None},
            {"month": "June 2026",     "murder": 113, "dacoity": 16, "robbery": None, "theft": None, "cyber_crime": None, "ndps": None,  "pocso": None},
        ],
        "note": "Partial data for Mar–Jun; detailed sub-head data available on request"
    }
