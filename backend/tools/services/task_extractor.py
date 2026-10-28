import json
import logging
from typing import Any, Dict, List, Optional
from django.conf import settings

from tools.services.llm_router import LLMRouter

logger = logging.getLogger(__name__)


class TaskExtractionError(Exception):
    """Raised when AI task extraction or refinement fails."""
    pass


# ==============================================================================
# ADMIN / PLATFORM CAPABILITY RULES OBJECT
# Edit or expand this object whenever new system capabilities are added, modified,
# or restricted. The LLM Task Extractor aligns user tool ideas strictly to these rules.
# ==============================================================================
ADMIN_PLATFORM_RULES = {
    "webhook_ingestion": (
        "Inbound Webhooks & Automated Ingestion: Whenever the user mentions the word 'webhook', 'payload', "
        "or receiving external event data, the first platform action is ALWAYS to generate and provision a dedicated inbound webhook URL and "
        "provide it to the user. We NEVER assume or ask the user to manually paste webhook response or payload JSON into an input form or text field. "
        "The very first task must explicitly be to create/provision the unique webhook URL and provide it to the user. "
        "If the user does not want a webhook, they can instruct to remove or change it during the feedback review step."
    ),
    "spreadsheets": (
        "Google Sheets: Currently, we ONLY support writing or appending rows to an existing spreadsheet "
        "that has already been created and selected by the user in the Google Drive Picker (or shared with the platform). "
        "We do NOT support dynamically creating new spreadsheets or folders at runtime."
    ),
    "customer_emails": (
        "Customer / Client Emails: When the inbound data contains recipient/customer email addresses "
        "(e.g. order customer records), individual transactional or status update emails "
        "can be dispatched to each respective customer."
    ),
    "deployer_summary_emails": (
        "Deployer Summary Emails: If the tool description mentions sending a summary, notification, or report "
        "to the tool owner / deployer, always include a distinct task to send a single overall execution summary email "
        "to the deployer's registered email address."
    ),
    "api_calls": (
        "Outbound APIs: Supports making REST API calls (GET, POST, PUT, PATCH, DELETE) to external endpoints or webhooks."
    ),
}


