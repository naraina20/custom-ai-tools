import uuid
from django.db import models
from django.utils.text import slugify
from django.utils import timezone


class CustomTool(models.Model):
    OAUTH_PROVIDER_CHOICES = [
        ('google', 'Google'),
        ('github', 'GitHub'),
        ('none', 'None'),
    ]

    title = models.CharField(max_length=255, help_text="Human-readable title of the tool")
    description = models.TextField(help_text="Detailed description of tool functionality")
    slug = models.SlugField(max_length=255, unique=True, blank=True, help_text="Unique slug identifier")
    author_id = models.CharField(max_length=255, db_index=True, help_text="Clerk User ID of creator")
    is_public = models.BooleanField(default=True, db_index=True, help_text="Whether tool appears on marketplace")
    requires_oauth = models.BooleanField(default=False, help_text="Whether tool requires OAuth access")
    oauth_provider = models.CharField(
        max_length=50,
        choices=OAUTH_PROVIDER_CHOICES,
        default='none',
        help_text="Target OAuth provider if authentication is required"
    )
    requires_hitl = models.BooleanField(default=False, help_text="Human-in-the-loop approval requirement")
    add_gmail_oauth_flag = models.BooleanField(default=False, help_text="Whether tool requires Gmail send authorization")
    google_products = models.JSONField(default=list, blank=True, help_text="Detected Google products involved in tool execution")
    google_auth_mode = models.CharField(
        max_length=50,
        default='none',
        blank=True,
        help_text="Active Google auth mode: oauth_full, granular_picker, manual_delegation, gmail_app_password, gmail_platform, none"
    )
    form_schema = models.JSONField(
        default=dict,
        blank=True,
        help_text="JSON schema specifying required input fields for execution"
    )
    api_config = models.JSONField(
        default=dict,
        blank=True,
        help_text="Execution API configuration (url, method, headers, body template)"
    )
    webhook_secret = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        editable=False,
        db_index=True,
        help_text="Secret token for inbound webhook execution URL"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['author_id', 'is_public']),
            models.Index(fields=['webhook_secret']),
        ]

    def __str__(self):
        return f"{self.title} ({self.slug})"

    def save(self, *args, **kwargs):
        if not self.slug:
            base_slug = slugify(self.title) or "custom-tool"
            candidate_slug = base_slug
            counter = 1
            while CustomTool.objects.filter(slug=candidate_slug).exclude(pk=self.pk).exists():
                candidate_slug = f"{base_slug}-{counter}"
                counter += 1
            self.slug = candidate_slug
        super().save(*args, **kwargs)


class UserOAuthToken(models.Model):
    PROVIDER_CHOICES = [
        ('google', 'Google'),
        ('github', 'GitHub'),
    ]

    user_id = models.CharField(max_length=255, db_index=True, help_text="Clerk User ID")
    provider = models.CharField(max_length=50, choices=PROVIDER_CHOICES)
    account_email = models.CharField(max_length=255, blank=True, null=True, help_text="Email of the authenticated OAuth account")
    access_token = models.TextField(help_text="Encrypted or raw access token")
    refresh_token = models.TextField(blank=True, null=True, help_text="OAuth refresh token")
    token_expiry = models.DateTimeField(blank=True, null=True, help_text="Token expiration timestamp")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user_id', 'provider')
        indexes = [
            models.Index(fields=['user_id', 'provider']),
        ]

    def __str__(self):
        return f"OAuthToken({self.user_id} - {self.provider})"

    def is_expired(self) -> bool:
        if not self.token_expiry:
            return False
        # Buffer of 60 seconds to avoid edge-of-expiry race conditions
        return timezone.now() >= (self.token_expiry - timezone.timedelta(seconds=60))


class FailedWebhookJob(models.Model):
    STATUS_CHOICES = [
        ('pending_reauth', 'Pending Re-authentication'),
        ('failed', 'Failed'),
        ('resolved', 'Resolved'),
    ]

    tool = models.ForeignKey(
        CustomTool,
        on_delete=models.CASCADE,
        related_name='failed_jobs',
        help_text="Custom tool associated with the webhook trigger"
    )
    payload = models.JSONField(default=dict, help_text="Captured request body")
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='pending_reauth')
    error_message = models.TextField(blank=True, null=True, help_text="Reason for webhook failure")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"FailedWebhookJob({self.tool.title} - {self.status} - {self.created_at.strftime('%Y-%m-%d %H:%M')})"


