"""
Isolated test: Square catalog pipeline via Fivetran → BigQuery
Tests product lookup and image URL for Vertex Athletics (S04-VTX)
Does NOT modify any PULSE pipeline files.
"""

import asyncio
import os
from dotenv import load_dotenv
from google.cloud import bigquery
import httpx

load_dotenv()

def get_client():
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    return bigquery.Client(project=project)

def list_datasets(client):
    """Show all datasets to find the Square one."""
    print("\n[1] All BigQuery datasets:")
    for ds in client.list_datasets():
        print(f"   ->{ds.dataset_id}")

def list_tables(client, dataset_id: str):
    """List all tables in the Square dataset."""
    print(f"\n[2] Tables in {dataset_id}:")
    try:
        for t in client.list_tables(dataset_id):
            print(f"   ->{t.table_id}")
    except Exception as e:
        print(f"   Error: {e}")

def show_table_sample(client, dataset_id: str, table_id: str):
    """Show first 2 rows and all columns of a table."""
    print(f"\n[3] Sample from {dataset_id}.{table_id}:")
    try:
        query = f"SELECT * FROM `{dataset_id}.{table_id}` LIMIT 2"
        rows = list(client.query(query).result())
        if rows:
            print(f"   Columns: {list(rows[0].keys())}")
            for i, row in enumerate(rows):
                print(f"   Row {i+1}: {dict(row)}")
        else:
            print("   Empty table")
    except Exception as e:
        print(f"   Error: {e}")

def find_vertex_product(client, dataset_id: str):
    """Find Vertex Athletics product by SKU prefix S04."""
    print(f"\n[4] Looking for Vertex Athletics (S04-VTX)...")

    # First check catalog_item table
    try:
        query = f"""
        SELECT *
        FROM `{dataset_id}.catalog_item`
        WHERE LOWER(name) LIKE '%vertex%'
        OR id IN (
            SELECT item_id FROM `{dataset_id}.catalog_item_variation`
            WHERE LOWER(sku) LIKE '%s04%'
        )
        LIMIT 5
        """
        rows = list(client.query(query).result())
        if rows:
            print(f"   OK Found {len(rows)} matching items:")
            for row in rows:
                print(f"   ->{dict(row)}")
            return rows[0]
        else:
            print("   NOT FOUND by name/SKU")

            # Try broader search
            print("   Trying broader search...")
            query2 = f"""
            SELECT id, name FROM `{dataset_id}.catalog_item`
            LIMIT 10
            """
            rows2 = list(client.query(query2).result())
            print(f"   All items found:")
            for r in rows2:
                print(f"   ->{r['id']} | {r['name']}")
            return None
    except Exception as e:
        print(f"   Error: {e}")
        return None

def find_product_image(client, dataset_id: str, item_id: str):
    """Find image URL for a catalog item."""
    print(f"\n[5] Looking for image for item {item_id}...")
    try:
        # Try catalog_image table
        query = f"""
        SELECT *
        FROM `{dataset_id}.catalog_image`
        LIMIT 10
        """
        rows = list(client.query(query).result())
        if rows:
            print(f"   catalog_image columns: {list(rows[0].keys())}")
            for row in rows:
                print(f"   ->{dict(row)}")
        else:
            print("   catalog_image table is empty")

        # Also check item_image_ids junction table if it exists
        try:
            query2 = f"""
            SELECT * FROM `{dataset_id}.catalog_item_image_id`
            WHERE catalog_item_id = '{item_id}'
            LIMIT 5
            """
            rows2 = list(client.query(query2).result())
            print(f"   Image links: {[dict(r) for r in rows2]}")
        except Exception:
            pass

    except Exception as e:
        print(f"   Error: {e}")

async def test_image_url(url: str):
    """Test if image URL is accessible."""
    print(f"\n[6] Testing image URL accessibility...")
    print(f"   URL: {url}")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.head(url, follow_redirects=True)
            print(f"   Status: {resp.status_code}")
            print(f"   Content-Type: {resp.headers.get('content-type', 'unknown')}")
            print(f"   OK Accessible!" if resp.status_code == 200 else "   NOT accessible")
    except Exception as e:
        print(f"   ERROR: {e}")

async def main():
    print("=" * 55)
    print("SQUARE PIPELINE ISOLATION TEST")
    print("Target: Vertex Athletics product + image")
    print("=" * 55)

    client = get_client()

    # Step 1: Find the Square dataset
    list_datasets(client)

    # Step 2: Use 'square' as dataset name (from Fivetran setup)
    # Change this if your dataset has a different name
    DATASET = "square_catalog"
    list_tables(client, DATASET)

    # Step 3: Show catalog_item sample to understand schema
    show_table_sample(client, DATASET, "catalog_item")

    # Step 4: Find Vertex product
    item = find_vertex_product(client, DATASET)

    # Step 5: Find its image
    if item:
        find_product_image(client, DATASET, item['id'])

    # Step 6: If you find an image URL, test it
    # Uncomment and paste the URL here after step 5:
    # await test_image_url("https://items-images-production.s3.amazonaws.com/...")

    print("\n" + "=" * 55)
    print("Test complete — no PULSE files modified")
    print("=" * 55)

if __name__ == "__main__":
    asyncio.run(main())
