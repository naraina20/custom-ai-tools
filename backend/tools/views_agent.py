import logging
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework import serializers

from .models import CustomTool
from .services.graph_engine import GraphEngine
from .services.app_logger import AppLogger

logger = logging.getLogger(__name__)


class AgentRunSerializer(serializers.Serializer):
    tool_id = serializers.IntegerField(required=True)
    input_data = serializers.DictField(default=dict)
    user_id = serializers.CharField(required=False, default="default_user")
    thread_id = serializers.CharField(required=False, allow_null=True, default=None)

    # Standardized 4 data payload inputs (optional overrides)
    deploy_tool_data = serializers.DictField(required=False, default=None, allow_null=True)
    webhook_data = serializers.JSONField(required=False, default=None, allow_null=True)
    deployer_data = serializers.DictField(required=False, default=None, allow_null=True)
    tool_owner_data = serializers.DictField(required=False, default=None, allow_null=True)


class AgentDecisionSerializer(serializers.Serializer):
    thread_id = serializers.CharField(required=True)
    decision = serializers.ChoiceField(choices=['approve', 'reject'], required=True)


class AgentRunView(APIView):
    """
    POST /api/agent/run/
    Initiates LangGraph workflow execution for a given CustomTool.
    Maintains standardized 4 data keys (deploy_tool_data, webhook_data, deployer_data, tool_owner_data)
    along with their system descriptions for the LLM.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        serializer = AgentRunSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        tool_id = serializer.validated_data['tool_id']
        input_data = serializer.validated_data['input_data']
        user_id = getattr(request.user, 'user_id', None) or serializer.validated_data.get('user_id', 'default_user')
        thread_id = serializer.validated_data.get('thread_id')

        tool = CustomTool.objects.filter(pk=tool_id).first()
        if not tool:
            return Response({"error": "Tool not found."}, status=status.HTTP_404_NOT_FOUND)

        # Standardize 4 Data Fields
        # 1. tool_owner_data
        tool_owner_data = serializer.validated_data.get('tool_owner_data')
        if not tool_owner_data:
            tool_owner_data = {
                "user_id": tool.author_id if tool else "",
                "name": "",
                "email": "",
                "phone": "",
            }

        # 2. deploy_tool_data
        deploy_tool_data = serializer.validated_data.get('deploy_tool_data')
        if deploy_tool_data is None:
            deploy_tool_data = input_data.get("deploy_tool_data") or input_data.get("user_tool_data") or input_data.get("user_config")
            if deploy_tool_data is None:
                deploy_tool_data = {
                    k: v for k, v in input_data.items()
                    if k not in ["webhook_data", "webhook_payload", "deployer_data", "tool_owner_data", "user_details", "user_tool_data", "user_config"]
                }

        # 3. webhook_data
        webhook_data = serializer.validated_data.get('webhook_data')
        if webhook_data is None:
            webhook_data = input_data.get("webhook_data") or input_data.get("webhook_payload") or {}

        # 4. deployer_data
        deployer_data = serializer.validated_data.get('deployer_data')
        if not deployer_data:
            deployer_data = {
                "user_id": user_id or "default_user",
                "name": input_data.get("name") or input_data.get("user_name") or "",
                "email": input_data.get("email") or input_data.get("user_email") or deploy_tool_data.get("personal_email") or "",
                "phone": input_data.get("phone") or input_data.get("phone_number") or "",
            }

        AppLogger.step(
            "AgentRunView",
            f"Initiating agent run for '{tool.title}' (ID: {tool_id}) by user '{deployer_data.get('user_id')}'",
            {
                "tool_id": tool_id,
                "user_id": user_id,
                "thread_id": thread_id,
                "deploy_tool_data_keys": list(deploy_tool_data.keys()),
            }
        )

        try:
            result = GraphEngine.run_flow(
                tool_id=tool_id,
                input_data=input_data,
                user_id=user_id,
                thread_id=thread_id,
                deploy_tool_data=deploy_tool_data,
                webhook_data=webhook_data,
                deployer_data=deployer_data,
                tool_owner_data=tool_owner_data,
                is_app_execution=True,
            )
            return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            AppLogger.error("AgentRunView", f"Agent execution run failed on tool '{tool.title}': {exc}", exc=exc)
            AppLogger.log_critical(
                message=f"AgentRunView execution exception: {exc}",
                category="graph_execution",
                exc=exc,
                tool=tool,
                tool_name=tool.title,
                tool_slug=tool.slug,
                deploy_tool_data=deploy_tool_data,
                webhook_data=webhook_data,
                deployer_data=deployer_data,
                tool_owner_data=tool_owner_data,
                execution_context={"view": "AgentRunView", "thread_id": thread_id}
            )
            return Response(
                {"error": f"Failed to execute agent: {str(exc)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class AgentDecisionView(APIView):
    """
    POST /api/agent/decision/
    Submits human-in-the-loop decision ('approve' or 'reject') for a paused thread.
    Resumes or cancels LangGraph execution.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        serializer = AgentDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        thread_id = serializer.validated_data['thread_id']
        decision = serializer.validated_data['decision']

        AppLogger.step("AgentDecisionView", f"Processing HITL decision '{decision}' for thread {thread_id}")

        try:
            result = GraphEngine.resume_flow(thread_id=thread_id, decision=decision)
            return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            AppLogger.error("AgentDecisionView", f"Agent decision resume failed for thread {thread_id}: {exc}", exc=exc)
            AppLogger.log_critical(
                message=f"AgentDecisionView resume exception: {exc}",
                category="graph_execution",
                exc=exc,
                execution_context={"view": "AgentDecisionView", "thread_id": thread_id, "decision": decision}
            )
            return Response(
                {"error": f"Failed to process agent decision: {str(exc)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
