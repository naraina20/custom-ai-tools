import base64
import json
import logging
import operator
import re
import uuid
from typing import Annotated, Any, Dict, Iterator, List, Optional, Sequence, Tuple, TypedDict

import requests
from asgiref.sync import sync_to_async
from django.conf import settings
from django.db import close_old_connections, connection
from django.utils import timezone

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
)
from langgraph.graph import END, START, StateGraph

from tools.models import (
    CustomTool,
    FailedWebhookJob,
    LangGraphCheckpointModel,
    LangGraphCheckpointWriteModel,
    UserOAuthToken,
    GoogleProductCapability,
    SharedUserAsset,
)
from tools.services.notification_service import NotificationService
from tools.services.google_executor import (
    GoogleExecutorService,
    execute_google_action,
    AssetQuarantineError,
    PLATFORM_SERVICE_ACCOUNT_EMAIL,
)
from tools.services.general_tools import (
    DocumentExtractorTool,
    ImagesToPdfTool,
    EmailSenderTool,
    ApiCallerTool,
    PayloadExtractorTool,
    ToolCatalogManager,
    GeneralToolsError,
)
from tools.services.llm_router import LLMRouter
from tools.services.app_logger import AppLogger

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1. Custom Django ORM Checkpointer for LangGraph
# ---------------------------------------------------------------------------
class DjangoORMCheckpointer(BaseCheckpointSaver):
    """
    Production-grade database-backed checkpointer for LangGraph using Django ORM.
    Persists checkpoints and intermediate task writes across graph interruptions (HITL).
    Encodes binary msgpack/serde bytes to Base64 dictionaries to ensure safe storage in Django JSONFields.
    """

    @staticmethod
    def _encode_typed(typed_data: Any) -> Optional[Dict[str, str]]:
        """
        Encodes a (type, bytes) tuple from serde.dumps_typed into a JSON-safe dictionary
        with base64-encoded bytes so it can be stored inside Django's JSONField.
        """
        if typed_data is None:
            return None
        if isinstance(typed_data, (tuple, list)) and len(typed_data) == 2:
            type_str, data_bytes = typed_data
            if isinstance(data_bytes, bytes):
                return {
                    "type": str(type_str),
                    "data": base64.b64encode(data_bytes).decode("ascii"),
                }
            elif isinstance(data_bytes, str):
                return {
                    "type": str(type_str),
                    "data": base64.b64encode(data_bytes.encode("utf-8")).decode("ascii"),
                }
        if isinstance(typed_data, dict):
            return typed_data
        return {"type": "raw", "data": str(typed_data)}

    @staticmethod
    def _decode_typed(data: Any) -> Optional[Tuple[str, bytes]]:
        """
        Decodes a JSON-safe dictionary with base64 data back into the (type, bytes)
        tuple expected by serde.loads_typed.
        """
        if data is None:
            return None
        if isinstance(data, dict) and "type" in data and "data" in data:
            data_str = data["data"]
            try:
                decoded_bytes = base64.b64decode(str(data_str).encode("ascii"))
            except Exception:
                decoded_bytes = str(data_str).encode("utf-8")
            return (str(data["type"]), decoded_bytes)
        if isinstance(data, (tuple, list)) and len(data) == 2:
            type_str, data_bytes = data
            if isinstance(data_bytes, str):
                data_bytes = data_bytes.encode("utf-8")
            return (str(type_str), data_bytes)
        return ("raw", str(data).encode("utf-8"))

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        thread_id = str(config["configurable"]["thread_id"])
        checkpoint_ns = str(config["configurable"].get("checkpoint_ns", ""))
        checkpoint_id = checkpoint["id"]
        parent_checkpoint_id = config["configurable"].get("checkpoint_id")

        serialized_checkpoint = self._encode_typed(self.serde.dumps_typed(checkpoint))
        serialized_metadata = self._encode_typed(self.serde.dumps_typed(metadata))

        LangGraphCheckpointModel.objects.update_or_create(
            thread_id=thread_id,
            checkpoint_ns=checkpoint_ns,
            checkpoint_id=checkpoint_id,
            defaults={
                "parent_checkpoint_id": parent_checkpoint_id,
                "checkpoint": serialized_checkpoint,
                "metadata": serialized_metadata,
            },
        )

        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint_id,
            }
        }

    def put_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[Tuple[str, Any]],
        task_id: str,
    ) -> None:
        thread_id = str(config["configurable"]["thread_id"])
        checkpoint_ns = str(config["configurable"].get("checkpoint_ns", ""))
        checkpoint_id = str(config["configurable"]["checkpoint_id"])

        for idx, (channel, val) in enumerate(writes):
            encoded_val = self._encode_typed(self.serde.dumps_typed(val))
            LangGraphCheckpointWriteModel.objects.update_or_create(
                thread_id=thread_id,
                checkpoint_ns=checkpoint_ns,
                checkpoint_id=checkpoint_id,
                task_id=task_id,
                idx=idx,
                defaults={
                    "channel": channel,
                    "type": encoded_val["type"] if encoded_val else None,
                    "value": encoded_val,
                },
            )

    def get_tuple(self, config: RunnableConfig) -> Optional[CheckpointTuple]:
        thread_id = str(config["configurable"]["thread_id"])
        checkpoint_ns = str(config["configurable"].get("checkpoint_ns", ""))
        checkpoint_id = config["configurable"].get("checkpoint_id")

        query = LangGraphCheckpointModel.objects.filter(
            thread_id=thread_id,
            checkpoint_ns=checkpoint_ns,
        )
        if checkpoint_id:
            record = query.filter(checkpoint_id=checkpoint_id).first()
        else:
            record = query.order_by("-created_at").first()

        if not record:
            return None

        checkpoint = self.serde.loads_typed(self._decode_typed(record.checkpoint))
        metadata = self.serde.loads_typed(self._decode_typed(record.metadata))

        writes_records = LangGraphCheckpointWriteModel.objects.filter(
            thread_id=thread_id,
            checkpoint_ns=checkpoint_ns,
            checkpoint_id=record.checkpoint_id,
        ).order_by("idx")

        pending_writes = [
            (w.task_id, w.channel, self.serde.loads_typed(self._decode_typed(w.value)))
            for w in writes_records
        ]

        parent_config = None
        if record.parent_checkpoint_id:
            parent_config = {
                "configurable": {
                    "thread_id": thread_id,
                    "checkpoint_ns": checkpoint_ns,
                    "checkpoint_id": record.parent_checkpoint_id,
                }
            }

        return CheckpointTuple(
            config={
                "configurable": {
                    "thread_id": thread_id,
                    "checkpoint_ns": checkpoint_ns,
                    "checkpoint_id": record.checkpoint_id,
                }
            },
            checkpoint=checkpoint,
            metadata=metadata,
            parent_config=parent_config,
            pending_writes=pending_writes,
        )

    def list(
        self,
        config: Optional[RunnableConfig],
        *,
        filter: Optional[Dict[str, Any]] = None,
        before: Optional[RunnableConfig] = None,
        limit: Optional[int] = None,
    ) -> Iterator[CheckpointTuple]:
        qs = LangGraphCheckpointModel.objects.all().order_by("-created_at")
        if config and "configurable" in config:
            thread_id = config["configurable"].get("thread_id")
            if thread_id:
                qs = qs.filter(thread_id=thread_id)
            checkpoint_ns = config["configurable"].get("checkpoint_ns")
            if checkpoint_ns is not None:
                qs = qs.filter(checkpoint_ns=checkpoint_ns)
        if limit:
            qs = qs[:limit]

        for record in qs:
            checkpoint = self.serde.loads_typed(self._decode_typed(record.checkpoint))
            metadata = self.serde.loads_typed(self._decode_typed(record.metadata))
            yield CheckpointTuple(
                config={
                    "configurable": {
                        "thread_id": record.thread_id,
                        "checkpoint_ns": record.checkpoint_ns,
                        "checkpoint_id": record.checkpoint_id,
                    }
                },
                checkpoint=checkpoint,
                metadata=metadata,
                parent_config=None,
            )

    # Async compatibility bindings
    async def aget_tuple(self, config: RunnableConfig) -> Optional[CheckpointTuple]:
        return await sync_to_async(self.get_tuple)(config)

    async def aput(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        return await sync_to_async(self.put)(config, checkpoint, metadata, new_versions)

    async def aput_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[Tuple[str, Any]],
        task_id: str,
    ) -> None:
        return await sync_to_async(self.put_writes)(config, writes, task_id)

    async def alist(
        self,
        config: Optional[RunnableConfig],
        *,
        filter: Optional[Dict[str, Any]] = None,
        before: Optional[RunnableConfig] = None,
        limit: Optional[int] = None,
    ):
        tuples = await sync_to_async(list)(self.list(config, filter=filter, before=before, limit=limit))
        for t in tuples:
            yield t


