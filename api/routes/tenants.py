from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from tools import bigquery_tools

router = APIRouter()

@router.get("")
async def get_tenants():
    """Retrieve full roster of tenants with system configuration details."""
    try:
        # Load all tenants, open or not, to show dashboard status
        roster = bigquery_tools.get_tenant_roster(open_only=False, opt_in_only=False)
        return roster
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{tenant_id}/inventory")
async def get_tenant_inventory_status(tenant_id: str):
    """Retrieve stock levels for a specific tenant ID."""
    try:
        inventory = bigquery_tools.get_tenant_inventory([tenant_id])
        if not inventory:
            # Check mock Pos endpoints or return empty
            return []
        return inventory
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
