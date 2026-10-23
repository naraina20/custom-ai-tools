import logging
from rest_framework import status, serializers
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated

from .models import CustomTool, GoogleProductCapability, SharedUserAsset
from .serializers import (
    GenerateSchemaRequestSerializer,
    GeneratedSchemaResponseSerializer,
    CustomToolSerializer,
    CustomToolPublicSerializer,
    GoogleProductCapabilitySerializer,
    SharedUserAssetSerializer,
)
from .services.llm_router import LLMRouter
from .services.google_executor import GoogleExecutorService, PLATFORM_SERVICE_ACCOUNT_EMAIL
from core.logger import app_logger

logger = logging.getLogger(__name__)


def build_schema_generator_system_prompt() -> str:
    """
    Fetches the supported product names, versions, scopes, and descriptions
    from google_product_capabilities and injects them into the LLM system prompt context.
    """
    try:
        capabilities = GoogleProductCapability.objects.all()
        caps_list = []
        for c in capabilities:
            caps_list.append(
                f"- {c.product_display_name} (API: {c.package_product_name} {c.api_version}, Scope: '{c.permission_scope_text}', Target Resource: '{c.target_resource_path}'): {c.description}"
            )
        caps_text = "\n".join(caps_list) if caps_list else "All standard Google products supported."
    except Exception as exc:
        logger.warning("Could not load capabilities from database: %s", exc)
        caps_text = "Gmail (gmail.send only), Calendar (v3), Docs (v1), Drive (v3), Forms (v1), Meet (v1), Sheets (v4)."

    return f"""You are an expert AI Automation Tool Architect for the NexusAI Agent Systems Gateway.
Your goal is to parse a natural language tool description into a clean, minimal, production-grade JSON configuration connecting an LLM tool-orchestration pipeline to 7 core Google products: Gmail, Calendar, Docs, Drive, Forms, Meet, and Sheets.

=== SUPPORTED GOOGLE CAPABILITY MATRIX ===
{caps_text}

=== ABSOLUTE ARCHITECTURAL RULES ===
1. CAPABILITY VALIDATION & FALLBACK POLICY:
   - Only the 7 core Google products above and their explicitly listed permission scopes are supported.
   - ABSOLUTE SECURITY RULE: Gmail access is strictly limited to sending outgoing emails ('gmail.send'). Any request for Gmail inbox reading, searching user emails, reading threads, modifying emails, or deleting emails is STRICTLY OMITTED and UNSUPPORTED.
   - If the user's description requires unsupported products (e.g. Google Slides, Photos) or unsupported permissions (e.g. reading user inbox emails, searching inbox, deleting user files without permission), you MUST DROP OUT of the normal configuration loop and TRIGGER THE FALLBACK INTERFACE:
     * "fallback_triggered": true
     * "fallback_reason": "<Detailed, polite explanation of why the requested action is unsupported (e.g. Gmail inbox read access is omitted for security; only outbound sending is permitted)>"
     * "fallback_alternatives": Provide EXACTLY THREE clear, practical alternative workflows to choose from:
         [
           "<Alternative 1: e.g. Trigger via inbound webhook payload when emails arrive instead of reading inbox>",
           "<Alternative 2: e.g. Dispatch outbound notification emails or status updates upon processing>",
           "<Alternative 3: e.g. Read input data from a shared Google Sheet or Google Drive folder instead>"
         ]
     * When fallback_triggered is true, set add_gmail_oauth_flag: false, title: "", description: "", form_schema: {{"type": "object", "properties": {{}}, "required": []}}, requires_oauth: false, oauth_provider: "none".

2. INTELLIGENT GMAIL DETECTION:
   - Strictly avoid primitive string keyword matching (such as just looking for the word "email").
   - Intelligently understand semantic context: decide if the user's text implies an email needs to be sent (e.g., "alert the shipping team about the inventory update", "notify client of status", "forward invoice details").
   - If sending email is implied or required: output "add_gmail_oauth_flag": true.
   - If no outgoing email is implied: output "add_gmail_oauth_flag": false.

3. GOOGLE PRODUCTS & AUTH CHANNELS:
   - Identify which Google products are involved in "google_products_detected" (array of product names, e.g. ["Drive", "Sheets", "Gmail"]).
   - Set "google_auth_flow_required":
     * "both": if both Gmail send AND Drive/Sheets/Docs/Forms are involved.
     * "gmail": if only Gmail send is involved.
     * "drive_workspace": if Drive, Sheets, Docs, or Forms are involved without Gmail.
     * "none": if no Google products are involved.

4. NORMAL TOOL SPECIFICATION (when fallback_triggered is false):
   - "title": Concise, professional name for the tool.
   - "description": Clear explanation of what the tool accomplishes.
   - "requires_oauth": true if any Google product or third-party OAuth is required, else false.
   - "oauth_provider": "google" if any Google product or Gmail is used; "github" for GitHub; otherwise "none".
   - "requires_hitl": Keep FALSE by default. Set to TRUE ONLY if human approval / manual review was explicitly requested.
   - "form_schema": Define ONLY up to MAX 3 input properties for the UI unless user requested more. Supported field types: "string", "number", "boolean".

=== EXACT OUTPUT FORMAT (JSON ONLY) ===
Return ONLY a valid, compact JSON object matching one of the following schemas:

If Unsupported (Fallback Triggered):
{{
  "fallback_triggered": true,
  "fallback_reason": "<Clear explanation>",
  "fallback_alternatives": [
    "<Alternative option 1>",
    "<Alternative option 2>",
    "<Alternative option 3>"
  ],
  "add_gmail_oauth_flag": false,
  "google_products_detected": ["Gmail"],
  "google_auth_flow_required": "none",
  "title": "",
  "description": "",
  "requires_oauth": false,
  "oauth_provider": "none",
  "requires_hitl": false,
  "form_schema": {{"type": "object", "properties": {{}}, "required": []}}
}}

If Supported:
{{
  "fallback_triggered": false,
  "fallback_reason": null,
  "fallback_alternatives": [],
  "add_gmail_oauth_flag": <true|false>,
  "google_products_detected": ["<Product1>", "<Product2>"],
  "google_auth_flow_required": "<both|gmail|drive_workspace|none>",
  "title": "<Concise Tool Title>",
  "description": "<Clear description>",
  "requires_oauth": <true|false>,
  "oauth_provider": "<google|github|none>",
  "requires_hitl": false,
  "form_schema": {{
    "type": "object",
    "properties": {{
      "<param_name>": {{
        "type": "<string|number|boolean>",
        "title": "<Label>",
        "description": "<Field instruction>"
      }}
    }},
    "required": ["<list of required param_names>"]
  }}
}}
Do NOT include markdown fences, conversational filler, or commentary. Output purely the JSON object.
"""


