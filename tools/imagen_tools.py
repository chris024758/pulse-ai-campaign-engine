import os
import base64
from pathlib import Path
from google import genai
from google.genai import types
from PIL import Image, ImageDraw
import io

OUTPUT_DIR = Path("frontend/assets/generated")

async def generate_ad_image(
    prompt: str,
    tenant_id: str
) -> str:
    """
    Generate ad image via Google Imagen 3.
    Falls back to premade PNG if generation fails.
    """
    fallback_url = f"/assets/creatives/{tenant_id}_ad.png"
    api_key = os.getenv("GEMINI_API_KEY", "")
    
    if not api_key:
        print(f"[ImageGen] No API key — using premade")
        return fallback_url
    
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    try:
        client = genai.Client(api_key=api_key)
        
        response = client.models.generate_images(
            model="imagen-3.0-generate-002",
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="16:9",
                safety_filter_level="block_only_high",
                person_generation="allow_adult"
            )
        )
        
        if not response.generated_images:
            print(f"[ImageGen] No images returned "
                  f"for {tenant_id}")
            return fallback_url
        
        image_bytes = (
            response.generated_images[0]
            .image.image_bytes
        )
        
        if not image_bytes:
            print(f"[ImageGen] Empty bytes "
                  f"for {tenant_id}")
            return fallback_url
        
        filename = f"{tenant_id}_generated.jpg"
        filepath = OUTPUT_DIR / filename
        
        img = Image.open(io.BytesIO(image_bytes))
        img.convert("RGB").save(
            filepath, "JPEG", quality=95
        )
        
        print(f"[ImageGen] ✅ Ad generated "
              f"for {tenant_id}")
        
        composited = composite_logo_on_image(
            str(filepath), tenant_id
        )
        final_filename = Path(composited).name
        return f"/assets/generated/{final_filename}"
        
    except Exception as e:
        error_str = str(e)
        if '429' in error_str or 'QUOTA' in error_str:
            print(f"[ImageGen] Quota limit — "
                  f"using premade for {tenant_id}")
        elif '403' in error_str:
            print(f"[ImageGen] Billing required — "
                  f"using premade for {tenant_id}")
        else:
            print(f"[ImageGen] {tenant_id}: {e}")
        return fallback_url


def composite_logo_on_image(
    image_path: str,
    tenant_id: str,
    corner: str = "bottom-left"
) -> str:
    try:
        logo_path = Path(
            f"frontend/assets/logos/{tenant_id}.png"
        )
        if not logo_path.exists():
            return image_path
        
        base = Image.open(image_path).convert("RGBA")
        base_w, base_h = base.size
        logo = Image.open(logo_path).convert("RGBA")
        
        data = logo.getdata()
        new_data = []
        for r, g, b, a in data:
            if r > 200 and g > 200 and b > 200:
                new_data.append((r, g, b, 0))
            else:
                new_data.append((r, g, b, a))
        logo.putdata(new_data)
        
        logo_h = int(base_h * 0.09)
        logo_ratio = logo.width / logo.height
        logo_w = int(logo_h * logo_ratio)
        logo = logo.resize(
            (logo_w, logo_h), Image.LANCZOS
        )
        
        padding = 12
        pill_w = logo_w + padding * 2
        pill_h = logo_h + padding * 2
        pill = Image.new(
            "RGBA", (pill_w, pill_h), (0,0,0,0)
        )
        pill_draw = ImageDraw.Draw(pill)
        radius = pill_h // 2
        pill_draw.rounded_rectangle(
            [0, 0, pill_w-1, pill_h-1],
            radius=radius,
            fill=(10, 15, 20, 210)
        )
        pill.paste(logo, (padding, padding), logo)
        
        margin = 20
        x = margin
        y = base_h - pill_h - margin
        
        base.paste(pill, (x, y), pill)
        
        output_path = image_path.replace(
            ".jpg", "_logo.jpg"
        )
        base.convert("RGB").save(
            output_path, "JPEG", quality=95
        )
        return output_path
        
    except Exception as e:
        print(f"[Logo] Error: {e}")
        return image_path