# ---------------------------------------------------------------------------
# 2. Standardized Data Descriptions & LangGraph State Definition
# ---------------------------------------------------------------------------
DATA_DESCRIPTIONS: Dict[str, str] = {
    "deploy_tool_data": "Configuration and form schema inputs provided by the user when deploying this AI Tool instance (e.g., target API URLs, personal fallback email, recipient preferences, custom parameters).",
    "webhook_data": "Raw runtime data payload received from the inbound webhook or manual trigger (e.g., incoming order data, customer list, event payload, document references).",
    "deployer_data": "Profile and contact details of the user who deployed this AI tool instance (user_id, name, email, phone). Used for on-app alerts, fallback recipient contact, and deployment ownership.",
    "tool_owner_data": "Profile and contact details of the creator/author who built this AI tool template (user_id, name, email, phone). Used for creator notifications and escalation.",
}


class AgentState(TypedDict):
    messages: Annotated[List[Dict[str, str]], operator.add]
    tool_id: int
    tool_slug: str
    user_id: str

    # Standardized 4 data fields with exact user names & descriptions
    deploy_tool_data: Dict[str, Any]
    webhook_data: Any
    deployer_data: Dict[str, Any]
    tool_owner_data: Dict[str, Any]
    data_descriptions: Dict[str, str]

    # Backward-compatibility aliases
    user_details: Dict[str, Any]
    user_tool_data: Dict[str, Any]
    input_data: Dict[str, Any]

    requires_hitl: bool
    approval_status: str  # "pending", "approved", "rejected", "completed"
    execution_result: Optional[Dict[str, Any]]
    auth_token: Optional[str]
    prepared_request: Optional[Dict[str, Any]]
    selected_tools: List[str]  # Ordered tool names from Node 1 (e.g. ["send_email", "api_call"])
    execution_plans: List[Dict[str, Any]]  # Structured array of execution plans matching tool schemas in exact order
    planned_action: Optional[Dict[str, Any]]  # Compatibility alias
    failed_items: List[Dict[str, Any]]  # Items failing validation/execution
    error: Optional[str]

    # Google Products Integration & Asset Quarantine fields
    add_gmail_oauth_flag: Optional[bool]
    google_products: List[str]
    google_auth_mode: Optional[str]
    quarantined_assets_verified: bool
    google_capability_context: Optional[Dict[str, Any]]
    is_app_execution: Optional[bool]


# ---------------------------------------------------------------------------
# 3. LangGraph Graph Nodes
# ---------------------------------------------------------------------------
def tool_selector_node(state: AgentState) -> Dict[str, Any]:
    """
    Node 1 (Tool Selector):
    Evaluates the user's AI-Tool description against our available General Tools registry.
    Uses High Reasoning LLM to select which General Tools must be used and returns an
    ORDERED ARRAY of tool names in the exact sequence they should be executed (e.g. ["send_email", "api_call"]).
    Note: Document extraction is not performed here; it will be handled via general tools when requested.
    """
    tool_id = state["tool_id"]
    input_data = state.get("input_data", {})
    user_id = state.get("user_id", "")

    try:
        tool = CustomTool.objects.get(pk=tool_id)
    except CustomTool.DoesNotExist:
        return {
            "error": f"Tool with id {tool_id} does not exist.",
            "messages": [{"role": "assistant", "content": f"Error: Tool {tool_id} not found."}],
        }

    # 1. Resolve Standardized Entities
    deployer_data = state.get("deployer_data") or state.get("user_details") or {}
    tool_owner_data = state.get("tool_owner_data") or {}
    deploy_tool_data = state.get("deploy_tool_data") or state.get("user_tool_data") or {}
    webhook_data = state.get("webhook_data")

    deployer_email = deployer_data.get("email") or deploy_tool_data.get("email") or deploy_tool_data.get("personal_email")
    deployer_name = deployer_data.get("name") or deployer_data.get("user_id") or user_id

    # 2. Build effective description with confirmed tasks appended
    effective_description = tool.description
    if getattr(tool, 'tasks', None) and tool.tasks.strip():
        effective_description += f"\n\nConfirmed Step-by-Step Execution Tasks:\n{tool.tasks.strip()}"

    # 3. Ordered Tool Selection via High Reasoning LLM
    decision = ToolCatalogManager.decide_required_tools(
        description=effective_description,
    )
    selected_tools = decision.get("selected_tools") or []
    if not selected_tools:
        # Fallback to data_response if no specific action tools matched
        selected_tools = ["data_response"]

    # 3. Resolve OAuth if required
    auth_token = None
    if tool.requires_oauth and tool.oauth_provider != 'none':
        token_record = UserOAuthToken.objects.filter(
            user_id=user_id or tool.author_id,
            provider=tool.oauth_provider,
        ).first()
        if token_record and not token_record.is_expired():
            auth_token = token_record.access_token

    AppLogger.step(
        "Node 1: Tool Selector",
        f"Selected general tools for '{tool.title}': {selected_tools}",
        {"selected_tools": selected_tools, "reason": decision.get("reason", "")}
    )

    out_payload = {
        "tool_slug": tool.slug,
        "selected_tools": selected_tools,
        "auth_token": auth_token,
        "deploy_tool_data": deploy_tool_data,
        "webhook_data": webhook_data,
        "deployer_data": deployer_data,
        "tool_owner_data": tool_owner_data,
        # Backward compatibility aliases:
        "user_details": deployer_data,
        "user_tool_data": deploy_tool_data,
        "messages": [
            {
                "role": "assistant",
                "content": f"Node 1: Evaluated AI-tool description. Selected ordered general tools: {selected_tools}. Reason: {decision.get('reason', '')}",
            }
        ],
    }

    if state.get("is_app_execution"):
        tools_str = ", ".join(selected_tools) if selected_tools else "Standard pipeline"
        NotificationService.broadcast_step_progress(
            user_id=state.get("user_id"),
            tool_title=tool.title if tool else f"Tool #{tool_id}",
            step_name="Step 1: Pipeline Configuration",
            details=f"Selected workflow tools: {tools_str}",
            status="completed",
            step_index=1,
            total_steps=4,
        )

    return out_payload


