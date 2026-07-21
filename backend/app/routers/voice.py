"""
Voice Assistant API — VigilanteVanguard
English + Kannada speech-to-text and text-to-speech via Catalyst Zia Speech Services.
"""
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import Response
import tempfile
import os

from app.core.catalyst import CatalystZiaSpeech, CatalystQuickML, CatalystNoSQL
from app.core.auth import AuthUser, verify_catalyst_token

router = APIRouter()


@router.post("/transcribe", summary="Speech-to-text (English or Kannada)")
async def transcribe_audio(
    audio: UploadFile = File(...),
    language: str = Form("en"),  # "en" or "kn"
    session_id: str = Form(...),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Transcribes audio to text using Catalyst Zia Speech Services.
    Supports English (en) and Kannada (kn).
    """
    if language not in ("en", "kn"):
        raise HTTPException(status_code=400, detail="Language must be 'en' or 'kn'")

    # Save to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        transcript = await CatalystZiaSpeech.speech_to_text(tmp_path, language=language)
    finally:
        os.unlink(tmp_path)

    if not transcript:
        raise HTTPException(status_code=422, detail="Could not transcribe audio")

    # Process the query through the AI assistant
    answer = await CatalystQuickML.generate(transcript)

    # Store in conversation history (Catalyst NoSQL)
    await CatalystNoSQL.insert("conversation_history", {
        "key": f"voice:{session_id}:{int(os.times()[0])}",
        "session_id": session_id,
        "language": language,
        "user_text": transcript,
        "ai_response": answer,
    })

    return {
        "transcript": transcript,
        "answer": answer,
        "language": language,
        "session_id": session_id,
    }


@router.post("/speak", summary="Text-to-speech (English or Kannada)")
async def text_to_speech(
    text: str = Form(...),
    language: str = Form("en"),
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """
    Converts text to audio using Catalyst Zia Speech Services.
    Returns audio/wav bytes directly.
    """
    if language not in ("en", "kn"):
        raise HTTPException(status_code=400, detail="Language must be 'en' or 'kn'")

    audio_bytes = await CatalystZiaSpeech.text_to_speech(text, language=language)
    return Response(content=audio_bytes, media_type="audio/wav")
