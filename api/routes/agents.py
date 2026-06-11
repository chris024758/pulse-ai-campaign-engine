from fastapi import APIRouter
from pydantic import BaseModel
from agents.orchestrator import OrchestratorAgent
from api.routes.stream import broadcast_agent_step
import asyncio

router = APIRouter()

# In-memory approval state
approval_gates = {}

# Weather toggle state
weather_toggle = {"use_real_api": False}

@router.post("/weather-toggle")
async def toggle_weather(payload: dict):
    weather_toggle["use_real_api"] = payload.get("enabled", False)
    return {
        "status": "ok",
        "use_real_api": weather_toggle["use_real_api"]
    }

@router.get("/weather-toggle")
async def get_weather_toggle():
    return weather_toggle

@router.post("/reset-approvals")
async def reset_approvals():
    approval_gates.clear()
    return {"status": "cleared"}

@router.post("/approve")
async def approve_gate(approval_id: str):
    approval_gates[approval_id] = True
    return {"approved": True, "approval_id": approval_id}

@router.get("/approval-status/{approval_id}")
async def get_approval_status(approval_id: str):
    """Orchestrator polls this to check if GM has approved."""
    return {"approved": approval_gates.get(approval_id, False)}

class GeminiResponsePayload(BaseModel):
    response: str

# In-memory stores
gemini_response_store = {}
gemini_prompt_store = {}

# Track the currently running orchestration task
current_orchestration_task: asyncio.Task = None

from typing import Optional
_current_task: Optional[asyncio.Task] = None
_task_lock: Optional[asyncio.Lock] = None

def get_task_lock():
    global _task_lock
    if _task_lock is None:
        _task_lock = asyncio.Lock()
    return _task_lock

@router.post("/gemini-response")
async def receive_gemini_response(payload: GeminiResponsePayload):
    gemini_response_store['pending'] = payload.response
    gemini_response_store['ready'] = True
    return {"status": "received"}

@router.get("/gemini-response/status")
async def get_gemini_response_status():
    if gemini_response_store.get('ready'):
        response = gemini_response_store.get('pending', '')
        gemini_response_store['ready'] = False
        gemini_response_store['pending'] = ''
        return {"ready": True, "response": response}
    return {"ready": False, "response": ""}

@router.post("/gemini-prompt")
async def store_gemini_prompt(payload: dict):
    gemini_prompt_store['prompt'] = payload.get('prompt', '')
    gemini_prompt_store['tokens'] = payload.get('tokens', 0)
    return {"status": "stored"}

@router.get("/gemini-prompt")
async def get_gemini_prompt():
    return {
        "prompt": gemini_prompt_store.get('prompt', ''),
        "tokens": gemini_prompt_store.get('tokens', 0),
        "ready": bool(gemini_prompt_store.get('prompt'))
    }

class GoalRequest(BaseModel):
    goal: str

@router.get("/status")
async def get_agents_status():
    """Retrieve statuses of all PULSE agents."""
    return {
        "orchestrator": "idle",
        "signal_agent": "polling",
        "campaign_agent": "ready",
        "delivery_agent": "ready",
        "performance_agent": "ready",
        "timestamp": asyncio.get_event_loop().time()
    }

async def run_orchestration_loop(goal: str):
    global current_orchestration_task
    from api.websocket import manager

    orchestrator = OrchestratorAgent()
    local_queue = asyncio.Queue()
    
    # Run the orchestrator run_goal task
    task = asyncio.create_task(orchestrator.run_goal(goal, local_queue))
    
    while not task.done() or not local_queue.empty():
        try:
            event = await asyncio.wait_for(local_queue.get(), timeout=0.1)
            # Send to SSE stream (reasoning panel)
            await broadcast_agent_step(event)
            
            # ALSO send to WebSocket for simulation events
            # NOTE: awaiting_approval_1/2 are intentionally excluded —
            # they are handled exclusively via SSE by dashboard.js
            ws_types = [
                "campaign_fired", "fivetran_sync", "investigating",
                "tenant_excluded", "screen_activated", "campaign_resolved",
                "pending_approval", "loyalty_notifications", "footfall_update"
            ]
            if event.get("type") in ws_types:
                await manager.broadcast(event)
        except asyncio.TimeoutError:
            pass
        await asyncio.sleep(0.01)
        
    await task

@router.post("/goal")
async def submit_goal(payload: GoalRequest):
    global _current_task

    lock = get_task_lock()
    async with lock:
        # Cancel any currently running task
        if _current_task and not _current_task.done():
            _current_task.cancel()
            try:
                await asyncio.wait_for(
                    asyncio.shield(_current_task),
                    timeout=2.0
                )
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
            print("[PULSE] Previous orchestration task cancelled")

        # Clear all stale state
        approval_gates.clear()
        gemini_response_store.clear()
        gemini_prompt_store.clear()
        print("[PULSE] Stale state cleared for new run")

        # Start new task
        _current_task = asyncio.create_task(
            run_orchestration_loop(payload.goal)
        )
        print("[PULSE] New orchestration task started")

    return {"status": "started", "goal": payload.goal}