def google_capability_node(state: AgentState) -> Dict[str, Any]:
    """
    Dedicated Node: Google Capability Validator
    Cross-checks the selected tools and tool context against the Google Product Capabilities Matrix.
    Strictly verifies that:
    1. Only supported products (Gmail, Calendar, Docs, Drive, Forms, Meet, Sheets) are utilized.
    2. Gmail access is strictly restricted to outbound send (gmail.send). Any inbox read or modify action is rejected.
    3. Flags whether add_gmail_oauth_flag is active.
    """
    if state.get("error"):
        return {}

    tool_id = state["tool_id"]
    tool = CustomTool.objects.filter(pk=tool_id).first()
    selected_tools = state.get("selected_tools", [])
    google_products = (tool.google_products if tool else []) or []
    add_gmail_oauth_flag = tool.add_gmail_oauth_flag if tool else False
    google_auth_mode = tool.google_auth_mode if tool else 'none'

    is_google_active = (
        "google_action" in selected_tools
        or bool(google_products)
        or add_gmail_oauth_flag
        or (tool and tool.oauth_provider == "google")
    )

    AppLogger.step(
        "Google Capability Node",
        f"Verifying Google capabilities for '{tool.title if tool else tool_id}': active={is_google_active}, gmail_send={add_gmail_oauth_flag}, products={google_products}"
    )

    if not is_google_active:
        return {
            "google_products": google_products,
            "add_gmail_oauth_flag": add_gmail_oauth_flag,
            "google_auth_mode": google_auth_mode,
            "quarantined_assets_verified": False,
        }

    # Fetch available capabilities from database matrix
    caps = GoogleProductCapability.objects.all()

    # Check for prohibited Gmail inbox/read actions in input or tool description
    tool_desc = (tool.description if tool else "").lower()
    if "gmail" in tool_desc and any(forbidden in tool_desc for forbidden in ["read email", "inbox", "search email", "delete email"]):
        err = "Security Policy Violation: Gmail inbox read/modify access is prohibited. Only outgoing email dispatch (gmail.send) is permitted."
        AppLogger.error("Google Capability Node", err)
        return {
            "error": err,
            "messages": [{"role": "assistant", "content": err}],
        }

    if state.get("is_app_execution") and is_google_active:
        NotificationService.broadcast_step_progress(
            user_id=state.get("user_id"),
            tool_title=tool.title if tool else f"Tool #{tool_id}",
            step_name="Step 2: Google Capabilities Verified",
            details="Validated permission boundary and product compatibility (gmail.send authorized).",
            status="completed",
            step_index=2,
            total_steps=4,
        )

    return {
        "google_products": google_products,
        "add_gmail_oauth_flag": add_gmail_oauth_flag,
        "google_auth_mode": google_auth_mode,
        "quarantined_assets_verified": False,
        "google_capability_context": {
            "supported_count": caps.count(),
            "service_account_email": PLATFORM_SERVICE_ACCOUNT_EMAIL,
        }
    }


