import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)


class NotificationConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for real-time notifications to authenticated users.
    Listens on /ws/notifications/<user_id>/
    Receives HITL interruption alerts, approval updates, and execution statuses.
    """

    async def connect(self):
        self.user_id = self.scope['url_route']['kwargs'].get('user_id', 'anonymous')
        self.group_name = f"user_{self.user_id}"

        # Join personal user notification group
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        logger.info("WebSocket connected for user: %s (channel: %s)", self.user_id, self.channel_name)

        # Send initial confirmation handshake
        await self.send(text_data=json.dumps({
            "type": "CONNECTION_ESTABLISHED",
            "user_id": self.user_id,
            "message": "Connected to NexusAI Realtime Notification Gateway."
        }))

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        logger.info("WebSocket disconnected for user: %s (code: %s)", getattr(self, 'user_id', 'unknown'), close_code)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        try:
            data = json.loads(text_data)
            msg_type = data.get("type", "ping")
            if msg_type == "ping":
                await self.send(text_data=json.dumps({"type": "pong", "status": "alive"}))
        except Exception as exc:
            logger.warning("Error processing inbound WebSocket message: %s", str(exc))

    async def hitl_notification(self, event):
        """
        Handler for HITL_REQUEST broadcasts.
        """
        payload = event.get('payload', {})
        await self.send(text_data=json.dumps(payload))

    async def webhook_notification(self, event):
        """
        Handler for webhook status updates.
        """
        payload = event.get('payload', {})
        await self.send(text_data=json.dumps(payload))
