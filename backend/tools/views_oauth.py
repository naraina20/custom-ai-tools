import json
import logging
from urllib.parse import urlencode
from datetime import timedelta
import requests
from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import UserOAuthToken
from .services.oauth_service import OAuthService
from .oauth_constants import (
    PROVIDER_GOOGLE,
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    GOOGLE_USERINFO_URL,
    DEFAULT_GOOGLE_SCOPES,
    DEFAULT_GOOGLE_OAUTH_REDIRECT_URI,
    DEFAULT_USER_ID,
    DEFAULT_TOKEN_EXPIRY_SECONDS,
    DEFAULT_TOKEN_REQUEST_TIMEOUT,
    DEFAULT_USERINFO_REQUEST_TIMEOUT,
    OAUTH_RESPONSE_TYPE_CODE,
    OAUTH_ACCESS_TYPE_OFFLINE,
    OAUTH_PROMPT_CONSENT,
    OAUTH_INCLUDE_GRANTED_SCOPES,
    OAUTH_GRANT_TYPE_AUTHORIZATION_CODE,
    GOOGLE_OAUTH_SUCCESS_EVENT,
    GOOGLE_OAUTH_ERROR_EVENT,
    GOOGLE_OAUTH_BROADCAST_CHANNEL,
    GOOGLE_OAUTH_LOCAL_STORAGE_KEY,
    DEFAULT_FRONTEND_ORIGIN,
)

logger = logging.getLogger(__name__)


