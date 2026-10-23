from rest_framework import serializers
from .models import CustomTool, UserOAuthToken, FailedWebhookJob, UserToolDeployment


class GenerateSchemaRequestSerializer(serializers.Serializer):
    description = serializers.CharField(
        min_length=5,
        required=True,
        help_text="Plain English description of the tool to generate the schema for."
    )


class GeneratedSchemaResponseSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    description = serializers.CharField()
    requires_oauth = serializers.BooleanField(default=False)
    oauth_provider = serializers.ChoiceField(
        choices=[('google', 'Google'), ('github', 'GitHub'), ('none', 'None')],
        default='none'
    )
    requires_hitl = serializers.BooleanField(default=False)
    form_schema = serializers.DictField(default=dict)
    api_config = serializers.DictField(required=False, default=dict)


class UserToolDeploymentSerializer(serializers.ModelSerializer):
    webhook_url = serializers.SerializerMethodField(read_only=True)
    tool_title = serializers.CharField(source='tool.title', read_only=True)
    tool_slug = serializers.CharField(source='tool.slug', read_only=True)

    class Meta:
        model = UserToolDeployment
        fields = [
            'id',
            'tool',
            'tool_title',
            'tool_slug',
            'user_id',
            'user_webhook_secret',
            'webhook_url',
            'config_data',
            'is_active',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'user_webhook_secret', 'webhook_url', 'created_at', 'updated_at']

    def get_webhook_url(self, obj) -> str:
        request = self.context.get('request')
        relative_url = f"/api/webhooks/{obj.user_webhook_secret}/"
        if request:
            return request.build_absolute_uri(relative_url)
        return relative_url


class CustomToolSerializer(serializers.ModelSerializer):
    webhook_url = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = CustomTool
        fields = [
            'id',
            'title',
            'description',
            'slug',
            'author_id',
            'is_public',
            'requires_oauth',
            'oauth_provider',
            'requires_hitl',
            'form_schema',
            'api_config',
            'webhook_secret',
            'webhook_url',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'slug', 'webhook_secret', 'webhook_url', 'created_at', 'updated_at']

    def get_webhook_url(self, obj) -> str:
        request = self.context.get('request')
        relative_url = f"/api/webhooks/{obj.webhook_secret}/"
        if request:
            return request.build_absolute_uri(relative_url)
        return relative_url

    def validate(self, attrs):
        requires_oauth = attrs.get('requires_oauth', getattr(self.instance, 'requires_oauth', False))
        oauth_provider = attrs.get('oauth_provider', getattr(self.instance, 'oauth_provider', 'none'))
        if requires_oauth and oauth_provider == 'none':
            raise serializers.ValidationError({"oauth_provider": "An OAuth provider (google or github) must be specified when requires_oauth is True."})
        return attrs


class CustomToolPublicSerializer(serializers.ModelSerializer):
    """
    Public representation for marketplace.
    Omits sensitive webhook secrets and private API credentials/headers.
    """
    class Meta:
        model = CustomTool
        fields = [
            'id',
            'title',
            'description',
            'slug',
            'author_id',
            'requires_oauth',
            'oauth_provider',
            'requires_hitl',
            'form_schema',
            'created_at',
        ]
        read_only_fields = fields


class UserOAuthTokenSerializer(serializers.ModelSerializer):
    is_expired = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = UserOAuthToken
        fields = [
            'id',
            'user_id',
            'provider',
            'access_token',
            'refresh_token',
            'token_expiry',
            'is_expired',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'is_expired', 'created_at', 'updated_at']
        extra_kwargs = {
            'access_token': {'write_only': True},
            'refresh_token': {'write_only': True},
        }

    def get_is_expired(self, obj) -> bool:
        return obj.is_expired()


class FailedWebhookJobSerializer(serializers.ModelSerializer):
    tool_title = serializers.CharField(source='tool.title', read_only=True)

    class Meta:
        model = FailedWebhookJob
        fields = [
            'id',
            'tool',
            'tool_title',
            'payload',
            'status',
            'error_message',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'tool_title', 'created_at', 'updated_at']