class LangGraphCheckpointModel(models.Model):
    """
    Django ORM-backed persistence table for LangGraph state checkpointers.
    Stores complete state checkpoints across graph interruptions (HITL).
    """
    thread_id = models.CharField(max_length=255, db_index=True)
    checkpoint_ns = models.CharField(max_length=255, default='', blank=True)
    checkpoint_id = models.CharField(max_length=255, db_index=True)
    parent_checkpoint_id = models.CharField(max_length=255, blank=True, null=True)
    checkpoint = models.JSONField(help_text="Serialized state snapshot")
    metadata = models.JSONField(default=dict, blank=True, help_text="Checkpoint metadata")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('thread_id', 'checkpoint_ns', 'checkpoint_id')
        ordering = ['-created_at']

    def __str__(self):
        return f"Checkpoint({self.thread_id} @ {self.checkpoint_id})"


class LangGraphCheckpointWriteModel(models.Model):
    """
    Django ORM-backed storage for intermediate writes/channels in LangGraph.
    """
    thread_id = models.CharField(max_length=255, db_index=True)
    checkpoint_ns = models.CharField(max_length=255, default='', blank=True)
    checkpoint_id = models.CharField(max_length=255, db_index=True)
    task_id = models.CharField(max_length=255)
    idx = models.IntegerField()
    channel = models.CharField(max_length=255)
    type = models.CharField(max_length=255, blank=True, null=True)
    value = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('thread_id', 'checkpoint_ns', 'checkpoint_id', 'task_id', 'idx')
        ordering = ['idx']

    def __str__(self):
        return f"CheckpointWrite({self.thread_id} @ {self.channel})"


class UserToolDeployment(models.Model):
    """
    User-specific instance/deployment of a CustomTool.
    Holds a unique webhook_secret for that specific user, along with user-configured
    parameters (such as their own fallback email, custom settings, etc.).
    """
    tool = models.ForeignKey(
        CustomTool,
        on_delete=models.CASCADE,
        related_name='deployments',
        help_text="Custom tool template"
    )
    user_id = models.CharField(max_length=255, db_index=True, help_text="Clerk User ID of the user who deployed the tool")
    user_webhook_secret = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        db_index=True,
        editable=False,
        help_text="Unique per-user webhook endpoint token"
    )
    config_data = models.JSONField(
        default=dict,
        blank=True,
        help_text="User configuration e.g. user_email, fallback options, target URL"
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['tool', 'user_id']),
            models.Index(fields=['user_webhook_secret']),
        ]

    def __str__(self):
        return f"Deployment({self.tool.title} for {self.user_id} - {self.user_webhook_secret})"


class CriticalErrorLog(models.Model):
    """
    Production error tracking table for capturing critical AI workflow, LLM,
    data processing, and integration delivery failures.
    """
    CATEGORY_CHOICES = [
        ('graph_execution', 'AI Graph Execution Error'),
        ('llm_error', 'LLM Provider / Routing Error'),
        ('email_error', 'Email Delivery / SMTP Failure'),
        ('api_error', 'External API Call Failure'),
        ('webhook_error', 'Webhook Ingest Error'),
        ('validation_error', 'Data Validation Error'),
        ('general', 'General Critical Error'),
    ]

    tool = models.ForeignKey(
        'CustomTool',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='critical_errors',
        help_text="Associated CustomTool if known"
    )
    tool_name = models.CharField(max_length=255, blank=True, default="", help_text="Cached title of the AI tool")
    tool_slug = models.CharField(max_length=255, blank=True, default="")
    error_category = models.CharField(max_length=50, choices=CATEGORY_CHOICES, default='general', db_index=True)
    error_message = models.TextField(help_text="Detailed error description")
    stack_trace = models.TextField(blank=True, null=True, help_text="Full exception traceback")

    # Standardized 4 data fields
    deploy_tool_data = models.JSONField(default=dict, blank=True, help_text="Tool deployment configuration inputs")
    webhook_data = models.JSONField(null=True, blank=True, help_text="Raw webhook or runtime payload")
    deployer_data = models.JSONField(default=dict, blank=True, help_text="Deployer user profile and contact info")
    tool_owner_data = models.JSONField(default=dict, blank=True, help_text="Tool author profile and contact info")

    execution_context = models.JSONField(
        default=dict,
        blank=True,
        help_text="Contextual runtime data: node_name, thread_id, item_ref, etc."
    )
    resolved = models.BooleanField(default=False, db_index=True, help_text="Whether error has been reviewed/resolved")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['error_category', 'created_at']),
            models.Index(fields=['tool_name', 'created_at']),
        ]

    def __str__(self):
        return f"CriticalErrorLog({self.error_category} - {self.tool_name or 'NoTool'} @ {self.created_at.strftime('%Y-%m-%d %H:%M')})"


