import hashlib
import json
import logging
from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework import serializers

from .models import CustomTool, FailedWebhookJob, UserToolDeployment, WebhookEventJob
from .serializers import UserToolDeploymentSerializer
from .services.oauth_service import OAuthService
from .services.notification_service import NotificationService
from .services.app_logger import AppLogger
from .services.webhook_queue import WebhookQueue

logger = logging.getLogger(__name__)


class UserToolDeployRequestSerializer(serializers.Serializer):
    tool_id = serializers.IntegerField(required=True)
    user_id = serializers.CharField(required=True)
    config_data = serializers.DictField(required=False, default=dict)


class UserToolDeployView(APIView):
    """
    POST /api/tools/deploy/
    Deploys a personal instance of a CustomTool for a specific user, generating a unique
    webhook URL and saving their user settings (e.g. user_email, forwarding endpoints).

    GET /api/tools/deploy/?user_id=...&tool_id=...
    Lists all deployed tool instances for a user (optionally filtered by tool_id).
    """
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        user_id = getattr(request.user, 'user_id', None) or request.headers.get('X-User-Id') or request.query_params.get('user_id')
        if not user_id:
            return Response({"error": "user_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        queryset = UserToolDeployment.objects.filter(user_id=user_id, is_active=True).select_related('tool')
        tool_id = request.query_params.get('tool_id')
        if tool_id:
            queryset = queryset.filter(tool_id=tool_id)

        serializer = UserToolDeploymentSerializer(queryset, many=True, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        serializer = UserToolDeployRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tool_id = serializer.validated_data['tool_id']
        user_id = getattr(request.user, 'user_id', None) or request.headers.get('X-User-Id') or serializer.validated_data['user_id']
        config_data = serializer.validated_data.get('config_data', {})

        tool = CustomTool.objects.filter(id=tool_id).first()
        if not tool:
            return Response({"error": "Tool not found."}, status=status.HTTP_404_NOT_FOUND)

        deployment = UserToolDeployment.objects.create(
            tool=tool,
            user_id=user_id,
            config_data=config_data,
        )

        AppLogger.step(
            "UserToolDeployView",
            f"Personal tool instance deployed for user '{user_id}' on tool '{tool.title}' (ID: {tool_id})",
            {
                "tool_id": tool_id,
                "user_id": user_id,
                "user_webhook_secret": str(deployment.user_webhook_secret),
                "config_keys": list(config_data.keys()),
            }
        )

        serializer_out = UserToolDeploymentSerializer(deployment, context={'request': request})
        return Response(serializer_out.data, status=status.HTTP_201_CREATED)


class WebhookIngestView(APIView):
    """
    POST /api/webhooks/<uuid:webhook_secret>/
    Universal Inbound Webhook Ingestion Engine with:
    1. Endpoint Rate Limiting (Supabase Postgres-backed).
    2. Idempotency Key deduplication (with SHA-256 payload hash fallback).
    3. Asynchronous Database-Backed Job Queue for immediate <30ms response.
    4. Background Agent Graph execution with user notification on completion/error.
    """
    permission_classes = [AllowAny]

    def post(self, request, webhook_secret, *args, **kwargs):
        # 1. Lookup deployment or base tool
        deployment = UserToolDeployment.objects.filter(user_webhook_secret=webhook_secret, is_active=True).first()
        if deployment:
            tool = deployment.tool
            effective_user_id = deployment.user_id
            deploy_tool_data = deployment.config_data or {}
        else:
            tool = CustomTool.objects.filter(webhook_secret=webhook_secret).first()
            effective_user_id = tool.author_id if tool else None
            deploy_tool_data = {}

        if not tool:
            AppLogger.error("Webhook Ingestion", f"Invalid webhook endpoint: token '{webhook_secret}' not found.")
            return Response(
                {"error": "Invalid webhook endpoint. Tool deployment not found."},
                status=status.HTTP_404_NOT_FOUND
            )

        # 2. Extract Standardized 4 Data Fields
        raw_payload = request.data
        webhook_data = raw_payload

        if not isinstance(deploy_tool_data, dict):
            deploy_tool_data = {}

        deployer_data = {
            "user_id": effective_user_id or "",
            "name": deploy_tool_data.get("user_name") or deploy_tool_data.get("name") or "",
            "email": deploy_tool_data.get("personal_email") or deploy_tool_data.get("email") or "",
            "phone": deploy_tool_data.get("phone") or deploy_tool_data.get("phone_number") or "",
        }

        tool_owner_data = {
            "user_id": tool.author_id if tool else "",
            "name": "",
            "email": "",
            "phone": "",
        }

        # 3. Endpoint Rate Limiting (Pure Supabase Postgres)
        one_minute_ago = timezone.now() - timezone.timedelta(seconds=60)
        rate_limit_per_min = getattr(settings, 'WEBHOOK_RATE_LIMIT_PER_MIN', 60)
        recent_requests_count = WebhookEventJob.objects.filter(
            tool=tool,
            deployment=deployment,
            created_at__gte=one_minute_ago
        ).count()

        if recent_requests_count >= rate_limit_per_min:
            AppLogger.error(
                "Webhook Ingestion",
                f"Rate limit exceeded on '{tool.title}' ({recent_requests_count}/{rate_limit_per_min} req/min)"
            )
            return Response(
                {
                    "error": "Rate limit exceeded. Too many requests for this webhook endpoint.",
                    "limit": f"{rate_limit_per_min} requests/minute",
                    "retry_after_seconds": 60,
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )

        # 4. Extract Idempotency Key (Header -> Payload ID -> SHA-256 Body Hash)
        raw_key = (
            request.headers.get("X-Idempotency-Key")
            or request.headers.get("Idempotency-Key")
            or request.headers.get("X-Webhook-Id")
            or request.headers.get("X-GitHub-Delivery")
        )

        if not raw_key and isinstance(raw_payload, dict):
            raw_key = raw_payload.get("event_id") or raw_payload.get("id") or raw_payload.get("order_id")

        if not raw_key:
            # Deterministic SHA-256 hash of webhook endpoint + canonical payload JSON
            payload_str = json.dumps(raw_payload, sort_keys=True, default=str)
            raw_key = hashlib.sha256(f"{webhook_secret}:{payload_str}".encode("utf-8")).hexdigest()

        idempotency_key = str(raw_key).strip()

        # 5. Idempotency Deduplication Check
        existing_job = WebhookEventJob.objects.filter(tool=tool, idempotency_key=idempotency_key).first()
        if existing_job:
            if existing_job.status in ['queued', 'processing']:
                AppLogger.step(
                    "Webhook Ingestion",
                    f"Idempotent duplicate webhook in progress for '{tool.title}'. Returning 202 Accepted.",
                    {"job_id": existing_job.id, "idempotency_key": idempotency_key}
                )
                return Response(
                    {
                        "status": "processing",
                        "message": "This webhook event is already being processed.",
                        "job_id": existing_job.id,
                        "idempotency_key": idempotency_key,
                    },
                    status=status.HTTP_202_ACCEPTED
                )
            elif existing_job.status == 'completed':
                AppLogger.step(
                    "Webhook Ingestion",
                    f"Idempotent duplicate webhook already completed for '{tool.title}'. Returning cached 200.",
                    {"job_id": existing_job.id, "idempotency_key": idempotency_key}
                )
                return Response(
                    {
                        "status": "completed",
                        "message": "Webhook event was previously processed successfully.",
                        "job_id": existing_job.id,
                        "idempotency_key": idempotency_key,
                        "result": existing_job.result,
                    },
                    status=status.HTTP_200_OK
                )
            elif existing_job.status == 'pending_hitl':
                return Response(
                    {
                        "status": "pending_human_approval",
                        "message": "Webhook execution is paused awaiting Human-In-The-Loop approval.",
                        "job_id": existing_job.id,
                        "idempotency_key": idempotency_key,
                        "thread_id": existing_job.thread_id,
                    },
                    status=status.HTTP_202_ACCEPTED
                )

        # 6. Check OAuth Requirements
        if tool.requires_oauth and tool.oauth_provider != 'none':
            success, access_token, err_msg = OAuthService.get_or_refresh_token(
                user_id=effective_user_id or tool.author_id,
                provider=tool.oauth_provider
            )

            if not success:
                AppLogger.error(
                    "Webhook Ingestion",
                    f"OAuth token missing or refresh failed for tool '{tool.title}' ({tool.oauth_provider}): {err_msg}"
                )
                AppLogger.log_critical(
                    message=f"Webhook OAuth check failure for provider '{tool.oauth_provider}': {err_msg}",
                    category="webhook_error",
                    tool=tool,
                    tool_name=tool.title,
                    tool_slug=tool.slug,
                    deploy_tool_data=deploy_tool_data,
                    webhook_data=webhook_data,
                    deployer_data=deployer_data,
                    tool_owner_data=tool_owner_data,
                    execution_context={"webhook_secret": str(webhook_secret), "provider": tool.oauth_provider}
                )

                failed_job = FailedWebhookJob.objects.create(
                    tool=tool,
                    payload={"webhook_payload": raw_payload},
                    status='pending_reauth',
                    error_message=err_msg
                )

                NotificationService.send_webhook_auth_failure_email(
                    tool_title=tool.title,
                    job_id=failed_job.id,
                    provider=tool.oauth_provider,
                    error_message=err_msg or "OAuth token missing or refresh failed."
                )

                return Response(
                    {
                        "status": "pending_reauth",
                        "job_id": failed_job.id,
                        "error": err_msg,
                        "message": f"Webhook payload enqueued in dead-letter queue. Re-authentication required for {tool.oauth_provider}."
                    },
                    status=status.HTTP_401_UNAUTHORIZED
                )

        # 7. Create WebhookEventJob in Supabase Postgres and Enqueue for Background Execution
        job = WebhookEventJob.objects.create(
            tool=tool,
            deployment=deployment,
            user_id=effective_user_id or tool.author_id,
            idempotency_key=idempotency_key,
            status='queued',
            deploy_tool_data=deploy_tool_data,
            webhook_data=webhook_data,
            deployer_data=deployer_data,
            tool_owner_data=tool_owner_data,
        )

        # Dispatch background worker execution (non-blocking)
        WebhookQueue.enqueue_job(job.id)

        AppLogger.step(
            "Webhook Ingestion",
            f"Inbound webhook accepted & queued as Job #{job.id} for '{tool.title}'",
            {
                "job_id": job.id,
                "idempotency_key": idempotency_key,
                "status": "queued",
            }
        )

        # 8. Return IMMEDIATE HTTP 202 Response to Webhook Caller (< 30ms)
        return Response(
            {
                "status": "queued",
                "message": "Webhook payload received and queued for background agent execution.",
                "job_id": job.id,
                "idempotency_key": idempotency_key,
                "tool_id": tool.id,
                "tool_title": tool.title,
            },
            status=status.HTTP_202_ACCEPTED
        )


class WebhookJobStatusView(APIView):
    """
    GET /api/webhooks/jobs/<int:job_id>/
    Polls the current execution status and result of a queued webhook job.
    """
    permission_classes = [AllowAny]

    def get(self, request, job_id, *args, **kwargs):
        job = WebhookEventJob.objects.select_related('tool').filter(id=job_id).first()
        if not job:
            return Response({"error": "Webhook job not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response(
            {
                "job_id": job.id,
                "tool_id": job.tool_id,
                "tool_title": job.tool.title,
                "status": job.status,
                "idempotency_key": job.idempotency_key,
                "thread_id": job.thread_id,
                "result": job.result,
                "error_message": job.error_message,
                "created_at": job.created_at,
                "updated_at": job.updated_at,
            },
            status=status.HTTP_200_OK
        )
