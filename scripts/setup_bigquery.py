import os
import sys
import pandas as pd
from google.cloud import bigquery

# Resolve project root import issue
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config.settings import settings

def setup_bigquery():
    print("Initializing BigQuery Setup...")
    
    # 1. Attempt connection
    try:
        client = bigquery.Client()
    except Exception as e:
        print(f"[-] Could not initialize Google BigQuery Client: {e}")
        print("[!] Falling back to Local Data Engine preparation.")
        print("[+] Checking synthetic CSV files in data/synthetic...")
        csv_files = [
            "square_transactions.csv",
            "toast_fb_data.csv",
            "shopify_inventory.csv",
            "lightspeed_catalog.csv",
            "footfall_sensors.csv",
            "loyalty_members.csv"
        ]
        all_exist = True
        for f in csv_files:
            path = os.path.join("data", "synthetic", f)
            if os.path.exists(path):
                print(f"  [OK] {f} exists")
            else:
                print(f"  [ERR] {f} missing! Please run 'python scripts/generate_synthetic_csvs.py'")
                all_exist = False
                
        if all_exist:
            print("[OK] Local CSV Data Engine is fully primed and ready for fallback operations!")
        return

    dataset_id = f"{client.project}.{settings.bigquery.dataset}"
    print(f"[+] Creating dataset {dataset_id} if not exists...")
    
    dataset = bigquery.Dataset(dataset_id)
    dataset.location = "US"
    try:
        dataset = client.create_dataset(dataset, exists_ok=True)
        print(f"[OK] Dataset {dataset_id} is ready.")
    except Exception as e:
        print(f"[-] Failed to create dataset: {e}")
        return

    # Parse schema SQL
    schema_path = os.path.join("data", "schema", "bigquery_schema.sql")
    if not os.path.exists(schema_path):
        print(f"[-] Schema SQL file not found at {schema_path}!")
        return
        
    with open(schema_path, "r") as f:
        sql = f.read()

    print("[+] Creating tables in BigQuery...")
    # BigQuery permits executing multiple CREATE TABLE IF NOT EXISTS statements separated by semicolons
    try:
        query_job = client.query(sql)
        query_job.result()
        print("[OK] All tables created successfully from bigquery_schema.sql.")
    except Exception as e:
        print(f"[-] Table creation query failed: {e}")
        return

    # Seeding tables from local CSVs
    csv_mappings = {
        "tenant_transactions": "square_transactions.csv",
        "tenant_inventory": "shopify_inventory.csv", # will load shopify inventory as base
        "footfall_by_zone": "footfall_sensors.csv",
        "loyalty_members": "loyalty_members.csv"
    }

    print("[+] Loading synthetic data into BigQuery tables...")
    for table_name, csv_file in csv_mappings.items():
        csv_path = os.path.join("data", "synthetic", csv_file)
        if not os.path.exists(csv_path):
            print(f"[-] CSV file {csv_file} missing, skipping seed for {table_name}.")
            continue
            
        df = pd.read_csv(csv_path)
        table_ref = client.dataset(settings.bigquery.dataset).table(table_name)
        
        job_config = bigquery.LoadJobConfig(
            write_disposition="WRITE_TRUNCATE",
            autodetect=True
        )
        
        try:
            print(f"  [LOAD] Uploading {csv_file} to {table_name}...")
            job = client.load_table_from_dataframe(df, table_ref, job_config=job_config)
            job.result()
            print(f"  [OK] Loaded {len(df)} rows into {table_name}.")
        except Exception as e:
            print(f"  [-] Failed to load {table_name}: {e}")

    # Seed the roster table directly
    print("[+] Seeding tenant_roster...")
    tenants = [
        {"tenant_id": "brewpoint_coffee", "store_name": "Brewpoint Coffee", "zone": "food_court", "pos_system": "toast", "fivetran_connector_id": "brewpoint_coffee_pos_sync", "is_open": True, "campaign_opt_in": True, "contact_whatsapp": "+12145550101"},
        {"tenant_id": "golden_fork", "store_name": "Golden Fork", "zone": "food_court", "pos_system": "toast", "fivetran_connector_id": "golden_fork_pos_sync", "is_open": True, "campaign_opt_in": True, "contact_whatsapp": "+12145550102"},
        {"tenant_id": "maison_varlo", "store_name": "Maison Varlo", "zone": "fashion_floor", "pos_system": "shopify", "fivetran_connector_id": "maison_varlo_pos_sync", "is_open": True, "campaign_opt_in": True, "contact_whatsapp": "+12145550103"},
        {"tenant_id": "nordvik", "store_name": "Nordvik", "zone": "fashion_floor", "pos_system": "shopify", "fivetran_connector_id": "nordvik_pos_sync", "is_open": True, "campaign_opt_in": True, "contact_whatsapp": "+12145550104"},
        {"tenant_id": "common_thread", "store_name": "Common Thread", "zone": "fashion_floor", "pos_system": "shopify", "fivetran_connector_id": "common_thread_pos_sync", "is_open": True, "campaign_opt_in": True, "contact_whatsapp": "+12145550105"},
        {"tenant_id": "vertex_athletics", "store_name": "Vertex Athletics", "zone": "sporting", "pos_system": "lightspeed", "fivetran_connector_id": "vertex_athletics_pos_sync", "is_open": True, "campaign_opt_in": True, "contact_whatsapp": "+12145550106"},
        {"tenant_id": "circuit_world", "store_name": "Circuit World", "zone": "electronics", "pos_system": "lightspeed", "fivetran_connector_id": "circuit_world_pos_sync", "is_open": True, "campaign_opt_in": True, "contact_whatsapp": "+12145550107"},
        {"tenant_id": "lumiere_beauty", "store_name": "Lumière Beauty", "zone": "beauty", "pos_system": "square", "fivetran_connector_id": "lumiere_beauty_pos_sync", "is_open": True, "campaign_opt_in": True, "contact_whatsapp": "+12145550108"},
        {"tenant_id": "pace_step", "store_name": "PaceStep", "zone": "sporting", "pos_system": "square", "fivetran_connector_id": "pace_step_pos_sync", "is_open": True, "campaign_opt_in": True, "contact_whatsapp": "+12145550109"},
        {"tenant_id": "mesa_grill", "store_name": "Mesa Grill", "zone": "food_court", "pos_system": "toast", "fivetran_connector_id": "mesa_grill_pos_sync", "is_open": True, "campaign_opt_in": True, "contact_whatsapp": "+12145550110"},
        {"tenant_id": "cineplex_grand", "store_name": "Cineplex Grand Theatres", "zone": "entertainment", "pos_system": "square", "fivetran_connector_id": "cineplex_grand_pos_sync", "is_open": True, "campaign_opt_in": True, "contact_whatsapp": "+12145550111"},
        {"tenant_id": "pixel_vault", "store_name": "PixelVault", "zone": "electronics", "pos_system": "square", "fivetran_connector_id": "pixel_vault_pos_sync", "is_open": True, "campaign_opt_in": True, "contact_whatsapp": "+12145550112"}
    ]
    df_roster = pd.DataFrame(tenants)
    table_ref_roster = client.dataset(settings.bigquery.dataset).table("tenant_roster")
    try:
        client.load_table_from_dataframe(df_roster, table_ref_roster, job_config=bigquery.LoadJobConfig(write_disposition="WRITE_TRUNCATE")).result()
        print("[OK] tenant_roster seeded successfully.")
    except Exception as e:
        print(f"[-] Failed to seed tenant_roster: {e}")

    print("[OK] BigQuery Setup Completed Successfully!")

if __name__ == "__main__":
    setup_bigquery()
