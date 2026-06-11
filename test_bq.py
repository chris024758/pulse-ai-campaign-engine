from google.cloud import bigquery
client = bigquery.Client()

r1 = list(client.query('SELECT COUNT(*) as row_count FROM pulse_tenant_inventory_daily.inventory_daily').result())
print('Inventory rows:', r1[0].row_count)

r2 = list(client.query('SELECT COUNT(*) as row_count FROM pulse_loyalty_customers.customers').result())
print('Loyalty rows:', r2[0].row_count)

q3 = 'SELECT tenant_name, inventory_health, stock_level FROM pulse_tenant_inventory_daily.inventory_daily WHERE date = "2026-06-06" ORDER BY inventory_health DESC LIMIT 5'
print('Top inventory Jun 6:')
for row in client.query(q3).result():
    print(' ', row.tenant_name, row.inventory_health, row.stock_level)
