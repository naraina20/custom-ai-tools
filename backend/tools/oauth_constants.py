"""
OAuth Configuration Constants and Defaults for NexusAI Gateway.

Centralized definitions for OAuth providers (Google, GitHub), API endpoints,
default scopes, grant types, timeouts, and frontend communication channels.
"""

# ==============================================================================
# Provider Identifiers
# ==============================================================================
PROVIDER_GOOGLE = "google"
PROVIDER_GITHUB = "github"

# ==============================================================================
# Google OAuth Endpoints
# ==============================================================================
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"

# ==============================================================================
# GitHub OAuth Endpoints
# ==============================================================================
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

# ==============================================================================
# Google OAuth Scopes
# ==============================================================================
GOOGLE_SCOPE_GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send"
GOOGLE_SCOPE_USERINFO_EMAIL = "https://www.googleapis.com/auth/userinfo.email"
GOOGLE_SCOPE_OPENID = "openid"

# Default scopes requested during Google OAuth initiation
DEFAULT_GOOGLE_SCOPES = (
    f"{GOOGLE_SCOPE_GMAIL_SEND} "
    f"{GOOGLE_SCOPE_USERINFO_EMAIL} "
    f"{GOOGLE_SCOPE_OPENID}"
)

# ==============================================================================
# OAuth Protocol Parameters & Grant Types
# ==============================================================================
OAUTH_RESPONSE_TYPE_CODE = "code"
OAUTH_ACCESS_TYPE_OFFLINE = "offline"
OAUTH_PROMPT_CONSENT = "consent"
OAUTH_INCLUDE_GRANTED_SCOPES = "true"
OAUTH_GRANT_TYPE_AUTHORIZATION_CODE = "authorization_code"
OAUTH_GRANT_TYPE_REFRESH_TOKEN = "refresh_token"

# ==============================================================================
# Redirect URIs & Default Fallbacks
# ==============================================================================
DEFAULT_GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:3000/api/proxy/oauth/google/callback/"
DEFAULT_FRONTEND_ORIGIN = "http://localhost:3000"
DEFAULT_USER_ID = "default_user"
DEFAULT_TOKEN_EXPIRY_SECONDS = 3600
DEFAULT_GITHUB_TOKEN_EXPIRY_SECONDS = 28800

# ==============================================================================
# Frontend Communication & PostMessage Channels
# ==============================================================================
GOOGLE_OAUTH_SUCCESS_EVENT = "GOOGLE_OAUTH_SUCCESS"
GOOGLE_OAUTH_ERROR_EVENT = "GOOGLE_OAUTH_ERROR"
GOOGLE_OAUTH_BROADCAST_CHANNEL = "nexus_google_oauth"
GOOGLE_OAUTH_LOCAL_STORAGE_KEY = "google_oauth_completed"

# ==============================================================================
# HTTP Request Timeouts (in seconds)
# ==============================================================================
DEFAULT_TOKEN_REQUEST_TIMEOUT = 20
DEFAULT_USERINFO_REQUEST_TIMEOUT = 10
DEFAULT_TOKENINFO_REQUEST_TIMEOUT = 8
DEFAULT_REVOKE_REQUEST_TIMEOUT = 8
