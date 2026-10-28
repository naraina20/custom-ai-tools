import json
import logging
import sys
import traceback
from datetime import datetime
from typing import Any, Dict, Optional

from django.conf import settings

standard_logger = logging.getLogger("tools")


class AppLogger:
    """
    Centralized Custom Logger for NexusAI Agent Systems.

    Rules:
    1. ERRORS are ALWAYS logged to console/loggers, irrespective of DEBUG flag.
    2. STEP and DEBUG execution logs are ONLY printed when DEBUG is True.
    3. Critical errors are recorded into the CriticalErrorLog production database table
       with full deployer_data, tool_owner_data, deploy_tool_data, webhook_data, and context.
    """

    @classmethod
    def _is_debug(cls) -> bool:
        return getattr(settings, "DEBUG", False)

    @classmethod
    def _timestamp(cls) -> str:
        return datetime.now().strftime("%H:%M:%S")

    @classmethod
    def step(cls, step_name: str, message: str, details: Optional[Dict[str, Any]] = None) -> None:
        """
        Logs a distinct workflow progression step (Node 1, 2, 3, 4, webhook trigger, etc.).
        Executed ONLY when DEBUG is True.
        """
        if not cls._is_debug():
            return

        detail_suffix = ""
        if details:
            try:
                detail_suffix = f"\n{json.dumps(details, default=str, indent=2)}"
            except Exception:
                detail_suffix = f" | Details: {details}"

        standard_logger.info("[STEP] [%s] %s%s", step_name, message, detail_suffix)

    @classmethod
    def debug(cls, component: str, message: str, details: Optional[Dict[str, Any]] = None) -> None:
        """
        Detailed developer diagnostics. Executed ONLY when DEBUG is True.
        """
        if not cls._is_debug():
            return

        detail_suffix = ""
        if details:
            try:
                detail_suffix = f" -> {json.dumps(details, default=str)}"
            except Exception:
                detail_suffix = f" -> {details}"

        standard_logger.debug("[%s] %s%s", component, message, detail_suffix)

    @classmethod
    def info(cls, component: str, message: str) -> None:
        """
        High-level milestone info. Executed ONLY when DEBUG is True.
        """
        if not cls._is_debug():
            return

        standard_logger.info("[%s] %s", component, message)

    @classmethod
    def error(cls, component: str, message: str, exc: Optional[Exception] = None) -> None:
        """
        Logs application errors. ALWAYS executed regardless of DEBUG flag.
        """
        standard_logger.error("[%s] %s", component, message, exc_info=exc if cls._is_debug() else False)

    @classmethod
    def log_critical(
        cls,
        message: str,
        category: str = "general",
        exc: Optional[Exception] = None,
        tool: Optional[Any] = None,
        tool_name: str = "",
        tool_slug: str = "",
        deploy_tool_data: Optional[Dict[str, Any]] = None,
        webhook_data: Optional[Any] = None,
        deployer_data: Optional[Dict[str, Any]] = None,
        tool_owner_data: Optional[Dict[str, Any]] = None,
        execution_context: Optional[Dict[str, Any]] = None,
    ) -> Optional[Any]:
        """
        Records a critical production error into the CriticalErrorLog database table
        and outputs a high-visibility error to the console.
        ALWAYS executed regardless of DEBUG flag.
        """
        ts = cls._timestamp()
        resolved_tool_name = tool_name or (tool.title if tool and hasattr(tool, "title") else "")
        resolved_tool_slug = tool_slug or (tool.slug if tool and hasattr(tool, "slug") else "")

        tb_str = None
        if exc:
            tb_str = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))

        # Console Alert Banner
        print("\n" + "!" * 80, file=sys.stderr, flush=True)
        print(f"[{ts}] [CRITICAL_ERROR] [{category.upper()}] {message}", file=sys.stderr, flush=True)
        print(f"  Tool: '{resolved_tool_name}' ({resolved_tool_slug})", file=sys.stderr, flush=True)
        if deployer_data:
            print(f"  Deployer: {deployer_data.get('user_id')} <{deployer_data.get('email')}>", file=sys.stderr, flush=True)
        if tool_owner_data:
            print(f"  Tool Owner: {tool_owner_data.get('user_id')}", file=sys.stderr, flush=True)
        if exc:
            print(f"  Exception: {exc}", file=sys.stderr, flush=True)
        print("!" * 80 + "\n", file=sys.stderr, flush=True)

        standard_logger.critical(
            "CRITICAL ERROR [%s] on tool '%s': %s",
            category, resolved_tool_name, message, exc_info=exc
        )

        # Database Persistence into CriticalErrorLog table
        try:
            from tools.models import CriticalErrorLog

            # Resolve foreign key if tool instance or ID available
            tool_instance = None
            if tool and hasattr(tool, "pk"):
                tool_instance = tool
            elif isinstance(tool, int):
                from tools.models import CustomTool
                tool_instance = CustomTool.objects.filter(pk=tool).first()

            error_record = CriticalErrorLog.objects.create(
                tool=tool_instance,
                tool_name=resolved_tool_name,
                tool_slug=resolved_tool_slug,
                error_category=category,
                error_message=str(message),
                stack_trace=tb_str,
                deploy_tool_data=deploy_tool_data or {},
                webhook_data=webhook_data,
                deployer_data=deployer_data or {},
                tool_owner_data=tool_owner_data or {},
                execution_context=execution_context or {},
            )
            return error_record
        except Exception as db_err:
            print(f"[{ts}] [ERROR] [AppLogger] Failed to write CriticalErrorLog to DB: {db_err}", file=sys.stderr, flush=True)
            return None
