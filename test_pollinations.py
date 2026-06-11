import asyncio
import httpx
import urllib.parse

async def test_pollinations():
    prompt = "A sleek premium laptop on a dark surface, dramatic lighting, 16:9 billboard format"
    encoded = urllib.parse.quote(prompt)
    seed = 12345

    url = (
        f"https://image.pollinations.ai/prompt/{encoded}"
        f"?width=1024&height=576&nologo=true&seed={seed}&model=flux"
    )

    print(f"Testing URL: {url[:100]}...")

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.get(url, follow_redirects=True)
            print(f"Status: {resp.status_code}")
            print(f"Content-Type: {resp.headers.get('content-type', 'unknown')}")
            print(f"Content size: {len(resp.content)} bytes")
            print(f"Success: {resp.status_code == 200 and len(resp.content) > 1000}")
            if resp.status_code != 200:
                print(f"Response body: {resp.text[:1000]}")
        except Exception as e:
            print(f"Error: {e}")

asyncio.run(test_pollinations())
