"""
Zoho Catalyst service clients for VigilanteVanguard.
All cloud operations route through Catalyst — no third-party cloud SDKs.
In local dev mode (CATALYST_PROJECT_ID not set) all calls are no-ops / mocked.
"""
from typing import Optional, Any, Dict, List
import json


def _get_catalyst_app():
    """
    Lazy-import and initialise Catalyst SDK.
    On AppSail, catalyst.initialize() works because the runtime injects headers.
    On bare local dev (no Catalyst context), this raises — callers must handle it.
    """
    import zcatalyst_sdk as catalyst
    return catalyst.initialize()


class CatalystDataStore:
    """Wraps Catalyst Data Store (relational) for all FIR/case data."""
    _app = None

    @classmethod
    async def connect(cls):
        try:
            cls._app = _get_catalyst_app()
            print("[Catalyst] Data Store connected")
        except Exception as e:
            print(f"[INFO] Data Store unavailable (dev/offline mode): {type(e).__name__}")
            cls._app = None

    @classmethod
    async def disconnect(cls):
        cls._app = None

    @classmethod
    def get_table(cls, table_name: str):
        return cls._app.datastore().table(table_name)

    @classmethod
    async def insert(cls, table_name: str, row: Dict) -> Dict:
        table = cls.get_table(table_name)
        result = table.insert_row(row)
        return result

    @classmethod
    async def get_by_id(cls, table_name: str, row_id: int) -> Optional[Dict]:
        table = cls.get_table(table_name)
        try:
            return table.get_row(row_id)
        except Exception:
            return None

    @classmethod
    async def query(cls, sql: str) -> List[Dict]:
        zcql = cls._app.zcql()
        return zcql.execute_query(sql)

    @classmethod
    async def update(cls, table_name: str, row_id: int, data: Dict) -> Dict:
        table = cls.get_table(table_name)
        return table.update_row({**data, "ROWID": row_id})

    @classmethod
    async def delete(cls, table_name: str, row_id: int) -> bool:
        table = cls.get_table(table_name)
        table.delete_row(row_id)
        return True


class CatalystCache:
    """Wraps Catalyst Cache for hot-path FIR lookups and dashboard data."""
    _app = None
    _segment = None

    @classmethod
    async def connect(cls):
        try:
            cls._app = _get_catalyst_app()
            cls._segment = cls._app.cache().segment("vv-cache")
            print("[Catalyst] Cache connected")
        except Exception as e:
            print(f"[INFO] Cache unavailable (dev/offline mode): {type(e).__name__}")
            cls._app = None
            cls._segment = None

    @classmethod
    async def get(cls, key: str) -> Optional[str]:
        try:
            result = cls._segment.get_value(key)
            return result
        except Exception:
            return None

    @classmethod
    async def set(cls, key: str, value: str, ttl_seconds: int = 3600):
        cls._segment.put_value(key, value, ttl_seconds)

    @classmethod
    async def delete(cls, key: str):
        try:
            cls._segment.delete_value(key)
        except Exception:
            pass

    @classmethod
    async def get_json(cls, key: str) -> Optional[Any]:
        raw = await cls.get(key)
        if raw:
            return json.loads(raw)
        return None

    @classmethod
    async def set_json(cls, key: str, value: Any, ttl_seconds: int = 3600):
        await cls.set(key, json.dumps(value), ttl_seconds)


class CatalystNoSQL:
    """Wraps Catalyst NoSQL for conversation history, session, AI context."""
    _app = None

    @classmethod
    async def connect(cls):
        try:
            cls._app = _get_catalyst_app()
            print("[Catalyst] NoSQL connected")
        except Exception as e:
            print(f"[INFO] NoSQL unavailable (dev/offline mode): {type(e).__name__}")
            cls._app = None

    @classmethod
    def _table(cls, table_name: str):
        return cls._app.nosql().table(table_name)

    @classmethod
    async def insert(cls, table_name: str, document: Dict) -> Dict:
        return cls._table(table_name).insert_row(document)

    @classmethod
    async def get(cls, table_name: str, key: str) -> Optional[Dict]:
        try:
            return cls._table(table_name).get_row(key)
        except Exception:
            return None

    @classmethod
    async def update(cls, table_name: str, key: str, data: Dict):
        return cls._table(table_name).update_row({**data, "key": key})

    @classmethod
    async def delete(cls, table_name: str, key: str):
        cls._table(table_name).delete_row(key)

    @classmethod
    async def query(cls, table_name: str, filter_expression: str) -> List[Dict]:
        return cls._table(table_name).get_rows_by_filter(filter_expression)


