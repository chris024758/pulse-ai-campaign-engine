import asyncio
import os
from google import genai
from google.genai import types

async def call_gemini_flash(
    prompt: str,
    system_instruction: str = ""
) -> str:
    """
    Call Gemini 2.5 Flash directly via Google AI SDK.
    Uses GEMINI_API_KEY only.
    """
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        raise ValueError(
            "GEMINI_API_KEY not set in .env — "
            "get key from aistudio.google.com/apikey"
        )

    client = genai.Client(api_key=api_key)

    try:
        config = types.GenerateContentConfig(
            temperature=0.7,
            max_output_tokens=8000,
            response_mime_type="application/json",
        )
        if system_instruction:
            config.system_instruction = system_instruction
    except Exception:
        config = types.GenerateContentConfig(
            temperature=0.7,
            max_output_tokens=8000,
        )
        if system_instruction:
            config.system_instruction = system_instruction

    last_error = None
    for attempt in range(4):
        try:
            if attempt > 0:
                wait = 3 * attempt
                print(f"[Gemini] Retry {attempt}/3 "
                      f"after {wait}s...")
                await asyncio.sleep(wait)

            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=config
            )
            print("[Gemini] ✅ Response received")
            return response.text

        except Exception as e:
            last_error = e
            error_str = str(e)
            if '503' in error_str or \
               'UNAVAILABLE' in error_str or \
               'high demand' in error_str:
                print(f"[Gemini] Temporary unavailability "
                      f"— attempt {attempt+1}/4")
                continue
            else:
                raise Exception(
                    f"Gemini API error: {e}"
                )

    raise Exception(
        f"Gemini unavailable after 4 attempts: "
        f"{last_error}"
    )
