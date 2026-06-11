import os
import asyncio
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from api.routes import campaigns, agents, fivetran, tenants, stream
from api.websocket import manager

app = FastAPI(
    title="PULSE - Predictive Unified Live Signal Engine",
    description="Real-time AI Campaign Trigger Engine for American Shopping Malls"
)

@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.endswith(('.js', '.css')):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Enable CORS for the dashboard UI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Sub-Routers
app.include_router(campaigns.router, prefix="/campaigns", tags=["Campaigns"])
app.include_router(agents.router, prefix="/agents", tags=["Agents"])
app.include_router(fivetran.router, prefix="/fivetran", tags=["Fivetran"])
app.include_router(tenants.router, prefix="/tenants", tags=["Tenants"])
app.include_router(stream.router, prefix="", tags=["Event Stream"])

# Real-Time WebSocket Route
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive and listen for incoming messages from dashboard
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Background polling for live signals (Weather & Footfall changes) to broadcast to WS clients
async def start_signals_polling():
    from tools import weather_tools, bigquery_tools
    import datetime
    
    while True:
        try:
            weather = await weather_tools.get_current_weather(32.8537, -96.7731)
            footfall = await bigquery_tools.get_footfall_anomaly("food_court", 24)
            
            # Broadcast state update to dashboard
            await manager.broadcast({
                "type": "live_signals_update",
                "data": {
                    "weather": weather,
                    "footfall": footfall,
                    "timestamp": datetime.datetime.now().isoformat()
                }
            })
        except Exception as e:
            pass  # suppress background polling errors silently
        # poll every 10 seconds for real-time visualization responsiveness
        await asyncio.sleep(10.0)

@app.on_event("startup")
async def startup_event():
    # Clean up TTS files from previous runs
    try:
        from tools.tts_tools import cleanup_tts_files
        cleanup_tts_files()
    except Exception as e:
        print(f"TTS cleanup warning: {e}")

    # Print warning if GEMINI_API_KEY is missing
    from config.settings import settings
    if not settings.gemini.api_key:
        print("WARNING: GEMINI_API_KEY not set in .env — Gemini calls will fail")
    # Make sure creatives asset folder exists so we can save and serve generated ad creatives
    os.makedirs("frontend/assets/creatives", exist_ok=True)
    # Start background polling task
    asyncio.create_task(start_signals_polling())

# Serve static frontend dashboard shell at root
# Note: StaticFiles must be mounted at the end so it doesn't mask API routes
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
else:
    print(f"Warning: frontend directory not found at {frontend_dir}!")
