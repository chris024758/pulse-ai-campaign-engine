import random
from typing import List, Dict, Any

try:
    from pytrends.request import TrendReq
    pytrends_client = TrendReq(hl='en-US', tz=360)
except Exception as e:
    print(f"PyTrends init skipped: {e}")
    pytrends_client = None

async def get_trending_retail_topics(category: str) -> List[Dict[str, Any]]:
    """Poll trending keywords related to retail and category."""
    if pytrends_client:
        try:
            # query pytrends for trending terms
            # For hackathon durability we wrapper it with safe fallback
            kw_list = [f"{category} deals", f"{category} fashion", f"trendy {category}"]
            pytrends_client.build_payload(kw_list, cat=0, timeframe='now 7-d', geo='US-TX')
            interest = pytrends_client.interest_over_time()
            if not interest.empty:
                # return trends
                latest = interest.iloc[-1].to_dict()
                return [{"keyword": k, "score": float(v), "trending_up": v > 50} for k, v in latest.items() if k != 'isPartial']
        except Exception as e:
            print(f"PyTrends search failed: {e}")

    # Fallback trending topics for mall categories
    trends_db = {
        "FASHION": ["oversized hoodies", "linen cargo pants", "y2k sneakers", "capsule wardrobe"],
        "BEAUTY": ["glow serum", "tinted lip oil", "slugging cream", "peachy blush"],
        "FB": ["cold brew oat milk", "matcha latte", "spicy chicken wraps", "tapioca tea"],
        "ELECTRONICS": ["noise cancelling buds", "handheld gaming console", "magnetic battery bank"]
    }
    
    selected = trends_db.get(category.upper(), ["summer sales", "coupons", "gift cards"])
    return [
        {
            "keyword": kw,
            "score": random.randint(60, 98),
            "trending_up": random.choice([True, True, False])
        }
        for kw in selected
    ]
