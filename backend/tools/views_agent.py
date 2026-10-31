import logging
import uuid
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework import serializers

from .models import CustomTool, WebhookEventJob, UserToolDeployment
from .services.graph_engine import GraphEngine
from .services.app_logger import AppLogger
from .services.webhook_queue import WebhookQueue

logger = logging.getLogger(__name__)


class AgentRunSerializer(serializers.Serializer):
    tool_id = serializers.IntegerField(required=False, allow_null=True)
    input_data = serializers.DictField(default=dict, required=False)
    user_id = serializers.CharField(required=False, default="default_user")
    thread_id = serializers.CharField(required=False, allow_null=True, default=None)
    deployment_id = serializers.IntegerField(required=False, allow_null=True, default=None)
    decision = serializers.CharField(required=False, allow_null=True, default=None)
    feedback = serializers.CharField(required=False, allow_null=True, allow_blank=True, default="")
    is_hitl_submission = serializers.BooleanField(required=False, default=False)
    sync = serializers.BooleanField(required=False, default=False)

    # Standardized 4 data payload inputs (optional overrides)
    deploy_tool_data = serializers.DictField(required=False, default=None, allow_null=True)
    webhook_data = serializers.JSONField(required=False, default=None, allow_null=True)
    deployer_data = serializers.DictField(required=False, default=None, allow_null=True)
    tool_owner_data = serializers.DictField(required=False, default=None, allow_null=True)


class AgentDecisionSerializer(serializers.Serializer):
    thread_id = serializers.CharField(required=True)
    decision = serializers.ChoiceField(choices=['approve', 'reject'], required=True)
    feedback = serializers.CharField(required=False, allow_blank=True, default="")