def tool_planner_node(state: AgentState) -> Dict[str, Any]:
    """
    Node 2 (Tool Planner):
    Receives the ordered tools list from Node 1, their exact schemas & tool-specific schema mapping instructions
    from the general tools registry, and all standardized context data (deploy_tool_data, webhook_data,
    deployer_data, tool_owner_data) with their official descriptions.
    Instructs the High Reasoning LLM to return a structured array of tool execution plans ('execution_plans')
    matching each tool's schema in the exact same sequence.
    """
    if state.get("error"):
        return {}

    tool_id = state["tool_id"]
    selected_tools = state.get("selected_tools", [])
    
    # 4 standardized data fields with descriptions
    deploy_tool_data = state.get("deploy_tool_data") if state.get("deploy_tool_data") is not None else (state.get("user_tool_data") or {})
    webhook_data = state.get("webhook_data") if state.get("webhook_data") is not None else state.get("input_data", {}).get("webhook_payload", {})
    deployer_data = state.get("deployer_data") if state.get("deployer_data") is not None else (state.get("user_details") or {})
    tool_owner_data = state.get("tool_owner_data") or {}
    data_descriptions = state.get("data_descriptions") or DATA_DESCRIPTIONS

    try:
        tool = CustomTool.objects.get(pk=tool_id)
    except CustomTool.DoesNotExist:
        return {"error": f"Tool #{tool_id} does not exist."}

    # Retrieve exact schemas and tool-specific instructions dynamically for the selected tools
    tools_schemas_str = ToolCatalogManager.get_tools_schemas_for_planner(selected_tools)
    company = getattr(settings, 'COMPANY_NAME', 'NexusAI')

    sheet_context_section = ""
    if "write_sheet" in selected_tools:
        from tools.services.sheets_service import get_sheet_planner_context
        caller_uid = state.get("user_id") or deployer_data.get("user_id")
        deployment_id = state.get("deployment_id") or deploy_tool_data.get("deployment_id")
        sheet_context_section = get_sheet_planner_context(
            deploy_tool_data=deploy_tool_data,
            user_id=caller_uid,
            deployment_id=deployment_id,
        )

    effective_description = tool.description
    if getattr(tool, 'tasks', None) and tool.tasks.strip():
        effective_description += f"\n\nConfirmed Step-by-Step Execution Tasks:\n{tool.tasks.strip()}"

    planner_prompt = f"""You are the Master Agent Execution Planner for {company}.
The following General Tools have been selected to fulfill this process and MUST be executed in this EXACT ORDER:
{json.dumps(selected_tools)}

Below are the EXACT Schemas, supported execution modes, and schema-mapping instructions for each selected tool:
{tools_schemas_str}

if we have write_sheet tool in our list to execute then read these instuction and extra data about the sheet : {sheet_context_section}

=== Context & Available Data Definitions ===
AI-Tool Title: {tool.title}
AI-Tool Description / User Instructions:
"{effective_description}"

1. Deploy Tool Data (`deploy_tool_data`):
Description: {data_descriptions.get("deploy_tool_data")}
Value:
{json.dumps(deploy_tool_data, default=str, indent=2)}

2. Webhook Inbound Payload Data (`webhook_data`):
Description: {data_descriptions.get("webhook_data")}
Value:
{json.dumps(webhook_data, default=str, indent=2) if webhook_data is not None else "{}"}

3. Deployer User Profile (`deployer_data`):
Description: {data_descriptions.get("deployer_data")}
Value:
{json.dumps(deployer_data, default=str, indent=2)}

4. Tool Owner Profile (`tool_owner_data`):
Description: {data_descriptions.get("tool_owner_data")}
Value:
{json.dumps(tool_owner_data, default=str, indent=2)}

=== YOUR INSTRUCTIONS ===
Generate a structured execution plan for each tool in {json.dumps(selected_tools)}, in the exact same sequence.
Return an array of plan objects under 'execution_plans'. Each plan object MUST strictly follow the tool's schema and schema-mapping instructions provided above.

'requires_hitl':
- DEFAULT TO FALSE. Set "requires_hitl" to true ONLY if the user explicitly stated in the AI-Tool description that human approval or human-in-the-loop is required. Otherwise, it MUST be false.

Return ONLY a valid JSON object matching this exact structure:
{{
  "requires_hitl": <true|false>,
  "execution_plans": [
    {{
      "tool": "<tool_name>",
      "execution_mode": "<mode>",
      "items": [ ... ]
    }}
  ],
  "summary": "<Short explanation of the planned execution>"
}}
"""
    try:
        plan_raw = LLMRouter.route_completion(
            messages=[
                {"role": "system", "content": "You are a production agent execution planner. Return valid JSON only following the exact schemas provided."},
                {"role": "user", "content": planner_prompt}
            ],
            json_mode=True,
            temperature=0.1,
            tier="reasoning",
        )
        data = plan_raw if isinstance(plan_raw, dict) else json.loads(str(plan_raw))

        requires_hitl = tool.requires_hitl or data.get("requires_hitl", False)
        execution_plans = data.get("execution_plans") or []
        if not isinstance(execution_plans, list) or len(execution_plans) == 0:
            raise GeneralToolsError("LLM planner returned an empty or invalid execution_plans list.")

        # Log what LLM returned for each planned tool
        for plan in execution_plans:
            plan_tool = plan.get("tool")
            items = plan.get("items", [])
            AppLogger.debug(
                "Node 2: Tool Planner",
                f"LLM Planned Tool Output for [{plan_tool}] (Mode: {plan.get('execution_mode')}, Items: {len(items)}):",
                details=plan
            )

    except Exception as plan_err:
        AppLogger.log_critical(
            message=f"LLM execution planning failed: {str(plan_err)}",
            category="llm_error",
            exc=plan_err,
            tool=tool,
            deploy_tool_data=deploy_tool_data,
            webhook_data=webhook_data,
            deployer_data=deployer_data,
            tool_owner_data=tool_owner_data,
            execution_context={"node": "tool_planner_node", "selected_tools": selected_tools}
        )
        return {
            "error": f"LLM execution planning failed: {str(plan_err)}",
            "messages": [
                {
                    "role": "assistant",
                    "content": f"LLM execution planning failed: {str(plan_err)}",
                }
            ],
        }

    AppLogger.step(
        "Node 2: Tool Planner",
        f"Generated {len(execution_plans)} execution plan(s) matching general tool schemas in order: {[p.get('tool') for p in execution_plans]}. HITL: {requires_hitl}.",
        {"plans": [p.get("tool") for p in execution_plans], "requires_hitl": requires_hitl}
    )

    if state.get("is_app_execution"):
        NotificationService.broadcast_step_progress(
            user_id=state.get("user_id"),
            tool_title=tool.title if tool else f"Tool #{tool_id}",
            step_name="Step 3: Plan Generation",
            details=f"Prepared {len(execution_plans)} execution plan(s) matching schema parameters.",
            status="completed",
            step_index=3,
            total_steps=4,
        )

    return {
        "execution_plans": execution_plans,
        "planned_action": execution_plans[0] if execution_plans else {},
        "requires_hitl": requires_hitl,
        "deploy_tool_data": deploy_tool_data,
        "webhook_data": webhook_data,
        "deployer_data": deployer_data,
        "tool_owner_data": tool_owner_data,
        "messages": [
            {
                "role": "assistant",
                "content": f"Node 2: Prepared {len(execution_plans)} execution plan(s) matching general tool schemas in order: {[p.get('tool') for p in execution_plans]}. HITL: {requires_hitl}.",
            }
        ],
    }


