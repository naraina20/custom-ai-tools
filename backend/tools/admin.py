from django.contrib import admin
from .models import (
    CustomTool,
    UserOAuthToken,
    FailedWebhookJob,
    LangGraphCheckpointModel,
    LangGraphCheckpointWriteModel,
    UserToolDeployment,
    CriticalErrorLog,
    WebhookEventJob,
)


@admin.register(WebhookEventJob)
class WebhookEventJobAdmin(admin.ModelAdmin):
    list_display = ('id', 'tool', 'status', 'idempotency_key', 'thread_id', 'created_at')
    list_filter = ('status', 'tool', 'created_at')
    search_fields = ('idempotency_key', 'tool__title', 'thread_id', 'user_id')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(CustomTool)
class CustomToolAdmin(admin.ModelAdmin):
    list_display = ('title', 'slug', 'author_id', 'is_public', 'requires_oauth', 'oauth_provider', 'requires_hitl', 'created_at')
    list_filter = ('is_public', 'requires_oauth', 'oauth_provider', 'requires_hitl')
    search_fields = ('title', 'description', 'author_id', 'slug')
    readonly_fields = ('slug', 'webhook_secret', 'created_at', 'updated_at')


@admin.register(UserToolDeployment)
class UserToolDeploymentAdmin(admin.ModelAdmin):
    list_display = ('tool', 'user_id', 'user_webhook_secret', 'is_active', 'created_at')
    list_filter = ('is_active', 'tool')
    search_fields = ('user_id', 'tool__title', 'user_webhook_secret')
    readonly_fields = ('user_webhook_secret', 'created_at', 'updated_at')


@admin.register(CriticalErrorLog)
class CriticalErrorLogAdmin(admin.ModelAdmin):
    list_display = ('error_category', 'tool_name', 'resolved', 'created_at')
    list_filter = ('error_category', 'resolved', 'created_at')
    search_fields = ('tool_name', 'error_message', 'stack_trace')
    readonly_fields = ('created_at',)


@admin.register(UserOAuthToken)
class UserOAuthTokenAdmin(admin.ModelAdmin):
    list_display = ('user_id', 'provider', 'token_expiry', 'created_at', 'updated_at')
    list_filter = ('provider',)
    search_fields = ('user_id',)
    readonly_fields = ('created_at', 'updated_at')


@admin.register(FailedWebhookJob)
class FailedWebhookJobAdmin(admin.ModelAdmin):
    list_display = ('tool', 'status', 'created_at', 'updated_at')
    list_filter = ('status', 'tool')
    search_fields = ('tool__title', 'error_message')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(LangGraphCheckpointModel)
class LangGraphCheckpointModelAdmin(admin.ModelAdmin):
    list_display = ('thread_id', 'checkpoint_id', 'checkpoint_ns', 'created_at')
    search_fields = ('thread_id', 'checkpoint_id')
    readonly_fields = ('created_at',)


@admin.register(LangGraphCheckpointWriteModel)
class LangGraphCheckpointWriteModelAdmin(admin.ModelAdmin):
    list_display = ('thread_id', 'checkpoint_id', 'channel', 'idx', 'created_at')
    search_fields = ('thread_id', 'channel')
    readonly_fields = ('created_at',)
