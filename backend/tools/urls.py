from django.urls import path
from .views import (
    GenerateSchemaView,
    ImproveDescriptionView,
    CreateToolView,
    MarketplaceToolsView,
    MyToolsView,
    GoogleCapabilitiesView,
    SharedUserAssetView,
)
from .views_agent import (
    AgentRunView,
    AgentDecisionView,
)
from .views_webhooks import (
    WebhookIngestView,
    UserToolDeployView,
    WebhookJobStatusView,
)
from .views_oauth import (
    GoogleOAuthInitView,
    GoogleOAuthCallbackView,
    GoogleOAuthStatusView,
    GoogleOAuthRevokeView,
)

urlpatterns = [
    # Google OAuth Consent & Token Management
    path('oauth/google/init/', GoogleOAuthInitView.as_view(), name='google-oauth-init'),
    path('oauth/google/callback/', GoogleOAuthCallbackView.as_view(), name='google-oauth-callback'),
    path('oauth/google/status/', GoogleOAuthStatusView.as_view(), name='google-oauth-status'),
    path('oauth/google/revoke/', GoogleOAuthRevokeView.as_view(), name='google-oauth-revoke'),
    # Milestone 1: Tool CRUD & Schema Generator & AI Description Improver
    path('tools/generate-schema/', GenerateSchemaView.as_view(), name='tools-generate-schema'),
    path('tools/improve-description/', ImproveDescriptionView.as_view(), name='tools-improve-description'),
    path('tools/create/', CreateToolView.as_view(), name='tools-create'),
    path('tools/marketplace/', MarketplaceToolsView.as_view(), name='tools-marketplace'),
    path('tools/my-tools/', MyToolsView.as_view(), name='tools-my-tools'),
    path('tools/deploy/', UserToolDeployView.as_view(), name='tools-deploy'),

    # Google Products Capabilities & Shared Asset Quarantine Endpoints
    path('tools/google-capabilities/', GoogleCapabilitiesView.as_view(), name='google-capabilities'),
    path('tools/google-assets/', SharedUserAssetView.as_view(), name='google-assets'),

    # Milestone 3: LangGraph Agent & Human-In-The-Loop Execution
    path('agent/run/', AgentRunView.as_view(), name='agent-run'),
    path('agent/decision/', AgentDecisionView.as_view(), name='agent-decision'),

    # Milestone 4: Universal Catch-All Inbound Webhook (supports tool & user secrets)
    path('webhooks/<uuid:webhook_secret>/', WebhookIngestView.as_view(), name='webhook-ingest'),
    path('webhooks/jobs/<int:job_id>/', WebhookJobStatusView.as_view(), name='webhook-job-status'),
]
