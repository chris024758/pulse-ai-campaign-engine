from fastapi import WebSocket
from typing import List

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Send initial success greeting
        await websocket.send_json({"type": "connection_established", "status": "connected"})

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        msg_type = message.get("type", "")
        should_broadcast = False
        
        if msg_type.startswith("ws_"):
            clean_type = msg_type[3:]
            message = message.copy()
            message["type"] = clean_type
            should_broadcast = True
            msg_type = clean_type
        
        allowed_types = [
            "campaign_fired", "fivetran_sync", "footfall_update", 
            "investigating", "tenant_excluded", "screen_activated", 
            "campaign_resolved", "awaiting_approval_1", "awaiting_approval_2",
            "pending_approval"
        ]
        if msg_type == "live_signals_update" or msg_type in allowed_types:
            should_broadcast = True
            
        if should_broadcast:
            for connection in self.active_connections:
                try:
                    await connection.send_json(message)
                except Exception:
                    pass

manager = ConnectionManager()
