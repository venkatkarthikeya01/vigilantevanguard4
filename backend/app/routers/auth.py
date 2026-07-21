"""
Auth Router — VigilanteVanguard
Demo login endpoint. Works in both local dev and deployed AppSail.
Encodes user identity into a self-contained token; verified by auth middleware
without needing Catalyst Auth SDK (which requires a live Catalyst session context).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import base64
import json
import hmac
import hashlib

router = APIRouter()

# Shared secret used to sign demo tokens — same value checked in auth.py
_TOKEN_SECRET = "vv_ksp_demo_2026"

# All demo / datathon accounts
_DEV_USERS = {
    "admin@ksp.gov.in":              {"password": "admin123",      "role": "ADMINISTRATOR", "display_name": "Admin Officer",      "district_id": 5},
    "venkat.25cse@cambridge.edu.in": {"password": "Karthi@007",    "role": "ADMINISTRATOR", "display_name": "Venkat (Admin)",     "district_id": 5},
    "raj.kumar@ksp.gov.in":          {"password": "Inspector@123", "role": "INVESTIGATOR",  "display_name": "Insp. Raj Kumar",    "district_id": 5},
    "priya.sharma@ksp.gov.in":       {"password": "Analyst@123",   "role": "ANALYST",       "display_name": "Priya Sharma",       "district_id": 1},
    "suresh.babu@ksp.gov.in":        {"password": "Supervisor@123","role": "SUPERVISOR",    "display_name": "DSP Suresh Babu",    "district_id": 5},
    "inspector@ksp.gov.in":          {"password": "pass123",       "role": "INVESTIGATOR",  "display_name": "S.K. Ravi Kumar",    "district_id": 5},
    "analyst@ksp.gov.in":            {"password": "pass123",       "role": "ANALYST",       "display_name": "Priya Nair",         "district_id": 1},
    "supervisor@ksp.gov.in":         {"password": "pass123",       "role": "SUPERVISOR",    "display_name": "DSP Venkatesh",      "district_id": 5},
}


def _make_token(email: str, user_data: dict, user_id: str) -> str:
    """
    Build a self-contained demo token:
      base64(payload_json).HMAC_SHA256_signature
    Verified in auth.py without any external SDK.
    """
    payload = {
        "user_id": user_id,
        "email": email,
        "role": user_data["role"],
        "display_name": user_data["display_name"],
        "district_id": user_data["district_id"],
        "type": "vv_demo",
    }
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).decode().rstrip("=")

    sig = hmac.new(
        _TOKEN_SECRET.encode(),
        payload_b64.encode(),
        hashlib.sha256,
    ).hexdigest()[:16]

    return f"{payload_b64}.{sig}"


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: dict


@router.post("/login", response_model=LoginResponse, summary="Sign in")
async def login(data: LoginRequest):
    """
    Demo login — works in local dev AND on deployed AppSail.
    Returns a self-contained signed token that auth middleware can verify
    without a Catalyst session context.
    """
    email = data.email.lower().strip()
    user_data = _DEV_USERS.get(email)

    if not user_data or user_data["password"] != data.password:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user_id = str(list(_DEV_USERS.keys()).index(email) + 1)
    token = _make_token(email, user_data, user_id)

    return LoginResponse(
        token=token,
        user={
            "user_id": user_id,
            "email": email,
            "role": user_data["role"],
            "display_name": user_data["display_name"],
            "district_id": user_data["district_id"],
        }
    )


@router.get("/me", summary="Get current user profile")
async def me():
    """Returns the admin profile for quick health-check."""
    return {
        "user_id": "1",
        "email": "admin@ksp.gov.in",
        "role": "ADMINISTRATOR",
        "display_name": "Admin Officer",
        "district_id": 5,
    }
