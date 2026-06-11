from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from tools import fivetran_tools

router = APIRouter()

@router.get("/connectors")
async def list_fivetran_connectors():
    """Retrieve connectors list from Fivetran."""
    try:
        connectors = await fivetran_tools.list_connectors()
        return connectors
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync")
async def trigger_fivetran_sync(payload: Dict[str, Any]):
    """Manually trigger a sync for a specific connector ID."""
    connector_id = payload.get("connector_id")
    if not connector_id:
        raise HTTPException(status_code=400, detail="connector_id is required")
        
    try:
        result = await fivetran_tools.trigger_sync(connector_id)
        # Notify WebSocket dashboard clients that a sync occurred
        from api.websocket import manager
        await manager.broadcast({
            "type": "sync_status_updated",
            "data": {
                "connector_id": connector_id,
                "status": "SYNCING",
                "triggered_at": "now"
            }
        })
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
