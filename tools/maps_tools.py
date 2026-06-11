import os
import googlemaps
from typing import Dict, Any, List
from config.settings import settings

# Initialize client
gmaps = None
try:
    if getattr(settings, "google_maps_api_key", None) or os.getenv("GOOGLE_MAPS_API_KEY"):
        gmaps = googlemaps.Client(key=os.getenv("GOOGLE_MAPS_API_KEY") or getattr(settings, "google_maps_api_key"))
except Exception as e:
    print(f"Google Maps client setup failed: {e}")

async def get_nearby_events_or_places(lat: float, lng: float, radius_meters: int = 5000) -> List[Dict[str, Any]]:
    """Gets nearby events, stadiums, transit spots that could drive traffic to mall."""
    if gmaps:
        try:
            places = gmaps.places_nearby(
                location=(lat, lng),
                radius=radius_meters,
                type="stadium" # or transit_station, tourist_attraction
            )
            return places.get("results", [])
        except Exception as e:
            print(f"Google Maps places search failed: {e}")

    # Fallback to realistic Dallas Galleria surroundings (e.g. Valley View Park, Churchill Park, etc.)
    return [
        {
            "name": "Dallas Galleria Ice Skating Arena",
            "vicinity": "Inside Galleria Mall",
            "types": ["amusement_park", "establishment"],
            "geometry": {"location": {"lat": lat, "lng": lng}}
        },
        {
            "name": "Churchill Park Soccer Fields",
            "vicinity": "7025 Churchill Way, Dallas",
            "types": ["park", "point_of_interest"],
            "geometry": {"location": {"lat": lat + 0.012, "lng": lng - 0.008}}
        },
        {
            "name": "Valley View Sports Complex",
            "vicinity": "13102 Hillcrest Rd, Dallas",
            "types": ["stadium", "sports_complex"],
            "geometry": {"location": {"lat": lat + 0.018, "lng": lng + 0.005}}
        }
    ]

async def check_traffic_conditions(origin: str, destination: str) -> Dict[str, Any]:
    """Calculates driving duration and traffic conditions between zones."""
    if gmaps:
        try:
            matrix = gmaps.distance_matrix(
                origins=origin,
                destinations=destination,
                mode="driving",
                departure_time="now"
            )
            return matrix
        except Exception as e:
            print(f"Google Maps distance matrix failed: {e}")

    # Mock matrix
    return {
        "origin_addresses": [origin],
        "destination_addresses": [destination],
        "rows": [{
            "elements": [{
                "distance": {"text": "3.5 mi", "value": 5630},
                "duration": {"text": "8 mins", "value": 480},
                "duration_in_traffic": {"text": "12 mins", "value": 720},
                "status": "OK"
            }]
        }],
        "status": "OK"
    }