class GoogleOAuthInitView(APIView):
    """
    GET /api/oauth/google/init/?user_id=<user_id>&scope=<scope>
    Constructs and returns the Google OAuth 2.0 authorization consent URL.
    Checks whether GOOGLE_OAUTH_CLIENT_ID is configured in settings/.env.
    """
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        user_id = getattr(request.user, 'user_id', None) or request.headers.get('X-User-Id') or request.query_params.get('user_id')
        if not user_id:
            return Response(
                {"error": "user_id is required to initiate Google OAuth consent."},
                status=status.HTTP_400_BAD_REQUEST
            )

        client_id = getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '').strip()
        client_secret = getattr(settings, 'GOOGLE_OAUTH_CLIENT_SECRET', '').strip()
        redirect_uri = getattr(settings, 'GOOGLE_OAUTH_REDIRECT_URI', DEFAULT_GOOGLE_OAUTH_REDIRECT_URI).strip()

        if not client_id or not client_secret:
            return Response(
                {
                    "error": "Google OAuth is not configured yet.",
                    "client_id_configured": False,
                    "details": "Please set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in backend/.env with credentials from your Google Cloud Console (APIs & Services -> Credentials).",
                    "redirect_uri_needed": redirect_uri
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        requested_scope = request.query_params.get('scope')
        scope = requested_scope or DEFAULT_GOOGLE_SCOPES

        state_payload = json.dumps({"user_id": str(user_id)})

        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": OAUTH_RESPONSE_TYPE_CODE,
            "scope": scope,
            "access_type": OAUTH_ACCESS_TYPE_OFFLINE,
            "prompt": OAUTH_PROMPT_CONSENT,
            "include_granted_scopes": OAUTH_INCLUDE_GRANTED_SCOPES,
            "state": state_payload,
        }

        auth_url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"

        return Response({
            "auth_url": auth_url,
            "client_id_configured": True,
            "redirect_uri": redirect_uri,
            "user_id": user_id,
        }, status=status.HTTP_200_OK)


class GoogleOAuthCallbackView(APIView):
    """
    GET /api/oauth/google/callback/?code=...&state=...
    Exchanges authorization code for access and refresh tokens, extracts account email,
    and stores credentials in the UserOAuthToken database model.
    """
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        code = request.query_params.get('code')
        state = request.query_params.get('state')
        error = request.query_params.get('error')

        if error:
            logger.warning("Google OAuth error from consent screen: %s", error)
            return self._render_html_response(
                success=False,
                title="Authorization Cancelled",
                message=f"Google OAuth denied or cancelled: {error}",
                user_id="",
                email=""
            )

        if not code:
            return self._render_html_response(
                success=False,
                title="Authorization Failed",
                message="Missing authorization code from Google redirect.",
                user_id="",
                email=""
            )

        user_id = ""
        try:
            if state:
                state_data = json.loads(state)
                user_id = state_data.get("user_id", "")
        except Exception:
            user_id = state or ""

        client_id = getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '').strip()
        client_secret = getattr(settings, 'GOOGLE_OAUTH_CLIENT_SECRET', '').strip()
        redirect_uri = getattr(settings, 'GOOGLE_OAUTH_REDIRECT_URI', DEFAULT_GOOGLE_OAUTH_REDIRECT_URI).strip()

        # Exchange code with Google token endpoint
        token_payload = {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": OAUTH_GRANT_TYPE_AUTHORIZATION_CODE,
            "redirect_uri": redirect_uri,
        }

        try:
            resp = requests.post(GOOGLE_TOKEN_URL, data=token_payload, timeout=DEFAULT_TOKEN_REQUEST_TIMEOUT)
            if resp.status_code != 200:
                logger.error("Failed to exchange Google OAuth code: %s", resp.text)
                return self._render_html_response(
                    success=False,
                    title="Token Exchange Failed",
                    message=f"Google returned error ({resp.status_code}): {resp.text}",
                    user_id=user_id,
                    email=""
                )

            token_data = resp.json()
            access_token = token_data.get("access_token")
            refresh_token = token_data.get("refresh_token")
            expires_in = token_data.get("expires_in", DEFAULT_TOKEN_EXPIRY_SECONDS)

            # Retrieve authenticated user's email via Google userinfo
            account_email = ""
            try:
                userinfo_resp = requests.get(
                    GOOGLE_USERINFO_URL,
                    headers={"Authorization": f"Bearer {access_token}"},
                    timeout=DEFAULT_USERINFO_REQUEST_TIMEOUT
                )
                if userinfo_resp.status_code == 200:
                    info = userinfo_resp.json()
                    account_email = info.get("email", "")
            except Exception as e:
                logger.warning("Could not fetch Google userinfo email: %s", str(e))

            # Store in UserOAuthToken table
            token_defaults = {
                "account_email": account_email,
                "access_token": access_token,
                "token_expiry": timezone.now() + timedelta(seconds=expires_in),
            }
            if refresh_token:
                token_defaults["refresh_token"] = refresh_token

            token_rec, created = UserOAuthToken.objects.update_or_create(
                user_id=user_id or account_email or DEFAULT_USER_ID,
                provider=PROVIDER_GOOGLE,
                defaults=token_defaults
            )

            logger.info("Successfully saved Google OAuth token for user '%s' (%s)", token_rec.user_id, account_email)

            return self._render_html_response(
                success=True,
                title="Google Account Connected",
                message=f"Successfully granted gmail.send authorization.",
                user_id=token_rec.user_id,
                email=account_email
            )

        except Exception as exc:
            logger.error("Exception during Google OAuth callback: %s", str(exc), exc_info=True)
            return self._render_html_response(
                success=False,
                title="Authorization Exception",
                message=f"Server error: {str(exc)}",
                user_id=user_id,
                email=""
            )

    def _render_html_response(self, success: bool, title: str, message: str, user_id: str, email: str) -> HttpResponse:
        status_color = "#10b981" if success else "#ef4444"
        icon = "✓" if success else "✕"
        event_type = GOOGLE_OAUTH_SUCCESS_EVENT if success else GOOGLE_OAUTH_ERROR_EVENT

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <style>
        body {{
            background-color: #0b0f19;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 1rem;
            box-sizing: border-box;
        }}
        .card {{
            background-color: #111827;
            border: 1px solid #1f2937;
            border-radius: 1rem;
            padding: 2rem;
            max-width: 420px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4);
        }}
        .icon-circle {{
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background-color: {status_color}20;
            color: {status_color};
            font-size: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1rem auto;
            border: 1px solid {status_color}40;
        }}
        h2 {{
            margin: 0 0 0.5rem 0;
            font-size: 1.15rem;
            color: #f8fafc;
        }}
        p {{
            margin: 0 0 1rem 0;
            font-size: 0.875rem;
            color: #94a3b8;
            line-height: 1.5;
        }}
        .email-pill {{
            display: inline-block;
            background: #1e293b;
            color: #60a5fa;
            font-family: monospace;
            padding: 0.35rem 0.75rem;
            border-radius: 0.5rem;
            font-size: 0.8rem;
            margin-bottom: 1rem;
            border: 1px solid #334155;
        }}
        .close-btn {{
            display: inline-block;
            width: 100%;
            padding: 0.75rem 1rem;
            border-radius: 0.75rem;
            background: #6366f1;
            color: #ffffff;
            border: none;
            font-weight: 600;
            cursor: pointer;
            font-size: 13px;
            margin-top: 1rem;
            transition: background 0.2s;
        }}
        .close-btn:hover {{
            background: #4f46e5;
        }}
        .footer-note {{
            font-size: 0.75rem;
            color: #64748b;
            margin-top: 0.75rem;
        }}
    </style>