class ImproveDescriptionRequestSerializer(serializers.Serializer):
    description = serializers.CharField(
        min_length=3,
        required=True,
        help_text="Short tool description to improve with AI."
    )


class ImproveDescriptionView(APIView):
    """
    POST /api/tools/improve-description/
    Accepts: { "description": "..." }
    Uses lite fast model (llama-3.1-8b-instant / gemini-3.5-flash-lite) to polish
    and expand the tool description into a clean, professional specification.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        serializer = ImproveDescriptionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        raw_description = serializer.validated_data['description']

        provider, user_api_key = LLMRouter.extract_auth_from_request(request)
        target_provider = provider or 'groq'

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a professional prompt engineer for an agentic AI tool gateway. "
                    "Refine the user's tool concept into a clear, concise 2-sentence specification. "
                    "State the inputs expected, the core processing action, and the output format or delivery. "
                    "Return ONLY the improved text directly without conversational filler or quotation marks."
                )
            },
            {
                "role": "user",
                "content": f"Improve this tool concept:\n\n{raw_description}"
            }
        ]

        try:
            improved = LLMRouter.route_completion(
                messages=messages,
                requested_provider=target_provider,
                user_api_key=user_api_key,
                json_mode=False,
                max_tokens=1024,
                temperature=0.3,
                tier="lite",
            )
            return Response(
                {"original": raw_description, "improved_description": str(improved).strip()},
                status=status.HTTP_200_OK
            )
        except Exception as exc:
            logger.error("Failed to improve description: %s", str(exc), exc_info=True)
            return Response(
                {"error": f"Failed to improve description: {str(exc)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class GenerateSchemaView(APIView):
    """
    POST /api/tools/generate-schema/
    Accepts: { "description": "..." }
    Injects Google capability matrix into LLM prompt context.
    Evaluates capabilities: triggers Fallback Interface with 3 alternatives if unsupported (e.g. Gmail inbox reading),
    or intelligently determines add_gmail_oauth_flag and Google product auth channels.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        serializer = GenerateSchemaRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        description = serializer.validated_data['description']

        provider, user_api_key = LLMRouter.extract_auth_from_request(request)
        target_provider = provider or 'groq'

        system_prompt = build_schema_generator_system_prompt()
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Generate tool configuration and validate Google capabilities for:\n\n{description}"}
        ]

        try:
            generated_data, meta = LLMRouter.route_completion(
                messages=messages,
                requested_provider=target_provider,
                user_api_key=user_api_key,
                json_mode=True,
                max_tokens=4096,
                temperature=0.1,
                tier="lite",
                return_metadata=True,
            )
            used_model = meta.get("model") or "unknown"
            used_provider = meta.get("provider") or target_provider
            app_logger.info(
                "Form schema / capability validation generated successfully using model: '%s' (provider: %s)",
                used_model,
                used_provider,
            )

            # Ensure expected default keys are present in generated_data
            if not isinstance(generated_data, dict):
                generated_data = {}

            defaults = {
                "fallback_triggered": False,
                "fallback_reason": None,
                "fallback_alternatives": [],
                "add_gmail_oauth_flag": False,
                "google_products_detected": [],
                "google_auth_flow_required": "none",
                "requires_oauth": False,
                "oauth_provider": "none",
                "requires_hitl": False,
                "form_schema": {"type": "object", "properties": {}, "required": []},
            }
            for k, v in defaults.items():
                if k not in generated_data:
                    generated_data[k] = v

            return Response(generated_data, status=status.HTTP_200_OK)
        except Exception as exc:
            app_logger.error("Schema generation failed: %s", str(exc), exc_info=True)
            return Response(
                {"error": f"Failed to generate tool schema: {str(exc)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class GoogleCapabilitiesView(APIView):
    """
    GET /api/tools/google-capabilities/
    Returns the supported Google products capability matrix from database.
    """
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        caps = GoogleProductCapability.objects.all()
        serializer = GoogleProductCapabilitySerializer(caps, many=True)
        return Response({
            "service_account_email": PLATFORM_SERVICE_ACCOUNT_EMAIL,
            "capabilities": serializer.data,
            "supported_products": ["Gmail", "Calendar", "Docs", "Drive", "Forms", "Meet", "Sheets"],
            "gmail_permission_limit": "gmail.send only (read/modify omitted)",
        }, status=status.HTTP_200_OK)


class SharedUserAssetView(APIView):
    """
    GET /api/tools/google-assets/ - list user's shared assets
    POST /api/tools/google-assets/ - register and cross-verify a shared asset against Drive API
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        user_id = getattr(request.user, 'user_id', None) or request.query_params.get('user_id')
        if not user_id:
            return Response({"error": "User ID required."}, status=status.HTTP_400_BAD_REQUEST)

        assets = SharedUserAsset.objects.filter(user_id=user_id)
        serializer = SharedUserAssetSerializer(assets, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        user_id = getattr(request.user, 'user_id', None) or request.data.get('user_id')
        if not user_id:
            return Response({"error": "User ID required."}, status=status.HTTP_400_BAD_REQUEST)

        file_id = request.data.get('google_file_or_folder_id', '').strip()
        if not file_id:
            return Response({"error": "google_file_or_folder_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        asset_name = request.data.get('asset_name', '').strip()
        product_name = request.data.get('product_name', 'drive')
        delegation_type = request.data.get('delegation_type', 'manual_service_account')

        # Create or update SharedUserAsset mapping
        asset, created = SharedUserAsset.objects.update_or_create(
            user_id=user_id,
            google_file_or_folder_id=file_id,
            defaults={
                'asset_name': asset_name or f"Shared Asset ({file_id[:8]}...)",
                'product_name': product_name,
                'delegation_type': delegation_type,
                'service_account_email': PLATFORM_SERVICE_ACCOUNT_EMAIL,
            }
        )

        # Programmatically cross-verify access token / Drive API via Service Account
        is_verified, verified_asset, error_msg = GoogleExecutorService.verify_and_quarantine_asset(
            user_id=user_id,
            google_file_or_folder_id=file_id,
            product_name=product_name
        )

        return Response({
            "asset": SharedUserAssetSerializer(asset).data,
            "is_verified": is_verified,
            "verification_error": error_msg,
            "service_account_email": PLATFORM_SERVICE_ACCOUNT_EMAIL,
            "message": "Asset verified successfully." if is_verified else f"Asset created but verification failed: {error_msg}"
        }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class CreateToolView(APIView):
    """
    POST /api/tools/create/
    Accepts user-approved JSON schema and persists the CustomTool.
    Returns tool details, generated slug, and inbound webhook URL.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        data = request.data.copy() if hasattr(request.data, 'copy') else dict(request.data)
        author_id = getattr(request.user, 'user_id', None) or request.headers.get('X-User-Id') or data.get('author_id')
        if author_id:
            data['author_id'] = author_id

        # By default all tools are public unless explicitly set to False
        if 'is_public' not in data:
            data['is_public'] = True
        elif isinstance(data['is_public'], str):
            data['is_public'] = data['is_public'].lower() in ['true', '1', 'yes']

        serializer = CustomToolSerializer(data=data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        tool = serializer.save()
        return Response(
            CustomToolSerializer(tool, context={'request': request}).data,
            status=status.HTTP_201_CREATED
        )


class MarketplaceToolsView(APIView):
    """
    GET /api/tools/marketplace/
    Returns all public tools available in the marketplace (is_public=True).
    Masks private credentials and webhook secrets.
    """
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        tools = CustomTool.objects.filter(is_public=True).order_by('-created_at')
        serializer = CustomToolPublicSerializer(tools, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class MyToolsView(APIView):
    """
    GET /api/tools/my-tools/
    Returns all tools created by the user, including private tools (is_public=False).
    Optional query parameters:
      - ?author_id=<author_id> (e.g. ?author_id=user_dev)
      - ?is_public=false (or true)
    Returns complete tool schemas, configurations, and webhook URLs.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        author_id = getattr(request.user, 'user_id', None) or request.query_params.get('author_id') or request.headers.get('X-User-Id')
        is_public_param = request.query_params.get('is_public')

        qs = CustomTool.objects.all()
        if author_id:
            qs = qs.filter(author_id=author_id)

        if is_public_param is not None:
            is_pub = is_public_param.lower() in ['true', '1', 'yes']
            qs = qs.filter(is_public=is_pub)
        elif not author_id:
            # Default to private tools if neither author nor is_public is explicitly passed
            qs = qs.filter(is_public=False)

        tools = qs.order_by('-created_at')
        serializer = CustomToolSerializer(tools, many=True, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)