class AgentRunView(APIView):
    """
    POST /api/agent/run/
    Initiates LangGraph workflow execution for a given CustomTool.
    Supports asynchronous execution queueing with real-time socket updates,
    as well as resuming paused HITL executions with reviewer feedback.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        # 1. Check if this is a HITL submission from the review page
        is_hitl = (
            request.data.get("is_hitl_submission")
            or request.data.get("decision")
            or ("approved" in request.data)
        )
        if is_hitl:
            thread_id = request.data.get("thread_id")
            deployment_id = request.data.get("deployment_id")
            tool_id = request.data.get("tool_id")
            user_id = getattr(request.user, 'user_id', None) or request.data.get("user_id") or getattr(request.user, 'username', 'default_user')

            # Normalize decision
            raw_decision = request.data.get("decision")
            if raw_decision:
                decision = str(raw_decision).lower().strip()
            elif "approved" in request.data:
                decision = "approve" if request.data.get("approved") else "reject"
            else:
                decision = "approve"

            feedback = request.data.get("feedback", "")

            if not thread_id and deployment_id:
                pending_job = WebhookEventJob.objects.filter(
                    deployment_id=deployment_id,
                    status='pending_hitl'
                ).order_by('-created_at').first()
                if pending_job and pending_job.thread_id:
                    thread_id = pending_job.thread_id

            if not thread_id:
                return Response(
                    {"error": "A valid thread_id or pending deployment is required for HITL resumption."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Locate or create WebhookEventJob for background tracking
            job = WebhookEventJob.objects.filter(thread_id=thread_id).order_by('-created_at').first()
            if not job and deployment_id:
                job = WebhookEventJob.objects.filter(deployment_id=deployment_id, status='pending_hitl').order_by('-created_at').first()

            if not job:
                app, _ = GraphEngine.get_app()
                state_snapshot = app.get_state({"configurable": {"thread_id": thread_id}})
                target_tool_id = tool_id or (state_snapshot.values.get("tool_id") if state_snapshot and state_snapshot.values else None)
                target_tool = CustomTool.objects.filter(pk=target_tool_id).first() if target_tool_id else None
                if target_tool:
                    job = WebhookEventJob.objects.create(
                        tool=target_tool,
                        deployment_id=deployment_id or (state_snapshot.values.get("deployment_id") if state_snapshot and state_snapshot.values else None),
                        user_id=user_id or (state_snapshot.values.get("user_id") if state_snapshot and state_snapshot.values else "default_user"),
                        idempotency_key=f"hitl_{thread_id}",
                        thread_id=thread_id,
                        webhook_data=(state_snapshot.values.get("input_data") if state_snapshot and state_snapshot.values else {}) or {},
                        deploy_tool_data=(state_snapshot.values.get("deploy_tool_data") if state_snapshot and state_snapshot.values else {}) or {},
                        deployer_data=(state_snapshot.values.get("deployer_data") if state_snapshot and state_snapshot.values else {}) or {},
                        tool_owner_data=(state_snapshot.values.get("tool_owner_data") if state_snapshot and state_snapshot.values else {}) or {},
                        status='queued',
                    )

            hitl_response_val = feedback.strip() if (feedback and feedback.strip()) else ("approved" if decision in ["approve", "approved"] else "rejected")

            if job:
                job.status = 'queued'
                job.hitl_response = hitl_response_val
                wh_data = job.webhook_data if isinstance(job.webhook_data, dict) else {}
                wh_data["hitl_response"] = hitl_response_val
                job.webhook_data = wh_data
                job.save(update_fields=['status', 'hitl_response', 'webhook_data', 'updated_at'])
                job_id = job.id
            else:
                job_id = None

            AppLogger.step("AgentRunView", f"Enqueuing HITL decision '{decision}' for thread {thread_id} (Job #{job_id}) with feedback: {bool(feedback)}")

            if job_id:
                WebhookQueue.enqueue_resume_hitl(
                    job_id=job_id,
                    thread_id=thread_id,
                    decision=decision,
                    feedback=feedback,
                )
            else:
                GraphEngine.resume_flow(thread_id=thread_id, decision=decision, feedback=feedback)

            return Response(
                {
                    "status": "queued",
                    "success": True,
                    "message": f"Workflow resumption enqueued with decision '{decision}'. Live updates are streaming to the app.",
                    "job_id": job_id,
                    "thread_id": thread_id,
                    "decision": decision,
                },
                status=status.HTTP_200_OK
            )

        # 2. Regular Workflow Execution Request
        serializer = AgentRunSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        tool_id = serializer.validated_data.get('tool_id')
        if not tool_id:
            return Response({"error": "tool_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        input_data = serializer.validated_data.get('input_data', {})
        user_id = getattr(request.user, 'username', None) or serializer.validated_data.get('user_id', 'default_user')
        thread_id = serializer.validated_data.get('thread_id')
        deployment_id = serializer.validated_data.get('deployment_id')
        run_sync = serializer.validated_data.get('sync', False)

        tool = CustomTool.objects.filter(pk=tool_id).first()
        if not tool:
            return Response({"error": "Tool not found."}, status=status.HTTP_404_NOT_FOUND)

        deployment = UserToolDeployment.objects.filter(pk=deployment_id).first() if deployment_id else None

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
                if deployment:
                    deploy_tool_data = deployment.config_data
                else:
                    deploy_tool_data = {
                        k: v for k, v in input_data.items()
                        if k not in ["webhook_data", "webhook_payload", "deployer_data", "tool_owner_data", "user_details", "user_tool_data", "user_config"]
                    }

        deploy_tool_data = dict(deploy_tool_data or {})
        if deployment:
            deploy_tool_data["requires_hitl"] = deployment.requires_hitl
        else:
            deploy_tool_data.setdefault("requires_hitl", False)

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
                "email": input_data.get("email") or input_data.get("user_email") or (deploy_tool_data or {}).get("personal_email") or "",
                "phone": input_data.get("phone") or input_data.get("phone_number") or "",
            }

        AppLogger.step(
            "AgentRunView",
            f"Initiating agent run for '{tool.title}' (ID: {tool_id}) by user '{deployer_data.get('user_id')}' (sync: {run_sync})",
            {
                "tool_id": tool_id,
                "user_id": user_id,
                "thread_id": thread_id,
                "deploy_tool_data_keys": list(deploy_tool_data.keys()),
            }
        )

        if run_sync:
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
                return Response(
                    {"error": f"Failed to execute agent: {str(exc)}"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
        else:
            # Asynchronous Queue execution
            job = WebhookEventJob.objects.create(
                tool=tool,
                deployment=deployment,
                user_id=user_id,
                idempotency_key=f"app_{uuid.uuid4().hex}",
                status='queued',
                deploy_tool_data=deploy_tool_data,
                webhook_data=webhook_data,
                deployer_data=deployer_data,
                tool_owner_data=tool_owner_data,
            )
            WebhookQueue.enqueue_job(job.id)

            return Response(
                {
                    "status": "queued",
                    "job_id": job.id,
                    "tool_id": tool.id,
                    "tool_title": tool.title,
                    "message": f"Workflow run queued for '{tool.title}'. Live progress updates are sent via notifications.",
                },
                status=status.HTTP_202_ACCEPTED
            )


class AgentDecisionView(APIView):
    """
    POST /api/agent/decision/
    Submits human-in-the-loop decision ('approve' or 'reject') and optional feedback for a paused thread.
    Resumes or cancels LangGraph execution.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        serializer = AgentDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        thread_id = serializer.validated_data['thread_id']
        decision = serializer.validated_data['decision']
        feedback = serializer.validated_data.get('feedback', '')

        AppLogger.step("AgentDecisionView", f"Processing HITL decision '{decision}' for thread {thread_id} with feedback: {bool(feedback)}")

        try:
            # Locate or create WebhookEventJob for background tracking
            job = WebhookEventJob.objects.filter(thread_id=thread_id).order_by('-created_at').first()
            if not job:
                app, _ = GraphEngine.get_app()
                state_snapshot = app.get_state({"configurable": {"thread_id": thread_id}})
                target_tool_id = state_snapshot.values.get("tool_id") if state_snapshot and state_snapshot.values else None
                target_tool = CustomTool.objects.filter(pk=target_tool_id).first() if target_tool_id else None
                if target_tool:
                    user_id = getattr(request.user, 'user_id', None) or getattr(request.user, 'username', 'default_user')
                    job = WebhookEventJob.objects.create(
                        tool=target_tool,
                        deployment_id=state_snapshot.values.get("deployment_id") if state_snapshot and state_snapshot.values else None,
                        user_id=user_id,
                        idempotency_key=f"hitl_{thread_id}",
                        thread_id=thread_id,
                        webhook_data=(state_snapshot.values.get("input_data") if state_snapshot and state_snapshot.values else {}) or {},
                        deploy_tool_data=(state_snapshot.values.get("deploy_tool_data") if state_snapshot and state_snapshot.values else {}) or {},
                        deployer_data=(state_snapshot.values.get("deployer_data") if state_snapshot and state_snapshot.values else {}) or {},
                        tool_owner_data=(state_snapshot.values.get("tool_owner_data") if state_snapshot and state_snapshot.values else {}) or {},
                        status='queued',
                    )

            if job:
                job.status = 'queued'
                job.save(update_fields=['status', 'updated_at'])
                WebhookQueue.enqueue_resume_hitl(
                    job_id=job.id,
                    thread_id=thread_id,
                    decision=decision,
                    feedback=feedback,
                )
                return Response(
                    {
                        "status": "queued",
                        "success": True,
                        "message": f"HITL decision '{decision}' enqueued successfully. Live updates are streaming to the app.",
                        "job_id": job.id,
                        "thread_id": thread_id,
                        "decision": decision,
                    },
                    status=status.HTTP_200_OK
                )
            else:
                result = GraphEngine.resume_flow(thread_id=thread_id, decision=decision, feedback=feedback)
                return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            AppLogger.error("AgentDecisionView", f"Agent decision resume failed for thread {thread_id}: {exc}", exc=exc)
            return Response(
                {"error": f"Failed to process agent decision: {str(exc)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class AgentHITLInfoView(APIView):
    """
    GET /api/agent/hitl-info/
    Fetches human-friendly details of planned actions for a pending HITL thread or deployment.
    Displays tools being called, recipient email bodies, spreadsheet rows, etc. in a natural, clear format.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        thread_id = request.query_params.get("thread_id")
        job_id = request.query_params.get("job_id")
        tool_id = request.query_params.get("tool_id")
        deployment_id = request.query_params.get("deployment_id")

        job = None
        if thread_id:
            job = WebhookEventJob.objects.filter(thread_id=thread_id).order_by('-created_at').first()
        if not job and job_id:
            job = WebhookEventJob.objects.filter(id=job_id).first()
            if job and job.thread_id:
                thread_id = job.thread_id
        if not job and deployment_id:
            job = WebhookEventJob.objects.filter(deployment_id=deployment_id, status='pending_hitl').order_by('-created_at').first()
            if job and job.thread_id:
                thread_id = job.thread_id
        if not job and tool_id:
            job = WebhookEventJob.objects.filter(tool_id=tool_id, status='pending_hitl').order_by('-created_at').first()
            if job and job.thread_id:
                thread_id = job.thread_id

        if not thread_id:
            return Response({
                "status": "none",
                "approval_status": "none",
                "requires_hitl": False,
                "message": "No active HITL session specified."
            }, status=status.HTTP_200_OK)

        app, _ = GraphEngine.get_app()
        state_snapshot = app.get_state({"configurable": {"thread_id": thread_id}})
        
        state_values = state_snapshot.values or {}
        requires_hitl = state_values.get("requires_hitl", True if (job and job.status == 'pending_hitl') else False)
        approval_status = state_values.get("approval_status", "pending" if (job and job.status == 'pending_hitl') else (job.status if job else "completed"))
        raw_plans = state_values.get("execution_plans", [])
        input_data = state_values.get("input_data") or (job.webhook_data if job else {})
        effective_tool_id = state_values.get("tool_id") or (job.tool_id if job else tool_id)
        tool = CustomTool.objects.filter(pk=effective_tool_id).first() if effective_tool_id else (job.tool if job else None)

        # Format human-friendly descriptions and rich LLM-generated payloads for user review
        formatted_plans = []
        for p in raw_plans:
            tool_name = p.get("tool", "Action")
            items = p.get("items", [])

            if tool_name == "send_email":
                recipients = []
                subjects = []
                email_items = []
                for it in items:
                    to_val = it.get("to_email") or it.get("to") or it.get("recipient")
                    subj_val = it.get("subject", "")
                    body_val = it.get("body", "")
                    if to_val:
                        recipients.append(str(to_val))
                    if subj_val:
                        subjects.append(str(subj_val))
                    email_items.append({
                        "to": str(to_val or ""),
                        "subject": str(subj_val),
                        "body": str(body_val),
                        "recipient_type": it.get("recipient_type", "personal"),
                        "client_identifier": it.get("client_identifier", ""),
                    })
                first_it = email_items[0] if email_items else {}
                body_content = first_it.get("body", "")
                formatted_plans.append({
                    "title": "Send Outbound Email(s)",
                    "tool": tool_name,
                    "icon": "mail",
                    "item_count": len(items),
                    "recipients": recipients,
                    "subjects": subjects,
                    "description": f"Ready to deliver {len(items)} outbound email(s) via Gmail to: {', '.join(recipients) if recipients else 'recipients from payload'}.",
                    "details": {
                        "to": ", ".join(recipients) if recipients else str(first_it.get("to", "")),
                        "subject": str(first_it.get("subject", "")),
                        "body": body_content,
                        "body_preview": body_content[:300],
                        "emails": email_items,
                        "items": items,
                    }
                })
            elif tool_name == "write_sheet":
                sheet_titles = [it.get("sheet_title", "Sheet1") for it in items]
                first_it = items[0] if items else {}
                headers = first_it.get("headers", [])
                all_values = []
                for it in items:
                    for v in it.get("values", []):
                        all_values.append(v)
                formatted_plans.append({
                    "title": "Append to Google Spreadsheet",
                    "tool": tool_name,
                    "icon": "spreadsheet",
                    "item_count": len(items),
                    "sheet_title": sheet_titles[0] if sheet_titles else "Sheet1",
                    "row_count": len(all_values),
                    "description": f"Append {len(all_values)} row(s) to Google Sheet '{sheet_titles[0] if sheet_titles else 'Sheet1'}' without overwriting existing data.",
                    "details": {
                        "sheet_title": sheet_titles[0] if sheet_titles else "Sheet1",
                        "rows_count": len(all_values),
                        "headers": headers,
                        "rows": all_values,
                        "sample_rows": all_values[:15],
                        "items": items,
                    }
                })
            else:
                formatted_plans.append({
                    "title": tool_name.replace("_", " ").title(),
                    "tool": tool_name,
                    "icon": "cpu",
                    "item_count": len(items),
                    "description": f"Execute {len(items)} action item(s) for {tool_name}.",
                    "details": {
                        "items": items,
                    }
                })

        return Response({
            "status": approval_status,
            "approval_status": approval_status,
            "requires_hitl": bool(requires_hitl),
            "thread_id": thread_id,
            "tool_id": effective_tool_id,
            "tool_title": tool.title if tool else f"Tool #{effective_tool_id}",
            "tool_description": tool.description if tool else "",
            "actions": formatted_plans,
            "plans": formatted_plans,
            "raw_plans": raw_plans,
            "input_data": input_data or {},
            "job_id": job.id if job else None,
        }, status=status.HTTP_200_OK)
