"""
Isolated test: Combined Square product + Gemini tone -> Grok Imagen
Tests the new ad generation flow end to end.
Does NOT modify any PULSE pipeline files.
"""

import asyncio
import httpx
import os
import base64
from pathlib import Path
from google.cloud import bigquery
from dotenv import load_dotenv

load_dotenv()

# -- HARDCODED TEST DATA -----------------------------------------------------
# Simulating what orchestrator will pass after wiring

# From Gemini ad_creatives response
AD_CREATIVES = {
    "S17": {
        "tone": "Warm golden bokeh background with a dark velvet surface. Intimate close-up lighting creates a celebration mood with a soft graduation shimmer in the background.",
        "tagline": "The gift they will remember.",
        "tagline_style": "elegant serif, bottom third centered, white text with soft gold glow"
    },
    "S07": {
        "tone": "Ultra-minimalist architecture with sharp clean lines and brilliant white light. A sleek metallic monochromatic palette reflecting high-end sophistication and modern achievements.",
        "tagline": "Designed differently.",
        "tagline_style": "modern sans-serif, top right aligned, matte silver text with sharp drop shadow"
    }
}

# SKU map for Square lookup
TENANT_SKU_MAP = {
    "S17": "S17-AUR",
    "S07": "S07-APX",
}

def get_square_product(tenant_id: str) -> dict:
    """
    Pull product name and description from Square
    via BigQuery for the given tenant.
    """
    sku = TENANT_SKU_MAP.get(tenant_id, "")
    if not sku:
        return {"name": "Unknown Product", "description": ""}

    try:
        project = os.getenv("GOOGLE_CLOUD_PROJECT")
        client = bigquery.Client(project=project)
        query = f"""
        SELECT
            i.name,
            i.description,
            v.price_money_amount
        FROM `square_catalog.catalog_item` i
        JOIN `square_catalog.catalog_item_variation` v
            ON v.item_id = i.id
        WHERE v.sku = '{sku}'
        LIMIT 1
        """
        rows = list(client.query(query).result())
        if rows:
            row = rows[0]
            return {
                "name": row.name,
                "description": row.description or "",
                "price": (row.price_money_amount or 0) / 100
            }
    except Exception as e:
        print(f"[Square] Error fetching {tenant_id}: {e}")

    return {"name": "Unknown Product", "description": ""}

def build_imagen_prompt(tenant_id: str, product: dict, creative: dict) -> str:
    """
    Combine Square product + Gemini tone into final Grok Imagen prompt.
    """
    prompt = (
        f"{product['description']}. "
        f"{creative['tone']} "
        f"Include text overlay: \"{creative['tagline']}\" "
        f"in {creative['tagline_style']}. "
        f"16:9 landscape DOOH digital billboard format. "
        f"Photorealistic professional advertising photography. "
        f"No additional logos or watermarks."
    )
    return prompt

async def generate_image(prompt: str, tenant_id: str, output_dir: Path) -> str:
    """Call Grok Imagen via OpenRouter."""
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        print(f"[ImageGen] No API key")
        return ""

    print(f"\n[ImageGen] Generating for {tenant_id}...")
    print(f"[ImageGen] Prompt: {prompt[:150]}...")

    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://pulse-mall.ai",
                "X-Title": "PULSE"
            },
            json={
                "model": "x-ai/grok-imagine-image-quality",
                "messages": [{"role": "user", "content": prompt}]
            }
        )

        print(f"[ImageGen] Status: {resp.status_code}")

        if resp.status_code == 200:
            data = resp.json()
            images = data["choices"][0]["message"].get("images", [])
            if images:
                b64 = images[0]["image_url"]["url"].split(",", 1)[1]
                filename = output_dir / f"{tenant_id}_test.jpg"
                with open(filename, "wb") as f:
                    f.write(base64.b64decode(b64))
                print(f"[ImageGen] Saved: {filename}")
                return str(filename)
        else:
            print(f"[ImageGen] Failed: {resp.text[:300]}")
        return ""

async def main():
    print("=" * 60)
    print("COMBINED IMAGEN TEST")
    print("Square product + Gemini tone -> Grok image")
    print("=" * 60)

    output_dir = Path("tests/output")
    output_dir.mkdir(parents=True, exist_ok=True)

    for tenant_id, creative in AD_CREATIVES.items():
        print(f"\n{'-'*60}")
        print(f"Processing: {tenant_id}")

        # Step 1: Get product from Square
        print(f"\n[1] Fetching Square product...")
        product = get_square_product(tenant_id)
        print(f"   Name: {product['name']}")
        print(f"   Description: {product['description']}")

        # Step 2: Build combined prompt
        print(f"\n[2] Building Imagen prompt...")
        prompt = build_imagen_prompt(tenant_id, product, creative)
        print(f"   Full prompt: {prompt}")

        # Step 3: Generate image
        print(f"\n[3] Calling Grok Imagen...")
        result = await generate_image(prompt, tenant_id, output_dir)

        if result:
            print(f"\nOK {tenant_id} complete -> {result}")
        else:
            print(f"\nFAILED {tenant_id}")

    print(f"\n{'='*60}")
    print(f"Test complete -- check tests/output/ for generated images")
    print(f"No PULSE files modified")
    print(f"{'='*60}")

if __name__ == "__main__":
    asyncio.run(main())
