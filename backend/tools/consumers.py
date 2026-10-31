import json
import logging
from django.conf import settings
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

        # Join personal user notification group (single canonical group to avoid duplicate deliveries)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        logger.info("WebSocket connected for user: %s (channel: %s)", self.user_id, self.channel_name)

        # Send initial confirmation handshake
        company = getattr(settings, 'COMPANY_NAME', 'NexusAI')
        await self.send(text_data=json.dumps({
            "type": "CONNECTION_ESTABLISHED",
            "user_id": self.user_id,
            "message": f"Connected to {company} Realtime Notification Gateway."
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

    async def dispatch(self, message):
        """
        Safely dispatches channel layer messages.
        If a specific handler (e.g. webhook_notification, step_notification) exists, it is called.
        Otherwise, if the message has a 'payload' or data, it safely serializes and sends it to the client,
        preventing ValueError: No handler for message type from crashing the WebSocket.
        """
        handler_name = message["type"].replace(".", "_")
        handler = getattr(self, handler_name, None)
        if handler:
            await handler(message)
        else:
            payload = message.get("payload") if "payload" in message else message
            try:
                if isinstance(payload, dict):
                    await self.send(text_data=json.dumps(payload))
                elif isinstance(payload, str):
                    await self.send(text_data=payload)
                else:
                    await self.send(text_data=json.dumps({"type": "NOTIFICATION", "data": str(payload)}))
            except Exception as exc:
                logger.warning("NotificationConsumer fallback dispatch failed for type %s: %s", message.get("type"), exc)

    async def webhook_notification(self, event):
        """
        Handler for WEBHOOK_EXECUTION_COMPLETED / WEBHOOK_EXECUTION_FAILED broadcasts.
        """
        payload = event.get('payload', {})
        await self.send(text_data=json.dumps(payload))

    async def hitl_notification(self, event):
        """
        Handler for HITL_REQUEST broadcasts.
        """
        payload = event.get('payload', {})
        await self.send(text_data=json.dumps(payload))

    async def step_notification(self, event):
        """
        Handler for real-time STEP_PROGRESS broadcasts (both in-app execution and webhook).
        """
        payload = event.get('payload', {})
        await self.send(text_data=json.dumps(payload))

    async def tool_failure_notification(self, event):
        """
        Handler for partial tool failure alerts.
        """
        payload = event.get('payload', {})
        await self.send(text_data=json.dumps(payload))

    async def generic_notification(self, event):
        """
        Handler for generic user notifications.
        """
        payload = event.get('payload', {})
        await self.send(text_data=json.dumps(payload))