class TaskExtractorService:
    """
    Intelligently converts natural language tool descriptions into verified, atomic
    step-by-step tasks aligned with Admin Platform Rules. Supports interactive Human-In-The-Loop
    review and iterative refinement based on user feedback.
    """

    @classmethod
    def get_rules_summary(cls) -> str:
        return "\n".join(f"- {rule_id.upper()}: {desc}" for rule_id, desc in ADMIN_PLATFORM_RULES.items())

    @classmethod
    def extract_tasks(
        cls,
        description: str,
        feedback: Optional[str] = None,
        current_tasks: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        company = getattr(settings, 'COMPANY_NAME', 'NexusAI')
        rules_text = cls.get_rules_summary()

        if feedback and feedback.strip():
            # Refinement mode: update previous tasks based on user feedback
            prompt = f"""You are the Master Agent Task Planner for {company}.
The user has reviewed the extracted tasks for their AI Tool and provided feedback for modifications.

=== ADMIN PLATFORM RULES ===
{rules_text}

=== ORIGINAL TOOL PROMPT ===
"{description}"

=== PREVIOUS EXTRACTED TASKS ===
{json.dumps(current_tasks or [], indent=2)}

=== USER FEEDBACK / REQUESTED CHANGES ===
"{feedback.strip()}"

Your Task:
Modify, refine, add, or remove tasks strictly according to the user's feedback while adhering to the Admin Platform Rules.
- PRESERVE ORIGINAL PROMPT: The user's original prompt must remain verbatim as the tool description. Do NOT rewrite or overwrite the prompt with task points.
- CRITICAL WEBHOOK RULE: If the tool involves webhooks or inbound event payloads, the first task MUST remain creating/provisioning a unique inbound webhook URL and providing it to the user (e.g. 'Create a unique inbound webhook URL and provide it to the user to receive incoming payloads'), NEVER asking or assuming the user pastes payload/response into an input field—UNLESS the user's feedback explicitly requests removing the webhook or switching to manual input.
- Ensure every distinct action (e.g. creating webhook URL, writing to existing sheet, emailing individual customers, emailing deployer summary) is explicitly enumerated as a separate, unambiguous task.

Return ONLY a valid JSON object matching this schema:
{{
  "title": "<Concise Tool Title>",
  "original_prompt": "{description.strip()}",
  "tasks": [
    "<Concise, actionable task point 1>",
    "<Concise, actionable task point 2>",
    "<...>"
  ],
  "tasks_text": "- <Task point 1>\\n- <Task point 2>\\n...",
  "tasks_paragraph": "<All task points smoothly connected as a single readable paragraph when needed>",
  "notes": "<Brief note on changes made based on feedback>"
}}
"""
        else:
            # Initial extraction mode
            prompt = f"""You are the Master Agent Task Planner for {company}.
Analyze the user's tool concept and extract clear, atomic, step-by-step execution tasks.

=== ADMIN PLATFORM RULES ===
{rules_text}

=== USER'S TOOL CONCEPT PROMPT ===
"{description.strip()}"

Your Instructions:
0. PRESERVE ORIGINAL PROMPT AS DESCRIPTION (CRITICAL):
   - DO NOT alter, rewrite, modify, or replace the user's original prompt.
   - The user's original prompt must be preserved verbatim as the tool's description.
   - Your job is strictly to extract atomic, step-by-step task points from the user's prompt without modifying the prompt itself.
1. WEBHOOK RULE (MANDATORY FIRST TASK):
   - If the user mentions the word 'webhook', 'payload', or receiving/sending data from external triggers/APIs:
     * The FIRST action/task MUST ALWAYS be: 'Create a unique inbound webhook URL and provide it to the user to receive incoming payloads'.
     * DO NOT assume, suggest, or extract any task where the user pastes a webhook response or JSON payload into an input field or manual form.
     * Always create the first task as provisioning the webhook URL and giving it to the user. If the user does not actually need a webhook, they can correct it in feedback.
2. SPREADSHEETS:
   - If the user mentions writing to spreadsheets, frame it as: 'Append data to the pre-selected Google Spreadsheet (existing sheet selected via Drive Picker)'.
3. CUSTOMER / CLIENT EMAILS:
   - If the user mentions sending emails to customers/users found in the data, extract an explicit task: 'Send individual update email to each customer/user in the payload'.
4. DEPLOYER SUMMARY EMAILS:
   - If the user mentions sending a summary or notification to themselves/the deployer, extract an explicit task: 'Send an execution summary email to the deployer'.
5. Keep each task point concise, professional, actionable, and deterministic.

Return ONLY a valid JSON object matching this schema:
{{
  "title": "<Concise Tool Title>",
  "original_prompt": "{description.strip()}",
  "tasks": [
    "<Concise, actionable task point 1>",
    "<Concise, actionable task point 2>",
    "<...>"
  ],
  "tasks_text": "- <Task point 1>\\n- <Task point 2>\\n...",
  "tasks_paragraph": "<All task points smoothly connected as a single readable paragraph when needed>",
  "notes": "<Brief explanation of how the prompt was structured>"
}}
"""

        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a production workflow architect and agent planner for {company}.\n"
                    "CRITICAL MANDATORY RULES:\n"
                    "1. Never alter or overwrite the user's original prompt. It will be stored as the tool description.\n"
                    "2. Extract atomic execution steps strictly as task points in 'tasks'.\n"
                    "3. If the user mentions 'webhook', 'payload', or external event triggers, the first task MUST ALWAYS be generating a unique inbound webhook URL and providing it to the user.\n"
                    "Output valid JSON only."
                )
            },
            {"role": "user", "content": prompt}
        ]

        try:
            res = LLMRouter.route_completion(
                messages=messages,
                json_mode=True,
                temperature=0.2,
                tier="reasoning",
            )
            data = res if isinstance(res, dict) else json.loads(str(res))
            tasks_list = data.get("tasks") or []
            if isinstance(tasks_list, str):
                tasks_list = [line.strip("- ").strip() for line in tasks_list.split("\n") if line.strip()]

            # Build clean markdown text if missing
            tasks_text = data.get("tasks_text")
            if not tasks_text and tasks_list:
                tasks_text = "\n".join(f"- {t}" for t in tasks_list)

            # Build clean paragraph representation if needed
            tasks_paragraph = data.get("tasks_paragraph")
            if not tasks_paragraph and tasks_list:
                tasks_paragraph = " ".join(f"{t.rstrip('.')}. " for t in tasks_list).strip()

            return {
                "title": data.get("title") or "Custom Automation Tool",
                "original_prompt": description.strip(),
                "description": description.strip(),
                "tasks": tasks_list,
                "tasks_text": tasks_text or "",
                "tasks_paragraph": tasks_paragraph or "",
                "notes": data.get("notes") or "Extracted conforming to platform capabilities.",
                "admin_rules": list(ADMIN_PLATFORM_RULES.keys()),
            }
        except Exception as exc:
            logger.error("Failed to extract tasks via LLM: %s", exc, exc_info=True)
            raise TaskExtractionError(f"AI task extraction failed: {str(exc)}") from exc
