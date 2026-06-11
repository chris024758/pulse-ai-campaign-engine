"""
Isolated TTS test — generates announcement audio
and verifies it plays correctly.
Does NOT modify any PULSE pipeline files.
"""

import asyncio
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()

# Test announcement text
TEST_ANNOUNCEMENT = (
    "Attention Galleria Dallas shoppers. "
    "Celebrate graduation milestones with our "
    "exclusive evening offers. Visit Aurel for "
    "complimentary gift wrapping on timeless jewelry, "
    "and head to Apex Tech for a free accessory bundle "
    "with any tech purchase. Thank you for shopping "
    "at Galleria Dallas."
)

async def test_tts_generation():
    print("=" * 55)
    print("TTS ISOLATION TEST")
    print("=" * 55)

    # Check API key
    api_key = os.getenv("GEMINI_API_KEY", "")
    print(f"\n[1] GEMINI_API_KEY: "
          f"{'✅ Set' if api_key else '❌ Not set'}")

    if not api_key:
        print("   Cannot test TTS without API key")
        print("   Set GEMINI_API_KEY in .env first")
        return

    # Check google-genai SDK
    print("\n[2] Checking google-genai SDK...")
    try:
        from google import genai
        from google.genai import types
        import google.genai as genai_module
        print(f"   ✅ google-genai installed")
        try:
            print(f"   Version: {genai_module.__version__}")
        except Exception:
            print(f"   Version: unknown")
    except ImportError as e:
        print(f"   ❌ Not installed: {e}")
        print("   Run: pip install google-genai")
        return

    # Test TTS generation
    print("\n[3] Generating TTS audio...")
    print(f"   Text: {TEST_ANNOUNCEMENT[:60]}...")

    try:
        client = genai.Client(api_key=api_key)

        response = client.models.generate_content(
            model="gemini-2.5-flash-preview-tts",
            contents=TEST_ANNOUNCEMENT,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name="Despina"
                        )
                    )
                )
            )
        )

        # Extract audio data
        audio_data = None
        try:
            audio_data = (
                response.candidates[0]
                .content.parts[0]
                .inline_data.data
            )
        except Exception as _e:
            print(f"   ❌ Could not extract audio: {_e}")
            print(f"   Response: {response}")
            return

        if not audio_data:
            print("   ❌ No audio data in response")
            return

        print(f"   ✅ Audio generated: "
              f"{len(audio_data)} bytes")

    except Exception as e:
        print(f"   ❌ TTS API failed: {e}")
        return

    # Save to test output
    print("\n[4] Saving audio file...")
    try:
        output_dir = Path("tests/output")
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "test_announcement.wav"

        with open(output_path, "wb") as f:
            f.write(audio_data)

        file_size = output_path.stat().st_size
        print(f"   ✅ Saved: {output_path}")
        print(f"   Size: {file_size:,} bytes "
              f"({file_size/1024:.1f} KB)")

        if file_size < 1000:
            print("   ⚠️  File seems too small — "
                  "may be empty or corrupt")
        else:
            print("   ✅ File size looks good")

    except Exception as e:
        print(f"   ❌ Save failed: {e}")
        return

    # Copy to frontend assets for browser test
    print("\n[5] Copying to frontend for browser test...")
    try:
        frontend_audio = Path(
            "frontend/assets/audio/test_tts.wav"
        )
        frontend_audio.parent.mkdir(
            parents=True, exist_ok=True
        )

        import shutil
        shutil.copy(output_path, frontend_audio)
        print(f"   ✅ Copied to: {frontend_audio}")
        print(f"   Browser URL: /assets/audio/test_tts.wav")
        print(f"\n   To test in browser, open browser console")
        print(f"   and run:")
        print(f"   new Audio('/assets/audio/test_tts.wav')"
              f".play()")

    except Exception as e:
        print(f"   ❌ Copy failed: {e}")

    # Test the tts_tools module directly
    print("\n[6] Testing tts_tools module...")
    try:
        sys.path.insert(0, str(Path.cwd()))
        from tools.tts_tools import (
            generate_announcement_audio,
            cleanup_tts_files
        )
        print("   ✅ tts_tools imported successfully")

        print("   Running generate_announcement_audio()...")
        result = await generate_announcement_audio(
            TEST_ANNOUNCEMENT,
            campaign_id="TEST001"
        )

        if result:
            print(f"   ✅ Returned URL: {result}")
            # Check file exists
            file_path = Path("frontend") / result.lstrip("/")
            if file_path.exists():
                print(f"   ✅ File exists at: {file_path}")
                print(f"   Size: "
                      f"{file_path.stat().st_size:,} bytes")
            else:
                print(f"   ❌ File not found at: {file_path}")
        else:
            print("   ❌ Returned empty URL")

    except Exception as e:
        print(f"   ❌ tts_tools test failed: {e}")
        import traceback
        traceback.print_exc()

    # Check dummy fallback
    print("\n[7] Checking dummy fallback...")
    dummy = Path("frontend/assets/audio/announcement.mp3")
    if dummy.exists():
        print(f"   ✅ Dummy announcement.mp3 exists "
              f"({dummy.stat().st_size:,} bytes)")
    else:
        print(f"   ❌ Dummy announcement.mp3 NOT found")
        print(f"   Create: frontend/assets/audio/"
              f"announcement.mp3")
        print(f"   Any short MP3 file will work as fallback")

    print(f"\n{'='*55}")
    print("TTS Test Complete")
    print(f"{'='*55}\n")

if __name__ == "__main__":
    asyncio.run(test_tts_generation())
