"""
Catalyst Authentication middleware for VigilanteVanguard.
Supports two token types:
  1. vv_demo  — self-contained signed token issued by /auth/login (works locally AND on AppSail)
  2. Catalyst JWT — validated via Catalyst Auth SDK (production Catalyst Auth login)
"""
from fastapi import HTTPException, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from enum import Enum
from typing import Optional
from pydantic import BaseModel
import base64
import json
import hmac
import hashlib
from app.core.config import settings


# Matches the secret in routers/auth.py
_TOKEN_SECRET = "vv_ksp_demo_2026"

# auto_error=False so a missing header doesn't throw 403 before our logic runs
security = HTTPBearer(auto_error=False)


class UserRole(str, Enum):
    INVESTIGATOR = "INVESTIGATOR"
    ANALYST = "ANALYST"
    SUPERVISOR = "SUPERVISOR"
    ADMINISTRATOR = "ADMINISTRATOR"
    POLICYMAKER = "POLICYMAKER"


class AuthUser(BaseModel):
    user_id: str
    email: str
    role: UserRole
    unit_id: Optional[int] = None
    district_id: Optional[int] = None
    display_name: Optional[str] = None


def _verify_demo_token(token: str) -> Optional[AuthUser]:
    """
    Verifies a vv_demo self-contained token.
    Format: base64url(payload_json).hmac_16chars
    Returns AuthUser on success, None if the token is not a vv_demo token.
    Raises 401 if the token looks like a vv_demo token but the signature is wrong.
    """
    if "." not in token:
        return None
    parts = token.rsplit(".", 1)
    if len(parts) != 2:
        return None

    payload_b64, sig = parts[0], parts[1]

    # Add back stripped padding
    padding = 4 - len(payload_b64) % 4
    if padding != 4:
        payload_b64 += "=" * padding

    try:
        payload = json.loads(base64.urlsafe_b64decode(payload_b64).decode())
    except Exception:
        return None  # Not a vv_demo token — let Catalyst Auth handle it

    if payload.get("type") != "vv_demo":
        return None  # Not ours — let Catalyst Auth handle it

    # Verify HMAC signature
    expected_sig = hmac.new(
        _TOKEN_SECRET.encode(),
        parts[0].encode(),
        hashlib.sha256,
    ).hexdigest()[:16]

    if not hmac.compare_digest(sig, expected_sig):
        raise HTTPException(status_code=401, detail="Invalid demo token signature")

    try:
        role = UserRole(payload["role"])
    except (KeyError, ValueError):
        role = UserRole.INVESTIGATOR

    return AuthUser(
        user_id=payload.get("user_id", "1"),
        email=payload.get("email", ""),
        role=role,
        district_id=payload.get("district_id"),
        display_name=payload.get("display_name", ""),
    )


async def verify_catalyst_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security)
) -> AuthUser:
    """
    Token verification chain:
      1. No token + dev mode (no numeric PROJECT_ID) → return dev admin
      2. vv_demo self-contained token → decode & verify HMAC (works everywhere)
      3. Catalyst JWT → validate via Catalyst Auth SDK (full production mode)
    """
    # ── Pure dev mode: no token at all, no real PROJECT_ID ────
    _pid = (settings.CATALYST_PROJECT_ID or "").strip()
    _is_dev = not _pid or not _pid.isdigit()

    if not credentials:
        if _is_dev:
            return AuthUser(
                user_id="1",
                email="admin@ksp.gov.in",
                role=UserRole.ADMINISTRATOR,
                unit_id=1,
                district_id=5,
                display_name="Dev Admin",
            )
        raise HTTPException(status_code=401, detail="Authorization header missing")

    token = credentials.credentials

    # ── Try vv_demo self-contained token first (works on AppSail too) ──
    demo_user = _verify_demo_token(token)
    if demo_user is not None:
        return demo_user

    # ── Dev mode fallback: any unrecognised token accepted ────
    if _is_dev:
        return AuthUser(
            user_id="1",
            email="admin@ksp.gov.in",
            role=UserRole.ADMINISTRATOR,
            unit_id=1,
            district_id=5,
            display_name="Dev Admin",
        )

    # ── Production: validate via Catalyst Auth SDK ────────────
    try:
        import zcatalyst_sdk as catalyst
        app = catalyst.initialize()
        auth = app.authentication()
        user_details = auth.validate_session_token(token)

        role_str = user_details.get("role", "INVESTIGATOR").upper()
        try:
            role = UserRole(role_str)
        except ValueError:
            role = UserRole.INVESTIGATOR

        return AuthUser(
            user_id=user_details.get("user_id", ""),
            email=user_details.get("email_id", ""),
            role=role,
            unit_id=user_details.get("unit_id"),
            district_id=user_details.get("district_id"),
            display_name=user_details.get("display_name", ""),
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {str(e)}")


def require_roles(*roles: UserRole):
    """Dependency factory — restrict endpoint to specific roles."""
    async def _check(user: AuthUser = Depends(verify_catalyst_token)) -> AuthUser:
        if user.role not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Required roles: {[r.value for r in roles]}"
            )
        return user
    return _check


# Pre-built role guards
require_investigator = require_roles(
    UserRole.INVESTIGATOR, UserRole.SUPERVISOR, UserRole.ADMINISTRATOR
)
require_analyst = require_roles(
    UserRole.ANALYST, UserRole.SUPERVISOR, UserRole.ADMINISTRATOR
)
require_supervisor = require_roles(
    UserRole.SUPERVISOR, UserRole.ADMINISTRATOR
)
require_admin = require_roles(UserRole.ADMINISTRATOR)
