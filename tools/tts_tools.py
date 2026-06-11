import os
import asyncio
from pathlib import Path
from google import genai

TTS_OUTPUT_DIR = Path("frontend/assets/audio")

def cleanup_tts_files():
    """Delete generated TTS files but keep the dummy."""
    if TTS_OUTPUT_DIR.exists():
        for f in TTS_OUTPUT_DIR.glob("*.wav"):
            f.unlink()
        for f in TTS_OUTPUT_DIR.glob("*.mp3"):
            if f.name != "announcement.mp3":
                f.unlink()
        print("[TTS] Cleaned up generated audio files")
    TTS_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

async def generate_announcement_audio(
    announcement_text: str,
    campaign_id: str = "campaign"
) -> str:
    """
    Generate TTS audio via Gemini 2.5 Flash TTS.
    Falls back to dummy announcement.mp3 if no API key.
    """
    api_key = os.getenv("GEMINI_API_KEY", "")

    dummy_audio = "/assets/audio/announcement.mp3"
    dummy_path = Path("frontend/assets/audio/announcement.mp3")

    if not api_key:
        print("[TTS] No GEMINI_API_KEY — using dummy announcement audio")
        if dummy_path.exists():
            return dummy_audio
        else:
            print("[TTS] WARNING: dummy announcement.mp3 not found either")
            return ""

    TTS_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_filename = f"announcement_{campaign_id}.wav"
    output_path = TTS_OUTPUT_DIR / output_filename

    try:
        client = genai.Client(api_key=api_key)

        response = client.models.generate_content(
            model="gemini-2.5-flash-preview-tts",
            contents=announcement_text,
            config=genai.types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=genai.types.SpeechConfig(
                    voice_config=genai.types.VoiceConfig(
                        prebuilt_voice_config=genai.types.PrebuiltVoiceConfig(
                            voice_name="Despina"
                        )
                    )
                )
            )
        )

        audio_data = response.candidates[0].content.parts[0].inline_data.data

        with open(output_path, "wb") as f:
            f.write(audio_data)

        local_url = f"/assets/audio/{output_filename}"
        print(f"[TTS] Generated: {local_url} ({len(audio_data)} bytes)")
        return local_url

    except Exception as e:
        print(f"[TTS] API failed: {e} — falling back to dummy audio")
        if dummy_path.exists():
            return dummy_audio
        return ""
