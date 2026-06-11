"""
Direct BigQuery test for Square catalog lookup.
Uses same client as main PULSE pipeline.
Does NOT modify any project files.
"""

from tools.bigquery_tools import bq_client

def test_square_lookup():
    print("=" * 55)
    print("SQUARE BIGQUERY DIRECT TEST")
    print("=" * 55)

    # Use exact same client as main pipeline
    client = bq_client
    print(f"\n[OK] BigQuery client connected")
    print(f"   Project: {client.project}")

    # Test 1: Check square_catalog dataset exists
    print(f"\n[1] Checking square_catalog tables...")
    try:
        tables = list(client.list_tables("square_catalog"))
        print(f"   Tables found: {[t.table_id for t in tables]}")
    except Exception as e:
        print(f"   [ERR] Error: {e}")
        return

    # Test 2: Raw query on catalog_item_variation
    print(f"\n[2] Raw SKU lookup for S17 (Aurel)...")
    try:
        query = f"""
        SELECT sku, item_id, price_money_amount
        FROM `{client.project}.square_catalog.catalog_item_variation`
        WHERE sku LIKE 'S17%'
        LIMIT 5
        """
        rows = list(client.query(query).result(timeout=10))
        if rows:
            for row in rows:
                print(f"   [OK] SKU: {row.sku} | item_id: {row.item_id} | price: {row.price_money_amount}")
        else:
            print(f"   [MISS] No rows found for S17%")
    except Exception as e:
        print(f"   [ERR] Error: {e}")

    # Test 3: Full join query for Aurel
    print(f"\n[3] Full product lookup for S17 (Aurel)...")
    try:
        query = f"""
        SELECT
            i.name,
            i.description,
            v.sku,
            v.price_money_amount
        FROM `{client.project}.square_catalog.catalog_item` i
        JOIN `{client.project}.square_catalog.catalog_item_variation` v
            ON v.item_id = i.id
        WHERE v.sku LIKE 'S17%'
        LIMIT 1
        """
        rows = list(client.query(query).result(timeout=10))
        if rows:
            row = rows[0]
            print(f"   [OK] Name: {row.name}")
            print(f"   [OK] Description: {row.description}")
            print(f"   [OK] SKU: {row.sku}")
            print(f"   [OK] Price: ${row.price_money_amount/100:.2f}")
        else:
            print(f"   [MISS] No product found")
    except Exception as e:
        print(f"   [ERR] Error: {e}")

    # Test 4: Same for Apex Tech S07
    print(f"\n[4] Full product lookup for S07 (Apex Tech)...")
    try:
        query = f"""
        SELECT
            i.name,
            i.description,
            v.sku,
            v.price_money_amount
        FROM `{client.project}.square_catalog.catalog_item` i
        JOIN `{client.project}.square_catalog.catalog_item_variation` v
            ON v.item_id = i.id
        WHERE v.sku LIKE 'S07%'
        LIMIT 1
        """
        rows = list(client.query(query).result(timeout=10))
        if rows:
            row = rows[0]
            print(f"   [OK] Name: {row.name}")
            print(f"   [OK] Description: {row.description}")
            print(f"   [OK] SKU: {row.sku}")
            print(f"   [OK] Price: ${row.price_money_amount/100:.2f}")
        else:
            print(f"   [MISS] No product found")
    except Exception as e:
        print(f"   [ERR] Error: {e}")

    print(f"\n{'='*55}")
    print("Test complete — no PULSE files modified")
    print(f"{'='*55}")

if __name__ == "__main__":
    test_square_lookup()
