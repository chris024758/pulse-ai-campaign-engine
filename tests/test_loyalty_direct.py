"""
Test loyalty customer query directly.
Does NOT modify any project files.
"""
from dotenv import load_dotenv
load_dotenv()
import os
from google.cloud import bigquery

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-7fa00ed2-a79f-4932-99a")

def test_loyalty():
    print("=" * 55)
    print("LOYALTY CUSTOMER DIRECT TEST")
    print("=" * 55)

    client = bigquery.Client(project=PROJECT)
    print(f"Project: {client.project}")

    # Check what datasets exist
    print("\n[1] All datasets:")
    for ds in client.list_datasets():
        print(f"   -> {ds.dataset_id}")

    # Check loyalty dataset tables
    print("\n[2] Tables in pulse_loyalty_customers:")
    try:
        for t in client.list_tables(
            "pulse_loyalty_customers"
        ):
            print(f"   -> {t.table_id}")
    except Exception as e:
        print(f"   Error: {e}")

    # Sample the customers table
    print("\n[3] Sample customers:")
    try:
        query = """
        SELECT * FROM `pulse_loyalty_customers.customers`
        LIMIT 5
        """
        rows = list(client.query(query).result())
        if rows:
            print(f"   Columns: {list(rows[0].keys())}")
            for row in rows:
                print(f"   -> {dict(row)}")
        else:
            print("   Empty table")
    except Exception as e:
        print(f"   Error: {e}")

    # Test query for top 5 tenants
    print("\n[4] Query for top 5 tenants:")
    try:
        test_ids = ['S17', 'S07', 'S11', 'S25', 'S22']
        ids_str = ','.join([f"'{x}'" for x in test_ids])
        query = f"""
        SELECT name, tenant_id, tenant_name, amount_spent
        FROM `pulse_loyalty_customers.customers`
        WHERE tenant_id IN ({ids_str})
        ORDER BY tenant_id, amount_spent DESC
        LIMIT 10
        """
        rows = list(client.query(query).result())
        if rows:
            for row in rows:
                print(f"   -> {row.tenant_id} | "
                      f"{row.tenant_name} | "
                      f"{row.name} | "
                      f"${row.amount_spent}")
        else:
            print("   No rows found")
    except Exception as e:
        print(f"   Error: {e}")

    print("\n" + "=" * 55)
    print("Test complete")
    print("=" * 55)

if __name__ == "__main__":
    test_loyalty()
