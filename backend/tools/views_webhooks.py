from tools.models import UserOAuthToken
import hashlib
import json
import logging
import uuid
from typing import Optional, Dict, Any, List
import requests
from django.conf import settings
from django.db import models
from django.utils import timezone
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework import serializers

from .models import CustomTool, FailedWebhookJob, UserToolDeployment, WebhookEventJob, SharedUserAsset
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
    requires_hitl = serializers.BooleanField(required=False, default=False)
    email_service = serializers.CharField(required=False, default='none')
    google_email = serializers.CharField(required=False, default='', allow_blank=True)
    google_app_password = serializers.CharField(required=False, default='', allow_blank=True)


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

        requires_hitl = serializer.validated_data.get('requires_hitl')
        if requires_hitl is None:
            requires_hitl = request.data.get('requires_hitl')
        if requires_hitl is None:
            requires_hitl = config_data.get('requires_hitl', False)
        requires_hitl = bool(requires_hitl)
        config_data['requires_hitl'] = requires_hitl

        # Parse email_service from request or config_data
        email_service = serializer.validated_data.get('email_service') or request.data.get('email_service')
        if not email_service or email_service == 'none':
            channel_choice = config_data.get('email_channel_choice') or config_data.get('email_service')
            if channel_choice == 'oauth' or channel_choice == 'gmail':
                email_service = 'gmail'
            elif channel_choice == 'app_password' or channel_choice == 'google_app_password':
                email_service = 'google_app_password'
            elif channel_choice in ['company_email', 'smtp']:
                email_service = 'company_email'
            elif channel_choice in ['platform', 'default']:
                email_service = 'platform_default'
            else:
                email_service = 'none'

        google_email = (
            serializer.validated_data.get('google_email')
            or request.data.get('google_email')
            or config_data.get('gmail_app_email')
            or config_data.get('user_email')
            or config_data.get('personal_email')
            or ""
        )
        google_app_password = (
            serializer.validated_data.get('google_app_password')
            or request.data.get('google_app_password')
            or config_data.get('gmail_app_password')
            or ""
        )

        deployment = UserToolDeployment.objects.create(
            tool=tool,
            user_id=user_id,
            config_data=config_data,
            requires_hitl=requires_hitl,
            email_service=email_service,
            google_email=google_email,
            google_app_password=google_app_password,
        )

        # Connect any associated Google asset to this deployed instance
        from tools.models import SharedUserAsset
        target_file_id = (
            config_data.get("google_file_id")
            or config_data.get("spreadsheet_id")
            or config_data.get("google_sheet_id")
            or config_data.get("file_id")
        )
        if target_file_id:
            SharedUserAsset.objects.filter(
                user_id=user_id,
                google_file_or_folder_id=str(target_file_id)
            ).update(deployment=deployment)

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
            deploy_tool_data = dict(deployment.config_data or {})
            deploy_tool_data["requires_hitl"] = deployment.requires_hitl
            deploy_tool_data["email_service"] = deployment.email_service
            deploy_tool_data["google_email"] = deployment.google_email
            deploy_tool_data["google_app_password"] = deployment.google_app_password
        else:
            tool = CustomTool.objects.filter(webhook_secret=webhook_secret).first()
            effective_user_id = tool.author_id if tool else None
            deploy_tool_data = {"requires_hitl": False, "email_service": "none"}

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

        # Resolve deployer user email
        deployer_email = (
            deploy_tool_data.get("user_email")
            or deploy_tool_data.get("personal_email")
            or deploy_tool_data.get("email")
            or deploy_tool_data.get("google_email")
            or (deployment.google_email if deployment else "")
            or ""
        )
        if not deployer_email and effective_user_id:
            tok = UserOAuthToken.objects.filter(user_id=effective_user_id).exclude(account_email="").first()
            if tok and tok.account_email:
                deployer_email = tok.account_email

        deployer_data = {
            "user_id": effective_user_id or "",
            "name": deploy_tool_data.get("user_name") or deploy_tool_data.get("name") or "",
            "email": deployer_email,
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
        # A tool requires OAuth if:
        # - tool.requires_oauth and tool.oauth_provider != 'none'
        # - OR tool has Google products other than Gmail (sheets, drive, docs, forms, calendar, meet)
        # - OR the deployment specifically chose Gmail OAuth (deployment.email_service == 'gmail' or email_channel_choice == 'oauth')
        has_non_gmail_google_prods = any(
            str(p).lower().strip() not in ['gmail', 'mail', 'email', 'none', '']
            for p in (tool.google_products or [])
        )
        deployment_needs_gmail_oauth = False
        if deployment:
            cfg = deployment.config_data or {}
            deployment_needs_gmail_oauth = (
                deployment.email_service == 'gmail'
                or cfg.get('email_service') == 'gmail'
                or cfg.get('email_channel_choice') == 'oauth'
            )

        tool_needs_oauth = bool(tool.requires_oauth and tool.oauth_provider != 'none')
        needs_oauth = tool_needs_oauth or has_non_gmail_google_prods or deployment_needs_gmail_oauth
        target_oauth_provider = (
            tool.oauth_provider
            if (tool.oauth_provider and tool.oauth_provider != 'none')
            else 'google'
        )

        if needs_oauth:
            target_user_id = effective_user_id or (deployment.user_id if deployment else tool.author_id)
            candidate_uids = [
                target_user_id,
                deployment.user_id if deployment else None,
                tool.author_id,
            ]
            candidate_uids = [u for u in candidate_uids if u]

            success = False
            err_msg = None
            token_record = None
            for c_uid in candidate_uids:
                token_record = UserOAuthToken.objects.filter(user_id=c_uid, provider=target_oauth_provider).first()
                if token_record:
                    target_user_id = c_uid
                    break

            if not token_record:
                success = False
                err_msg = f"No {target_oauth_provider.capitalize()} OAuth credentials found for user '{target_user_id}'. Authorization required before executing tool."
            elif target_oauth_provider == 'google':
                # Live verification with Google's tokeninfo API to ensure grant is active and not revoked
                is_active, email, granted_scopes, check_err = OAuthService.verify_and_sync_google_token(token_record)
                if not is_active:
                    success = False
                    err_msg = check_err or "Google OAuth authorization was revoked or expired."
                else:
                    # Verify required scopes are granted
                    if deployment_needs_gmail_oauth:
                        has_gmail = any('gmail' in s.lower() for s in granted_scopes)
                        if not has_gmail:
                            success = False
                            err_msg = f"Google account ({email}) is connected, but Gmail send permission (gmail.send) was not granted."
                        else:
                            success = True
                    else:
                        success = True

                    if success and has_non_gmail_google_prods:
                        has_drive = any(('drive' in s.lower() or 'spreadsheet' in s.lower() or 'doc' in s.lower()) for s in granted_scopes)
                        if not has_drive:
                            success = False
                            err_msg = f"Google account ({email}) is connected, but Google Drive / Sheets permissions are missing."
            else:
                success, access_token, err_msg = OAuthService.get_or_refresh_token(
                    user_id=target_user_id,
                    provider=target_oauth_provider
                )

            if not success:
                AppLogger.error(
                    "Webhook Ingestion",
                    f"OAuth token missing or refresh failed for tool '{tool.title}' ({target_oauth_provider}): {err_msg}"
                )
                AppLogger.log_critical(
                    message=f"Webhook OAuth check failure for provider '{target_oauth_provider}': {err_msg}",
                    category="webhook_error",
                    tool=tool,
                    tool_name=tool.title,
                    tool_slug=tool.slug,
                    deploy_tool_data=deploy_tool_data,
                    webhook_data=webhook_data,
                    deployer_data=deployer_data,
                    tool_owner_data=tool_owner_data,
                    execution_context={"webhook_secret": str(webhook_secret), "provider": target_oauth_provider}
                )

                failed_job = FailedWebhookJob.objects.create(
                    tool=tool,
                    deployment=deployment,
                    payload={
                        "webhook_payload": raw_payload,
                        "deployment_id": deployment.id if deployment else None,
                        "user_id": target_user_id,
                        "webhook_secret": str(webhook_secret),
                        "idempotency_key": idempotency_key,
                        "deploy_tool_data": deploy_tool_data,
                        "deployer_data": deployer_data,
                        "tool_owner_data": tool_owner_data,
                        "tool_data": {
                            "id": tool.id,
                            "title": tool.title,
                            "description": tool.description,
                            "slug": tool.slug,
                            "requires_oauth": tool.requires_oauth,
                            "oauth_provider": target_oauth_provider,
                            "add_gmail_oauth_flag": tool.add_gmail_oauth_flag,
                            "google_products": tool.google_products or [],
                            "google_auth_mode": tool.google_auth_mode,
                            "tasks": tool.tasks,
                        },
                    },
                    status='pending_reauth',
                    error_message=err_msg
                )

                deployer_email = (
                    deployer_data.get("email")
                    or (deploy_tool_data or {}).get("personal_email")
                    or (deployment.config_data.get("user_email") if deployment else None)
                    or getattr(settings, 'EMAIL_HOST_USER', None)
                )

                frontend_base = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000').rstrip('/')
                reauth_url = f"{frontend_base}/tools/oauth-reauth?job_id={failed_job.id}&tool_id={tool.id}"
                if deployment:
                    reauth_url += f"&deployment_id={deployment.id}"

                NotificationService.send_webhook_auth_failure_email(
                    tool_title=tool.title,
                    job_id=failed_job.id,
                    provider=target_oauth_provider,
                    error_message=err_msg or "OAuth token missing or refresh failed.",
                    user_email=deployer_email,
                    reauth_url=reauth_url,
                )

                AppLogger.step(
                    "Webhook Ingestion",
                    f"OAuth re-authentication required for '{tool.title}' ({target_oauth_provider}): {err_msg}. Saved in dead-letter table as Job #{failed_job.id}. Returning 202 queued response to caller.",
                    {"job_id": failed_job.id, "idempotency_key": idempotency_key}
                )

                # Return same response as success to webhook caller (< 30ms)
                return Response(
                    {
                        "status": "queued",
                        "message": "Webhook payload received and queued for background agent execution.",
                        "job_id": failed_job.id,
                        "idempotency_key": idempotency_key,
                        "tool_id": tool.id,
                        "tool_title": tool.title,
                    },
                    status=status.HTTP_202_ACCEPTED
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


def check_and_sync_google_file_access(deployment, asset=None, user_id=None):
    """
    Checks access to the deployment's connected Google file via Google Drive API:
    GET https://www.googleapis.com/drive/v3/files/{saved_file_id}?fields=id,name,mimeType,trashed
    If accessible (HTTP 200 and not trashed): marks asset is_active=True, is_verified=True.
    If not accessible (HTTP 403, 404, or trashed): marks asset is_active=False, is_verified=False.
    Returns: (is_accessible: bool, asset: SharedUserAsset, err_msg: Optional[str])
    """
    if not deployment and not asset:
        return False, None, "No deployment or asset provided."

    target_user_id = user_id or (deployment.user_id if deployment else getattr(asset, 'user_id', None))
    if not target_user_id:
        return False, asset, "No user ID available for OAuth token lookup."

    target_asset = asset
    if not target_asset and deployment:
        target_asset = SharedUserAsset.objects.filter(deployment=deployment, is_active=True).first()
        if not target_asset:
            target_asset = SharedUserAsset.objects.filter(deployment=deployment).first()

    saved_file_id = None
    if target_asset:
        saved_file_id = target_asset.google_file_or_folder_id
    elif deployment and deployment.config_data:
        saved_file_id = deployment.config_data.get("google_file_id")

    if not saved_file_id:
        return False, None, "No Google file ID configured for this deployment."

    # If asset record doesn't exist yet for this file, create one
    if not target_asset and deployment:
        target_asset, _ = SharedUserAsset.objects.get_or_create(
            user_id=target_user_id,
            google_file_or_folder_id=str(saved_file_id).strip(),
            defaults={
                "deployment": deployment,
                "asset_name": (deployment.config_data or {}).get("google_file_name", "Connected File"),
                "product_name": "sheets",
                "delegation_type": "granular_picker",
                "is_active": True,
                "is_verified": False,
            }
        )

    # Lookup OAuth token
    success, access_token, err = OAuthService.get_or_refresh_token(
        user_id=target_user_id,
        provider='google'
    )
    if not success or not access_token:
        if target_asset:
            target_asset.is_verified = False
            target_asset.last_error = f"OAuth token not available: {err}"
            target_asset.save(update_fields=["is_verified", "last_error", "updated_at"])
        return False, target_asset, f"OAuth token not available: {err}"

    # Call Google Drive API to verify per-file access
    try:
        drive_url = f"https://www.googleapis.com/drive/v3/files/{saved_file_id}?fields=id,name,mimeType,trashed"
        resp = requests.get(
            drive_url,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10
        )

        if resp.status_code == 200:
            file_data = resp.json()
            if file_data.get("trashed"):
                if target_asset:
                    target_asset.is_active = False
                    target_asset.is_verified = False
                    target_asset.last_error = "File is in Google Drive trash."
                    target_asset.save(update_fields=["is_active", "is_verified", "last_error", "updated_at"])
                return False, target_asset, "File has been moved to Google Drive trash."

            # File is accessible!
            if target_asset:
                target_asset.is_active = True
                target_asset.is_verified = True
                target_asset.verified_at = timezone.now()
                target_asset.last_error = None
                if file_data.get("name"):
                    target_asset.asset_name = file_data.get("name")
                if file_data.get("mimeType"):
                    target_asset.mime_type = file_data.get("mimeType")
                target_asset.save(update_fields=["is_active", "is_verified", "verified_at", "last_error", "asset_name", "mime_type", "updated_at"])

            if deployment:
                deployment.config_data = deployment.config_data or {}
                deployment.config_data["google_file_id"] = saved_file_id
                deployment.config_data["google_file_name"] = target_asset.asset_name if target_asset else file_data.get("name")
                deployment.config_data.pop("google_file_id_status", None)
                deployment.save(update_fields=["config_data", "updated_at"])

            return True, target_asset, None

        elif resp.status_code in [403, 404]:
            err_detail = "Access to file was revoked in Google Drive." if resp.status_code == 403 else "File not found or permission revoked."
            if target_asset:
                target_asset.is_active = False
                target_asset.is_verified = False
                target_asset.last_error = f"{err_detail} (HTTP {resp.status_code})"
                target_asset.save(update_fields=["is_active", "is_verified", "last_error", "updated_at"])

            if deployment:
                deployment.config_data = deployment.config_data or {}
                deployment.config_data["google_file_id_status"] = "revoked"
                deployment.save(update_fields=["config_data", "updated_at"])

            return False, target_asset, err_detail
        else:
            err_msg = f"Google Drive API error (HTTP {resp.status_code}): {resp.text[:100]}"
            if target_asset:
                target_asset.last_error = err_msg
                target_asset.save(update_fields=["last_error", "updated_at"])
            return False, target_asset, err_msg

    except Exception as exc:
        err_msg = f"Network exception checking file access: {str(exc)}"
        if target_asset:
            target_asset.last_error = err_msg
            target_asset.save(update_fields=["last_error", "updated_at"])
        return False, target_asset, err_msg


class FailedWebhookInfoView(APIView):
    """
    GET /api/tools/failed-webhook/<int:job_id>/
    Fetches tool metadata, deployment parameters, connected assets, and error details
    for the dedicated OAuth re-authentication page. Automatically verifies file accessibility.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, job_id, *args, **kwargs):
        failed_job = FailedWebhookJob.objects.select_related('tool', 'deployment').filter(pk=job_id).first()
        if not failed_job:
            return Response({"error": "Failed webhook record not found or already resolved."}, status=status.HTTP_404_NOT_FOUND)

        tool = failed_job.tool
        deployment = failed_job.deployment or (UserToolDeployment.objects.filter(pk=failed_job.payload.get("deployment_id")).first() if failed_job.payload.get("deployment_id") else None)

        # Count pending failed webhooks for this deployment
        pending_count = 1
        if deployment:
            pending_count = FailedWebhookJob.objects.filter(
                models.Q(deployment=deployment) | models.Q(payload__deployment_id=deployment.id),
                status='pending_reauth'
            ).count()

        # Check active asset and file history for this deployment
        active_asset = None
        file_history_qs = []
        if deployment:
            file_history_qs = list(SharedUserAsset.objects.filter(deployment=deployment).order_by('-updated_at'))
            active_asset = next((a for a in file_history_qs if a.is_active), None)
            if not active_asset and file_history_qs:
                active_asset = file_history_qs[0]
        elif request.user:
            user_ident = getattr(request.user, 'user_id', None) or getattr(request.user, 'username', '')
            file_history_qs = list(SharedUserAsset.objects.filter(user_id=user_ident).order_by('-updated_at')[:10])
            active_asset = next((a for a in file_history_qs if a.is_active), None) or (file_history_qs[0] if file_history_qs else None)

        # Perform auto-check if active asset or saved_file_id exists
        auto_check_performed = False
        is_accessible = False
        check_error = None
        eff_uid = failed_job.payload.get("user_id") or (deployment.user_id if deployment else getattr(request.user, 'user_id', None))

        if active_asset or (deployment and (deployment.config_data or {}).get("google_file_id")):
            is_accessible, active_asset, check_error = check_and_sync_google_file_access(
                deployment=deployment,
                asset=active_asset,
                user_id=eff_uid
            )
            auto_check_performed = True

        connected_asset_data = None
        if active_asset:
            connected_asset_data = {
                "id": active_asset.id,
                "asset_name": active_asset.asset_name,
                "google_file_or_folder_id": active_asset.google_file_or_folder_id,
                "product_name": active_asset.product_name,
                "is_verified": active_asset.is_verified,
                "is_active": active_asset.is_active,
                "description": active_asset.description,
                "last_error": active_asset.last_error,
                "verified_at": active_asset.verified_at,
            }

        # Serialized file history for the deployment
        file_history_data = []
        if deployment:
            file_history_qs = SharedUserAsset.objects.filter(deployment=deployment).order_by('-updated_at')
        for h_asset in file_history_qs:
            file_history_data.append({
                "id": h_asset.id,
                "asset_name": h_asset.asset_name,
                "google_file_or_folder_id": h_asset.google_file_or_folder_id,
                "product_name": h_asset.product_name,
                "is_verified": h_asset.is_verified,
                "is_active": h_asset.is_active,
                "description": h_asset.description,
                "last_error": h_asset.last_error,
                "updated_at": h_asset.updated_at,
            })

        tool_data_saved = (failed_job.payload or {}).get("tool_data") or {}

        return Response({
            "job_id": failed_job.id,
            "status": failed_job.status,
            "error_message": failed_job.error_message,
            "created_at": failed_job.created_at,
            "pending_failed_count": pending_count,
            "user_id": eff_uid or (tool.author_id if tool else ""),
            "tool": {
                "id": tool.id if tool else tool_data_saved.get("id"),
                "title": tool.title if tool else tool_data_saved.get("title", ""),
                "description": tool.description if tool else tool_data_saved.get("description", ""),
                "slug": tool.slug if tool else tool_data_saved.get("slug", ""),
                "requires_oauth": tool.requires_oauth if tool else tool_data_saved.get("requires_oauth", False),
                "oauth_provider": tool.oauth_provider if tool else tool_data_saved.get("oauth_provider", "none"),
                "add_gmail_oauth_flag": tool.add_gmail_oauth_flag if tool else tool_data_saved.get("add_gmail_oauth_flag", False),
                "google_products": (tool.google_products if tool else tool_data_saved.get("google_products")) or [],
                "google_auth_mode": tool.google_auth_mode if tool else tool_data_saved.get("google_auth_mode", "none"),
                "tasks": tool.tasks if tool else tool_data_saved.get("tasks", ""),
            },
            "deployment": {
                "id": deployment.id if deployment else None,
                "user_webhook_secret": str(deployment.user_webhook_secret) if deployment else None,
                "config_data": deployment.config_data if deployment else {},
            } if deployment else None,
            "connected_asset": connected_asset_data,
            "file_history": file_history_data,
            "file_access_check": {
                "performed": auto_check_performed,
                "is_accessible": is_accessible,
                "error": check_error,
            }
        }, status=status.HTTP_200_OK)


class FailedWebhookFileCheckView(APIView):
    """
    POST /api/tools/failed-webhook/<int:job_id>/check-file-access/
    Explicitly triggers an auto-check against Google Drive API for the file connected to this deployment.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, job_id, *args, **kwargs):
        failed_job = FailedWebhookJob.objects.select_related('tool', 'deployment').filter(pk=job_id).first()
        if not failed_job:
            return Response({"error": "Failed webhook record not found."}, status=status.HTTP_404_NOT_FOUND)

        deployment = failed_job.deployment or (UserToolDeployment.objects.filter(pk=failed_job.payload.get("deployment_id")).first() if failed_job.payload.get("deployment_id") else None)
        eff_uid = failed_job.payload.get("user_id") or (deployment.user_id if deployment else getattr(request.user, 'user_id', None))

        is_accessible, asset, err = check_and_sync_google_file_access(
            deployment=deployment,
            user_id=eff_uid
        )

        connected_asset_data = None
        if asset:
            connected_asset_data = {
                "id": asset.id,
                "asset_name": asset.asset_name,
                "google_file_or_folder_id": asset.google_file_or_folder_id,
                "product_name": asset.product_name,
                "is_verified": asset.is_verified,
                "is_active": asset.is_active,
                "description": asset.description,
                "last_error": asset.last_error,
                "verified_at": asset.verified_at,
            }

        file_history_data = []
        if deployment:
            for h_asset in SharedUserAsset.objects.filter(deployment=deployment).order_by('-updated_at'):
                file_history_data.append({
                    "id": h_asset.id,
                    "asset_name": h_asset.asset_name,
                    "google_file_or_folder_id": h_asset.google_file_or_folder_id,
                    "product_name": h_asset.product_name,
                    "is_verified": h_asset.is_verified,
                    "is_active": h_asset.is_active,
                    "description": h_asset.description,
                    "last_error": h_asset.last_error,
                    "updated_at": h_asset.updated_at,
                })

        return Response({
            "success": True,
            "is_accessible": is_accessible,
            "error": err,
            "connected_asset": connected_asset_data,
            "file_history": file_history_data,
        }, status=status.HTTP_200_OK)


class FailedWebhookFileSelectView(APIView):
    """
    POST /api/tools/failed-webhook/<int:job_id>/select-file/
    Selects or re-activates a file for this deployment.
    Deactivates other files for this deployment so one deployment has only one active sheet.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, job_id, *args, **kwargs):
        failed_job = FailedWebhookJob.objects.select_related('tool', 'deployment').filter(pk=job_id).first()
        if not failed_job:
            return Response({"error": "Failed webhook record not found."}, status=status.HTTP_404_NOT_FOUND)

        deployment = failed_job.deployment or (UserToolDeployment.objects.filter(pk=failed_job.payload.get("deployment_id")).first() if failed_job.payload.get("deployment_id") else None)
        if not deployment:
            return Response({"error": "No deployment instance associated with this failed webhook."}, status=status.HTTP_400_BAD_REQUEST)

        file_id = request.data.get("google_file_id") or request.data.get("asset_id")
        if not file_id:
            return Response({"error": "google_file_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        file_id = str(file_id).strip()
        asset_name = request.data.get("asset_name") or "Selected Spreadsheet"
        mime_type = request.data.get("mime_type") or "application/vnd.google-apps.spreadsheet"
        description = request.data.get("description", "")
        eff_uid = failed_job.payload.get("user_id") or deployment.user_id or getattr(request.user, 'user_id', None)

        # 1. Deactivate other files for this deployment
        SharedUserAsset.objects.filter(deployment=deployment).exclude(google_file_or_folder_id=file_id).update(is_active=False)

        # 2. Get or update the chosen file record
        asset, created = SharedUserAsset.objects.get_or_create(
            user_id=eff_uid,
            google_file_or_folder_id=file_id,
            defaults={
                "deployment": deployment,
                "asset_name": asset_name,
                "mime_type": mime_type,
                "product_name": "sheets",
                "delegation_type": "granular_picker",
                "is_active": True,
                "is_verified": True,
                "description": description,
                "verified_at": timezone.now(),
            }
        )
        asset.deployment = deployment
        asset.is_active = True
        asset.is_verified = True
        if asset_name:
            asset.asset_name = asset_name
        if mime_type:
            asset.mime_type = mime_type
        if description is not None:
            asset.description = description
        asset.last_error = None
        asset.verified_at = timezone.now()
        asset.save()

        # 3. Update deployment config_data
        deployment.config_data = deployment.config_data or {}
        deployment.config_data["google_file_id"] = file_id
        deployment.config_data["google_file_name"] = asset.asset_name
        deployment.config_data.pop("google_file_id_status", None)
        deployment.save(update_fields=["config_data", "updated_at"])

        # 4. Serialize
        connected_asset_data = {
            "id": asset.id,
            "asset_name": asset.asset_name,
            "google_file_or_folder_id": asset.google_file_or_folder_id,
            "product_name": asset.product_name,
            "is_verified": asset.is_verified,
            "is_active": asset.is_active,
            "description": asset.description,
            "last_error": asset.last_error,
            "verified_at": asset.verified_at,
        }

        file_history_data = []
        for h_asset in SharedUserAsset.objects.filter(deployment=deployment).order_by('-updated_at'):
            file_history_data.append({
                "id": h_asset.id,
                "asset_name": h_asset.asset_name,
                "google_file_or_folder_id": h_asset.google_file_or_folder_id,
                "product_name": h_asset.product_name,
                "is_verified": h_asset.is_verified,
                "is_active": h_asset.is_active,
                "description": h_asset.description,
                "last_error": h_asset.last_error,
                "updated_at": h_asset.updated_at,
            })

        return Response({
            "success": True,
            "message": f"Spreadsheet '{asset.asset_name}' successfully linked and activated for deployment #{deployment.id}.",
            "connected_asset": connected_asset_data,
            "file_history": file_history_data,
        }, status=status.HTTP_200_OK)


def resume_failed_webhooks_for_deployment(
    deployment: Optional[UserToolDeployment],
    tool: Optional[CustomTool] = None,
    authenticated_uid: Optional[str] = None,
    extra_config: Optional[dict] = None
) -> list:
    """
    Finds all FailedWebhookJob records for a deployment (or tool) in FIFO order,
    converts each into a WebhookEventJob with queued status, dispatches each to WebhookQueue,
    and removes the resolved records from FailedWebhookJob.
    Returns the list of created WebhookEventJob IDs.
    """
    if not deployment and not tool:
        return []

    target_tool = tool or (deployment.tool if deployment else None)

    if deployment:
        query = models.Q(deployment=deployment) | models.Q(payload__deployment_id=deployment.id)
        if deployment.user_id:
            query = query | (models.Q(tool=target_tool, payload__user_id=deployment.user_id))
        failed_jobs_qs = FailedWebhookJob.objects.filter(query, status='pending_reauth').order_by('created_at')
    else:
        query = models.Q(tool=target_tool, status='pending_reauth')
        if authenticated_uid:
            query = query & models.Q(payload__user_id=authenticated_uid)
        failed_jobs_qs = FailedWebhookJob.objects.filter(query).order_by('created_at')

    failed_jobs = list(failed_jobs_qs)
    if not failed_jobs:
        return []

    resumed_ids = []
    for fj in failed_jobs:
        raw_payload = fj.payload.get("webhook_payload", fj.payload)
        deploy_tool_data = (
            (deployment.config_data if deployment else None)
            or fj.payload.get("deploy_tool_data")
            or {}
        )
        if deployment and deployment.config_data:
            deploy_tool_data = {**deploy_tool_data, **deployment.config_data}
        if extra_config and isinstance(extra_config, dict):
            deploy_tool_data = {**deploy_tool_data, **extra_config}

        eff_user = (
            authenticated_uid
            or (deployment.user_id if deployment else None)
            or fj.payload.get("user_id")
            or "default_user"
        )

        deployer_data = fj.payload.get("deployer_data") or {
            "user_id": eff_user,
            "email": (deploy_tool_data or {}).get("personal_email") or "",
        }

        tool_owner_data = fj.payload.get("tool_owner_data") or {
            "user_id": target_tool.author_id if target_tool else "",
        }

        idempotency_key = fj.payload.get("idempotency_key") or f"retry_{fj.id}_{uuid.uuid4().hex[:12]}"

        # Create WebhookEventJob in Supabase Postgres
        new_event = WebhookEventJob.objects.create(
            tool=fj.tool or target_tool,
            deployment=deployment or getattr(fj, 'deployment', None),
            user_id=eff_user,
            idempotency_key=idempotency_key,
            status='queued',
            deploy_tool_data=deploy_tool_data,
            webhook_data=raw_payload,
            deployer_data=deployer_data,
            tool_owner_data=tool_owner_data,
        )

        # Enqueue for background worker execution
        WebhookQueue.enqueue_job(new_event.id)
        resumed_ids.append(new_event.id)

        # Delete the resolved FailedWebhookJob record
        fj.delete()

        AppLogger.step(
            "Webhook Retry",
            f"FailedWebhookJob #{fj.id} resolved & re-enqueued as WebhookEventJob #{new_event.id} for tool '{target_tool.title if target_tool else 'Unknown'}' (Deployment #{deployment.id if deployment else 'none'})."
        )

    return resumed_ids


def resume_ready_failed_webhooks_for_user(user_id: str) -> int:
    """
    Called upon OAuth re-authentication. Checks if user has any pending failed webhooks
    for their deployments. If a deployment has all required configuration (or does not need a picker file),
    automatically executes all pending failed webhooks one by one.
    Returns the total count of resumed webhook jobs.
    """
    if not user_id:
        return 0

    pending_jobs = FailedWebhookJob.objects.filter(
        models.Q(deployment__user_id=user_id) | models.Q(payload__user_id=user_id),
        status='pending_reauth'
    ).select_related('tool', 'deployment')

    if not pending_jobs.exists():
        return 0

    # Group by deployment / tool
    deployment_ids = set()
    standalone_tools = set()
    for pj in pending_jobs:
        if pj.deployment_id:
            deployment_ids.add(pj.deployment_id)
        elif pj.payload.get("deployment_id"):
            deployment_ids.add(pj.payload.get("deployment_id"))
        else:
            standalone_tools.add(pj.tool_id)

    total_resumed = 0
    for dep_id in deployment_ids:
        dep = UserToolDeployment.objects.filter(pk=dep_id).first()
        if not dep:
            continue
        tool = dep.tool

        # Check if deployment requires a picker file that is still missing
        prods = [p.lower() for p in (tool.google_products or [])]
        needs_file = any(p in ["sheets", "drive", "docs"] for p in prods)
        file_choice = (dep.config_data or {}).get("file_access_choice")
        if needs_file and file_choice == 'granular_picker' and not (dep.config_data or {}).get("google_file_id"):
            # Awaiting user file selection on the reauth page, do not auto-resume yet
            continue

        resumed = resume_failed_webhooks_for_deployment(
            deployment=dep,
            tool=tool,
            authenticated_uid=user_id
        )
        total_resumed += len(resumed)

    for tool_id in standalone_tools:
        tool = CustomTool.objects.filter(pk=tool_id).first()
        if tool:
            resumed = resume_failed_webhooks_for_deployment(
                deployment=None,
                tool=tool,
                authenticated_uid=user_id
            )
            total_resumed += len(resumed)

    if total_resumed > 0:
        AppLogger.step(
            "OAuth Re-auth",
            f"Auto-resumed {total_resumed} pending failed webhook(s) for user '{user_id}' following successful OAuth re-authentication."
        )

    return total_resumed


class FailedWebhookRetryView(APIView):
    """
    POST /api/tools/failed-webhook/<int:job_id>/retry/
    Validates that OAuth re-authentication has completed, optionally links a selected asset,
    and resumes ALL pending failed webhooks for that deployment one by one.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, job_id, *args, **kwargs):
        failed_job = FailedWebhookJob.objects.select_related('tool', 'deployment').filter(pk=job_id).first()

        deployment = None
        tool = None

        if failed_job:
            tool = failed_job.tool
            deployment = failed_job.deployment or (UserToolDeployment.objects.filter(pk=failed_job.payload.get("deployment_id")).first() if failed_job.payload.get("deployment_id") else None)
        else:
            deployment_id = request.data.get("deployment_id")
            if deployment_id:
                deployment = UserToolDeployment.objects.filter(pk=deployment_id).first()
                if deployment:
                    tool = deployment.tool

        if not failed_job and not deployment:
            return Response(
                {"error": "Failed webhook record not found or already resolved.", "status": "already_resolved", "success": True},
                status=status.HTTP_200_OK
            )

        # Candidate user IDs to check OAuth token
        candidate_uids = [
            getattr(request.user, 'user_id', None),
            getattr(request.user, 'username', None),
            failed_job.payload.get("user_id") if failed_job else None,
            deployment.user_id if deployment else None,
        ]
        candidate_uids = [uid for uid in candidate_uids if uid]
        effective_user_id = candidate_uids[0] if candidate_uids else "default_user"

        # Verify OAuth token is active / refreshed if required
        has_non_gmail_google_prods = any(
            str(p).lower().strip() not in ['gmail', 'mail', 'email', 'none', '']
            for p in ((tool.google_products if tool else []) or [])
        )
        deployment_needs_gmail_oauth = False
        if deployment:
            cfg = deployment.config_data or {}
            deployment_needs_gmail_oauth = (
                deployment.email_service == 'gmail'
                or cfg.get('email_service') == 'gmail'
                or cfg.get('email_channel_choice') == 'oauth'
            )
        needs_oauth = bool((tool and tool.requires_oauth and tool.oauth_provider != 'none') or has_non_gmail_google_prods or deployment_needs_gmail_oauth)
        target_provider = (
            tool.oauth_provider
            if (tool and tool.oauth_provider and tool.oauth_provider != 'none')
            else 'google'
        )

        if needs_oauth:
            token_valid = False
            token_err = "Token missing or revoked"
            for c_uid in candidate_uids:
                if target_provider == 'google':
                    token_rec = UserOAuthToken.objects.filter(user_id=c_uid, provider='google').first()
                    if token_rec:
                        is_active, email, scopes, g_err = OAuthService.verify_and_sync_google_token(token_rec)
                        if is_active:
                            token_valid = True
                            effective_user_id = c_uid
                            break
                        if g_err:
                            token_err = g_err
                else:
                    success, access_token, err = OAuthService.get_or_refresh_token(
                        user_id=c_uid,
                        provider=target_provider
                    )
                    if success and access_token:
                        token_valid = True
                        effective_user_id = c_uid
                        break
                    if err:
                        token_err = err

            if not token_valid:
                return Response(
                    {"error": f"OAuth authorization is still pending: {token_err}. Please authorize first."},
                    status=status.HTTP_400_BAD_REQUEST
                )

        # If user picked a file on the reauth page, register / link it
        extra_config = {}
        picked_file_id = request.data.get("asset_id") or request.data.get("google_file_id")
        picked_file_name = request.data.get("asset_name") or "Selected Spreadsheet"
        if picked_file_id and deployment:
            clean_file_id = str(picked_file_id).strip()
            description = request.data.get("description", "")
            # Deactivate previous files for this deployment to keep only one active
            SharedUserAsset.objects.filter(deployment=deployment).exclude(google_file_or_folder_id=clean_file_id).update(is_active=False)

            asset, _ = SharedUserAsset.objects.get_or_create(
                user_id=effective_user_id,
                google_file_or_folder_id=clean_file_id,
                defaults={
                    "deployment": deployment,
                    "asset_name": picked_file_name,
                    "product_name": "sheets",
                    "delegation_type": "granular_picker",
                    "is_active": True,
                    "is_verified": True,
                    "description": description or "",
                    "verified_at": timezone.now(),
                }
            )
            asset.deployment = deployment
            asset.is_active = True
            asset.is_verified = True
            if picked_file_name:
                asset.asset_name = picked_file_name
            if description:
                asset.description = description
            asset.last_error = None
            asset.verified_at = timezone.now()
            asset.save()

            deployment.config_data = deployment.config_data or {}
            deployment.config_data["google_file_id"] = clean_file_id
            deployment.config_data["google_file_name"] = asset.asset_name
            deployment.config_data.pop("google_file_id_status", None)
            deployment.save(update_fields=["config_data", "updated_at"])

            extra_config["google_file_id"] = clean_file_id
            extra_config["google_file_name"] = asset.asset_name

        # Resume ALL pending failed webhooks for this deployment one by one
        resumed_ids = resume_failed_webhooks_for_deployment(
            deployment=deployment,
            tool=tool,
            authenticated_uid=effective_user_id,
            extra_config=extra_config
        )

        # If this specific job wasn't caught (e.g. status was already changed or different filter), clean it
        if failed_job and failed_job.pk:
            try:
                failed_job.delete()
            except Exception:
                pass

        if not resumed_ids:
            return Response({
                "success": True,
                "status": "already_resumed",
                "message": "All failed webhooks for this deployment have already been processed.",
                "resumed_count": 0,
            }, status=status.HTTP_200_OK)

        return Response({
            "success": True,
            "status": "resumed",
            "job_id": resumed_ids[0] if resumed_ids else None,
            "resumed_count": len(resumed_ids),
            "resumed_job_ids": resumed_ids,
            "message": f"OAuth verified successfully. {len(resumed_ids)} pending webhook(s) for this deployment have been resumed and queued for execution.",
        }, status=status.HTTP_200_OK)
