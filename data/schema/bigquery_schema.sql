-- BigQuery schema DDL statements for PULSE

CREATE TABLE IF NOT EXISTS tenant_transactions (
    tenant_id STRING NOT NULL,
    store_name STRING,
    pos_system STRING,
    item_category STRING,
    amount NUMERIC,
    quantity INT64,
    timestamp TIMESTAMP,
    zone STRING
);

CREATE TABLE IF NOT EXISTS tenant_inventory (
    tenant_id STRING NOT NULL,
    sku STRING NOT NULL,
    product_name STRING,
    category STRING,
    quantity_available INT64,
    last_updated TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_roster (
    tenant_id STRING NOT NULL,
    store_name STRING,
    zone STRING,
    pos_system STRING,
    fivetran_connector_id STRING,
    is_open BOOLEAN,
    campaign_opt_in BOOLEAN,
    contact_whatsapp STRING
);

CREATE TABLE IF NOT EXISTS footfall_by_zone (
    zone_id STRING NOT NULL,
    zone_name STRING,
    visitor_count INT64,
    timestamp TIMESTAMP,
    entrance_id STRING
);

CREATE TABLE IF NOT EXISTS loyalty_members (
    member_id STRING NOT NULL,
    zip_code STRING,
    home_lat FLOAT64,
    home_lng FLOAT64,
    opt_in_push BOOLEAN,
    last_visit TIMESTAMP,
    avg_transaction NUMERIC,
    preferred_categories STRING -- comma-separated
);

CREATE TABLE IF NOT EXISTS campaign_history (
    campaign_id STRING NOT NULL,
    trigger_type STRING,
    trigger_context STRING,
    tenants_included STRING, -- comma-separated
    brief_text STRING,
    creative_url STRING,
    channels_fired STRING, -- comma-separated
    estimated_revenue NUMERIC,
    actual_revenue NUMERIC,
    footfall_delta FLOAT64,
    fired_at TIMESTAMP,
    measured_at TIMESTAMP
);
