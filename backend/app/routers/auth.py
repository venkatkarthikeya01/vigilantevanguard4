"""
Auth Router — VigilanteVanguard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Login + user management endpoints.

Branch / data isolation:
  - Each non-admin user is assigned a `branch_id` that scopes ALL their data
    (training samples, CCTV incidents, FIRs, cameras).
  - ADMINISTRATOR role (or branch_id == "HQ") can see everything.
  - Admins can create/update users and assign them to branches.

In production, persist _BRANCH_USERS to Catalyst Data Store table "VVUsers"
instead of the in-memory dict below.  The _load_users / _save_users helpers
are the only touch-points.
"""
import os
import base64
import json
import hmac
import hashlib
import time
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from app.core.auth import (
    verify_catalyst_token, require_admin, AuthUser, UserRole,
)

router = APIRouter()

# Token secret — read from env (same key as auth.py uses)
_TOKEN_SECRET = os.environ.get("VV_TOKEN_SECRET", "vv_ksp_demo_2026")

# ─────────────────────────────────────────────────────────────────────────────
#  BRANCHES  — each entry defines a police division / unit
#  branch_id  : machine-readable key (stored in tokens & all DB rows)
#  name       : display name shown in the UI
#  district_id: for backward compat with legacy analytics
# ─────────────────────────────────────────────────────────────────────────────
BRANCHES: Dict[str, Dict[str, Any]] = {
    "HQ": {
        "name":        "State HQ / Karnataka Police HQ",
        "district_id": 0,
        "city":        "Bengaluru",
    },
    "BLR_CITY": {
        "name":        "Bengaluru City Police",
        "district_id": 5,
        "city":        "Bengaluru",
    },
    "BLR_SOUTH": {
        "name":        "Bengaluru South Division",
        "district_id": 5,
        "city":        "Bengaluru",
    },
    "BLR_NORTH": {
        "name":        "Bengaluru North Division",
        "district_id": 5,
        "city":        "Bengaluru",
    },
    "BLR_EAST": {
        "name":        "Bengaluru East Division",
        "district_id": 5,
        "city":        "Bengaluru",
    },
    "BLR_WEST": {
        "name":        "Bengaluru West Division",
        "district_id": 5,
        "city":        "Bengaluru",
    },
    "MYS_CITY": {
        "name":        "Mysuru City Police",
        "district_id": 12,
        "city":        "Mysuru",
    },
    "HBL_CITY": {
        "name":        "Hubballi-Dharwad City Police",
        "district_id": 10,
        "city":        "Hubballi",
    },
    "MGD_DIST": {
        "name":        "Mangaluru District Police",
        "district_id": 8,
        "city":        "Mangaluru",
    },
    "BLG_DIST": {
        "name":        "Belagavi District Police",
        "district_id": 3,
        "city":        "Belagavi",
    },
    "SHG_DIST": {
        "name":        "Shivamogga District Police",
        "district_id": 15,
        "city":        "Shivamogga",
    },
    "GUL_DIST": {
        "name":        "Kalaburagi District Police",
        "district_id": 6,
        "city":        "Kalaburagi",
    },
}

