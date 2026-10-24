import logging
import uuid
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework import serializers
from django.conf import settings
from django.utils import timezone

from tools.services.llm_router import LLMRouter
from .models import TaxChatSession, TaxChatMessage

logger = logging.getLogger(__name__)


def get_indian_tax_system_prompt() -> str:
    company = getattr(settings, 'COMPANY_NAME', 'NexusAI')
    return f"""You are {company} Tax & GST Intelligence, an authoritative, expert Indian Chartered Accountant and Tax Specialist AI powered by fine-tuned Qwen3-1.7B (PEFT/LoRA adapter: narainad/qwen3-gst-tax-adapter).

Your domain specialization strictly covers Indian Goods and Services Tax (GST) Compliance, Sections, Clauses, and Factual Accounting Guidance:
1. Goods & Services Tax (GST):
   - GST rate slabs (0%, 5%, 12%, 18%, 28%), Compensation Cess.
   - Mechanism: Central GST (CGST), State GST (SGST), and Integrated GST (IGST) for inter-state transactions.
   - Input Tax Credit (ITC) eligibility under Section 16, Section 17(5) blocked credits, GSTR-1, GSTR-3B, GSTR-9 annual reconciliation, and Reverse Charge Mechanism (RCM).
2. Indian Income Tax Act 1961:
   - Old vs New Tax Regime comparison under Section 115BAC.
   - Slabs & Tax Calculations (Standard Deduction ₹75,000, Section 87A rebate).
   - Exemptions and Deductions: Section 80C (up to ₹1.5L), Section 80D (Mediclaim), Section 80CCD(1B) (NPS), Section 24(b) (Home loan interest), Section 10(13A) (HRA).
3. ITR Filing Forms:
   - ITR-1 (Sahaj), ITR-2, ITR-3, and ITR-4 (Sugam).
4. Compliance & Penalties:
   - Advance Tax schedules, Section 234A/B/C interest calculations, TDS sections (194C, 194J, 194Q, 194IA).

Guidelines:
- Provide precise, factual legal anchors and step-by-step arithmetic calculations.
- Cite specific sections of the CGST Act / Income Tax Act.
- Conclude with a brief standard professional compliance disclaimer.
"""

INDIAN_TAX_SYSTEM_PROMPT = get_indian_tax_system_prompt()


class TaxChatHistoryItemSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=['user', 'assistant', 'system'])
    content = serializers.CharField()


class TaxChatRequestSerializer(serializers.Serializer):
    message = serializers.CharField(required=True, min_length=1)
    session_id = serializers.CharField(required=False, allow_null=True, default=None)
    user_id = serializers.CharField(required=False, default="anonymous")
    history = serializers.ListField(
        child=TaxChatHistoryItemSerializer(),
        required=False,
        default=list
    )


class TaxChatView(APIView):
    """
    POST /api/tax/chat/
    GET  /api/tax/chat/?session_id=<uuid>
    
    Interfaces with the stateless fine-tuned Qwen3-1.7B microservice hosted on Hugging Face Spaces.
    Maintains persistent conversational memory sequentially in the database (TaxChatSession & TaxChatMessage),
    ensuring continuous multi-turn dialogue context across turns.
    """
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        """
        Retrieves complete conversation history for a given session_id.
        """
        session_id_raw = request.query_params.get('session_id')
        if not session_id_raw:
            return Response({"error": "Query parameter 'session_id' is required."}, status=status.HTTP_400_BAD_REQUEST)

        session = TaxChatSession.objects.filter(session_id=session_id_raw).first()
        if not session:
            return Response({"error": "Session not found."}, status=status.HTTP_404_NOT_FOUND)

        messages = [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat()
            }
            for m in session.messages.all()
        ]

        return Response({
            "session_id": str(session.session_id),
            "user_id": session.user_id,
            "title": session.title,
            "messages": messages,
            "updated_at": session.updated_at.isoformat()
        }, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        serializer = TaxChatRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user_message = serializer.validated_data['message']
        session_id_raw = serializer.validated_data.get('session_id')
        user_id = getattr(request.user, 'user_id', None) or serializer.validated_data.get('user_id', 'anonymous')
        seed_history = serializer.validated_data.get('history', [])

        # 1. Retrieve or initialize the persistent database session
        session = None
        if session_id_raw:
            try:
                session = TaxChatSession.objects.filter(session_id=session_id_raw).first()
            except Exception:
                session = None

        if not session:
            session = TaxChatSession.objects.create(
                user_id=user_id,
                title=user_message[:50] + ("..." if len(user_message) > 50 else "")
            )

        # 2. Ensure system prompt anchor is present in DB as root message
        if not session.messages.filter(role='system').exists():
            TaxChatMessage.objects.create(
                session=session,
                role='system',
                content=INDIAN_TAX_SYSTEM_PROMPT
            )

        # 3. Seed historical messages from client if DB was empty
        if session.messages.filter(role__in=['user', 'assistant']).count() == 0 and seed_history:
            for item in seed_history:
                if item['role'] in ['user', 'assistant']:
                    TaxChatMessage.objects.create(
                        session=session,
                        role=item['role'],
                        content=item['content']
                    )

        # 4. Save incoming user message turn to DB
        TaxChatMessage.objects.create(
            session=session,
            role='user',
            content=user_message
        )

        # 5. Reconstruct full chronological messages array for stateless microservice
        full_messages = [
            {"role": m.role, "content": m.content}
            for m in session.messages.all().order_by('created_at')
        ]

        # 6. Extract BYOK headers and dispatch to LLM router
        provider, user_api_key = LLMRouter.extract_auth_from_request(request)
        target_provider = provider or 'hf_gravita'

        try:
            assistant_reply = LLMRouter.route_completion(
                messages=full_messages,
                requested_provider=target_provider,
                user_api_key=user_api_key,
                json_mode=False,
                temperature=0.3,
                max_tokens=1024,
                top_p=0.9
            )

            # 7. Append assistant response turn sequentially into database
            TaxChatMessage.objects.create(
                session=session,
                role='assistant',
                content=assistant_reply
            )
            session.save(update_fields=['updated_at'])

            # 8. Return response along with current session state
            active_messages = [
                {
                    "role": m.role,
                    "content": m.content,
                    "created_at": m.created_at.isoformat()
                }
                for m in session.messages.all().order_by('created_at')
            ]

            return Response(
                {
                    "session_id": str(session.session_id),
                    "reply": assistant_reply,
                    "provider": target_provider,
                    "messages": active_messages,
                    "timestamp": timezone.now().isoformat()
                },
                status=status.HTTP_200_OK
            )

        except Exception as exc:
            logger.error("Tax chat completion error: %s", str(exc), exc_info=True)
            return Response(
                {
                    "error": f"Failed to retrieve tax guidance: {str(exc)}",
                    "session_id": str(session.session_id)
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class TaxChatSessionListView(APIView):
    """
    GET /api/tax/sessions/?user_id=<user_id>
    Lists all persistent tax chat sessions for a given user.
    """
    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        user_id = getattr(request.user, 'user_id', None) or request.query_params.get('user_id', 'anonymous')
        sessions = TaxChatSession.objects.filter(user_id=user_id).order_by('-updated_at')
        
        data = [
            {
                "session_id": str(s.session_id),
                "title": s.title,
                "message_count": s.messages.count(),
                "created_at": s.created_at.isoformat(),
                "updated_at": s.updated_at.isoformat()
            }
            for s in sessions
        ]
        return Response(data, status=status.HTTP_200_OK)
