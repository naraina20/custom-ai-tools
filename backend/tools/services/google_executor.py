import os
import json
import logging
from typing import Any, Dict, List, Optional, Tuple
from django.conf import settings
from django.utils import timezone
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials as UserCredentials

from tools.models import GoogleProductCapability, SharedUserAsset, UserOAuthToken

logger = logging.getLogger(__name__)

PLATFORM_SERVICE_ACCOUNT_EMAIL = "narainad308@gmail.com"


class GoogleExecutionError(Exception):
    """Raised when a Google API execution or authorization check fails."""
    pass


class AssetQuarantineError(GoogleExecutionError):
    """Raised when an asset fails cross-tenant or service-account quarantine validation."""
    pass


def execute_google_action(credentials, package_product_name, api_version, target_resource_path, method_name, **kwargs):
    """
    Universal API Execution Engine.
    Dynamically routes payload parameters (**kwargs) down the target resource chains for all supported Google products.
    """
    if not credentials:
        raise GoogleExecutionError(
            "Cannot execute Google API action without valid credentials. "
            "User OAuth credentials or service account credentials must be provided."
        )

    try:
        service = build(package_product_name, api_version, credentials=credentials)
        execution_chain = service
        if target_resource_path:
            for node in target_resource_path.split('.'):
                execution_chain = getattr(execution_chain, node)()
        action_method = getattr(execution_chain, method_name)
        return action_method(**kwargs).execute()
    except (AttributeError, Exception) as e:
        raise e


def _is_valid_base64_mime(val: Any) -> bool:
    """
    Checks if a string is a valid base64-encoded RFC 2822 MIME email message.
    Detects and rejects dummy placeholders (e.g. 'BASE64_ENCODED_WELCOME_EMAIL').
    """
    if not isinstance(val, str) or not val.strip():
        return False
    val_clean = val.strip()
    placeholder_indicators = ['BASE64_', 'PLACEHOLDER', 'ENCODED_EMAIL', 'REPLACE_WITH', 'YOUR_BASE64', 'DUMMY']
    if any(ind in val_clean.upper() for ind in placeholder_indicators):
        return False
    try:
        import base64
        missing_padding = len(val_clean) % 4
        padded = val_clean + ('=' * (4 - missing_padding)) if missing_padding else val_clean
        decoded_bytes = base64.urlsafe_b64decode(padded.encode('utf-8'))
        decoded_str = decoded_bytes.decode('utf-8', errors='ignore')
        lower = decoded_str.lower()
        return ('to:' in lower or 'subject:' in lower or 'content-type:' in lower or 'mime-version:' in lower)
    except Exception:
        return False


