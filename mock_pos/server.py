import os
import random
import datetime
from flask import Flask, jsonify, request

app = Flask(__name__)

# Base synthetic directory
SYNTHETIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "synthetic")

# Time-varying dynamic state
start_time = datetime.datetime.now()
inventory_drift = {}  # sku -> decrements

def get_drifted_qty(sku: str, base_qty: int) -> int:
    # Simulates items selling over time
    elapsed_minutes = (datetime.datetime.now() - start_time).total_seconds() / 60.0
    # ~1 item sold every 3 minutes for high velocity
    sales = int(elapsed_minutes / 3.0)
    # Add some random variance per SKU
    random.seed(sku)
    sku_rate = random.uniform(0.1, 0.5)
    total_deducted = int(sales * sku_rate)
    return max(0, base_qty - total_deducted)

@app.route("/square/transactions", methods=["GET"])
def get_square_transactions():
    """Mimics Square Transactions API."""
    import pandas as pd
    csv_path = os.path.join(SYNTHETIC_DIR, "square_transactions.csv")
    if not os.path.exists(csv_path):
        return jsonify({"errors": [{"detail": "Transactions seed not found"}]}), 404
        
    df = pd.read_csv(csv_path)
    # Add a couple of dynamic real-time transactions at the end
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    dynamic_txs = [
        {
            "tenant_id": "lumiere_beauty",
            "store_name": "Lumière Beauty",
            "item_category": "BEAUTY",
            "amount": round(random.uniform(45.0, 150.0), 2),
            "quantity": random.randint(1, 3),
            "timestamp": now,
            "zone": "beauty"
        },
        {
            "tenant_id": "cineplex_grand",
            "store_name": "Cineplex Grand Theatres",
            "item_category": "ENTERTAINMENT",
            "amount": round(random.uniform(20.0, 60.0), 2),
            "quantity": random.randint(1, 4),
            "timestamp": now,
            "zone": "entertainment"
        }
    ]
    
    # Read last 50 transactions + append dynamic ones
    records = df.tail(48).to_dict(orient="records") + dynamic_txs
    return jsonify({
        "transactions": [
            {
                "id": f"sq-tx-{idx}",
                "location_id": r["tenant_id"],
                "created_at": r["timestamp"],
                "total_money": {"amount": int(r["amount"] * 100), "currency": "USD"},
                "line_items": [
                    {
                        "name": f"{r['item_category']} Item",
                        "quantity": str(r["quantity"]),
                        "total_money": {"amount": int(r["amount"] * 100), "currency": "USD"}
                    }
                ],
                "metadata": {"zone": r["zone"], "store_name": r["store_name"]}
            }
            for idx, r in enumerate(records)
        ]
    })

@app.route("/toast/orders", methods=["GET"])
def get_toast_orders():
    """Mimics Toast Orders API."""
    import pandas as pd
    csv_path = os.path.join(SYNTHETIC_DIR, "toast_fb_data.csv")
    if not os.path.exists(csv_path):
        return jsonify([])
        
    df = pd.read_csv(csv_path)
    records = df.tail(40).to_dict(orient="records")
    
    return jsonify([
        {
            "id": f"toast-ord-{idx}",
            "openedDate": r["timestamp"],
            "closedDate": r["timestamp"],
            "numberOfGuests": r["covers"],
            "totals": {
                "subtotal": r["revenue"],
                "tax": round(r["revenue"] * 0.0825, 2),
                "tips": round(r["revenue"] * 0.18, 2),
                "grandTotal": round(r["revenue"] * 1.2625, 2)
            },
            "source": "IN_STORE",
            "diningOption": "DINE_IN",
            "checks": [
                {
                    "items": [
                        {"name": item.strip(), "quantity": 1}
                        for item in r["items_ordered"].split(",")
                    ]
                }
            ],
            "metadata": {"tenant_id": r["tenant_id"], "store_name": r["store_name"], "zone": r["zone"]}
        }
        for idx, r in enumerate(records)
    ])

@app.route("/shopify/inventory", methods=["GET"])
def get_shopify_inventory():
    """Mimics Shopify inventory levels endpoint."""
    import pandas as pd
    csv_path = os.path.join(SYNTHETIC_DIR, "shopify_inventory.csv")
    if not os.path.exists(csv_path):
        return jsonify({"inventory_levels": []})
        
    df = pd.read_csv(csv_path)
    levels = []
    for idx, row in df.iterrows():
        base_qty = int(row["quantity_available"])
        current_qty = get_drifted_qty(row["sku"], base_qty)
        levels.append({
            "inventory_item_id": f"inv-item-{row['sku']}",
            "location_id": row["tenant_id"],
            "available": current_qty,
            "updated_at": row["last_updated"],
            "sku": row["sku"],
            "product_name": row["product_name"]
        })
    return jsonify({"inventory_levels": levels})

@app.route("/lightspeed/items", methods=["GET"])
def get_lightspeed_items():
    """Mimics Lightspeed items endpoint."""
    import pandas as pd
    csv_path = os.path.join(SYNTHETIC_DIR, "lightspeed_catalog.csv")
    if not os.path.exists(csv_path):
        return jsonify({"Item": []})
        
    df = pd.read_csv(csv_path)
    items = []
    for idx, row in df.iterrows():
        base_qty = int(row["quantity_available"])
        current_qty = get_drifted_qty(row["sku"], base_qty)
        items.append({
            "itemID": f"ls-{idx}",
            "systemSku": row["sku"],
            "description": row["product_name"],
            "ItemShops": {
                "ItemShop": {
                    "qoh": current_qty,
                    "shopID": row["tenant_id"]
                }
            },
            "categoryID": row["category"]
        })
    return jsonify({"Item": items})

@app.route("/footfall/zones", methods=["GET"])
def get_footfall_zones():
    """Mimics IoT footfall sensors with realistic time-of-day counts."""
    # Peak hours: lunch (12-14) or dinner/evening (17-20)
    current_hour = datetime.datetime.now().hour
    zones = ["food_court", "fashion_floor", "electronics", "sporting", "beauty", "entertainment"]
    
    output = []
    for zone in zones:
        if 12 <= current_hour <= 14:
            base = random.randint(120, 260)
        elif 18 <= current_hour <= 20:
            base = random.randint(150, 320)
        else:
            base = random.randint(25, 90)
            
        # Add dynamic live anomaly 5% of the time for entertainment/sporting
        if zone in ("entertainment", "sporting") and random.random() < 0.15:
            # Huge anomaly trigger (e.g. 2.5x base)
            base = int(base * random.uniform(2.1, 2.9))
            
        output.append({
            "zone_id": zone,
            "zone_name": zone.replace("_", " ").title(),
            "visitor_count": base,
            "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
    return jsonify(output)

if __name__ == "__main__":
    # Runs on port 5001 as specified
    app.run(host="0.0.0.0", port=5001, debug=True)
