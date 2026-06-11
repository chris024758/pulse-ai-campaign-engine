import os
import base64
import asyncio
from typing import Dict, Any, List, Optional
import httpx
from config.settings import settings

CONNECTOR_MAP = {
    "pulse_tenant_inventory_daily": "pulse_tenant_inventory_daily",
    "pulse_loyalty_customers": "pulse_loyalty_customers",
}

# Connector IDs — set FIVETRAN_INVENTORY_CONNECTOR_ID and
# FIVETRAN_LOYALTY_CONNECTOR_ID in .env (get from Fivetran dashboard
# → connector → Settings → Connector ID)
CONNECTOR_IDS = {
    "pulse_tenant_inventory_daily": os.getenv(
        "FIVETRAN_INVENTORY_CONNECTOR_ID", None
    ),
    "pulse_loyalty_customers": os.getenv(
        "FIVETRAN_LOYALTY_CONNECTOR_ID", None
    ),
}

# Tenant to connector mapping
TENANT_CONNECTOR_MAP = {
    "S01": "pulse_tenant_inventory_daily",
    "S02": "pulse_tenant_inventory_daily",
    "S03": "pulse_tenant_inventory_daily",
    "S04": "pulse_tenant_inventory_daily",
    "S05": "pulse_tenant_inventory_daily",
    "S10": "pulse_tenant_inventory_daily",
    "S11": "pulse_tenant_inventory_daily",
    "S12": "pulse_tenant_inventory_daily",
    "S06": "pulse_tenant_inventory_daily",
    "S07": "pulse_tenant_inventory_daily",
    "S08": "pulse_tenant_inventory_daily",
    "S09": "pulse_tenant_inventory_daily",
    "S13": "pulse_tenant_inventory_daily",
    "S14": "pulse_tenant_inventory_daily",
    "S15": "pulse_tenant_inventory_daily",
    "S16": "pulse_tenant_inventory_daily",
    "S17": "pulse_tenant_inventory_daily",
    "S20": "pulse_tenant_inventory_daily",
    "S18": "pulse_tenant_inventory_daily",
    "S19": "pulse_tenant_inventory_daily",
    "S21": "pulse_tenant_inventory_daily",
    "S22": "pulse_tenant_inventory_daily",
    "S23": "pulse_tenant_inventory_daily",
    "S24": "pulse_tenant_inventory_daily",
    "S25": "pulse_tenant_inventory_daily",
}

def _get_headers() -> Dict[str, str]:
    import base64
    api_key = settings.fivetran.api_key
    api_secret = settings.fivetran.api_secret
    token = base64.b64encode(f"{api_key}:{api_secret}".encode()).decode()
    return {
        "Authorization": f"Basic {token}",
        "Content-Type": "application/json",
        "Accept": "application/json;version=2"
    }

async def list_connections() -> List[Dict]:
    group_id = settings.fivetran.group_id
    url = f"{settings.fivetran.base_url}/groups/{group_id}/connectors"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, headers=_get_headers(), timeout=15.0)
            response.raise_for_status()
            return response.json().get("data", {}).get("items", [])
        except Exception as e:
            print(f"list_connections error: {e}")
            return []

async def sync_connection(connector_id: str) -> Dict[str, Any]:
    """Force immediate sync of a specific connector."""
    real_id = CONNECTOR_IDS.get(connector_id, connector_id)
    if not real_id:
        print(f"[Fivetran] No connector ID configured for {connector_id} — skipping sync")
        return {"status": "skipped"}
    url = f"{settings.fivetran.base_url}/connectors/{real_id}/force"
    print(f"Fivetran: Forcing sync for connector {real_id}...")
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(url, headers=_get_headers())
        response.raise_for_status()
        return response.json()

async def get_connection_details(connector_id: str) -> Dict[str, Any]:
    """Get full connector details including status, sync state, succeeded_at, failed_at, and service."""
    real_id = CONNECTOR_IDS.get(connector_id, connector_id)
    url = f"{settings.fivetran.base_url}/connectors/{real_id}"
    print(f"Fivetran: Getting details for connector {real_id}...")
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(url, headers=_get_headers())
        response.raise_for_status()
        return response.json()

async def modify_connection_table_config(
    connector_id: str, schema_name: str, table_name: str, enabled: bool
) -> Dict[str, Any]:
    """Enable or disable a specific table in the connector schema."""
    real_id = CONNECTOR_IDS.get(connector_id, connector_id)
    url = f"{settings.fivetran.base_url}/connectors/{real_id}/schemas/{schema_name}/tables/{table_name}"
    print(f"Fivetran: Modifying table config for {real_id} ({schema_name}.{table_name}) to enabled={enabled}...")
    payload = {"enabled": enabled}
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.patch(url, headers=_get_headers(), json=payload)
        response.raise_for_status()
        return response.json()

