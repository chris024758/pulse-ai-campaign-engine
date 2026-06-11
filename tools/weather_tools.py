import os
import random
import httpx
from datetime import date as dt
from config.settings import settings

# Dallas seasonal weather RANGES (min, max temp_f, possible conditions list)
DALLAS_SEASONAL_RANGES = {
    1:  {"min": 35, "max": 58, "conditions": ["cold and cloudy", "cold with light rain", "cold and overcast", "chilly with fog"], "rain_chance": 0.40},
    2:  {"min": 38, "max": 62, "conditions": ["cool and rainy", "cool and cloudy", "chilly with showers", "mild and overcast"], "rain_chance": 0.42},
    3:  {"min": 48, "max": 72, "conditions": ["mild and breezy", "partly cloudy", "mild with scattered showers", "warm and pleasant"], "rain_chance": 0.35},
    4:  {"min": 58, "max": 78, "conditions": ["warm and sunny", "warm with afternoon storms", "pleasant and breezy", "partly cloudy"], "rain_chance": 0.30},
    5:  {"min": 66, "max": 85, "conditions": ["warm and sunny", "hot and humid", "warm with scattered storms", "sunny and breezy"], "rain_chance": 0.25},
    6:  {"min": 74, "max": 95, "conditions": ["hot and sunny", "very hot", "hot with afternoon thunderstorms", "scorching and clear"], "rain_chance": 0.20},
    7:  {"min": 80, "max": 100, "conditions": ["very hot and sunny", "scorching heat", "hot and dry", "extreme heat"], "rain_chance": 0.12},
    8:  {"min": 79, "max": 99, "conditions": ["very hot", "hot and humid", "hot with late storms", "scorching"], "rain_chance": 0.14},
    9:  {"min": 68, "max": 90, "conditions": ["warm and sunny", "hot with cooling trend", "warm and pleasant", "mild afternoons"], "rain_chance": 0.20},
    10: {"min": 54, "max": 76, "conditions": ["cool and pleasant", "mild and sunny", "crisp fall day", "partly cloudy"], "rain_chance": 0.28},
    11: {"min": 42, "max": 65, "conditions": ["cool and overcast", "chilly with rain", "cool and windy", "cold fronts possible"], "rain_chance": 0.38},
    12: {"min": 34, "max": 58, "conditions": ["cold and rainy", "cold and overcast", "cold with possible sleet", "chilly and grey"], "rain_chance": 0.40},
}

def _get_random_weather_for_month(month: int) -> dict:
    """Generate a random but realistic weather reading for a given Dallas month."""
    ranges = DALLAS_SEASONAL_RANGES.get(month, DALLAS_SEASONAL_RANGES[6])
    temp = random.randint(ranges["min"], ranges["max"])
    conditions = random.choice(ranges["conditions"])
    rain_chance = ranges["rain_chance"]
    
    # Derive rain intensity from temp and conditions
    is_raining = "rain" in conditions or "shower" in conditions or "storm" in conditions
    rain_intensity = round(random.uniform(0.05, 0.25), 2) if is_raining else round(random.uniform(0.0, 0.03), 2)
    
    # Derive mood
    if temp >= 85:
        mood = "summer_heat"
    elif temp >= 70:
        mood = "summer_energy"
    elif temp >= 55:
        mood = "spring_fresh" if month <= 6 else "fall_transition"
    elif temp >= 42:
        mood = "fall_cozy"
    else:
        mood = "cold_comfort"
    
    return {
        "temp_f": temp,
        "conditions": conditions,
        "rain_chance": rain_chance,
        "rain_intensity": rain_intensity,
        "mood": mood,
        "source": "seasonal_estimate"
    }

async def get_current_weather(lat: float, lng: float, target_date: str = None, use_real_api: bool = False) -> dict:
    """
    Get weather for a location and date.
    If use_real_api=True and GOOGLE_WEATHER_API_KEY is set, calls real Google Weather API.
    Otherwise uses seasonal estimate.
    """
    # Determine month from target_date or today
    if target_date:
        try:
            d = dt.fromisoformat(target_date)
            month = d.month
        except:
            month = dt.today().month
    else:
        month = dt.today().month

    # Try real API only if explicitly toggled on
    if use_real_api:
        api_key = os.environ.get("GOOGLE_WEATHER_API_KEY", "") or getattr(settings, 'google_maps_api_key', '')
        if api_key:
            try:
                url = "https://weather.googleapis.com/v1/currentConditions:lookup"
                params = {
                    "key": api_key,
                    "location.latitude": lat,
                    "location.longitude": lng,
                }
                async with httpx.AsyncClient(timeout=8.0) as client:
                    response = await client.get(url, params=params)
                    if response.status_code == 200:
                        data = response.json()
                        temp_c = data.get("temperature", {}).get("degrees", 20)
                        temp_f = round(temp_c * 9/5 + 32)
                        conditions = data.get("weatherCondition", {}).get("description", {}).get("text", "partly cloudy")
                        return {
                            "temp_f": temp_f,
                            "conditions": conditions.lower(),
                            "rain_chance": 0.2,
                            "rain_intensity": 0.05,
                            "mood": "live_data",
                            "source": "google_weather_api"
                        }
            except Exception as e:
                print(f"Weather API failed: {e}. Using seasonal estimate.")
        else:
            print("[Weather] Real API toggled ON but no API key — using estimate")

    # Fallback: random seasonal estimate
    weather = _get_random_weather_for_month(month)
    print(f"Weather: Using seasonal estimate for month {month} -> {weather['temp_f']}F, {weather['conditions']}")
    return weather

def get_weather_sync(lat: float, lng: float, target_date: str = None) -> dict:
    """Synchronous version for non-async contexts."""
    if target_date:
        try:
            d = dt.fromisoformat(target_date)
            month = d.month
        except:
            month = dt.today().month
    else:
        month = dt.today().month
    return _get_random_weather_for_month(month)
