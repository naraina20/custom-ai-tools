import logging
from datetime import timedelta
from typing import Optional, Tuple
import requests
from django.conf import settings
from django.utils import timezone

from tools.models import UserOAuthToken
from tools.oauth_constants import (
    PROVIDER_GOOGLE,
    PROVIDER_GITHUB,
    GOOGLE_TOKEN_URL,
    GITHUB_TOKEN_URL,
    GOOGLE_TOKENINFO_URL,
    GOOGLE_REVOKE_URL,
    OAUTH_GRANT_TYPE_REFRESH_TOKEN,
    DEFAULT_TOKEN_EXPIRY_SECONDS,
    DEFAULT_GITHUB_TOKEN_EXPIRY_SECONDS,
    DEFAULT_TOKEN_REQUEST_TIMEOUT,
    DEFAULT_TOKENINFO_REQUEST_TIMEOUT,
    DEFAULT_REVOKE_REQUEST_TIMEOUT,
)

logger = logging.getLogger(__name__)


class OAuthService:
    """
    Manages OAuth token lifecycle, validation, and auto-refresh for Google and GitHub.
    """

    GOOGLE_TOKEN_URL = GOOGLE_TOKEN_URL
    GITHUB_TOKEN_URL = GITHUB_TOKEN_URL

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
            if provider == PROVIDER_GOOGLE:
                success, new_access_token, expires_in, err = cls._refresh_google_token(token_record.refresh_token)
            elif provider == PROVIDER_GITHUB:
                success, new_access_token, expires_in, err = cls._refresh_github_token(token_record.refresh_token)
            else:
                return False, None, f"Unsupported OAuth provider: {provider}"

            if not success or not new_access_token:
                if provider == PROVIDER_GOOGLE and ('invalid_grant' in str(err).lower() or 'revoked' in str(err).lower()):
                    logger.warning("Google refresh token revoked for user %s. Purging token record from DB.", user_id)
                    token_record.delete()
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
    def verify_and_sync_google_token(cls, token_record: UserOAuthToken) -> Tuple[bool, Optional[str], list, Optional[str]]:
        """
        Actively verifies with Google whether the user's OAuth grant is still valid and active.
        If Google reports the grant has been revoked or expired (invalid_token, invalid_grant),
        attempts auto-refresh. If refresh also fails or is revoked, removes the record from the database.

        Returns:
            (is_active: bool, email: Optional[str], granted_scopes: list, error_message: Optional[str])
        """
        if not token_record or not token_record.access_token:
            return False, None, [], "No token found."

        # Step 1: Verify live access token with Google's tokeninfo endpoint
        tokeninfo_url = GOOGLE_TOKENINFO_URL
        try:
            resp = requests.get(tokeninfo_url, params={"access_token": token_record.access_token}, timeout=DEFAULT_TOKENINFO_REQUEST_TIMEOUT)
            if resp.status_code == 200:
                data = resp.json()
                email = data.get("email") or token_record.account_email
                if email and token_record.account_email != email:
                    token_record.account_email = email
                    token_record.save(update_fields=['account_email', 'updated_at'])
                scope_str = data.get("scope", "")
                granted_scopes = scope_str.split() if scope_str else []
                return True, email, granted_scopes, None
        except requests.RequestException as net_err:
            logger.warning("Network failure during Google tokeninfo check: %s", str(net_err))
            # On transient network error, fallback to local expiry check
            if not token_record.is_expired():
                return True, token_record.account_email, [], None
            return False, token_record.account_email, [], f"Network error checking token with Google: {str(net_err)}"

        # Step 2: Access token rejected by Google (e.g. 400 invalid_token or expired)
        # Attempt refresh if refresh_token is present
        if token_record.refresh_token:
            success, new_access_token, expires_in, refresh_err = cls._refresh_google_token(token_record.refresh_token)
            if success and new_access_token:
                token_record.access_token = new_access_token
                token_record.token_expiry = timezone.now() + timedelta(seconds=expires_in or DEFAULT_TOKEN_EXPIRY_SECONDS)
                token_record.save(update_fields=['access_token', 'token_expiry', 'updated_at'])
                logger.info("Successfully refreshed Google OAuth token during live verification (User: %s)", token_record.user_id)
                # Try to fetch scopes on newly refreshed token
                try:
                    r2 = requests.get(tokeninfo_url, params={"access_token": new_access_token}, timeout=DEFAULT_TOKENINFO_REQUEST_TIMEOUT)
                    if r2.status_code == 200:
                        d2 = r2.json()
                        scope_str = d2.get("scope", "")
                        return True, token_record.account_email, scope_str.split() if scope_str else [], None
                except Exception:
                    pass
                return True, token_record.account_email, [], None

            logger.warning(
                "Google refresh failed for user '%s' (%s). Refresh error: %s",
                token_record.user_id, token_record.account_email, refresh_err
            )

        # Step 3: Google rejected access_token and refresh failed/was revoked
        logger.info(
            "Google access was revoked or permanently expired for user '%s' (%s). Purging from database.",
            token_record.user_id, token_record.account_email
        )
        user_id = token_record.user_id
        email = token_record.account_email
        token_record.delete()
        return False, None, [], f"Google access revoked for user '{user_id}' ({email}). Database record deleted."

    @classmethod
    def revoke_google_token(cls, user_id: str) -> Tuple[bool, Optional[str]]:
        """
        Explicitly revokes the token with Google API and purges the record from the database.
        """
        token_record = UserOAuthToken.objects.filter(user_id=user_id, provider=PROVIDER_GOOGLE).first()
        if not token_record and '@' in user_id:
            token_record = UserOAuthToken.objects.filter(account_email=user_id, provider=PROVIDER_GOOGLE).first()

        if not token_record:
            return True, "No active token found in database."

        token_to_revoke = token_record.refresh_token or token_record.access_token
        if token_to_revoke:
            try:
                requests.post(
                    GOOGLE_REVOKE_URL,
                    params={"token": token_to_revoke},
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    timeout=DEFAULT_REVOKE_REQUEST_TIMEOUT
                )
            except Exception as exc:
                logger.warning("Error notifying Google API during token revocation: %s", str(exc))

        token_record.delete()
        logger.info("Successfully revoked and purged Google OAuth credentials for user: %s", user_id)
        return True, "Google account disconnected and credentials removed from database."

    @classmethod
    def _refresh_google_token(cls, refresh_token: str) -> Tuple[bool, Optional[str], Optional[int], Optional[str]]:
        client_id = getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '')
        client_secret = getattr(settings, 'GOOGLE_OAUTH_CLIENT_SECRET', '')

        payload = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": OAUTH_GRANT_TYPE_REFRESH_TOKEN,
        }
        resp = requests.post(cls.GOOGLE_TOKEN_URL, data=payload, timeout=DEFAULT_TOKEN_REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            return True, data.get("access_token"), data.get("expires_in", DEFAULT_TOKEN_EXPIRY_SECONDS), None
        return False, None, None, f"Google refresh endpoint returned {resp.status_code}: {resp.text}"

    @classmethod
    def _refresh_github_token(cls, refresh_token: str) -> Tuple[bool, Optional[str], Optional[int], Optional[str]]:
        client_id = getattr(settings, 'GITHUB_OAUTH_CLIENT_ID', '')
        client_secret = getattr(settings, 'GITHUB_OAUTH_CLIENT_SECRET', '')

        payload = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": OAUTH_GRANT_TYPE_REFRESH_TOKEN,
        }
        headers = {"Accept": "application/json"}
        resp = requests.post(cls.GITHUB_TOKEN_URL, data=payload, headers=headers, timeout=DEFAULT_TOKEN_REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            if "access_token" in data:
                return True, data.get("access_token"), data.get("expires_in", DEFAULT_GITHUB_TOKEN_EXPIRY_SECONDS), None
            return False, None, None, data.get("error_description", "Unknown error refreshing GitHub token")
        return False, None, None, f"GitHub refresh endpoint returned {resp.status_code}: {resp.text}"
