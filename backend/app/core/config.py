import os
from pydantic_settings import BaseSettings
from typing import List, Optional


class Settings(BaseSettings):
    # ─── Zoho Catalyst Configuration ─────────────────────────
    CATALYST_PROJECT_ID: Optional[str] = ""
    CATALYST_PROJECT_KEY: Optional[str] = ""
    CATALYST_ENV: str = "development"

    # Catalyst Data Store
    CATALYST_DATA_STORE_URL: str = "https://datastore.catalystapps.com"

    # Catalyst Cache
    CATALYST_CACHE_SEGMENT: str = "vv-cache"

    # Catalyst NoSQL
    CATALYST_NOSQL_TABLE_CONVERSATIONS: str = "conversation_history"
    CATALYST_NOSQL_TABLE_AI_CONTEXT: str = "ai_context"
    CATALYST_NOSQL_TABLE_SESSION: str = "session_state"

    # Catalyst Stratus (Object Storage)
    CATALYST_STRATUS_BUCKET_PDFS: str = "crime-pdfs"
    CATALYST_STRATUS_BUCKET_EVIDENCE: str = "evidence"
    CATALYST_STRATUS_BUCKET_REPORTS: str = "reports"
    CATALYST_STRATUS_BUCKET_OCR: str = "ocr-outputs"

    # Catalyst QuickML
    CATALYST_QUICKML_KB_NAME: str = "ksp-crime-kb"
    CATALYST_QUICKML_API_KEY: Optional[str] = ""

    # Catalyst Zia Services
    CATALYST_ZIA_OCR_API: str = "https://zia.zoho.com/api/v1/ocr"
    CATALYST_ZIA_SPEECH_API: str = "https://zia.zoho.com/api/v1/speech"

    # Catalyst Authentication
    CATALYST_AUTH_SECRET: str = "vigilante_vanguard_dev_secret"
    CATALYST_JWT_ALGORITHM: str = "RS256"

    # Google Maps (via Catalyst Connections)
    GOOGLE_MAPS_API_KEY: Optional[str] = ""
    GOOGLE_GEOCODING_API_KEY: Optional[str] = ""

    # AI Backend — Ollama (local) or Gemini (cloud fallback)
    OLLAMA_BASE_URL: str = "http://127.0.0.1:11434"
    OLLAMA_MODEL: str = "qwen2.5:1.5b"
    GEMINI_API_KEY: Optional[str] = ""

    # Application
    APP_NAME: str = "VigilanteVanguard"
    APP_VERSION: str = "4.0.0"
    ALLOWED_ORIGINS: List[str] = [
        "https://vigilante-vanguard.catalystappsail.com",
        "https://vigilante-vanguard.catalystslate.com",
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    # Karnataka Police
    KSP_STATE_ID: int = 1
    KSP_DEFAULT_DISTRICT_ID: int = 5  # Bengaluru City as default

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


settings = Settings()
