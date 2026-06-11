import asyncio
import httpx
import os
import base64
from dotenv import load_dotenv

load_dotenv()

async def test_grok_imagine():
    api_key = os.getenv("OPENROUTER_API_KEY", "")

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/images/generations",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://pulse-mall.ai",
                "X-Title": "PULSE"
            },
            json={
                "model": "x-ai/grok-imagine-image-quality",
                "prompt": "A sleek premium laptop on dark surface, dramatic lighting, 16:9 billboard format, photorealistic, no text",
                "n": 1,
                "size": "1024x576"
            }
        )

        print(f"Status: {resp.status_code}")
        print(f"Response: {resp.text[:500]}")

        if resp.status_code == 200:
            data = resp.json()
            print(f"Keys: {list(data.keys())}")
            if "data" in data:
                print(f"Data[0] keys: {list(data['data'][0].keys())}")

asyncio.run(test_grok_imagine())
