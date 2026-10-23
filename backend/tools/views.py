import logging
from rest_framework import status, serializers
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated

from .models import CustomTool
from .serializers import (
    GenerateSchemaRequestSerializer,
    GeneratedSchemaResponseSerializer,
    CustomToolSerializer,
    CustomToolPublicSerializer,
)
from .services.llm_router import LLMRouter
from core.logger import app_logger

logger = logging.getLogger(__name__)


SCHEMA_GENERATOR_SYSTEM_PROMPT = """You are an expert AI Automation Tool Architect for the NexusAI Agent Systems Gateway.
Your goal is to parse a natural language tool description into a clean, minimal, production-grade JSON configuration.

CRITICAL CONSTRAINTS:
1. "form_schema": Define ONLY up to MAX 3 input properties for the UI (e.g. invoice_file, client_email, notes) unless the user explicitly described more. The user will be given a button on the UI to add extra fields manually in the next step.
2. Supported field types: "string", "number", "boolean". For documents or files (PDF, images, spreadsheets), use "type": "string" with "description": "Upload document or image file".
3. "requires_hitl": Keep FALSE by default. Set to TRUE ONLY if the user explicitly stated in their description that they require human approval, human-in-the-loop (HITL), or manual review.
4. "requires_oauth": Set to true only if third-party private account authorization (google, github) is required.
5. Return ONLY a valid, compact JSON object matching this exact specification:

{
  "title": "<Concise, professional name for the tool>",
  "description": "<Clear explanation of what the tool accomplishes>",
  "requires_oauth": false,
  "oauth_provider": "none",
  "requires_hitl": false,
  "form_schema": {
    "type": "object",
    "properties": {
      "<param_name>": {
        "type": "<string|number|boolean>",
        "title": "<Human-readable label>",
        "description": "<Field instruction>"
      }
    },
    "required": ["<list of mandatory param_names>"]
  }
}
Do NOT include api_config. Do not include markdown code fences or conversational text. Output purely the valid JSON object.
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
    Uses dynamic LLM router (Lite model: Groq Llama 3.1 8B Instant / Gemini 3.5 Flash-Lite)
    to rapidly generate structured JSON tool definitions with max 3 form inputs.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        serializer = GenerateSchemaRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        description = serializer.validated_data['description']

        provider, user_api_key = LLMRouter.extract_auth_from_request(request)
        target_provider = provider or 'groq'

        messages = [
            {"role": "system", "content": SCHEMA_GENERATOR_SYSTEM_PROMPT},
            {"role": "user", "content": f"Generate tool configuration for the following requirement:\n\n{description}"}
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
                "Form schema generated successfully using model: '%s' (provider: %s)",
                used_model,
                used_provider,
            )
            return Response(generated_data, status=status.HTTP_200_OK)
        except Exception as exc:
            app_logger.error("Schema generation failed: %s", str(exc), exc_info=True)
            return Response(
                {"error": f"Failed to generate tool schema: {str(exc)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class CreateToolView(APIView):
    """
    POST /api/tools/create/
    Accepts user-approved JSON schema and persists the CustomTool.
    Returns tool details, generated slug, and inbound webhook URL.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        data = request.data.copy() if hasattr(request.data, 'copy') else dict(request.data)
        if hasattr(request.user, 'user_id') and request.user.user_id:
            data['author_id'] = request.user.user_id
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