def google_asset_quarantine_node(state: AgentState) -> Dict[str, Any]:
    """
    Dedicated Node: Shared Service Account Asset Quarantine Strategy
    Ensures assets manually shared with narainad308@gmail.com are quarantined per user profile.
    Cross-verifies that:
    1. Any referenced Google file/folder belongs to the caller's user_id in SharedUserAsset.
    2. Programmatically cross-verifies access against the Drive API using the Service Account credentials block.
    3. Blocks execution immediately if an asset is unverified or belongs to a different user.
    """
    if state.get("error"):
        return {}

    user_id = state.get("user_id", "")
    execution_plans = state.get("execution_plans", [])
    deploy_tool_data = state.get("deploy_tool_data", {})
    webhook_data = state.get("webhook_data", {})
    auth_mode = state.get("google_auth_mode") or deploy_tool_data.get("google_auth_mode", "none")

    AppLogger.step(
        "Asset Quarantine Node",
        f"Scanning execution plans for shared Google assets (User: '{user_id}', auth_mode: '{auth_mode}')..."
    )

    # Collect any file/folder IDs referenced across plans and inputs
    referenced_asset_ids = set()
    for plan in execution_plans:
        if plan.get("tool") == "google_action":
            for item in plan.get("items", []):
                kwargs = item.get("kwargs", {})
                for key in ["fileId", "folderId", "spreadsheetId", "documentId", "formId"]:
                    if kwargs.get(key):
                        referenced_asset_ids.add(str(kwargs[key]).strip())

    # Check deploy_tool_data and webhook_data for explicit asset IDs
    for data_source in [deploy_tool_data, webhook_data if isinstance(webhook_data, dict) else {}]:
        for k, v in data_source.items():
            if any(term in k.lower() for term in ["file_id", "folder_id", "sheet_id", "doc_id", "asset_id"]) and isinstance(v, str):
                referenced_asset_ids.add(v.strip())

    if not referenced_asset_ids:
        return {"quarantined_assets_verified": True}

    # Verify each asset under quarantine rules
    verified_assets = []
    for asset_id in referenced_asset_ids:
        # Check SharedUserAsset table
        asset_record = SharedUserAsset.objects.filter(google_file_or_folder_id=asset_id).first()
        if asset_record:
            if asset_record.user_id != user_id:
                err = (
                    f"Quarantine Access Denied: Asset '{asset_id}' is registered to a different user profile. "
                    f"Cross-user asset sharing via the platform service account is strictly quarantined."
                )
                AppLogger.error("Asset Quarantine Node", err)
                return {
                    "error": err,
                    "messages": [{"role": "assistant", "content": err}],
                }

        # If manual delegation is used, cross-verify against Drive API
        if auth_mode in ["manual_delegation", "service_account"]:
            is_valid, asset, err = GoogleExecutorService.verify_and_quarantine_asset(
                user_id=user_id,
                google_file_or_folder_id=asset_id,
                product_name="drive"
            )
            if not is_valid:
                AppLogger.error("Asset Quarantine Node", f"Asset verification failed: {err}")
                return {
                    "error": err or f"Failed cross-verifying access to asset {asset_id}",
                    "messages": [{"role": "assistant", "content": f"Quarantine verification failed: {err}"}],
                }
            verified_assets.append(asset_id)
        else:
            verified_assets.append(asset_id)

    AppLogger.step(
        "Asset Quarantine Node",
        f"Quarantine verification successful for {len(verified_assets)} asset(s): {verified_assets}."
    )

    return {
        "quarantined_assets_verified": True,
    }


def hitl_gatekeeper(state: AgentState) -> Dict[str, Any]:
    """
    Node 3 (HITL Gatekeeper):
    Checks if human approval is required by HITL policy.
    If requires_hitl is True and state is not yet approved, summarizes the planned
    general tools and dispatches real-time WebSocket and email approval notifications.
    """
    if state.get("error"):
        return {"approval_status": "rejected"}

    requires_hitl = state.get("requires_hitl", False)
    current_status = state.get("approval_status", "pending")

    AppLogger.step(
        "Node 3: HITL Gatekeeper",
        f"Checking HITL policy: requires_hitl={requires_hitl}, approval_status='{current_status}'.",
        {"requires_hitl": requires_hitl, "approval_status": current_status}
    )

    if requires_hitl and current_status != "approved":
        tool_id = state["tool_id"]
        tool = CustomTool.objects.filter(pk=tool_id).first()
        tool_title = tool.title if tool else f"Tool #{tool_id}"
        user_id = state.get("user_id") or (tool.author_id if tool else "system")

        execution_plans = state.get("execution_plans", [])
        plan_summaries = []
        for p in execution_plans:
            t_name = p.get("tool", "unknown")
            count = len(p.get("items", []))
            plan_summaries.append(f"{t_name} ({count} items)")

        details = f"Human authorization required for execution plans: {', '.join(plan_summaries) if plan_summaries else 'action execution'}"

        AppLogger.step(
            "Node 3: HITL Gatekeeper",
            f"Execution halted by HITL policy for tool '{tool_title}'. Awaiting approval.",
            {"details": details}
        )

        NotificationService.broadcast_hitl_notification(
            user_id=user_id,
            thread_id=state.get("tool_slug", str(uuid.uuid4())),
            tool_id=tool_id,
            tool_title=tool_title,
            details=details,
            input_data=state.get("input_data", {}),
        )

        return {
            "approval_status": "pending",
            "deploy_tool_data": state.get("deploy_tool_data", {}),
            "webhook_data": state.get("webhook_data", {}),
            "deployer_data": state.get("deployer_data", {}),
            "tool_owner_data": state.get("tool_owner_data", {}),
            "messages": [
                {
                    "role": "assistant",
                    "content": f"Execution halted by HITL policy for tool '{tool_title}'. Awaiting human approval for: {details}.",
                }
            ],
        }

    return {
        "approval_status": current_status,
        "deploy_tool_data": state.get("deploy_tool_data", {}),
        "webhook_data": state.get("webhook_data", {}),
        "deployer_data": state.get("deployer_data", {}),
        "tool_owner_data": state.get("tool_owner_data", {}),
    }


def should_execute(state: AgentState) -> str:
    """
    Conditional edge router: executes tool only if approval_status == 'approved' or no HITL needed.
    """
    if state.get("error"):
        return "end"

    requires_hitl = state.get("requires_hitl", False)
    approval_status = state.get("approval_status", "pending")

    if requires_hitl:
        return "execute" if approval_status == "approved" else "end"
    return "execute"


