import json
import asyncio
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter()

# List of subscriber queues — one per active SSE connection
subscribers = []

@router.get("/stream")
async def stream_agent_events(request: Request):
    # Create a dedicated queue for this connection
    my_queue = asyncio.Queue()
    subscribers.append(my_queue)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(
                        my_queue.get(), timeout=1.0
                    )
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'keepalive'})}\n\n"
        finally:
            # Clean up on disconnect
            if my_queue in subscribers:
                subscribers.remove(my_queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )

async def broadcast_agent_step(event: dict):
    """Push event to ALL active SSE subscribers."""
    for q in list(subscribers):
        try:
            await q.put(event)
        except Exception:
            pass
