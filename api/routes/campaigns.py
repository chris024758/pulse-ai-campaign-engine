from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from tools import bigquery_tools
from agents.orchestrator import OrchestratorAgent
from api.routes.stream import broadcast_agent_step
import asyncio

router = APIRouter()

@router.get("")
async def get_campaigns():
    """Retrieve the last 20 campaign runs from campaign_history."""
    try:
        # Fallback lookback is 30 days, we'll query for 'WEATHER' or other types by querying history
        # Let's get historical records
        history = bigquery_tools.get_historical_performance("WEATHER", lookback_days=30)
        history2 = bigquery_tools.get_historical_performance("PAYDAY", lookback_days=30)
        history3 = bigquery_tools.get_historical_performance("ANOMALY", lookback_days=30)
        
        all_campaigns = history + history2 + history3
        # Sort by date
        all_campaigns.sort(key=lambda x: x.get("fired_at", ""), reverse=True)
        return all_campaigns[:20]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/trigger")
async def trigger_campaign(payload: Dict[str, Any]):
    """Manually triggers a campaign for specific parameters."""
    trigger_type = payload.get("trigger_type", "ANOMALY")
    tenant_id = payload.get("tenant_id", "zara")
    
    # We can kick off a task to orchestrate
    orchestrator = OrchestratorAgent()
    event_queue = asyncio.Queue()
    
    # Run async background task so we don't block
    async def run_and_broadcast():
        # Read from queue and broadcast via SSE & WS
        task = asyncio.create_task(orchestrator.run_goal(
            f"Manual campaign override for {tenant_id} under {trigger_type}", 
            event_queue
        ))
        
        # Read items from queue and send to SSE clients
        while not task.done() or not event_queue.empty():
            try:
                event = await asyncio.wait_for(event_queue.get(), timeout=0.1)
                await broadcast_agent_step(event)
                # also send to WS
                from api.websocket import manager
                await manager.broadcast({"type": "agent_reasoning", "data": event})
            except asyncio.TimeoutError:
                pass
            await asyncio.sleep(0.01)
            
        await task
        
    asyncio.create_task(run_and_broadcast())
    return {"status": "triggered", "message": f"Campaign trigger initiated for {tenant_id}."}