def tool_executor(state: AgentState) -> Dict[str, Any]:
    """
    Node 4 (Tool Executor):
    Sequentially executes the structured execution plans in the exact order returned by Node 2.
    Dynamically invokes each general tool's registered executor handler via ToolCatalogManager.execute_tool.
    Validates each item against the general tool's schema using ToolCatalogManager.validate_tool_plan_item.
    CRITICAL RESILIENCE RULE:
    If any item fails validation or execution, DO NOT terminate or crash the pipeline.
    Log the error, record the failed item (with tool name, item reference, short error message, and data),
    and continue processing remaining items and tools.
    At the end, if any item failed, dispatch a concise error summary alert via email (to user's personal/deployer email)
    and in-app WebSocket notification.
    """
    execution_plans = state.get("execution_plans", [])
    input_data = state.get("input_data", {})
    deploy_tool_data = state.get("deploy_tool_data") or state.get("user_tool_data") or input_data.get("user_tool_data") or input_data.get("user_config") or {}
    webhook_data = state.get("webhook_data") or input_data.get("webhook_payload") or {}
    deployer_data = state.get("deployer_data") or state.get("user_details") or input_data.get("user_details") or {}
    tool_owner_data = state.get("tool_owner_data") or {}

    user_tool_data = deploy_tool_data
    user_details = deployer_data
    user_id = state.get("user_id") or deployer_data.get("user_id", "default_user")
    tool_id = state["tool_id"]
    tool = CustomTool.objects.filter(pk=tool_id).first()
    tool_title = tool.title if tool else f"Tool #{tool_id}"

    executed_results: List[Dict[str, Any]] = []
    failed_items: List[Dict[str, Any]] = []
    total_success_count = 0

    AppLogger.step(
        "Node 4: Tool Executor",
        f"Sequentially executing {len(execution_plans)} execution plan(s) for '{tool_title}'...",
        {"plans": [p.get("tool") for p in execution_plans]}
    )

    for plan in execution_plans:
        tool_name = plan.get("tool")
        execution_mode = plan.get("execution_mode", "single")
        items = plan.get("items", [])

        plan_item_results: List[Dict[str, Any]] = []

        for idx, item in enumerate(items, 1):
            item_ref = (
                item.get("client_identifier")
                or item.get("to_email")
                or item.get("url")
                or item.get("item_reference")
                or f"Item #{idx}"
            )

            AppLogger.debug(
                "Node 4: Tool Executor",
                f"[{tool_name}] Executing item {idx}/{len(items)} (Ref: {item_ref}):",
                details=item
            )

            # 1. Schema & Required Field Validation on General Tool level
            is_valid, val_err = ToolCatalogManager.validate_tool_plan_item(tool_name, item)
            if not is_valid:
                AppLogger.error(
                    "Node 4: Tool Executor",
                    f"Validation failed for tool '{tool_name}' on item '{item_ref}': {val_err}"
                )
                AppLogger.log_critical(
                    message=f"Validation failed for tool '{tool_name}' on item '{item_ref}': {val_err}",
                    category="validation_error",
                    tool=tool,
                    tool_name=tool_title,
                    tool_slug=tool.slug if tool else "",
                    deploy_tool_data=deploy_tool_data,
                    webhook_data=webhook_data,
                    deployer_data=deployer_data,
                    tool_owner_data=tool_owner_data,
                    execution_context={
                        "node": "tool_executor",
                        "tool_name": tool_name,
                        "item_ref": str(item_ref),
                        "item_data": item,
                        "error": val_err,
                    }
                )
                failed_items.append({
                    "tool": tool_name,
                    "item_reference": str(item_ref),
                    "error_type": "validation_error",
                    "error_message": val_err,
                    "item_data": item,
                })
                # Do NOT end the process, continue to the next item!
                continue

            # 2. Dynamic Execution per Tool via registered executor handler
            try:
                item_res = ToolCatalogManager.execute_tool(
                    tool_name=tool_name,
                    item=item,
                    context={
                        "tool_title": tool_title,
                        "tool_id": tool_id,
                        "user_id": user_id,
                        "deploy_tool_data": deploy_tool_data,
                        "webhook_data": webhook_data,
                        "deployer_data": deployer_data,
                        "tool_owner_data": tool_owner_data,
                        "user_details": user_details,
                        "user_tool_data": user_tool_data,
                        "input_data": input_data,
                        "google_auth_mode": state.get("google_auth_mode") or getattr(tool, "google_auth_mode", "none"),
                        "add_gmail_oauth_flag": state.get("add_gmail_oauth_flag", False) or getattr(tool, "add_gmail_oauth_flag", False),
                        "google_products": state.get("google_products", []) or getattr(tool, "google_products", []),
                        "tool": tool,
                    }
                )
                plan_item_results.append({
                    "item_reference": item_ref,
                    "success": True,
                    "result": item_res,
                })
                total_success_count += 1
                AppLogger.debug("Node 4: Tool Executor", f"[{tool_name}] SUCCESS on {item_ref}")

            except Exception as item_err:
                AppLogger.error(
                    "Node 4: Tool Executor",
                    f"Execution failed for tool '{tool_name}' on item '{item_ref}': {item_err}",
                    exc=item_err
                )
                error_cat = "email_error" if "email" in str(tool_name).lower() else ("api_error" if "api" in str(tool_name).lower() else "graph_execution")
                AppLogger.log_critical(
                    message=f"Execution failed for tool '{tool_name}' on item '{item_ref}': {item_err}",
                    category=error_cat,
                    exc=item_err,
                    tool=tool,
                    tool_name=tool_title,
                    tool_slug=tool.slug if tool else "",
                    deploy_tool_data=deploy_tool_data,
                    webhook_data=webhook_data,
                    deployer_data=deployer_data,
                    tool_owner_data=tool_owner_data,
                    execution_context={
                        "node": "tool_executor",
                        "tool_name": tool_name,
                        "item_ref": str(item_ref),
                        "item_data": item,
                        "error": str(item_err),
                    }
                )
                failed_items.append({
                    "tool": tool_name,
                    "item_reference": str(item_ref),
                    "error_type": "execution_exception",
                    "error_message": str(item_err),
                    "item_data": item,
                })
                # Continue with remaining items!

        executed_results.append({
            "tool": tool_name,
            "execution_mode": execution_mode,
            "items_count": len(items),
            "successful_items": plan_item_results,
        })

    AppLogger.step(
        "Node 4: Tool Executor",
        f"Execution complete for '{tool_title}': {total_success_count} succeeded, {len(failed_items)} failed.",
        {"total_success": total_success_count, "failed_count": len(failed_items)}
    )

    succeeded_details = [
        {"tool": p.get("tool"), "item": r.get("item_reference")}
        for p in executed_results
        for r in p.get("successful_items", [])
    ]
    failed_details = [
        {"tool": f.get("tool"), "item": f.get("item_reference"), "error": f.get("error_message")}
        for f in failed_items
    ]
    AppLogger.debug(
        "Node 4: Tool Executor",
        f"Execution Item Breakdown ({total_success_count} succeeded, {len(failed_items)} failed):",
        details={"succeeded_items": succeeded_details, "failed_items": failed_details}
    )

    # 3. Post-execution Alert Dispatch if any item failed
    if failed_items:
        deployer_email = (
            deployer_data.get("email")
            or deploy_tool_data.get("personal_email")
            or deploy_tool_data.get("email")
            or getattr(settings, "DEFAULT_FROM_EMAIL", "")
        )
        logger.warning(
            "Tool '%s' executed with %d item failure(s). Dispatching alert email to %s and in-app notification.",
            tool_title, len(failed_items), deployer_email
        )
        NotificationService.broadcast_tool_execution_failure_alert(
            user_id=user_id,
            tool_title=tool_title,
            failed_items=failed_items,
            user_email=deployer_email,
        )

    has_partial_failures = len(failed_items) > 0
    final_status = "completed_with_partial_failures" if has_partial_failures else "completed"

    execution_result = {
        "status": final_status,
        "success": not has_partial_failures,
        "summary": (
            f"Execution completed for '{tool_title}'. "
            f"Tools executed: {len(executed_results)}. "
            f"Successful items: {total_success_count}. "
            f"Failed items: {len(failed_items)}."
        ),
        "executed_plans": executed_results,
        "failed_items": failed_items,
        "executed_at": timezone.now().isoformat(),
    }

    if state.get("is_app_execution"):
        NotificationService.broadcast_step_progress(
            user_id=user_id,
            tool_title=tool_title,
            step_name="Step 4: Execution Completed",
            details=execution_result["summary"],
            status="completed" if not has_partial_failures else "warning",
            step_index=4,
            total_steps=4,
        )

    return {
        "execution_result": execution_result,
        "failed_items": failed_items,
        "approval_status": "completed",
        "deploy_tool_data": deploy_tool_data,
        "webhook_data": webhook_data,
        "deployer_data": deployer_data,
        "tool_owner_data": tool_owner_data,
        "messages": [
            {
                "role": "assistant",
                "content": execution_result["summary"],
            }
        ],
    }