</head>
<body>
    <div class="card">
        <div class="icon-circle">{icon}</div>
        <h2>{title}</h2>
        <p>{message}</p>
        {f'<div class="email-pill">{email}</div>' if email else ''}
        <button id="closeBtn" class="close-btn" onclick="handleManualClose()">Close Window & Return to App</button>
        <div class="footer-note">Closing automatically...</div>
    </div>

    <script>
        const messagePayload = {{
            type: '{event_type}',
            success: {str(success).lower()},
            user_id: '{user_id}',
            email: '{email}'
        }};

        function dispatchOAuthEvents() {{
            // Channel 1: postMessage to window.opener with both explicit origin and wildcard
            if (window.opener) {{
                try {{
                    window.opener.postMessage(messagePayload, '{DEFAULT_FRONTEND_ORIGIN}');
                }} catch (e) {{
                    console.warn('postMessage to {DEFAULT_FRONTEND_ORIGIN} failed:', e);
                }}
                try {{
                    window.opener.postMessage(messagePayload, '*');
                }} catch (e) {{
                    console.warn('postMessage wildcard failed:', e);
                }}
            }}

            // Channel 2: BroadcastChannel (cross-window/tab on same origin)
            try {{
                const bc = new BroadcastChannel('{GOOGLE_OAUTH_BROADCAST_CHANNEL}');
                bc.postMessage(messagePayload);
            }} catch (e) {{
                console.warn('BroadcastChannel failed:', e);
            }}

            // Channel 3: localStorage event (cross-tab / cross-window on same origin)
            try {{
                localStorage.setItem('{GOOGLE_OAUTH_LOCAL_STORAGE_KEY}', JSON.stringify({{
                    ...messagePayload,
                    timestamp: Date.now()
                }}));
            }} catch (e) {{
                console.warn('localStorage sync failed:', e);
            }}
        }}

        function handleManualClose() {{
            dispatchOAuthEvents();
            setTimeout(function() {{
                try {{
                    window.close();
                }} catch (e) {{
                    console.warn('window.close() prevented by browser:', e);
                }}
            }}, 200);
        }}

        // Run immediately and try auto-closing
        dispatchOAuthEvents();
        setTimeout(function() {{
            handleManualClose();
        }}, 800);
    </script>
</body>
</html>"""
        return HttpResponse(html, content_type="text/html; charset=utf-8")


class GoogleOAuthStatusView(APIView):
    """
    GET /api/oauth/google/status/?user_id=<user_id>
    Checks if the specified user has valid, active Google OAuth tokens in UserOAuthToken.
    Actively queries Google API to verify authorization grant. If the user revoked access,
    the credentials in UserOAuthToken are automatically purged from the database.
    """
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        user_id = getattr(request.user, 'user_id', None) or request.headers.get('X-User-Id') or request.query_params.get('user_id')
        if not user_id:
            return Response({"error": "user_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        client_id = getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '').strip()
        client_secret = getattr(settings, 'GOOGLE_OAUTH_CLIENT_SECRET', '').strip()
        is_client_configured = bool(client_id and client_secret)

        token_rec = UserOAuthToken.objects.filter(user_id=user_id, provider=PROVIDER_GOOGLE).first()
        if not token_rec and '@' in user_id:
            token_rec = UserOAuthToken.objects.filter(account_email=user_id, provider=PROVIDER_GOOGLE).first()

        if not token_rec:
            return Response({
                "connected": False,
                "provider": PROVIDER_GOOGLE,
                "client_id_configured": is_client_configured,
                "email": None,
                "is_expired": False,
                "has_refresh_token": False
            }, status=status.HTTP_200_OK)

        # Actively verify with Google that access is still granted and token is valid
        is_active, verified_email, err = OAuthService.verify_and_sync_google_token(token_rec)

        if not is_active:
            logger.info("Google OAuth grant revoked for user '%s'. DB record purged. Reason: %s", user_id, err)
            return Response({
                "connected": False,
                "provider": PROVIDER_GOOGLE,
                "client_id_configured": is_client_configured,
                "email": None,
                "is_expired": True,
                "has_refresh_token": False,
                "revoked": True,
                "message": err or "Google access was revoked. Database record cleared."
            }, status=status.HTTP_200_OK)

        return Response({
            "connected": True,
            "provider": PROVIDER_GOOGLE,
            "email": verified_email or token_rec.account_email or None,
            "client_id_configured": is_client_configured,
            "is_expired": False,
            "has_refresh_token": bool(token_rec.refresh_token),
            "created_at": token_rec.created_at.isoformat(),
            "updated_at": token_rec.updated_at.isoformat()
        }, status=status.HTTP_200_OK)

    def delete(self, request, *args, **kwargs):
        """
        DELETE /api/oauth/google/status/?user_id=<user_id>
        Revokes token with Google and purges database credentials.
        """
        user_id = getattr(request.user, 'user_id', None) or request.headers.get('X-User-Id') or request.query_params.get('user_id')
        if not user_id:
            return Response({"error": "user_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        success, msg = OAuthService.revoke_google_token(user_id)
        return Response({
            "connected": False,
            "success": success,
            "message": msg
        }, status=status.HTTP_200_OK)


class GoogleOAuthRevokeView(APIView):
    """
    POST /api/oauth/google/revoke/
    Explicitly revokes Google OAuth grant and cleans up database.
    """
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        user_id = request.data.get('user_id') or getattr(request.user, 'user_id', None) or request.headers.get('X-User-Id') or request.query_params.get('user_id')
        if not user_id:
            return Response({"error": "user_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        success, msg = OAuthService.revoke_google_token(user_id)
        return Response({
            "connected": False,
            "success": success,
            "message": msg
        }, status=status.HTTP_200_OK)
