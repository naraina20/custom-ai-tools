import json
import logging
from typing import Any, Dict, Optional
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils import timezone

logger = logging.getLogger(__name__)


class NotificationService:
    """
    Central dispatcher for real-time WebSocket notifications and system email alerts.
    """

    @classmethod
    def broadcast_hitl_notification(
        cls,
        user_id: str,
        thread_id: str,
        tool_id: int,
        tool_title: str,
        details: str,
        input_data: Dict[str, Any],
        user_email: Optional[str] = None
    ) -> None:
        """
        1. Broadcasts WebSocket event to /ws/notifications/<user_id>/
        2. Sends styled HTML approval email to user
        """
        # 1. Channels WebSocket Broadcast
        try:
            channel_layer = get_channel_layer()
            if channel_layer:
                payload = {
                    "type": "HITL_REQUEST",
                    "thread_id": thread_id,
                    "tool_id": tool_id,
                    "tool_title": tool_title,
                    "details": details,
                    "input_data": input_data,
                }
                async_to_sync(channel_layer.group_send)(
                    f"user_{user_id}",
                    {
                        "type": "hitl.notification",
                        "payload": payload,
                    }
                )
                logger.info("HITL WebSocket broadcast delivered to user_%s for thread %s", user_id, thread_id)
        except Exception as exc:
            logger.warning("Failed to dispatch WebSocket notification: %s", str(exc))

        # 2. HTML Email Notification
        try:
            company_name = getattr(settings, 'COMPANY_NAME', 'NexusAI Agent Systems')
            support_email = getattr(settings, 'COMPANY_SUPPORT_EMAIL', 'support@nexusai.local')
            target_email = user_email or getattr(settings, 'EMAIL_HOST_USER', None) or support_email

            approval_url = f"https://nexusai.local/agent/approve?thread_id={thread_id}"
            formatted_input = json.dumps(input_data, indent=2)

            context = {
                "company_name": company_name,
                "support_email": support_email,
                "tool_title": tool_title,
                "thread_id": thread_id,
                "details": details,
                "input_data_formatted": formatted_input,
                "approval_url": approval_url,
            }

            html_message = render_to_string('emails/hitl_notification.html', context)
            plain_message = (
                f"Action Approval Required: {tool_title}\n"
                f"Thread ID: {thread_id}\n"
                f"Details: {details}\n"
                f"Review & Approve: {approval_url}\n"
            )

            send_mail(
                subject=f"[{company_name}] Action Authorization Required: {tool_title}",
                message=plain_message,
                from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', support_email),
                recipient_list=[target_email],
                html_message=html_message,
                fail_silently=True,
            )
            logger.info("HITL email dispatched to %s for thread %s", target_email, thread_id)
        except Exception as exc:
            logger.warning("Failed to dispatch HITL email: %s", str(exc))

    @classmethod
    def send_webhook_auth_failure_email(
        cls,
        tool_title: str,
        job_id: int,
        provider: str,
        error_message: str,
        user_email: Optional[str] = None
    ) -> None:
        """
        Sends email alert when an inbound webhook fails due to invalid/expired OAuth tokens.
        """
        try:
            company_name = getattr(settings, 'COMPANY_NAME', 'NexusAI Agent Systems')
            support_email = getattr(settings, 'COMPANY_SUPPORT_EMAIL', 'support@nexusai.local')
            target_email = user_email or getattr(settings, 'EMAIL_HOST_USER', None) or support_email

            reauth_url = f"https://nexusai.local/integrations/{provider}/connect"

            context = {
                "company_name": company_name,
                "support_email": support_email,
                "tool_title": tool_title,
                "job_id": job_id,
                "provider": provider,
                "error_message": error_message,
                "reauth_url": reauth_url,
            }

            html_message = render_to_string('emails/webhook_auth_failure.html', context)
            plain_message = (
                f"Webhook OAuth Error for {tool_title}\n"
                f"Job ID: {job_id}\n"
                f"Provider: {provider}\n"
                f"Error: {error_message}\n"
                f"Re-authenticate at: {reauth_url}\n"
            )

            send_mail(
                subject=f"[{company_name}] OAuth Re-authentication Needed for {tool_title}",
                message=plain_message,
                from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', support_email),
                recipient_list=[target_email],
                html_message=html_message,
                fail_silently=True,
            )
            logger.info("Webhook OAuth failure alert sent to %s for job %s", target_email, job_id)
        except Exception as exc:
            logger.warning("Failed to send webhook failure alert email: %s", str(exc))

    @classmethod
    def broadcast_tool_execution_failure_alert(
        cls,
        user_id: str,
        tool_title: str,
        failed_items: list,
        user_email: Optional[str] = None,
    ) -> None:
        """
        Broadcasts in-app WebSocket notification and sends an alert email to user's personal email
        when one or more tool plan items fail validation or execution.
        """
        if not failed_items:
            return

        company_name = getattr(settings, 'COMPANY_NAME', 'NexusAI Agent Systems')
        support_email = getattr(settings, 'COMPANY_SUPPORT_EMAIL', 'support@nexusai.local')
        target_email = user_email or getattr(settings, 'EMAIL_HOST_USER', None) or support_email

        # 1. Real-time WebSocket notification
        try:
            channel_layer = get_channel_layer()
            if channel_layer:
                payload = {
                    "type": "TOOL_EXECUTION_PARTIAL_FAILURE",
                    "tool_title": tool_title,
                    "failure_count": len(failed_items),
                    "failed_items": failed_items,
                }
                async_to_sync(channel_layer.group_send)(
                    f"user_{user_id}",
                    {
                        "type": "tool.failure.notification",
                        "payload": payload,
                    }
                )
                logger.info("Failure alert WebSocket delivered to user_%s for '%s'", user_id, tool_title)
        except Exception as ws_err:
            logger.warning("Failed to dispatch execution failure WebSocket: %s", str(ws_err))

        # 2. Email alert to user's personal email
        try:
            failure_lines = []
            for idx, item in enumerate(failed_items, 1):
                tool = item.get("tool", "unknown_tool")
                ref = item.get("item_reference", f"Item #{idx}")
                err = item.get("error_message", "Unknown error")
                err_type = item.get("error_type", "error")
                failure_lines.append(f"{idx}. [{tool.upper()}] Item: {ref} | Type: {err_type} | Issue: {err}")

            failures_text = "\n".join(failure_lines)

            plain_message = (
                f"Tool Execution Warning for '{tool_title}'\n\n"
                f"The following {len(failed_items)} item(s) could not be processed during tool execution:\n\n"
                f"{failures_text}\n\n"
                f"All valid items were successfully processed. Please review the item data or configurations above.\n\n"
                f"— {company_name}"
            )

            send_mail(
                subject=f"[{company_name}] Execution Warning: {len(failed_items)} item(s) failed in {tool_title}",
                message=plain_message,
                from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', support_email),
                recipient_list=[target_email],
                fail_silently=True,
            )
            logger.info("Tool failure alert email dispatched to %s for tool '%s'", target_email, tool_title)
        except Exception as mail_err:
            logger.warning("Failed to dispatch tool failure alert email: %s", str(mail_err))

    @classmethod
    def broadcast_webhook_completion(
        cls,
        user_id: str,
        tool_title: str,
        status: str,
        summary: str,
        result: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None,
        user_email: Optional[str] = None,
    ) -> None:
        """
        Dispatches real-time WebSocket notification and optional email when an asynchronous
        webhook background execution finishes (completed or failed).
        """
        company_name = getattr(settings, 'COMPANY_NAME', 'NexusAI Agent Systems')
        support_email = getattr(settings, 'COMPANY_SUPPORT_EMAIL', 'support@nexusai.local')
        target_email = user_email or getattr(settings, 'EMAIL_HOST_USER', None) or support_email

        # 1. Real-time WebSocket event
        try:
            channel_layer = get_channel_layer()
            if channel_layer:
                payload = {
                    "type": "WEBHOOK_EXECUTION_COMPLETED" if status == "completed" else "WEBHOOK_EXECUTION_FAILED",
                    "status": status,
                    "tool_title": tool_title,
                    "summary": summary,
                    "result": result or {},
                    "error": error_message,
                }
                async_to_sync(channel_layer.group_send)(
                    f"user_{user_id}",
                    {
                        "type": "webhook.notification",
                        "payload": payload,
                    }
                )
                logger.info("Webhook completion WebSocket delivered to user_%s for '%s' (status: %s)", user_id, tool_title, status)
        except Exception as ws_err:
            logger.warning("Failed to dispatch webhook completion WebSocket: %s", str(ws_err))

        # 2. Email alert if execution failed
        if status == "failed" and error_message and target_email:
            try:
                plain_message = (
                    f"Webhook Processing Alert for '{tool_title}'\n\n"
                    f"Status: Failed\n"
                    f"Error Details: {error_message}\n\n"
                    f"Summary: {summary}\n\n"
                    f"— {company_name}"
                )
                send_mail(
                    subject=f"[{company_name}] Webhook Execution Failed: {tool_title}",
                    message=plain_message,
                    from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', support_email),
                    recipient_list=[target_email],
                    fail_silently=True,
                )
                logger.info("Webhook failure email alert sent to %s for tool '%s'", target_email, tool_title)
            except Exception as mail_err:
                logger.warning("Failed to dispatch webhook failure email alert: %s", str(mail_err))

    @classmethod
    def broadcast_step_progress(
        cls,
        user_id: str,
        tool_title: str,
        step_name: str,
        details: str,
        status: str = "completed",
        step_index: int = 1,
        total_steps: int = 4,
    ) -> None:
        """
        Broadcasts on-app WebSocket notification only (STRICTLY NO EMAIL) for execution step progression.
        """
        if not user_id:
            return

        try:
            channel_layer = get_channel_layer()
            if channel_layer:
                payload = {
                    "type": "STEP_PROGRESS",
                    "tool_title": tool_title,
                    "step_name": step_name,
                    "details": details,
                    "status": status,
                    "step_index": step_index,
                    "total_steps": total_steps,
                    "timestamp": timezone.now().isoformat(),
                }
                async_to_sync(channel_layer.group_send)(
                    f"user_{user_id}",
                    {
                        "type": "step.notification",
                        "payload": payload,
                    }
                )
                logger.info("Step progress WebSocket broadcast to user_%s: [%s] %s", user_id, step_name, details)
        except Exception as ws_err:
            logger.warning("Failed to dispatch step progress WebSocket: %s", str(ws_err))