async def create_connection(service: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new connector in our group."""
    url = f"{settings.fivetran.base_url}/connectors"
    print(f"Fivetran: Creating connector of type '{service}' in group {settings.fivetran.group_id}...")
    payload = {
        "group_id": settings.fivetran.group_id,
        "service": service,
        "config": config,
        "trust_certificates": True,
        "run_setup_tests": True
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(url, headers=_get_headers(), json=payload)
        response.raise_for_status()
        return response.json()

async def resync_connection(connector_id: str) -> Dict[str, Any]:
    """Trigger a full historical resync."""
    real_id = CONNECTOR_IDS.get(connector_id, connector_id)
    url = f"{settings.fivetran.base_url}/connectors/{real_id}/resync"
    print(f"Fivetran: Triggering historical resync for connector {real_id}...")
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(url, headers=_get_headers())
        response.raise_for_status()
        return response.json()

async def run_connection_setup_tests(connector_id: str) -> Dict[str, Any]:
    """Run setup tests to verify the connection is healthy."""
    real_id = CONNECTOR_IDS.get(connector_id, connector_id)
    url = f"{settings.fivetran.base_url}/connectors/{real_id}/test"
    print(f"Fivetran: Running setup tests for connector {real_id}...")
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(url, headers=_get_headers())
        response.raise_for_status()
        return response.json()

async def create_account_webhook(url: str, events: List[str]) -> Dict[str, Any]:
    """Create an account-level webhook."""
    webhook_url = f"{settings.fivetran.base_url}/webhooks/account"
    print(f"Fivetran: Creating account webhook for {url}...")
    payload = {
        "url": url,
        "events": events,
        "active": True,
        "secret": settings.app.webhook_secret
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(webhook_url, headers=_get_headers(), json=payload)
        response.raise_for_status()
        return response.json()

async def create_group(name: str) -> Dict[str, Any]:
    """Create a new group (for multi-mall expansion)."""
    url = f"{settings.fivetran.base_url}/groups"
    print(f"Fivetran: Creating group '{name}'...")
    payload = {"name": name}
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(url, headers=_get_headers(), json=payload)
        response.raise_for_status()
        return response.json()

def get_connector_id_for_tenant(tenant_id: str) -> Optional[str]:
    """Map a tenant_id to the correct connector_id using categories."""
    return TENANT_CONNECTOR_MAP.get(tenant_id)

async def sync_all_tenant_connectors() -> Dict[str, str]:
    results = {}
    for name, connector_id in CONNECTOR_IDS.items():
        try:
            result = await sync_connection(connector_id)
            results[name] = "success"
            print(f"Fivetran: Synced {name}")
        except Exception as e:
            results[name] = f"error: {str(e)[:50]}"
            print(f"Fivetran: Sync failed for {name}: {e}")
    return results

async def check_all_connector_health() -> List[Dict[str, Any]]:
    """Call get_connection_details for all connectors in parallel."""
    connector_ids = list(CONNECTOR_MAP.keys())
    print(f"Fivetran: Checking health for all {len(connector_ids)} PULSE connectors in parallel...")
    
    async def safe_get_details(cid: str):
        try:
            res = await get_connection_details(cid)
            connector_data = res.get("data", {})
            status = connector_data.get("status", {})
            setup_state = status.get("setup_state")
            is_healthy = (setup_state == "connected")
            return {
                "connector_id": CONNECTOR_IDS.get(cid, cid),
                "schema": connector_data.get("schema") or cid,
                "status": status,
                "last_sync": connector_data.get("succeeded_at"),
                "is_healthy": is_healthy
            }
        except Exception as e:
            return {
                "connector_id": CONNECTOR_IDS.get(cid, cid),
                "schema": cid,
                "status": {"error": str(e)},
                "last_sync": None,
                "is_healthy": False
            }
            
    results = await asyncio.gather(*(safe_get_details(cid) for cid in connector_ids))
    return list(results)

# Backwards compatibility wrappers
async def list_connectors() -> List[Dict[str, Any]]:
    """Backward compatibility wrapper for list_connections."""
    return await list_connections()

async def trigger_sync(connector_id: str) -> Dict[str, Any]:
    """Backward compatibility wrapper for sync_connection."""
    return await sync_connection(connector_id)

async def get_sync_status(connector_id: str) -> Dict[str, Any]:
    """Backward compatibility wrapper for get_connection_details mapping to legacy status payload."""
    details = await get_connection_details(connector_id)
    connector_data = details.get("data", {})
    return {
        "connector_id": connector_id,
        "service": connector_data.get("service"),
        "sync_status": connector_data.get("status", {}).get("sync_state", "UNKNOWN"),
        "setup_status": connector_data.get("status", {}).get("setup_state", "UNKNOWN"),
        "last_sync": connector_data.get("succeeded_at")
    }
