from google.cloud import translate_v2 as translate
from config.settings import settings
import os

translate_client = None
try:
    if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or os.environ.get("GOOGLE_CLOUD_PROJECT"):
        translate_client = translate.Client()
except Exception as e:
    print(f"Translate client setup skipped: {e}")

async def translate_text(text: str, target_language: str = "es") -> str:
    """Translates campaign briefs into target languages (e.g. Spanish for tourist surges)."""
    if translate_client:
        try:
            result = translate_client.translate(text, target_language=target_language)
            return result["translatedText"]
        except Exception as e:
            print(f"Translation failed: {e}")

    # Fallback dictionary translations for Spanish (mocking a translation engine)
    spanish_phrases = {
        "Stay Cozy, Stay Stylin'": "Mantente Abrigado, Mantente con Estilo",
        "Payday Upgrade Event": "Evento de Actualización en el Día de Pago",
        "Galleria Mall Live Buzz": "Zumbido en Vivo del Centro Comercial Galleria",
        "Coffee Deals": "Ofertas de Café"
    }
    return spanish_phrases.get(text, f"[Translated to {target_language}]: {text}")