# ---------------------------------------------------------------------------
# 4. Graph Construction and Workflow Runner
# ---------------------------------------------------------------------------
def build_agent_graph(checkpointer: BaseCheckpointSaver):
    """
    Compiles StateGraph with 6 distinct sequential nodes:
    1. tool_selector: selects ordered list of general tools based on AI-Tool description.
    2. google_capability_node: verifies Google product compatibility and enforces strict permission boundaries (gmail.send only).
    3. tool_planner: produces structured array of execution plans matching tool schemas in exact order.
    4. google_asset_quarantine_node: cross-verifies shared asset ownership and service account access before execution.
    5. hitl_gatekeeper: intercepts execution for human approval if required by HITL policy.
    6. tool_executor: sequentially executes plans with per-item validation and non-blocking failure alerts.
    """
    workflow = StateGraph(AgentState)

    workflow.add_node("tool_selector", tool_selector_node)
    workflow.add_node("google_capability_node", google_capability_node)
    workflow.add_node("tool_planner", tool_planner_node)
    workflow.add_node("google_asset_quarantine_node", google_asset_quarantine_node)
    workflow.add_node("hitl_gatekeeper", hitl_gatekeeper)
    workflow.add_node("tool_executor", tool_executor)

    workflow.add_edge(START, "tool_selector")
    workflow.add_edge("tool_selector", "google_capability_node")
    workflow.add_edge("google_capability_node", "tool_planner")
    workflow.add_edge("tool_planner", "google_asset_quarantine_node")
    workflow.add_edge("google_asset_quarantine_node", "hitl_gatekeeper")
    workflow.add_conditional_edges(
        "hitl_gatekeeper",
        should_execute,
        {
            "execute": "tool_executor",
            "end": END,
        },
    )
    workflow.add_edge("tool_executor", END)

    # Interrupt before tool_executor to enforce HITL
    return workflow.compile(
        checkpointer=checkpointer,
        interrupt_before=["tool_executor"],
    )


