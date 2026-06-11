import os
import csv
import random
from datetime import datetime, timedelta

def generate_data():
    os.makedirs("data/synthetic", exist_ok=True)
    
    # 1. square_transactions.csv
    # use: Brewpoint Coffee, Golden Fork, PaceStep, Lumière Beauty, Apex Tech, Atelier M, Verdure, Bloom & Co, PixelVault, Cineplex Grand
    square_tenants = [
        {"id": "brewpoint_coffee", "name": "Brewpoint Coffee", "category": "FB", "zone": "food_court"},
        {"id": "golden_fork", "name": "Golden Fork", "category": "FB", "zone": "food_court"},
        {"id": "pace_step", "name": "PaceStep", "category": "SPORTING", "zone": "sporting"},
        {"id": "lumiere_beauty", "name": "Lumière Beauty", "category": "BEAUTY", "zone": "beauty"},
        {"id": "apex_tech", "name": "Apex Tech", "category": "ELECTRONICS", "zone": "electronics"},
        {"id": "atelier_m", "name": "Atelier M", "category": "BEAUTY", "zone": "beauty"},
        {"id": "verdure", "name": "Verdure", "category": "BEAUTY", "zone": "beauty"},
        {"id": "bloom_and_co", "name": "Bloom & Co", "category": "BEAUTY", "zone": "beauty"},
        {"id": "pixel_vault", "name": "PixelVault", "category": "ENTERTAINMENT", "zone": "entertainment"},
        {"id": "cineplex_grand", "name": "Cineplex Grand", "category": "ENTERTAINMENT", "zone": "entertainment"}
    ]
    
    with open("data/synthetic/square_transactions.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["tenant_id", "store_name", "item_category", "amount", "quantity", "timestamp", "zone"])
        
        now = datetime.now()
        for i in range(500):
            tenant = random.choice(square_tenants)
            days_ago = random.randint(0, 30)
            hour = random.choice([10, 11, 12, 12, 13, 13, 14, 15, 16, 17, 17, 18, 18, 19, 19, 20, 21])
            minute = random.randint(0, 59)
            second = random.randint(0, 59)
            tx_time = now - timedelta(days=days_ago)
            tx_time = tx_time.replace(hour=hour, minute=minute, second=second)
            
            is_weekend = tx_time.weekday() >= 5
            base_amount = 15.0 if tenant["category"] == "FB" else 60.0
            if is_weekend:
                base_amount *= random.uniform(1.2, 1.8)
            else:
                base_amount *= random.uniform(0.8, 1.2)
                
            qty = random.randint(1, 4)
            amount = round(base_amount * qty, 2)
            
            writer.writerow([
                tenant["id"],
                tenant["name"],
                tenant["category"],
                amount,
                qty,
                tx_time.strftime("%Y-%m-%d %H:%M:%S"),
                tenant["zone"]
            ])

    # 2. toast_fb_data.csv
    # use: Brewpoint Coffee, Golden Fork, Mesa Grill, Lotus Kitchen
    fb_tenants = [
        {"id": "brewpoint_coffee", "name": "Brewpoint Coffee", "zone": "food_court"},
        {"id": "golden_fork", "name": "Golden Fork", "zone": "food_court"},
        {"id": "mesa_grill", "name": "Mesa Grill", "zone": "food_court"},
        {"id": "lotus_kitchen", "name": "Lotus Kitchen", "zone": "food_court"}
    ]
    menu_items = {
        "brewpoint_coffee": ["Caramel Macchiato", "Cafe Latte", "Croissant", "Cold Brew", "Cake Pop"],
        "golden_fork": ["Big Mac Meal", "McChicken", "Fries", "Nuggets", "Apple Pie"],
        "mesa_grill": ["Burrito Bowl", "Tacos Trio", "Chips & Guac", "Quesadilla", "Agua Fresca"],
        "lotus_kitchen": ["Orange Chicken", "Beijing Beef", "Chow Mein", "Spring Roll", "Fried Rice"]
    }
    with open("data/synthetic/toast_fb_data.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["tenant_id", "store_name", "covers", "revenue", "items_ordered", "timestamp", "zone"])
        
        now = datetime.now()
        for i in range(300):
            tenant = random.choice(fb_tenants)
            days_ago = random.randint(0, 30)
            hour = random.choice([7, 8, 8, 9, 10, 11, 12, 12, 13, 13, 14, 15, 16, 17, 18, 19, 20])
            tx_time = now - timedelta(days=days_ago)
            tx_time = tx_time.replace(hour=hour, minute=random.randint(0,59), second=random.randint(0,59))
            
            covers = random.randint(1, 4)
            items = random.sample(menu_items[tenant["id"]], random.randint(1, 3))
            items_str = ", ".join(items)
            revenue = round(covers * random.uniform(8.5, 18.0), 2)
            
            writer.writerow([
                tenant["id"],
                tenant["name"],
                covers,
                revenue,
                items_str,
                tx_time.strftime("%Y-%m-%d %H:%M:%S"),
                tenant["zone"]
            ])

    # 3. shopify_inventory.csv
    # use: Maison Varlo, Nordvik, Stridecore, Levi & Co, Solène, Arca, Vertex Athletics
    shopify_tenants = [
        {"id": "maison_varlo", "name": "Maison Varlo", "category": "FASHION"},
        {"id": "nordvik", "name": "Nordvik", "category": "FASHION"},
        {"id": "stridecore", "name": "Stridecore", "category": "SPORTING"},
        {"id": "levi_and_co", "name": "Levi & Co", "category": "FASHION"},
        {"id": "solene", "name": "Solène", "category": "FASHION"},
        {"id": "arca", "name": "Arca", "category": "FASHION"},
        {"id": "vertex_athletics", "name": "Vertex Athletics", "category": "SPORTING"}
    ]
    with open("data/synthetic/shopify_inventory.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["tenant_id", "sku", "product_name", "category", "quantity_available", "last_updated"])
        
        for tenant in shopify_tenants:
            gender = ["Mens", "Womens", "Kids"]
            items = ["Jeans", "T-Shirt", "Jacket", "Sweater", "Sneakers", "Dress", "Socks"]
            for idx in range(20):
                sku = f"{tenant['id'].upper()}-{random.randint(100, 999)}-{idx}"
                name = f"{random.choice(gender)} {random.choice(items)}"
                qty = random.randint(2, 80)
                writer.writerow([
                    tenant["id"],
                    sku,
                    name,
                    tenant["category"],
                    qty,
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                ])

    # 4. lightspeed_catalog.csv
    # use: Circuit World, Glassline, Aero Home, Aurel, Celeste Jewels, Karat & Co
    lightspeed_tenants = [
        {"id": "circuit_world", "name": "Circuit World", "category": "ELECTRONICS"},
        {"id": "glassline", "name": "Glassline", "category": "ELECTRONICS"},
        {"id": "aero_home", "name": "Aero Home", "category": "ELECTRONICS"},
        {"id": "aurel", "name": "Aurel", "category": "JEWELRY"},
        {"id": "celeste_jewels", "name": "Celeste Jewels", "category": "JEWELRY"},
        {"id": "karat_and_co", "name": "Karat & Co", "category": "JEWELRY"}
    ]
    with open("data/synthetic/lightspeed_catalog.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["tenant_id", "sku", "product_name", "category", "quantity_available", "last_updated"])
        
        for tenant in lightspeed_tenants:
            if tenant["id"] == "circuit_world":
                items = ["OLED TV 55", "Wireless Headphones", "Smartwatch V2", "Bluetooth Speaker", "Gaming Laptop", "USB-C Cable"]
            elif tenant["id"] == "glassline":
                items = ["Smart Phone G1", "QLED Display 65", "Soundbar Pro", "Wireless Charger", "Foldable Phone"]
            elif tenant["id"] == "aero_home":
                items = ["Cyclone Vacuum", "Air Purifier H1", "Hair Dryer Premium", "Humidifier Cool"]
            else:
                items = ["Gold Ring", "Diamond Pendant", "Silver Bracelet", "Gemstone Earrings", "Charms Starter Set"]
                
            for idx in range(20):
                sku = f"{tenant['id'].upper()}-{random.randint(100, 999)}-{idx}"
                name = f"{random.choice(items)} {random.choice(['Special', 'Classic', 'Pro', 'Air', 'Pulse'])}"
                qty = random.randint(0, 50)
                writer.writerow([
                    tenant["id"],
                    sku,
                    name,
                    tenant["category"],
                    qty,
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                ])

    # 5. footfall_sensors.csv
    zones = ["food_court", "fashion_floor", "electronics", "sporting", "beauty", "entertainment"]
    entrances = ["entrance_north", "entrance_south", "entrance_east", "entrance_west"]
    with open("data/synthetic/footfall_sensors.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["zone_id", "zone_name", "visitor_count", "timestamp", "entrance_id"])
        
        now = datetime.now()
        for d in range(30):
            for hour in range(9, 22):
                for zone in zones:
                    if 12 <= hour <= 14:
                        base = random.randint(80, 250)
                    elif 18 <= hour <= 20:
                        base = random.randint(100, 300)
                    else:
                        base = random.randint(20, 100)
                        
                    tx_time = now - timedelta(days=d)
                    if tx_time.weekday() >= 5:
                        base = int(base * random.uniform(1.3, 2.0))
                        
                    timestamp = tx_time.replace(hour=hour, minute=0, second=0)
                    entrance = random.choice(entrances)
                    writer.writerow([
                        zone,
                        zone.replace("_", " ").title(),
                        base,
                        timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                        entrance
                    ])

    # 6. loyalty_members.csv
    dallas_zips = ["75201", "75204", "75205", "75206", "75209", "75219", "75225", "75230", "75240", "75248"]
    categories = ["FB", "FASHION", "ELECTRONICS", "SPORTING", "BEAUTY", "ENTERTAINMENT"]
    with open("data/synthetic/loyalty_members.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["member_id", "zip_code", "home_lat", "home_lng", "opt_in_push", "last_visit", "avg_transaction", "preferred_categories"])
        
        for i in range(200):
            member_id = f"LOY-{1000 + i}"
            zip_c = random.choice(dallas_zips)
            lat = 32.7767 + random.uniform(-0.15, 0.15)
            lng = -96.7970 + random.uniform(-0.15, 0.15)
            opt_in = random.choice([True, True, True, False])
            last_visit = datetime.now() - timedelta(days=random.randint(0, 45), hours=random.randint(10, 20))
            avg_tx = round(random.uniform(12.50, 185.00), 2)
            pref_cats = ",".join(random.sample(categories, random.randint(1, 3)))
            
            writer.writerow([
                member_id,
                zip_c,
                lat,
                lng,
                1 if opt_in else 0,
                last_visit.strftime("%Y-%m-%d %H:%M:%S"),
                avg_tx,
                pref_cats
            ])

if __name__ == "__main__":
    generate_data()
    print("Synthetic data CSV files generated successfully with fictional brands.")
