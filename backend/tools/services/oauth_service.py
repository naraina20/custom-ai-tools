import logging
from datetime import timedelta
from typing import Optional, Tuple
import requests
from django.conf import settings
from django.utils import timezone

from tools.models import UserOAuthToken

logger = logging.getLogger(__name__)


class OAuthService:
    """
    Manages OAuth token lifecycle, validation, and auto-refresh for Google and GitHub.
    """

    GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
    GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

    @classmethod
    def get_or_refresh_token(cls, user_id: str, provider: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Retrieves a valid access token for the given user and provider.
        If expired, automatically executes the refresh flow.
        
        Returns:
          (success: bool, access_token: Optional[str], error_message: Optional[str])
        """
        token_record = UserOAuthToken.objects.filter(user_id=user_id, provider=provider).first()
        if not token_record:
            return False, None, f"No OAuth credentials found for user '{user_id}' with provider '{provider}'."

        # If token is still valid, return directly
        if not token_record.is_expired():
            return True, token_record.access_token, None

        # Attempt token refresh
        if not token_record.refresh_token:
            return False, None, f"Access token for provider '{provider}' is expired and no refresh token is stored."

        logger.info("Attempting auto-refresh for expired %s token (User: %s)", provider, user_id)

        try:
            if provider == 'google':
                success, new_access_token, expires_in, err = cls._refresh_google_token(token_record.refresh_token)
            elif provider == 'github':
                success, new_access_token, expires_in, err = cls._refresh_github_token(token_record.refresh_token)
            else:
                return False, None, f"Unsupported OAuth provider: {provider}"

            if not success or not new_access_token:
                return False, None, err or "Token refresh failed."

            # Update DB record with new token and expiry
            token_record.access_token = new_access_token
            if expires_in:
                token_record.token_expiry = timezone.now() + timedelta(seconds=expires_in)
            else:
                token_record.token_expiry = timezone.now() + timedelta(hours=1)
            token_record.save(update_fields=['access_token', 'token_expiry', 'updated_at'])

            logger.info("Successfully refreshed %s OAuth token for User %s", provider, user_id)
            return True, new_access_token, None

        except Exception as exc:
            logger.error("Exception during OAuth token refresh for %s: %s", provider, str(exc), exc_info=True)
            return False, None, f"Exception during token refresh: {str(exc)}"

    @classmethod
    def _refresh_google_token(cls, refresh_token: str) -> Tuple[bool, Optional[str], Optional[int], Optional[str]]:
        client_id = getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '')
        client_secret = getattr(settings, 'GOOGLE_OAUTH_CLIENT_SECRET', '')

        payload = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        resp = requests.post(cls.GOOGLE_TOKEN_URL, data=payload, timeout=20)
        if resp.status_code == 200:
            data = resp.json()
            return True, data.get("access_token"), data.get("expires_in", 3600), None
        return False, None, None, f"Google refresh endpoint returned {resp.status_code}: {resp.text}"

    @classmethod
    def _refresh_github_token(cls, refresh_token: str) -> Tuple[bool, Optional[str], Optional[int], Optional[str]]:
        client_id = getattr(settings, 'GITHUB_OAUTH_CLIENT_ID', '')
        client_secret = getattr(settings, 'GITHUB_OAUTH_CLIENT_SECRET', '')

        payload = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        headers = {"Accept": "application/json"}
        resp = requests.post(cls.GITHUB_TOKEN_URL, data=payload, headers=headers, timeout=20)
        if resp.status_code == 200:
            data = resp.json()
            if "access_token" in data:
                return True, data.get("access_token"), data.get("expires_in", 28800), None
            return False, None, None, data.get("error_description", "Unknown error refreshing GitHub token")
        return False, None, None, f"GitHub refresh endpoint returned {resp.status_code}: {resp.text}"