class WebhookEventJob(models.Model):
    """
    Supabase Postgres-backed queue, idempotency, and rate limiting tracking table for incoming webhooks.
    Enables immediate HTTP 202 response while the AI Agent runs asynchronously in the background.
    """
    STATUS_CHOICES = [
        ('queued', 'Queued'),
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('pending_hitl', 'Awaiting Human Approval'),
        ('failed', 'Failed'),
    ]

    tool = models.ForeignKey(
        'CustomTool',
        on_delete=models.CASCADE,
        related_name='webhook_jobs',
        help_text="Target custom tool"
    )
    deployment = models.ForeignKey(
        'UserToolDeployment',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='webhook_jobs',
        help_text="User tool deployment if triggered via deployment secret"
    )
    user_id = models.CharField(max_length=255, db_index=True, help_text="Effective deployer user ID")
    idempotency_key = models.CharField(max_length=255, db_index=True, help_text="Unique key from header/payload or SHA-256 payload hash")
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='queued', db_index=True)

    # Standardized 4 data fields
    deploy_tool_data = models.JSONField(default=dict, blank=True, help_text="Deployment form inputs")
    webhook_data = models.JSONField(null=True, blank=True, help_text="Raw inbound webhook payload")
    deployer_data = models.JSONField(default=dict, blank=True, help_text="Deployer profile details")
    tool_owner_data = models.JSONField(default=dict, blank=True, help_text="Tool owner profile details")

    thread_id = models.CharField(max_length=255, blank=True, default='', help_text="LangGraph thread ID")
    result = models.JSONField(default=dict, blank=True, help_text="Output result summary from graph engine")
    error_message = models.TextField(blank=True, null=True, help_text="Execution failure message if any")

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['tool', 'idempotency_key']),
            models.Index(fields=['status', 'created_at']),
            models.Index(fields=['tool', 'created_at']),
            models.Index(fields=['tool', 'deployment', 'created_at']),
        ]

    def __str__(self):
        return f"WebhookEventJob({self.idempotency_key[:16]}... - {self.tool.title} [{self.status}])"


class GoogleProductCapability(models.Model):
    """
    Capability Matrix defining supported Google products, APIs, and explicit permission scopes.
    Matches exact SQL specification: table name google_product_capabilities.
    Gmail access is strictly limited to 'gmail.send'; read/modify is omitted.
    """
    product_display_name = models.CharField(max_length=50)
    package_product_name = models.CharField(max_length=50)
    api_version = models.CharField(max_length=10)
    permission_scope_text = models.CharField(max_length=100)
    target_resource_path = models.CharField(max_length=100)
    description = models.CharField(max_length=255)

    class Meta:
        db_table = 'google_product_capabilities'
        verbose_name = 'Google Product Capability'
        verbose_name_plural = 'Google Product Capabilities'
        ordering = ['product_display_name', 'package_product_name']

    def __str__(self):
        return f"{self.product_display_name} ({self.package_product_name} {self.api_version}) - {self.permission_scope_text}"


class SharedUserAsset(models.Model):
    """
    Dedicated database model for the Shared Service Account Asset Quarantine Strategy.
    Tracks user_id mapped against specific google_file_or_folder_id to prevent cross-profile leakage.
    Access must be programmatically cross-verified against the Drive API before execution.
    """
    DELEGATION_TYPE_CHOICES = [
        ('manual_service_account', 'Manual Service Account Delegation (narainad308@gmail.com)'),
        ('granular_picker', 'Granular Google Picker Selection'),
        ('oauth_full', 'Direct OAuth Consent'),
    ]

    user_id = models.CharField(max_length=255, db_index=True, help_text="Clerk User ID of the asset owner/delegator")
    google_file_or_folder_id = models.CharField(max_length=255, db_index=True, help_text="Google Drive File or Folder ID")
    asset_name = models.CharField(max_length=255, blank=True, default="", help_text="Display title or name of the asset")
    mime_type = models.CharField(max_length=100, blank=True, default="", help_text="MIME type of the asset")
    product_name = models.CharField(max_length=50, default='drive', help_text="Target Google product (drive, sheets, docs, forms)")
    delegation_type = models.CharField(max_length=50, choices=DELEGATION_TYPE_CHOICES, default='manual_service_account')
    service_account_email = models.CharField(max_length=255, default='narainad308@gmail.com')
    is_verified = models.BooleanField(default=False, db_index=True, help_text="Whether access has been cross-verified against Drive API")
    verified_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, null=True, help_text="Last verification error if any")
    metadata = models.JSONField(default=dict, blank=True, help_text="Extra asset metadata (size, parents, permissions)")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'shared_user_assets'
        unique_together = ('user_id', 'google_file_or_folder_id')
        indexes = [
            models.Index(fields=['user_id', 'is_verified']),
            models.Index(fields=['google_file_or_folder_id']),
        ]
        ordering = ['-created_at']

    def __str__(self):
        return f"SharedAsset({self.user_id} -> {self.google_file_or_folder_id} [{self.asset_name or 'unnamed'}])"


