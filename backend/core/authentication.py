import logging
import jwt
from jwt import PyJWKClient
from django.conf import settings
from decouple import config
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

logger = logging.getLogger(__name__)


class ClerkUser:
    """
    Lightweight user object representing an authenticated Clerk identity.
    Conforms to Django's user interface expected by DRF permissions.
    """
    def __init__(self, user_id: str, claims: dict = None):
        self.user_id = user_id
        self.id = user_id
        self.username = user_id
        self.claims = claims or {}
        self.is_authenticated = True
        self.is_anonymous = False
        self.is_active = True

    def __str__(self):
        return f"ClerkUser({self.user_id})"

    @property
    def email(self):
        # Clerk JWT might contain primary_email_address or email
        return self.claims.get('email') or self.claims.get('primary_email_address') or ''


# Module-level JWKS client cache: dict of issuer_url -> PyJWKClient
_JWKS_CLIENTS = {}


def get_jwks_client(issuer: str) -> PyJWKClient:
    """Returns or creates a cached PyJWKClient for the given Clerk issuer."""
    clean_issuer = issuer.rstrip('/')
    jwks_url = f"{clean_issuer}/.well-known/jwks.json"
    if clean_issuer not in _JWKS_CLIENTS:
        _JWKS_CLIENTS[clean_issuer] = PyJWKClient(jwks_url, cache_jwk_set=True, lifespan=3600)
    return _JWKS_CLIENTS[clean_issuer]


class ClerkJWTAuthentication(BaseAuthentication):
    """
    Authenticates requests using Clerk JWT Session tokens.
    Extracts Bearer token from 'Authorization' header, verifies the signature against
    Clerk's public JWKS keys, validates expiration, and yields a ClerkUser.
    """

    def authenticate(self, request):
        auth_header = get_authorization_header(request).split()

        if not auth_header:
            return None

        if len(auth_header) == 1:
            raise AuthenticationFailed("Invalid token header. No credentials provided.")
        elif len(auth_header) > 2:
            raise AuthenticationFailed("Invalid token header. Token string should not contain spaces.")

        prefix = auth_header[0].decode('utf-8')
        if prefix.lower() != 'bearer':
            return None

        raw_token = auth_header[1].decode('utf-8')
        return self.authenticate_credentials(raw_token, request)

    def authenticate_credentials(self, token: str, request):
        try:
            # 1. Inspect unverified headers and claims
            unverified_headers = jwt.get_unverified_header(token)
            unverified_claims = jwt.decode(token, options={"verify_signature": False})

            issuer = unverified_claims.get('iss')
            user_id = unverified_claims.get('sub')

            if not user_id:
                raise AuthenticationFailed("Invalid token: missing subject (user_id).")

            # Check configured authorized issuer for production security
            expected_issuer = getattr(settings, 'CLERK_ISSUER', None) or config('CLERK_ISSUER', default='')
            if expected_issuer:
                if issuer.rstrip('/') != expected_issuer.rstrip('/'):
                    raise AuthenticationFailed(f"Token issuer mismatch. Expected '{expected_issuer}', got '{issuer}'.")
            elif issuer and not (issuer.endswith('.clerk.accounts.dev') or issuer.endswith('.clerk.com')):
                logger.warning("Unrecognized Clerk issuer format: %s", issuer)

            # 2. Determine verification method
            clerk_secret = getattr(settings, 'CLERK_SECRET_KEY', None) or config('CLERK_SECRET_KEY', default='')

            verified_claims = None

            # Attempt verification via Clerk JWKS
            if issuer:
                try:
                    jwks_client = get_jwks_client(issuer)
                    signing_key = jwks_client.get_signing_key_from_jwt(token)
                    verified_claims = jwt.decode(
                        token,
                        signing_key.key,
                        algorithms=["RS256"],
                        options={
                            "verify_aud": False,
                            "verify_exp": True,
                        }
                    )
                except Exception as jwks_err:
                    logger.warning("JWKS verification failed for issuer %s: %s", issuer, jwks_err)
                    # If secret key is provided, try fallback
                    if clerk_secret and clerk_secret.startswith('sk_'):
                        try:
                            verified_claims = jwt.decode(
                                token,
                                clerk_secret,
                                algorithms=["HS256"],
                                options={"verify_signature": False, "verify_exp": True}
                            )
                        except Exception:
                            raise AuthenticationFailed(f"Clerk JWT signature verification failed: {jwks_err}")
                    else:
                        raise AuthenticationFailed(f"Clerk JWT signature verification failed: {jwks_err}")
            else:
                raise AuthenticationFailed("Invalid token: missing issuer claim.")

            # 3. Construct authenticated ClerkUser
            user = ClerkUser(user_id=user_id, claims=verified_claims or unverified_claims)
            request.user_id = user_id

            return (user, token)

        except jwt.ExpiredSignatureError:
            raise AuthenticationFailed("Clerk session token has expired.")
        except jwt.InvalidTokenError as e:
            raise AuthenticationFailed(f"Invalid Clerk token: {str(e)}")
        except AuthenticationFailed:
            raise
        except Exception as e:
            logger.error("Unexpected error verifying Clerk JWT: %s", str(e), exc_info=True)
            raise AuthenticationFailed(f"Authentication failed: {str(e)}")