class CatalystStratus:
    """Wraps Catalyst Stratus object storage for all files."""
    _app = None

    @classmethod
    def init(cls):
        cls._app = _get_catalyst_app()

    @classmethod
    def get_bucket(cls, bucket_name: str):
        if not cls._app:
            cls.init()
        return cls._app.stratus().bucket(bucket_name)

    @classmethod
    async def upload_file(cls, bucket_name: str, file_path: str, object_name: str) -> str:
        bucket = cls.get_bucket(bucket_name)
        result = bucket.upload_file(file_path, object_name)
        return result.get("url", "")

    @classmethod
    async def download_file(cls, bucket_name: str, object_name: str, dest_path: str):
        bucket = cls.get_bucket(bucket_name)
        bucket.download_file(object_name, dest_path)

    @classmethod
    async def get_signed_url(cls, bucket_name: str, object_name: str, expiry_seconds: int = 3600) -> str:
        bucket = cls.get_bucket(bucket_name)
        return bucket.get_signed_url(object_name, expiry_seconds)


class CatalystQuickML:
    """Wraps Catalyst QuickML for RAG, LLM inference, semantic search."""
    _app = None

    @classmethod
    def init(cls):
        cls._app = _get_catalyst_app()

    @classmethod
    async def query_knowledge_base(cls, question: str, kb_name: str = "ksp-crime-kb") -> Dict:
        if not cls._app:
            cls.init()
        kb = cls._app.ml().quickml().knowledge_base(kb_name)
        return kb.search(question)

    @classmethod
    async def generate(cls, prompt: str, context: str = "") -> str:
        if not cls._app:
            cls.init()
        llm = cls._app.ml().quickml().llm()
        full_prompt = f"Context: {context}\n\nQuestion: {prompt}" if context else prompt
        result = llm.generate(full_prompt)
        return result.get("response", "")


class CatalystZia:
    """Wraps Catalyst Zia Services for OCR and Vision intelligence."""
    _app = None

    @classmethod
    def init(cls):
        cls._app = _get_catalyst_app()

    @classmethod
    async def ocr_file(cls, file_path: str) -> Dict:
        """Run OCR on a PDF or image file via Catalyst Zia."""
        if not cls._app:
            cls.init()
        zia = cls._app.zia()
        with open(file_path, "rb") as f:
            result = zia.ocr(f)
        return result

    @classmethod
    async def extract_entities(cls, text: str) -> Dict:
        """Use Zia NLP to extract named entities from text."""
        if not cls._app:
            cls.init()
        zia = cls._app.zia()
        return zia.parse_entities(text)


class CatalystZiaSpeech:
    """Wraps Catalyst Zia Speech for English + Kannada voice services."""
    _app = None

    @classmethod
    def init(cls):
        cls._app = _get_catalyst_app()

    @classmethod
    async def speech_to_text(cls, audio_path: str, language: str = "en") -> str:
        """Convert audio to text via Catalyst Zia Speech."""
        if not cls._app:
            cls.init()
        zia = cls._app.zia()
        with open(audio_path, "rb") as f:
            result = zia.speech_to_text(f, language=language)
        return result.get("transcript", "")

    @classmethod
    async def text_to_speech(cls, text: str, language: str = "en") -> bytes:
        """Convert text to speech audio via Catalyst Zia Speech."""
        if not cls._app:
            cls.init()
        zia = cls._app.zia()
        return zia.text_to_speech(text, language=language)


class CatalystSmartBrowz:
    """Wraps Catalyst SmartBrowz for PDF report generation."""
    _app = None

    @classmethod
    def init(cls):
        cls._app = _get_catalyst_app()

    @classmethod
    async def generate_pdf(cls, url: str, output_path: str) -> str:
        """Generate a PDF from a URL using Catalyst SmartBrowz."""
        if not cls._app:
            cls.init()
        sb = cls._app.smartbrowz()
        result = sb.capture_url_as_pdf(url, output_path)
        return result


class CatalystMail:
    """Wraps Catalyst Mail for automated email notifications."""
    _app = None

    @classmethod
    def init(cls):
        cls._app = _get_catalyst_app()

    @classmethod
    async def send(cls, to: List[str], subject: str, body: str, is_html: bool = True):
        if not cls._app:
            cls.init()
        mail = cls._app.mail()
        mail.send_mail(to=to, subject=subject, content=body, is_html=is_html)


class CatalystPush:
    """Wraps Catalyst Push Notifications for real-time alerts."""
    _app = None

    @classmethod
    def init(cls):
        cls._app = _get_catalyst_app()

    @classmethod
    async def notify(cls, device_token: str, title: str, body: str, data: Dict = None):
        if not cls._app:
            cls.init()
        push = cls._app.push_notification()
        push.send(
            device_token=device_token,
            title=title,
            body=body,
            data=data or {}
        )