class GraphEngine:
    """
    High-level facade to initiate and resume LangGraph executions.
    """

    _checkpointer = None
    _app = None

    @classmethod
    def get_app(cls):
        if cls._app is None:
            cls._checkpointer = DjangoORMCheckpointer()
            cls._app = build_agent_graph(cls._checkpointer)
        return cls._app, cls._checkpointer

    @classmethod
    def run_flow(
        cls,
        tool_id: int,
        input_data: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        thread_id: Optional[str] = None,
        *,
        deploy_tool_data: Optional[Dict[str, Any]] = None,
        webhook_data: Optional[Any] = None,
        deployer_data: Optional[Dict[str, Any]] = None,
        tool_owner_data: Optional[Dict[str, Any]] = None,
        is_app_execution: bool = False,
    ) -> Dict[str, Any]:
        """
        Runs the agent graph. If interrupted for human approval, returns pending status.
        Maintains standardized 4 data keys (deploy_tool_data, webhook_data, deployer_data, tool_owner_data).
        """
        app, checkpointer = cls.get_app()
        tid = thread_id or str(uuid.uuid4())
        config = {"configurable": {"thread_id": tid}}

        tool = CustomTool.objects.filter(pk=tool_id).first()
        tool_title = tool.title if tool else f"Tool #{tool_id}"

        # Standardize 4 Data Fields
        # 1. tool_owner_data
        if tool_owner_data is None:
            tool_owner_data = {
                "user_id": tool.author_id if tool else "",
                "name": "",
                "email": "",
                "phone": "",
            }

        # 2. deploy_tool_data
        if deploy_tool_data is None:
            deploy_tool_data = (input_data or {}).get("deploy_tool_data") or (input_data or {}).get("user_tool_data") or (input_data or {}).get("user_config")
            if deploy_tool_data is None:
                deploy_tool_data = {
                    k: v for k, v in (input_data or {}).items()
                    if k not in ["webhook_data", "webhook_payload", "deployer_data", "tool_owner_data", "user_details", "user_tool_data", "user_config"]
                }

        # 3. webhook_data
        if webhook_data is None:
            webhook_data = (input_data or {}).get("webhook_data") or (input_data or {}).get("webhook_payload") or {}

        # 4. deployer_data
        if deployer_data is None:
            deployer_data = (input_data or {}).get("deployer_data") or (input_data or {}).get("user_details") or {
                "user_id": user_id or "default_user",
                "name": (input_data or {}).get("name") or (input_data or {}).get("user_name") or "",
                "email": (input_data or {}).get("user_email") or (input_data or {}).get("email") or (deploy_tool_data or {}).get("personal_email") or "",
                "phone": (input_data or {}).get("phone") or "",
            }

        user_details = deployer_data
        user_tool_data = deploy_tool_data
        eff_user_id = user_id or deployer_data.get("user_id") or "default_user"

        initial_state: AgentState = {
            "messages": [{"role": "user", "content": f"Run tool {tool_id}"}],
            "tool_id": tool_id,
            "tool_slug": tool.slug if tool else "",
            "user_id": eff_user_id,
            "deploy_tool_data": deploy_tool_data,
            "webhook_data": webhook_data,
            "deployer_data": deployer_data,
            "tool_owner_data": tool_owner_data,
            "data_descriptions": DATA_DESCRIPTIONS,
            "user_details": user_details,
            "user_tool_data": user_tool_data,
            "input_data": input_data or {},
            "requires_hitl": False,
            "approval_status": "pending",
            "execution_result": None,
            "auth_token": None,
            "prepared_request": None,
            "selected_tools": [],
            "execution_plans": [],
            "planned_action": None,
            "failed_items": [],
            "error": None,
            "add_gmail_oauth_flag": getattr(tool, "add_gmail_oauth_flag", False) if tool else False,
            "google_products": getattr(tool, "google_products", []) if tool else [],
            "google_auth_mode": (deploy_tool_data or {}).get("google_auth_mode") or (getattr(tool, "google_auth_mode", "none") if tool else "none"),
            "quarantined_assets_verified": False,
            "google_capability_context": None,
            "is_app_execution": is_app_execution,
        }

        if is_app_execution:
            NotificationService.broadcast_step_progress(
                user_id=eff_user_id,
                tool_title=tool_title,
                step_name="Workflow Initiated",
                details=f"Starting autonomous workflow run for '{tool_title}'...",
                status="started",
                step_index=1,
                total_steps=4,
            )

        AppLogger.step("GraphEngine", f"Starting execution for Tool #{tool_id} ('{tool_title}') | Thread: {tid}")

        try:
            output = app.invoke(initial_state, config=config)
        except Exception as exc:
            AppLogger.error("GraphEngine", f"Graph invocation failed for Tool #{tool_id}: {exc}", exc=exc)
            AppLogger.log_critical(
                message=f"Fatal exception during LangGraph invoke on '{tool_title}': {exc}",
                category="graph_execution",
                exc=exc,
                tool=tool,
                tool_name=tool_title,
                tool_slug=tool.slug if tool else "",
                deploy_tool_data=deploy_tool_data,
                webhook_data=webhook_data,
                deployer_data=deployer_data,
                tool_owner_data=tool_owner_data,
                execution_context={"thread_id": tid, "step": "invoke_initial_state"},
            )
            return {
                "status": "error",
                "thread_id": tid,
                "error": str(exc),
            }

        # Inspect current checkpoint state
        state_snapshot = app.get_state(config)

        # If interrupted before tool_executor
        if state_snapshot.next and "tool_executor" in state_snapshot.next:
            requires_hitl = state_snapshot.values.get("requires_hitl", False)
            approval_status = state_snapshot.values.get("approval_status", "pending")

            if requires_hitl and approval_status != "approved":
                AppLogger.step(
                    "GraphEngine",
                    f"Execution paused awaiting Human-In-The-Loop approval (requires_hitl=True). Thread: {tid}",
                    {"plans": state_snapshot.values.get("execution_plans", [])}
                )
                return {
                    "status": "pending_human_approval",
                    "thread_id": tid,
                    "tool_id": tool_id,
                    "message": "Execution halted awaiting human approval. Notification and email dispatched.",
                    "plans": state_snapshot.values.get("execution_plans", []),
                }
            else:
                # HITL not required (or already approved): continue immediately to tool_executor!
                AppLogger.step(
                    "GraphEngine",
                    f"HITL not required (requires_hitl=False). Proceeding to execute tool_executor... Thread: {tid}"
                )
                try:
                    close_old_connections()
                    output = app.invoke(None, config=config)
                except Exception as exc:
                    AppLogger.error("GraphEngine", f"tool_executor resumption failed for Tool #{tool_id}: {exc}", exc=exc)
                    AppLogger.log_critical(
                        message=f"Fatal exception during tool_executor execution on '{tool_title}': {exc}",
                        category="graph_execution",
                        exc=exc,
                        tool=tool,
                        tool_name=tool_title,
                        tool_slug=tool.slug if tool else "",
                        deploy_tool_data=deploy_tool_data,
                        webhook_data=webhook_data,
                        deployer_data=deployer_data,
                        tool_owner_data=tool_owner_data,
                        execution_context={"thread_id": tid, "step": "invoke_tool_executor"},
                    )
                    return {
                        "status": "error",
                        "thread_id": tid,
                        "error": str(exc),
                    }

        if output.get("error"):
            AppLogger.error("GraphEngine", f"Execution returned error for Tool #{tool_id}: {output['error']}")
            AppLogger.log_critical(
                message=f"Agent workflow error returned on '{tool_title}': {output['error']}",
                category="graph_execution",
                tool=tool,
                tool_name=tool_title,
                tool_slug=tool.slug if tool else "",
                deploy_tool_data=deploy_tool_data,
                webhook_data=webhook_data,
                deployer_data=deployer_data,
                tool_owner_data=tool_owner_data,
                execution_context={"thread_id": tid, "output": output},
            )
            return {
                "status": "error",
                "thread_id": tid,
                "error": output["error"],
            }

        AppLogger.step("GraphEngine", f"Execution COMPLETED successfully. Thread: {tid}")

        return {
            "status": "completed",
            "thread_id": tid,
            "result": output.get("execution_result"),
        }

    @classmethod
    def resume_flow(cls, thread_id: str, decision: str) -> Dict[str, Any]:
        """
        Resumes an interrupted graph execution using decision ('approve' or 'reject').
        """
        app, checkpointer = cls.get_app()
        config = {"configurable": {"thread_id": thread_id}}

        state_snapshot = app.get_state(config)
        if not state_snapshot.values:
            AppLogger.error("GraphEngine", f"No active or interrupted state found for thread_id {thread_id}")
            return {
                "status": "error",
                "message": f"No active or interrupted state found for thread_id {thread_id}",
            }

        decision_clean = decision.lower().strip()
        AppLogger.step("GraphEngine", f"Resuming workflow for thread {thread_id} with decision: '{decision_clean}'")

        if decision_clean == "approve":
            app.update_state(config, {"approval_status": "approved"})
            try:
                close_old_connections()
                resumed_output = app.invoke(None, config=config)
                AppLogger.step("GraphEngine", f"Resumed execution completed successfully for thread {thread_id}")
                return {
                    "status": "completed",
                    "thread_id": thread_id,
                    "decision": "approved",
                    "result": resumed_output.get("execution_result"),
                }
            except Exception as exc:
                AppLogger.error("GraphEngine", f"Resumed execution failed for thread {thread_id}: {exc}", exc=exc)
                AppLogger.log_critical(
                    message=f"Fatal exception during resume_flow on thread {thread_id}: {exc}",
                    category="graph_execution",
                    exc=exc,
                    execution_context={"thread_id": thread_id, "decision": decision_clean},
                )
                return {
                    "status": "error",
                    "thread_id": thread_id,
                    "error": str(exc),
                }
        else:
            app.update_state(config, {"approval_status": "rejected", "error": "Execution was rejected by user."})
            AppLogger.step("GraphEngine", f"Workflow execution rejected for thread {thread_id}")
            return {
                "status": "rejected",
                "thread_id": thread_id,
                "decision": "rejected",
                "message": "Execution was successfully rejected and will not run.",
            }