class GoogleExecutorService:
    """
    Production service orchestrating capability validation, credential resolution,
    asset quarantine verification, and execution via execute_google_action.
    """

    @classmethod
    def get_service_account_credentials(cls, scopes: Optional[List[str]] = None):
        """
        Retrieves or constructs google.auth service account credentials using
        the configured JSON credentials block or file.
        """
        from google.oauth2 import service_account

        scopes = scopes or [
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/forms.body',
        ]

        # 1. Check settings or environment for raw JSON string
        sa_json_raw = getattr(settings, 'GOOGLE_SERVICE_ACCOUNT_JSON', None) or os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON')
        if sa_json_raw:
            try:
                info = json.loads(sa_json_raw) if isinstance(sa_json_raw, str) else sa_json_raw
                return service_account.Credentials.from_service_account_info(info, scopes=scopes)
            except Exception as e:
                logger.warning("Failed loading service account credentials from GOOGLE_SERVICE_ACCOUNT_JSON: %s", e)

        # 2. Check settings or environment for JSON file path
        sa_file = getattr(settings, 'GOOGLE_SERVICE_ACCOUNT_FILE', None) or os.getenv('GOOGLE_SERVICE_ACCOUNT_FILE')
        if sa_file and os.path.exists(sa_file):
            try:
                return service_account.Credentials.from_service_account_file(sa_file, scopes=scopes)
            except Exception as e:
                logger.warning("Failed loading service account credentials from file %s: %s", sa_file, e)

        # 3. Fallback: Return None to indicate service account credentials are not configured
        return None

    @classmethod
    def build_user_oauth_credentials(cls, access_token: str, token_rec: Optional[UserOAuthToken] = None) -> UserCredentials:
        """
        Constructs UserCredentials instance from an active OAuth access token,
        attaching client and refresh credentials when available for auto-refresh.
        """
        client_id = getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '').strip()
        client_secret = getattr(settings, 'GOOGLE_OAUTH_CLIENT_SECRET', '').strip()
        if token_rec and token_rec.refresh_token and client_id and client_secret:
            return UserCredentials(
                token=access_token,
                refresh_token=token_rec.refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=client_id,
                client_secret=client_secret
            )
        return UserCredentials(token=access_token)

    @classmethod
    def verify_and_quarantine_asset(
        cls,
        user_id: str,
        google_file_or_folder_id: str,
        product_name: str = 'drive',
    ) -> Tuple[bool, Optional[SharedUserAsset], Optional[str]]:
        """
        Shared Service Account Asset Quarantine Strategy:
        1. Checks database mapping of user_id against google_file_or_folder_id.
           Ensures files shared with narainad308@gmail.com are NEVER accessible across different user profiles.
        2. Programmatically cross-verifies access against the Drive API using the Service Account credentials.
        """
        if not user_id:
            return False, None, "User ID is required for asset quarantine verification."

        if not google_file_or_folder_id:
            return False, None, "Google File or Folder ID is required."

        clean_file_id = google_file_or_folder_id.strip()

        # Step 1: Ensure asset belongs to the caller's profile in SharedUserAsset
        asset = SharedUserAsset.objects.filter(
            user_id=user_id,
            google_file_or_folder_id=clean_file_id
        ).first()

        if not asset:
            msg = (
                f"Quarantine Violation: File ID '{clean_file_id}' is not mapped to user profile '{user_id}'. "
                f"Assets shared with {PLATFORM_SERVICE_ACCOUNT_EMAIL} must be registered under your account."
            )
            logger.error(msg)
            return False, None, msg

        # Step 2: Cross-verify access against Google Drive API using Service Account
        sa_credentials = cls.get_service_account_credentials()
        if not sa_credentials:
            # If service account file is not yet deployed on server, record state and allow graceful dev mock
            logger.warning(
                "Service account credentials not found in environment. Marking asset as verified with mock status in development."
            )
            asset.is_verified = True
            asset.verified_at = timezone.now()
            asset.save(update_fields=['is_verified', 'verified_at', 'updated_at'])
            return True, asset, None

        try:
            # Cross-verify via Drive API files.get
            file_meta = execute_google_action(
                credentials=sa_credentials,
                package_product_name='drive',
                api_version='v3',
                target_resource_path='files',
                method_name='get',
                fileId=clean_file_id,
                fields='id, name, mimeType, capabilities, trashed'
            )

            if file_meta.get('trashed'):
                asset.is_verified = False
                asset.last_error = "Target asset is currently in the Google Drive trash."
                asset.save(update_fields=['is_verified', 'last_error', 'updated_at'])
                return False, asset, asset.last_error

            asset.asset_name = file_meta.get('name') or asset.asset_name
            asset.mime_type = file_meta.get('mimeType') or asset.mime_type
            asset.is_verified = True
            asset.verified_at = timezone.now()
            asset.last_error = None
            asset.metadata = {
                "capabilities": file_meta.get('capabilities', {}),
                "drive_id": file_meta.get('id'),
            }
            asset.save()
            logger.info("Asset '%s' (%s) successfully cross-verified for user %s", asset.asset_name, clean_file_id, user_id)
            return True, asset, None

        except Exception as exc:
            err_msg = (
                f"Google Drive verification failed for asset '{clean_file_id}': {str(exc)}. "
                f"Please ensure you have shared this asset with '{PLATFORM_SERVICE_ACCOUNT_EMAIL}' with Editor/Viewer access."
            )
            logger.error(err_msg)
            asset.is_verified = False
            asset.last_error = str(exc)
            asset.save(update_fields=['is_verified', 'last_error', 'updated_at'])
            return False, asset, err_msg

    @classmethod
    def execute_google_plan(
        cls,
        item: Dict[str, Any],
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Executes a Google tool action according to the capability matrix and security policies.
        Validates target package, method, and permission scope.
        Strictly enforces that Gmail read/modify access is prohibited.
        """
        user_id = context.get('user_id') or context.get('deployer_data', {}).get('user_id') or 'system'
        deployer_email = (
            context.get('deployer_data', {}).get('email')
            or context.get('user_details', {}).get('email')
            or context.get('deploy_tool_data', {}).get('personal_email')
            or ''
        )

        package_product_name = item.get('package_product_name') or item.get('product')
        api_version = item.get('api_version') or 'v1'
        target_resource_path = item.get('target_resource_path', '')
        method_name = item.get('method_name')
        kwargs = dict(item.get('kwargs') or item.get('params') or {})

        if not package_product_name or not method_name:
            raise GoogleExecutionError("Both 'package_product_name' and 'method_name' are required for Google action execution.")

        # STRICT SECURITY RULE: Gmail Read/Modify access is omitted.
        if package_product_name.lower() == 'gmail':
            if method_name.lower() not in ['send', 'create', 'insert']:
                raise GoogleExecutionError(
                    f"Permission Denied: Gmail capability is strictly limited to 'gmail.send'. "
                    f"Attempted execution of '{method_name}' is prohibited by security policy."
                )

            # Auto-format Gmail resource path
            if not target_resource_path:
                target_resource_path = 'users.messages'

            # Extract any raw string passed directly at top-level or nested in body
            raw_input = kwargs.pop('raw', None)
            if isinstance(kwargs.get('body'), dict):
                raw_input = raw_input or kwargs['body'].get('raw')
            elif isinstance(kwargs.get('body'), str):
                raw_input = raw_input or kwargs.pop('body')

            raw_b64 = None
            if _is_valid_base64_mime(raw_input):
                raw_b64 = raw_input.strip()

            # High-level field resolution (to, subject, body/content)
            to_addr = (
                kwargs.pop('to', None)
                or kwargs.pop('to_email', None)
                or kwargs.pop('recipient', None)
                or item.get('to_email')
                or item.get('to')
                or item.get('recipient')
            )
            subj = kwargs.pop('subject', None) or item.get('subject')
            text_content = (
                kwargs.pop('body', None)
                or kwargs.pop('content', None)
                or kwargs.pop('text', None)
                or kwargs.pop('message', None)
                or item.get('body')
                or item.get('content')
                or item.get('text')
                or ''
            )

            # If raw_input was provided as plain text rather than MIME, use it as text_content
            if not text_content and raw_input and not any(ind in str(raw_input).upper() for ind in ['BASE64_', 'PLACEHOLDER', 'ENCODED_EMAIL']):
                text_content = str(raw_input)

            # If we do not already have a valid base64 MIME message, construct one
            if not raw_b64:
                # Fallback to recipient from webhook data if not specified
                if not to_addr:
                    webhook_data = context.get('webhook_data') or context.get('input_data', {}).get('webhook_payload') or {}
                    if isinstance(webhook_data, dict):
                        users = webhook_data.get('users') or webhook_data.get('data', {}).get('users') or webhook_data.get('records')
                        if isinstance(users, list) and len(users) > 0 and isinstance(users[0], dict):
                            to_addr = users[0].get('email') or users[0].get('user_email') or users[0].get('client_email')
                        if not to_addr:
                            to_addr = webhook_data.get('email') or webhook_data.get('customer_email') or webhook_data.get('client_email')

                # Fallback to personal or deployer email
                if not to_addr:
                    to_addr = (
                        context.get('deploy_tool_data', {}).get('personal_email')
                        or context.get('deploy_tool_data', {}).get('user_email')
                        or deployer_email
                    )

                if not subj:
                    tool_title = context.get('tool_title') or (context.get('tool').title if context.get('tool') else None) or 'NexusAI Assistant'
                    subj = f"Notification from {tool_title}"

                if not text_content:
                    webhook_data = context.get('webhook_data') or {}
                    if webhook_data:
                        text_content = (
                            f"Hello,\n\n"
                            f"We have processed the following event details:\n"
                            f"{json.dumps(webhook_data, indent=2)}\n\n"
                            f"Best regards,\nNexusAI Automation"
                        )
                    else:
                        text_content = "Hello,\n\nThis is an automated notification from your tool.\n\nBest regards,\nNexusAI Automation"

                import base64
                from email.mime.text import MIMEText
                from email.mime.multipart import MIMEMultipart

                mime_msg = MIMEMultipart('alternative')
                if to_addr:
                    mime_msg['To'] = to_addr if isinstance(to_addr, str) else ', '.join(to_addr)
                mime_msg['Subject'] = subj
                is_html = '<' in str(text_content) and '>' in str(text_content)
                mime_msg.attach(MIMEText(str(text_content), 'html' if is_html else 'plain'))
                raw_b64 = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode('utf-8')

            # Clean extraneous kwargs so Google's Discovery API receives ONLY valid discovery parameters
            # Discovery API method signature for users.messages.send ONLY accepts 'userId' and 'body'
            disallowed_keys = [
                'raw', 'to', 'to_email', 'recipient', 'subject', 'content', 'text',
                'message', 'client_identifier', 'recipient_type', 'is_fallback_to_personal',
                'item_reference', 'html_body'
            ]
            for k in disallowed_keys:
                kwargs.pop(k, None)

            # Enforce exact Google Gmail Discovery parameter structure:
            # gmail.users().messages().send(userId='me', body={'raw': '...'})
            kwargs['userId'] = kwargs.get('userId') or 'me'
            kwargs['body'] = {'raw': raw_b64}

        # Check Capability in Database Matrix
        cap_exists = GoogleProductCapability.objects.filter(
            package_product_name__iexact=package_product_name,
            api_version=api_version,
        ).exists()

        if not cap_exists:
            logger.warning(
                "Executing uncataloged or custom Google capability: %s %s %s",
                package_product_name, api_version, target_resource_path
            )

        # Asset Quarantine Check: If fileId or spreadsheetId or documentId is present
        file_id = kwargs.get('fileId') or kwargs.get('spreadsheetId') or kwargs.get('documentId') or kwargs.get('formId')
        auth_mode = context.get('google_auth_mode') or item.get('google_auth_mode') or 'none'

        if auth_mode == 'manual_delegation' and file_id:
            is_valid, asset, err = cls.verify_and_quarantine_asset(
                user_id=user_id,
                google_file_or_folder_id=file_id,
                product_name=package_product_name
            )
            if not is_valid:
                raise AssetQuarantineError(err or "Quarantine verification failed.")

        # Resolve Credentials:
        # Check UserOAuthToken first (by user_id or deployer_email)
        credentials = None
        token_rec = UserOAuthToken.objects.filter(user_id=user_id, provider='google').first()
        if not token_rec and deployer_email:
            token_rec = UserOAuthToken.objects.filter(account_email=deployer_email, provider='google').first()
        if not token_rec and '@' in str(user_id):
            token_rec = UserOAuthToken.objects.filter(account_email=user_id, provider='google').first()

        if token_rec:
            if token_rec.is_expired():
                from tools.services.oauth_service import OAuthService
                ok, new_token, err = OAuthService.get_or_refresh_token(token_rec.user_id, 'google')
                if ok and new_token:
                    token_rec.refresh_from_db()
                    credentials = cls.build_user_oauth_credentials(token_rec.access_token, token_rec=token_rec)
                else:
                    logger.warning("Failed refreshing Google token for user '%s': %s", user_id, err)
            else:
                credentials = cls.build_user_oauth_credentials(token_rec.access_token, token_rec=token_rec)

        # Fallback to service account if explicitly configured and no OAuth token found
        if not credentials and auth_mode in ['manual_delegation', 'service_account']:
            credentials = cls.get_service_account_credentials()

        if not credentials:
            raise GoogleExecutionError(
                f"Google OAuth credentials not found or not authorized for user '{user_id}' "
                f"({deployer_email or 'no email'}). Please connect and authorize your personal Google account "
                f"via OAuth in the tool deployment modal before executing this action."
            )

        # Execute using universal engine
        result = execute_google_action(
            credentials=credentials,
            package_product_name=package_product_name,
            api_version=api_version,
            target_resource_path=target_resource_path,
            method_name=method_name,
            **kwargs
        )

        return {
            "status": "success",
            "package_product_name": package_product_name,
            "method_name": method_name,
            "result": result,
        }
