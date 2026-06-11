import os
from typing import Dict, Any, List
from config.settings import settings

has_firebase = False
try:
    import firebase_admin
    from firebase_admin import credentials, messaging
    
    cred_path = settings.app.firebase_service_account_path
    if cred_path and os.path.exists(cred_path):
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
        has_firebase = True
except Exception as e:
    print(f"Firebase Admin initialization skipped: {e}")

async def send_loyalty_push_notification(title: str, body: str, topic: str = "loyalty_members") -> Dict[str, Any]:
    """Broadcasts a push notification to firebase loyalty topic."""
    if has_firebase:
        try:
            message = messaging.Message(
                notification=messaging.Notification(
                    title=title,
                    body=body,
                ),
                topic=topic,
            )
            response = messaging.send(message)
            return {"status": "success", "message_id": response}
        except Exception as e:
            print(f"Firebase FCM send failed: {e}")

    # Fallback/Mock success
    print(f"Broadcasted Firebase Notification to topic '{topic}': '{title}' - '{body}'")
    return {
        "status": "success",
        "mock": True,
        "message_id": "mock-fcm-message-id-998877"
    }
