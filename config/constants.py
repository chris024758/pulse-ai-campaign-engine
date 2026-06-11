from enum import Enum

class CampaignType(str, Enum):
    WEATHER = "WEATHER"
    PAYDAY = "PAYDAY"
    NEARBY_EVENT = "NEARBY_EVENT"
    SOCIAL_VIRALITY = "SOCIAL_VIRALITY"
    TOURIST_SURGE = "TOURIST_SURGE"
    ANOMALY = "ANOMALY"
    CULTURAL = "CULTURAL"

class TenantCategory(str, Enum):
    FB = "FB"
    FASHION = "FASHION"
    ELECTRONICS = "ELECTRONICS"
    SPORTING = "SPORTING"
    BEAUTY = "BEAUTY"
    ENTERTAINMENT = "ENTERTAINMENT"

class PosSystem(str, Enum):
    SQUARE = "SQUARE"
    TOAST = "TOAST"
    SHOPIFY = "SHOPIFY"
    LIGHTSPEED = "LIGHTSPEED"
    WOOCOMMERCE = "WOOCOMMERCE"

TRIGGER_THRESHOLDS = {
    "temperature_drop_f": 10.0,
    "rain_intensity_inches_per_hour": 0.1,
    "footfall_anomaly_percent": 25.0,
    "trend_spike_percent": 40.0
}

ZONE_DEFINITIONS = {
    "food_court": {"name": "Food Court", "floor": 1, "description": "Central dining and fast food hub"},
    "fashion_floor": {"name": "Fashion Floor", "floor": 2, "description": "High density apparel retailers"},
    "electronics": {"name": "Electronics Zone", "floor": 2, "description": "Consumer electronics & gadget stores"},
    "sporting": {"name": "Sporting Zone", "floor": 1, "description": "Sporting apparel and gear"},
    "beauty": {"name": "Beauty Zone", "floor": 1, "description": "Cosmetics and health stores"},
    "entertainment": {"name": "Entertainment Zone", "floor": 3, "description": "Theatres and arcades"},
    "entrance_zones": {
        "entrance_north": {"name": "North Entrance", "floor": 1},
        "entrance_south": {"name": "South Entrance", "floor": 1},
        "entrance_east": {"name": "East Entrance", "floor": 1},
        "entrance_west": {"name": "West Entrance", "floor": 1}
    }
}

SIGNAL_POLL_INTERVALS = {
    "weather_minutes": 5,
    "trends_minutes": 15,
    "events_minutes": 10,
    "footfall_minutes": 5
}
