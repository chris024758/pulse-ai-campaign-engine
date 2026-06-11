"""
Isolated test: Square payment data via Fivetran -> BigQuery
Tests if transaction data exists in square_catalog dataset
Does NOT modify any PULSE pipeline files.
"""

import os
from dotenv import load_dotenv
from google.cloud import bigquery

load_dotenv()

def get_client():
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    return bigquery.Client(project=project)

def check_payment_tables(client, dataset_id: str):
    """List all payment-related tables in Square dataset."""
    print(f"\n[1] Payment-related tables in {dataset_id}:")
    try:
        all_tables = [t.table_id for t in client.list_tables(dataset_id)]
        payment_tables = [t for t in all_tables if any(
            keyword in t.lower() for keyword in
            ['payment', 'order', 'transaction', 'tender', 'cash', 'refund']
        )]
        if payment_tables:
            print(f"   Found {len(payment_tables)} payment tables:")
            for t in payment_tables:
                print(f"   -> {t}")
        else:
            print("   No payment tables found yet")
            print(f"   All tables: {all_tables}")
        return payment_tables
    except Exception as e:
        print(f"   Error: {e}")
        return []

def check_payment_count(client, dataset_id: str):
    """Check how many payments exist."""
    print(f"\n[2] Payment record count:")
    try:
        query = f"""
        SELECT
            COUNT(*) as total_payments,
            SUM(amount_money_amount) / 100 as total_revenue_usd,
            MIN(created_at) as earliest,
            MAX(created_at) as latest
        FROM `{dataset_id}.payment`
        """
        rows = list(client.query(query).result())
        if rows:
            row = rows[0]
            print(f"   Total payments: {row.total_payments}")
            print(f"   Total revenue: ${row.total_revenue_usd or 0:.2f}")
            print(f"   Date range: {row.earliest} -> {row.latest}")
        return rows[0].total_payments if rows else 0
    except Exception as e:
        print(f"   Error (table may not exist yet): {e}")
        return 0

def sample_payments(client, dataset_id: str):
    """Show sample payment records."""
    print(f"\n[3] Sample payments:")
    try:
        query = f"""
        SELECT *
        FROM `{dataset_id}.payment`
        LIMIT 5
        """
        rows = list(client.query(query).result())
        if rows:
            print(f"   Columns: {list(rows[0].keys())}")
            for i, row in enumerate(rows):
                print(f"\n   Payment {i+1}:")
                for k, v in dict(row).items():
                    if v is not None:
                        print(f"      {k}: {v}")
        else:
            print("   No payment records found")
    except Exception as e:
        print(f"   Error: {e}")

def check_orders(client, dataset_id: str):
    """Check order data."""
    print(f"\n[4] Order data:")
    try:
        query = f"""
        SELECT COUNT(*) as total_orders
        FROM `{dataset_id}.order`
        """
        rows = list(client.query(query).result())
        print(f"   Total orders: {rows[0].total_orders if rows else 0}")
    except Exception as e:
        print(f"   Error: {e}")

def check_all_table_counts(client, dataset_id: str):
    """Show row counts for all tables."""
    print(f"\n[5] Row counts for all Square tables:")
    try:
        all_tables = [t.table_id for t in client.list_tables(dataset_id)]
        for table_id in sorted(all_tables):
            try:
                query = f"""
                SELECT COUNT(*) as cnt
                FROM `{dataset_id}.{table_id}`
                """
                rows = list(client.query(query).result())
                count = rows[0].cnt if rows else 0
                status = "[OK]" if count > 0 else "[--]"
                print(f"   {status} {table_id}: {count} rows")
            except Exception:
                print(f"   [??] {table_id}: error reading")
    except Exception as e:
        print(f"   Error: {e}")

def main():
    print("=" * 55)
    print("SQUARE PAYMENTS ISOLATION TEST")
    print("Checking sandbox transaction data")
    print("=" * 55)

    client = get_client()
    DATASET = "square_catalog"

    # Check what payment tables exist
    payment_tables = check_payment_tables(client, DATASET)

    # Check payment counts
    count = check_payment_count(client, DATASET)

    if count > 0:
        # Show sample records
        sample_payments(client, DATASET)
        check_orders(client, DATASET)
    else:
        print("\nWARNING: No payment data found yet.")
        print("   This is expected for a new sandbox account.")
        print("   Options:")
        print("   1. Trigger a Fivetran sync after adding")
        print("      test payments in Square sandbox dashboard")
        print("   2. Use Square API to generate synthetic payments")

    # Show all table row counts regardless
    check_all_table_counts(client, DATASET)

    # Also check pulse_square_transactions dataset
    print("\n[6] Checking pulse_square_transactions dataset:")
    TRANSACTIONS_DATASET = "pulse_square_transactions"
    try:
        all_tables = [
            t.table_id for t in client.list_tables(TRANSACTIONS_DATASET)
        ]
        print(f"   Tables found: {all_tables}")

        for table_id in all_tables:
            try:
                query = f"""
                SELECT COUNT(*) as cnt
                FROM `{TRANSACTIONS_DATASET}.{table_id}`
                """
                rows = list(client.query(query).result())
                count = rows[0].cnt if rows else 0
                print(f"   [OK] {table_id}: {count} rows")

                if count > 0:
                    query2 = f"""
                    SELECT * FROM `{TRANSACTIONS_DATASET}.{table_id}`
                    LIMIT 2
                    """
                    sample = list(client.query(query2).result())
                    if sample:
                        print(f"      Columns: {list(sample[0].keys())}")
                        print(f"      Row 1: {dict(sample[0])}")
            except Exception as e:
                print(f"   [ERR] {table_id}: {e}")

    except Exception as e:
        print(f"   Error accessing dataset: {e}")
        print(f"   Dataset may not exist or have different name")

        # List ALL datasets to find the right one
        print("\n   All available BigQuery datasets:")
        for ds in client.list_datasets():
            print(f"   -> {ds.dataset_id}")

    print("\n" + "=" * 55)
    print("Test complete — no PULSE files modified")
    print("=" * 55)

if __name__ == "__main__":
    main()