# ─────────────────────────────────────────────────────────────────────────────
#  USER STORE
#  Schema per user:
#    email        : login key
#    password     : plain-text (replace with bcrypt in production)
#    role         : UserRole value string
#    display_name : shown in UI header
#    branch_id    : scopes all data — None / "HQ" = admin access
#    station_code : optional sub-unit (e.g. police station code)
#    active       : soft-delete flag
# ─────────────────────────────────────────────────────────────────────────────
_BRANCH_USERS: Dict[str, Dict[str, Any]] = {
    # ── State-wide admins ─────────────────────────────────────────────────────
    "admin@ksp.gov.in": {
        "password": "admin123", "role": "ADMINISTRATOR",
        "display_name": "State Admin", "branch_id": "HQ", "station_code": None, "active": True,
    },
    "venkat.25cse@cambridge.edu.in": {
        "password": "Karthi@007", "role": "ADMINISTRATOR",
        "display_name": "Venkat (Admin)", "branch_id": "HQ", "station_code": None, "active": True,
    },

    # ── Bengaluru City ────────────────────────────────────────────────────────
    "blr.city.admin@ksp.gov.in": {
        "password": "BLR@City1", "role": "ADMINISTRATOR",
        "display_name": "Bengaluru City Admin", "branch_id": "BLR_CITY", "station_code": None, "active": True,
    },
    "blr.south.supervisor@ksp.gov.in": {
        "password": "BLR@South1", "role": "SUPERVISOR",
        "display_name": "DSP BLR South", "branch_id": "BLR_SOUTH", "station_code": "BLR_S_01", "active": True,
    },
    "blr.north.supervisor@ksp.gov.in": {
        "password": "BLR@North1", "role": "SUPERVISOR",
        "display_name": "DSP BLR North", "branch_id": "BLR_NORTH", "station_code": "BLR_N_01", "active": True,
    },
    "blr.east.supervisor@ksp.gov.in": {
        "password": "BLR@East1", "role": "SUPERVISOR",
        "display_name": "DSP BLR East", "branch_id": "BLR_EAST", "station_code": "BLR_E_01", "active": True,
    },
    "blr.west.supervisor@ksp.gov.in": {
        "password": "BLR@West1", "role": "SUPERVISOR",
        "display_name": "DSP BLR West", "branch_id": "BLR_WEST", "station_code": "BLR_W_01", "active": True,
    },
    "blr.inspector1@ksp.gov.in": {
        "password": "BLR@Insp1", "role": "INVESTIGATOR",
        "display_name": "Insp. BLR South", "branch_id": "BLR_SOUTH", "station_code": "BLR_S_01", "active": True,
    },
    "blr.analyst1@ksp.gov.in": {
        "password": "BLR@Anl1", "role": "ANALYST",
        "display_name": "Analyst BLR City", "branch_id": "BLR_CITY", "station_code": None, "active": True,
    },

    # ── Mysuru ────────────────────────────────────────────────────────────────
    "mys.admin@ksp.gov.in": {
        "password": "MYS@Admin1", "role": "ADMINISTRATOR",
        "display_name": "Mysuru City Admin", "branch_id": "MYS_CITY", "station_code": None, "active": True,
    },
    "mys.supervisor@ksp.gov.in": {
        "password": "MYS@Sup1", "role": "SUPERVISOR",
        "display_name": "DSP Mysuru City", "branch_id": "MYS_CITY", "station_code": "MYS_C_01", "active": True,
    },
    "mys.inspector@ksp.gov.in": {
        "password": "MYS@Insp1", "role": "INVESTIGATOR",
        "display_name": "Insp. Mysuru", "branch_id": "MYS_CITY", "station_code": "MYS_C_01", "active": True,
    },

    # ── Hubballi-Dharwad ──────────────────────────────────────────────────────
    "hbl.admin@ksp.gov.in": {
        "password": "HBL@Admin1", "role": "ADMINISTRATOR",
        "display_name": "Hubballi-Dharwad Admin", "branch_id": "HBL_CITY", "station_code": None, "active": True,
    },
    "hbl.supervisor@ksp.gov.in": {
        "password": "HBL@Sup1", "role": "SUPERVISOR",
        "display_name": "DSP Hubballi City", "branch_id": "HBL_CITY", "station_code": "HBL_C_01", "active": True,
    },
    "hbl.inspector@ksp.gov.in": {
        "password": "HBL@Insp1", "role": "INVESTIGATOR",
        "display_name": "Insp. Hubballi", "branch_id": "HBL_CITY", "station_code": "HBL_C_01", "active": True,
    },

    # ── Mangaluru ─────────────────────────────────────────────────────────────
    "mgd.admin@ksp.gov.in": {
        "password": "MGD@Admin1", "role": "ADMINISTRATOR",
        "display_name": "Mangaluru Dist Admin", "branch_id": "MGD_DIST", "station_code": None, "active": True,
    },
    "mgd.supervisor@ksp.gov.in": {
        "password": "MGD@Sup1", "role": "SUPERVISOR",
        "display_name": "DSP Mangaluru", "branch_id": "MGD_DIST", "station_code": "MGD_D_01", "active": True,
    },

    # ── Belagavi ──────────────────────────────────────────────────────────────
    "blg.admin@ksp.gov.in": {
        "password": "BLG@Admin1", "role": "ADMINISTRATOR",
        "display_name": "Belagavi Dist Admin", "branch_id": "BLG_DIST", "station_code": None, "active": True,
    },
    "blg.supervisor@ksp.gov.in": {
        "password": "BLG@Sup1", "role": "SUPERVISOR",
        "display_name": "DSP Belagavi", "branch_id": "BLG_DIST", "station_code": "BLG_D_01", "active": True,
    },

    # ── Shivamogga ────────────────────────────────────────────────────────────
    "shg.admin@ksp.gov.in": {
        "password": "SHG@Admin1", "role": "ADMINISTRATOR",
        "display_name": "Shivamogga Dist Admin", "branch_id": "SHG_DIST", "station_code": None, "active": True,
    },

    # ── Kalaburagi ────────────────────────────────────────────────────────────
    "gul.admin@ksp.gov.in": {
        "password": "GUL@Admin1", "role": "ADMINISTRATOR",
        "display_name": "Kalaburagi Dist Admin", "branch_id": "GUL_DIST", "station_code": None, "active": True,
    },

    # ── Legacy datathon accounts (kept for backward compat) ───────────────────
    "raj.kumar@ksp.gov.in": {
        "password": "Inspector@123", "role": "INVESTIGATOR",
        "display_name": "Insp. Raj Kumar", "branch_id": "BLR_CITY", "station_code": "BLR_S_01", "active": True,
    },
    "priya.sharma@ksp.gov.in": {
        "password": "Analyst@123", "role": "ANALYST",
        "display_name": "Priya Sharma", "branch_id": "MYS_CITY", "station_code": None, "active": True,
    },
    "suresh.babu@ksp.gov.in": {
        "password": "Supervisor@123", "role": "SUPERVISOR",
        "display_name": "DSP Suresh Babu", "branch_id": "BLR_CITY", "station_code": None, "active": True,
    },
    "inspector@ksp.gov.in": {
        "password": "pass123", "role": "INVESTIGATOR",
        "display_name": "S.K. Ravi Kumar", "branch_id": "BLR_SOUTH", "station_code": "BLR_S_01", "active": True,
    },
    "analyst@ksp.gov.in": {
        "password": "pass123", "role": "ANALYST",
        "display_name": "Priya Nair", "branch_id": "MYS_CITY", "station_code": None, "active": True,
    },
    "supervisor@ksp.gov.in": {
        "password": "pass123", "role": "SUPERVISOR",
        "display_name": "DSP Venkatesh", "branch_id": "BLR_CITY", "station_code": None, "active": True,
    },
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_token(email: str, user: dict, uid: str) -> str:
    """Build a self-contained HMAC-signed demo token with branch payload."""
    branch_id   = user.get("branch_id")
    branch_info = BRANCHES.get(branch_id or "", {})
    payload = {
        "user_id":      uid,
        "email":        email,
        "role":         user["role"],
        "display_name": user["display_name"],
        "branch_id":    branch_id,
        "branch_name":  branch_info.get("name"),
        "station_code": user.get("station_code"),
        "district_id":  branch_info.get("district_id"),
        "type":         "vv_demo",
    }
    b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    sig = hmac.new(_TOKEN_SECRET.encode(), b64.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{b64}.{sig}"


def _user_public(email: str, user: dict, uid: str) -> dict:
    """Public user dict (no password) returned by login/me endpoints."""
    branch_id   = user.get("branch_id")
    branch_info = BRANCHES.get(branch_id or "", {})
    return {
        "user_id":      uid,
        "email":        email,
        "role":         user["role"],
        "display_name": user["display_name"],
        "branch_id":    branch_id,
        "branch_name":  branch_info.get("name"),
        "station_code": user.get("station_code"),
        "district_id":  branch_info.get("district_id"),
        "active":       user.get("active", True),
    }


def _uid(email: str) -> str:
    keys = list(_BRANCH_USERS.keys())
    return str(keys.index(email) + 1) if email in keys else "99"


# ─────────────────────────────────────────────────────────────────────────────
#  PYDANTIC MODELS
# ─────────────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email:    str
    password: str


class LoginResponse(BaseModel):
    token: str
    user:  dict


class CreateUserRequest(BaseModel):
    email:        str
    password:     str
    role:         str
    display_name: str
    branch_id:    Optional[str] = None
    station_code: Optional[str] = None


class UpdateUserRequest(BaseModel):
    password:     Optional[str] = None
    role:         Optional[str] = None
    display_name: Optional[str] = None
    branch_id:    Optional[str] = None
    station_code: Optional[str] = None
    active:       Optional[bool] = None


# ─────────────────────────────────────────────────────────────────────────────
#  LOGIN
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse, summary="Sign in")
async def login(data: LoginRequest):
    """
    Sign in with email + password.
    Returns a self-contained HMAC token that encodes the user's branch,
    role and station — no Catalyst session context required.
    """
    email = data.email.lower().strip()
    user  = _BRANCH_USERS.get(email)

    if not user or user.get("password") != data.password:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Account is deactivated")

    uid   = _uid(email)
    token = _make_token(email, user, uid)
    return LoginResponse(token=token, user=_user_public(email, user, uid))


# ─────────────────────────────────────────────────────────────────────────────
#  CURRENT USER
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/me", summary="Get current user profile")
async def me(current_user: AuthUser = Depends(verify_catalyst_token)):
    """Return the authenticated user's profile including branch information."""
    return {
        "user_id":      current_user.user_id,
        "email":        current_user.email,
        "role":         current_user.role.value,
        "display_name": current_user.display_name,
        "branch_id":    current_user.branch_id,
        "branch_name":  current_user.branch_name,
        "station_code": current_user.station_code,
        "district_id":  current_user.district_id,
        "is_admin":     current_user.is_admin,
    }


# ─────────────────────────────────────────────────────────────────────────────
#  BRANCHES LISTING  (public — used by admin UI to populate dropdowns)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/branches", summary="List all branches")
async def list_branches(_: AuthUser = Depends(verify_catalyst_token)):
    return {
        "branches": [
            {"branch_id": bid, **info}
            for bid, info in BRANCHES.items()
        ]
    }


# ─────────────────────────────────────────────────────────────────────────────
#  ADMIN — USER MANAGEMENT
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/users", summary="[Admin] List all users")
async def list_users(
    branch_id: Optional[str] = None,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    List all users.
    - Admin (HQ/ADMINISTRATOR): sees all users or filter by branch_id param.
    - Branch-admin: sees only users in their own branch.
    - Others: 403.
    """
    if current_user.role not in (UserRole.ADMINISTRATOR, UserRole.SUPERVISOR):
        raise HTTPException(403, "Insufficient privileges")

    result = []
    for email, udata in _BRANCH_USERS.items():
        # Branch-admin restriction
        if not current_user.is_admin and udata.get("branch_id") != current_user.branch_id:
            continue
        # Optional filter by query param (admin only)
        if branch_id and udata.get("branch_id") != branch_id:
            continue
        result.append(_user_public(email, udata, _uid(email)))

    return {"users": result, "total": len(result)}


@router.post("/users", summary="[Admin] Create a new user")
async def create_user(
    req: CreateUserRequest,
    current_user: AuthUser = Depends(require_admin),
):
    """
    Create a new user account.
    Admin (HQ) can assign any branch.
    Branch-admin can only create users in their own branch.
    """
    email = req.email.lower().strip()
    if email in _BRANCH_USERS:
        raise HTTPException(400, f"User {email!r} already exists")

    # Validate role
    try:
        UserRole(req.role)
    except ValueError:
        raise HTTPException(400, f"Invalid role {req.role!r}. Valid: {[r.value for r in UserRole]}")

    # Validate branch
    if req.branch_id and req.branch_id not in BRANCHES:
        raise HTTPException(400, f"Unknown branch_id {req.branch_id!r}. Valid: {list(BRANCHES.keys())}")

    # Branch-admin restriction: can only create users in their own branch
    if not current_user.is_admin:
        if req.branch_id != current_user.branch_id:
            raise HTTPException(403, "You can only create users in your own branch")

    _BRANCH_USERS[email] = {
        "password":     req.password,
        "role":         req.role,
        "display_name": req.display_name,
        "branch_id":    req.branch_id,
        "station_code": req.station_code,
        "active":       True,
    }

    uid = _uid(email)
    return {
        "message": f"User {email} created successfully",
        "user":    _user_public(email, _BRANCH_USERS[email], uid),
    }


@router.patch("/users/{email}", summary="[Admin] Update a user")
async def update_user(
    email: str,
    req: UpdateUserRequest,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Update an existing user. Admins can update any field.
    Branch-admins can only update users in their branch and cannot change branch_id.
    Users can change their own password only.
    """
    email = email.lower().strip()
    user  = _BRANCH_USERS.get(email)
    if not user:
        raise HTTPException(404, f"User {email!r} not found")

    is_self = current_user.email == email

    # Permission check
    if not current_user.is_admin and not is_self:
        if user.get("branch_id") != current_user.branch_id:
            raise HTTPException(403, "Cannot modify users outside your branch")
        if current_user.role != UserRole.SUPERVISOR:
            raise HTTPException(403, "Insufficient privileges")

    # Non-admin cannot change branch_id or role
    if not current_user.is_admin:
        if req.branch_id is not None:
            raise HTTPException(403, "Only HQ Admin can change branch assignment")
        if req.role is not None and not is_self:
            raise HTTPException(403, "Only HQ Admin can change roles")

    if req.password     is not None: user["password"]     = req.password
    if req.role         is not None: user["role"]         = req.role
    if req.display_name is not None: user["display_name"] = req.display_name
    if req.branch_id    is not None: user["branch_id"]    = req.branch_id
    if req.station_code is not None: user["station_code"] = req.station_code
    if req.active       is not None: user["active"]       = req.active

    return {
        "message": f"User {email} updated",
        "user":    _user_public(email, user, _uid(email)),
    }


@router.delete("/users/{email}", summary="[Admin] Deactivate a user")
async def deactivate_user(
    email: str,
    current_user: AuthUser = Depends(require_admin),
):
    """Soft-delete (deactivate) a user account. HQ Admin only."""
    email = email.lower().strip()
    if email not in _BRANCH_USERS:
        raise HTTPException(404, f"User {email!r} not found")
    if email == current_user.email:
        raise HTTPException(400, "Cannot deactivate your own account")
    _BRANCH_USERS[email]["active"] = False
    return {"message": f"User {email} deactivated"}
