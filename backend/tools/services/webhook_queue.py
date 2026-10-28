import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from django.db import connection, connections

from tools.models import WebhookEventJob
from tools.services.graph_engine import GraphEngine
from tools.services.app_logger import AppLogger
from tools.services.notification_service import NotificationService

logger = logging.getLogger(__name__)


class WebhookQueue:
    """
    Database-backed asynchronous queue for executing AI Agent workflows from webhooks.
    Uses Supabase PostgreSQL for job persistence, state tracking, and ThreadPoolExecutor
    for fast non-blocking background task execution without Redis.
    """
    _executor: Optional[ThreadPoolExecutor] = None

    @classmethod
    def get_executor(cls) -> ThreadPoolExecutor:
        if cls._executor is None:
            cls._executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="webhook_worker")
        return cls._executor

    @classmethod
    def enqueue_job(cls, job_id: int) -> None:
        """
        Dispatches background execution for a WebhookEventJob.
        """
        executor = cls.get_executor()
        executor.submit(cls._run_job_safe, job_id)

    @classmethod
    def _run_job_safe(cls, job_id: int) -> None:
        # Ensure a clean thread-local DB connection for this background worker
        try:
            connection.close()
            connections.close_all()
        except Exception:
            pass

        try:
            job = WebhookEventJob.objects.select_related('tool', 'deployment').filter(id=job_id).first()
            if not job:
                AppLogger.error("WebhookQueue", f"Job #{job_id} not found in database.")
                return

            job.status = 'processing'
            job.save(update_fields=['status', 'updated_at'])

            AppLogger.step(
                "WebhookQueue",
                f"Worker started processing Job #{job.id} for '{job.tool.title}' (Idempotency: {job.idempotency_key[:12]}...)"
            )

            # Build comprehensive execution payload
            raw_payload = job.webhook_data
            payload = {
                "webhook_payload": raw_payload,
                "webhook_data": job.webhook_data,
                "deploy_tool_data": job.deploy_tool_data,
                "deployer_data": job.deployer_data,
                "tool_owner_data": job.tool_owner_data,
                "user_details": job.deployer_data,
                "user_tool_data": job.deploy_tool_data,
                "user_config": job.deploy_tool_data,
            }
            if isinstance(raw_payload, dict):
                for k, v in raw_payload.items():
                    if k not in payload:
                        payload[k] = v
            if isinstance(job.deploy_tool_data, dict):
                for k, v in job.deploy_tool_data.items():
                    if k not in payload:
                        payload[k] = v

            execution_response = GraphEngine.run_flow(
                tool_id=job.tool.id,
                input_data=payload,
                user_id=job.user_id,
                deploy_tool_data=job.deploy_tool_data,
                webhook_data=job.webhook_data,
                deployer_data=job.deployer_data,
                tool_owner_data=job.tool_owner_data,
            )

            resp_status = execution_response.get('status')
            thread_id = execution_response.get('thread_id', '')

            if resp_status == 'pending_human_approval':
                job.status = 'pending_hitl'
                job.thread_id = thread_id
                job.result = execution_response
                job.save(update_fields=['status', 'thread_id', 'result', 'updated_at'])
                AppLogger.step(
                    "WebhookQueue",
                    f"Job #{job.id} for '{job.tool.title}' paused awaiting Human-In-The-Loop approval."
                )

            elif resp_status == 'completed':
                job.status = 'completed'
                job.thread_id = thread_id
                job.result = execution_response.get('result', {})
                job.save(update_fields=['status', 'thread_id', 'result', 'updated_at'])
                AppLogger.step(
                    "WebhookQueue",
                    f"Job #{job.id} for '{job.tool.title}' COMPLETED successfully."
                )

                # Broadcast notification to user
                NotificationService.broadcast_webhook_completion(
                    user_id=job.user_id,
                    tool_title=job.tool.title,
                    status='completed',
                    summary=(job.result or {}).get('summary', f"Workflow execution completed for '{job.tool.title}'."),
                    result=job.result,
                    user_email=job.deployer_data.get('email')
                )

            else:
                err_msg = str(execution_response.get('error', 'Execution returned an error status'))
                job.status = 'failed'
                job.thread_id = thread_id
                job.error_message = err_msg
                job.save(update_fields=['status', 'thread_id', 'error_message', 'updated_at'])
                AppLogger.error("WebhookQueue", f"Job #{job.id} for '{job.tool.title}' failed: {err_msg}")

                NotificationService.broadcast_webhook_completion(
                    user_id=job.user_id,
                    tool_title=job.tool.title,
                    status='failed',
                    summary=f"Execution error on '{job.tool.title}': {err_msg}",
                    error_message=err_msg,
                    user_email=job.deployer_data.get('email')
                )

        except Exception as exc:
            AppLogger.error("WebhookQueue", f"Fatal worker exception on Job #{job_id}: {exc}", exc=exc)
            try:
                job = WebhookEventJob.objects.filter(id=job_id).first()
                if job:
                    job.status = 'failed'
                    job.error_message = str(exc)
                    job.save(update_fields=['status', 'error_message', 'updated_at'])
                    AppLogger.log_critical(
                        message=f"Fatal worker exception on Job #{job_id}: {exc}",
                        category="webhook_error",
                        exc=exc,
                        tool=job.tool,
                        tool_name=job.tool.title,
                        tool_slug=job.tool.slug,
                        deploy_tool_data=job.deploy_tool_data,
                        webhook_data=job.webhook_data,
                        deployer_data=job.deployer_data,
                        tool_owner_data=job.tool_owner_data,
                        execution_context={"job_id": job_id, "queue": "WebhookQueue"}
                    )
                    NotificationService.broadcast_webhook_completion(
                        user_id=job.user_id,
                        tool_title=job.tool.title,
                        status='failed',
                        summary=f"Worker crashed during execution: {str(exc)}",
                        error_message=str(exc),
                        user_email=job.deployer_data.get('email')
                    )
            except Exception:
                pass
        finally:
            try:
                connection.close()
                connections.close_all()
            except Exception:
                pass
