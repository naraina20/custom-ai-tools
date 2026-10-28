import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple, Union
import urllib.parse
import requests

from tools.models import SharedUserAsset
from tools.oauth_constants import PROVIDER_GOOGLE
from tools.services.oauth_service import OAuthService
from tools.services.llm_router import LLMRouter, LLMProviderError

logger = logging.getLogger(__name__)

SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets"


class GoogleSheetsError(Exception):
    """Base exception for Google Sheets operations."""
    def __init__(self, message: str, status_code: Optional[int] = None, details: Any = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details


class GoogleSheetsAuthError(GoogleSheetsError):
    """Raised when Google OAuth authentication fails or token is expired."""
    pass


class GoogleSheetsNotFoundError(GoogleSheetsError):
    """Raised when spreadsheet, sheet tab, or range is not found."""
    pass


class GoogleSheetsRateLimitError(GoogleSheetsError):
    """Raised when Google Sheets API rate limit (429) is hit and retries are exhausted."""
    pass


def col_to_letter(col_idx: int) -> str:
    """
    Converts a 1-based column index to Excel/Sheets column letters.
    e.g. 1 -> 'A', 5 -> 'E', 26 -> 'Z', 27 -> 'AA'.
    """
    if col_idx < 1:
        return 'A'
    result = []
    while col_idx > 0:
        col_idx, remainder = divmod(col_idx - 1, 26)
        result.append(chr(65 + remainder))
    return ''.join(reversed(result))


def quote_sheet_title(sheet_title: str) -> str:
    """
    Quotes a sheet title for A1 notation per Google Sheets specification:
    Sheet names containing spaces, special symbols, or numbers should be enclosed in single quotes.
    Single quotes inside titles are escaped by doubling them (' -> '').
    """
    clean_title = sheet_title.replace("'", "''")
    return f"'{clean_title}'"


def _execute_sheets_api_request(
    method: str,
    url: str,
    access_token: str,
    user_id: Optional[str] = None,
    params: Optional[Any] = None,
    json_body: Optional[Any] = None,
    max_retries: int = 3,
) -> Tuple[Dict[str, Any], str]:
    """
    Executes an HTTP request against Google Sheets API v4.
    Handles:
      - 401/403: token expired -> refreshes once via OAuthService if user_id is provided, then retries.
      - 404: bad spreadsheet or sheet ID -> raises GoogleSheetsNotFoundError.
      - 429: rate limit -> exponential backoff retry (max 3 times).
    
    Returns:
      (response_json, active_access_token)
    """
    current_token = access_token
    token_refreshed = False

    for attempt in range(max_retries):
        headers = {
            "Authorization": f"Bearer {current_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        try:
            resp = requests.request(
                method=method.upper(),
                url=url,
                headers=headers,
                params=params,
                json=json_body,
                timeout=30,
            )
        except requests.RequestException as req_err:
            if attempt == max_retries - 1:
                raise GoogleSheetsError(f"Network error communicating with Google Sheets API: {str(req_err)}")
            time.sleep(1 * (2 ** attempt))
            continue

        # Handle 429 Rate Limit
        if resp.status_code == 429:
            logger.warning(
                "Google Sheets API 429 rate limit reached. Attempt %d/%d. Backing off...",
                attempt + 1, max_retries
            )
            if attempt == max_retries - 1:
                raise GoogleSheetsRateLimitError("Google Sheets API rate limit exceeded. Please try again shortly.", status_code=429)
            time.sleep(1 * (2 ** attempt))
            continue

        # Handle 401/403 Auth Error (Token Expired)
        if resp.status_code in (401, 403):
            if not token_refreshed and user_id:
                logger.info("Google Sheets API returned %d. Attempting token auto-refresh for user %s.", resp.status_code, user_id)
                success, new_token, err = OAuthService.get_or_refresh_token(user_id, PROVIDER_GOOGLE)
                if success and new_token:
                    current_token = new_token
                    token_refreshed = True
                    logger.info("Token successfully refreshed for user %s. Retrying Sheets API request.", user_id)
                    continue
                else:
                    raise GoogleSheetsAuthError(f"Google OAuth authorization expired or invalid: {err or 'Refresh failed'}", status_code=resp.status_code)
            else:
                raise GoogleSheetsAuthError(
                    f"Google Sheets permission denied or invalid token (HTTP {resp.status_code}): {resp.text}",
                    status_code=resp.status_code
                )

        # Handle 404 Not Found
        if resp.status_code == 404:
            raise GoogleSheetsNotFoundError(
                f"Requested spreadsheet or sheet resource was not found (HTTP 404): {resp.text}",
                status_code=404
            )

        # Handle other non-2xx status codes
        if not (200 <= resp.status_code < 300):
            raise GoogleSheetsError(
                f"Google Sheets API error (HTTP {resp.status_code}): {resp.text}",
                status_code=resp.status_code,
                details=resp.text
            )

        try:
            return resp.json(), current_token
        except Exception:
            return {}, current_token

    raise GoogleSheetsError("Failed to execute Google Sheets API request after retries.")


def get_sheets_info(
    spreadsheet_id: str,
    access_token: str,
    user_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}?fields=sheets.properties(sheetId,title,index,sheetType,gridProperties)
    
    Returns:
      list of {sheet_id, title, row_count, column_count}. Skips sheets where sheetType != "GRID".
      Note: row_count and column_count are the total grid dimensions, NOT the data extent.
    """
    url = f"{SHEETS_BASE_URL}/{spreadsheet_id}"
    params = {
        "fields": "sheets.properties(sheetId,title,index,sheetType,gridProperties)"
    }

    data, _ = _execute_sheets_api_request(
        method="GET",
        url=url,
        access_token=access_token,
        user_id=user_id,
        params=params,
    )

    results: List[Dict[str, Any]] = []
    for sheet in data.get("sheets", []):
        props = sheet.get("properties", {})
        if props.get("sheetType", "GRID") != "GRID":
            continue
        grid = props.get("gridProperties", {})
        results.append({
            "sheet_id": props.get("sheetId"),
            "title": props.get("title", ""),
            "row_count": grid.get("rowCount", 0),
            "column_count": grid.get("columnCount", 0),
        })

    return results


def get_sheet_sample(
    spreadsheet_id: str,
    sheet_title: str,
    sample_rows: int = 2,
    access_token: str = "",
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values:batchGet?ranges='{sheet_title}'!1:{1+sample_rows}&ranges='{sheet_title}'!A:A
    
    Computes from valueRanges:
      - headers = values[0] of first range
      - sample_rows = next rows of first range
      - last_row = len(values) of A:A range (API drops empty trailing rows, empty middle rows are [])
      - last_col = max row length across first range, converted to letter (5 -> E)
      - next_row = last_row + 1
      
    Returns:
      {sheet_title, headers, sample_rows, last_row, last_col_letter, next_row}
    """
    quoted_title = quote_sheet_title(sheet_title)
    range_sample = f"{quoted_title}!1:{1 + sample_rows}"
    range_col_a = f"{quoted_title}!A:A"

    url = f"{SHEETS_BASE_URL}/{spreadsheet_id}/values:batchGet"
    params = [
        ("ranges", range_sample),
        ("ranges", range_col_a),
    ]

    data, _ = _execute_sheets_api_request(
        method="GET",
        url=url,
        access_token=access_token,
        user_id=user_id,
        params=params,
    )

    value_ranges = data.get("valueRanges", [])
    first_range_values = value_ranges[0].get("values", []) if len(value_ranges) > 0 else []
    col_a_values = value_ranges[1].get("values", []) if len(value_ranges) > 1 else []

    headers = first_range_values[0] if len(first_range_values) > 0 else []
    sample_rows_data = first_range_values[1:1 + sample_rows] if len(first_range_values) > 1 else []

    last_row = len(col_a_values)
    max_row_len = max([len(r) for r in first_range_values], default=len(headers) or 1)
    last_col_letter = col_to_letter(max_row_len)
    next_row = last_row + 1

    return {
        "sheet_title": sheet_title,
        "headers": headers,
        "sample_rows": sample_rows_data,
        "last_row": last_row,
        "last_col_letter": last_col_letter,
        "next_row": next_row,
    }


def check_semantic_misalignment(headers: List[str], values: List[List[Any]]) -> bool:
    """
    Checks if values in rows appear placed in wrong columns based on common patterns:
    e.g. Email in Name column while an Email column exists without email format, etc.
    """
    if not headers or not values:
        return False
    
    headers_lower = [str(h).lower().strip() for h in headers]
    email_indices = [i for i, h in enumerate(headers_lower) if "email" in h or "mail" in h]
    name_indices = [i for i, h in enumerate(headers_lower) if "name" in h and "user" not in h]

    for row in values:
        if not isinstance(row, list):
            continue
        # Case 1: An email column exists, but its value does NOT contain '@', while another column DOES contain '@'
        for e_idx in email_indices:
            if e_idx < len(row):
                val_at_email = str(row[e_idx]).strip()
                if val_at_email and "@" not in val_at_email:
                    has_email_elsewhere = any(
                        "@" in str(row[i]) for i in range(len(row)) if i != e_idx and i < len(row)
                    )
                    if has_email_elsewhere:
                        return True
        # Case 2: A name column contains an email address with '@'
        for n_idx in name_indices:
            if n_idx < len(row):
                if "@" in str(row[n_idx]).strip():
                    return True
    return False


def fix_row_alignment_with_llm(headers: List[str], values: List[List[Any]]) -> List[List[Any]]:
    """
    Invokes LLM to align row values correctly to the target column headers.
    Ensures name goes to Name, email to email, etc.
    """
    header_count = len(headers)
    col_breakdown = "\n".join([f"- Column {i+1} ('{h}'): place the appropriate value for '{h}'. If no data belongs here, use empty string \"\"." for i, h in enumerate(headers)])
    prompt = f"""You are a precise data column alignment tool.
We are writing rows to a Google Sheet with the following {header_count} headers in exact column order:
Headers: {json.dumps(headers)}

The rows below have values placed in the wrong columns (e.g. email in Name column, ID in email column, etc.):
Values: {json.dumps(values)}

Task:
Reorder and align each row's values so that each element accurately corresponds to its column header:
{col_breakdown}

Return ONLY a JSON object conforming strictly to this format:
{{
  "rows": [
    ["val1", "val2", ...],
    ...
  ]
}}
"""
    try:
        messages = [
            {"role": "system", "content": "You are a deterministic column alignment engine. Return ONLY valid JSON."},
            {"role": "user", "content": prompt}
        ]
        result = LLMRouter.route_completion(messages, json_mode=True, tier="reasoning")
        if isinstance(result, dict) and "rows" in result and isinstance(result["rows"], list):
            adjusted = []
            for r in result["rows"]:
                if isinstance(r, list):
                    if len(r) < header_count:
                        r = r + [""] * (header_count - len(r))
                    elif len(r) > header_count:
                        r = r[:header_count]
                    adjusted.append(r)
            if adjusted:
                logger.info("Successfully re-aligned misaligned row columns with LLM: %s", adjusted)
                return adjusted
    except Exception as exc:
        logger.warning("LLM row-alignment fix attempt failed: %s.", str(exc))

    return values


def fix_row_lengths_with_llm(headers: List[str], values: List[List[Any]]) -> List[List[Any]]:
    """
    Fresh LLM call to correct row values when length does not match expected header count.
    Ensures every row has exactly len(headers) elements matching the header order.
    """
    header_count = len(headers)
    prompt = f"""You are a precise data formatting tool.
We are writing rows to a Google Sheet with the following {header_count} headers in exact order:
Headers: {json.dumps(headers)}

The generated rows have length mismatches:
Values: {json.dumps(values)}

Task:
Adjust every row so that its length is EXACTLY {header_count}, matching each header column in order.
If a row has fewer values, pad missing values with empty strings or appropriate null-equivalents.
If a row has too many values, merge extra details into the appropriate field or drop extraneous elements.

Return ONLY a JSON object conforming strictly to this format:
{{
  "rows": [
    ["val1", "val2", ...],
    ...
  ]
}}
"""
    try:
        messages = [
            {"role": "system", "content": "You are a deterministic data alignment engine. Return ONLY valid JSON."},
            {"role": "user", "content": prompt}
        ]
        result = LLMRouter.route_completion(messages, json_mode=True, tier="reasoning")
        if isinstance(result, dict) and "rows" in result and isinstance(result["rows"], list):
            adjusted = []
            for r in result["rows"]:
                if isinstance(r, list):
                    if len(r) < header_count:
                        r = r + [""] * (header_count - len(r))
                    elif len(r) > header_count:
                        r = r[:header_count]
                    adjusted.append(r)
            if adjusted:
                return adjusted
    except Exception as exc:
        logger.warning("LLM row-length fix attempt failed: %s. Falling back to mechanical pad/trim.", str(exc))

    # Deterministic fallback pad/trim
    adjusted = []
    for r in values:
        if not isinstance(r, list):
            r = [str(r)]
        if len(r) < header_count:
            r = r + [""] * (header_count - len(r))
        elif len(r) > header_count:
            r = r[:header_count]
        adjusted.append(r)
    return adjusted


def write_values(
    spreadsheet_id: str,
    sheet_title: str,
    start_row: int,
    values: List[List[Any]],
    access_token: str,
    user_id: Optional[str] = None,
    expected_headers: Optional[List[str]] = None,
    _retry_count: int = 0,
) -> Dict[str, Any]:
    """
    PUT https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/'{sheet_title}'!A{start_row}:{last_col}{start_row+len(values)-1}?valueInputOption=USER_ENTERED
    Body: {"range": "<same range>", "majorDimension": "ROWS", "values": [[...], [...]]}
    
    Returns:
      {updatedRange, updatedRows, updatedCells}
      
    Self-correction:
      If every row's length does not equal the header count (from expected_headers)
      or if values are semantically placed into wrong columns (e.g. email in name),
      sends sheet header data and values to a fresh LLM call to fix the issue and calls
      write_values again (checked so it loops at most once).
    """
    if not values:
        return {
            "updatedRange": f"{sheet_title}!A{start_row}",
            "updatedRows": 0,
            "updatedCells": 0,
        }

    # Validate row lengths and column semantic alignment against headers
    if expected_headers and _retry_count == 0:
        header_count = len(expected_headers)
        mismatched_len = any(len(r) != header_count for r in values if isinstance(r, list))
        misaligned_cols = check_semantic_misalignment(expected_headers, values)
        
        if mismatched_len or misaligned_cols:
            if misaligned_cols:
                logger.info("Detected semantic column misalignment against headers %s. Triggering LLM column re-alignment.", expected_headers)
                aligned_values = fix_row_alignment_with_llm(headers=expected_headers, values=values)
            else:
                logger.info("Detected row length mismatch against header count (%d). Triggering 1-time LLM alignment.", header_count)
                aligned_values = fix_row_lengths_with_llm(headers=expected_headers, values=values)

            return write_values(
                spreadsheet_id=spreadsheet_id,
                sheet_title=sheet_title,
                start_row=start_row,
                values=aligned_values,
                access_token=access_token,
                user_id=user_id,
                expected_headers=expected_headers,
                _retry_count=1,
            )

    num_rows = len(values)
    max_cols = max([len(r) for r in values if isinstance(r, list)], default=len(expected_headers or [1]))
    last_col = col_to_letter(max_cols)
    end_row = start_row + num_rows - 1

    quoted_title = quote_sheet_title(sheet_title)
    target_range = f"{quoted_title}!A{start_row}:{last_col}{end_row}"

    # Google Sheets API requires URL-encoded range in PUT path
    encoded_range = urllib.parse.quote(target_range, safe='')
    url = f"{SHEETS_BASE_URL}/{spreadsheet_id}/values/{encoded_range}?valueInputOption=USER_ENTERED"

    body = {
        "range": target_range,
        "majorDimension": "ROWS",
        "values": values,
    }

    data, _ = _execute_sheets_api_request(
        method="PUT",
        url=url,
        access_token=access_token,
        user_id=user_id,
        json_body=body,
    )

    return {
        "updatedRange": data.get("updatedRange", target_range),
        "updatedRows": data.get("updatedRows", num_rows),
        "updatedCells": data.get("updatedCells", num_rows * max_cols),
    }


def generate_sheet_rows_with_llm(
    sheet_title: str,
    instruction: str,
    row_count: int,
    sample_info: Dict[str, Any],
    input_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Sends sheet context (headers + 2 sample rows, unlabeled) and user instruction/input data
    to the LLM with structured JSON schema to generate matching rows.
    
    Rule compliance:
      - Does not send more than headers + 2 sample rows.
      - Does not label rows (sends them simply as 3 unlabeled rows).
      - Prompts LLM to detect headers, infer formats, and produce the requested rows.
      - Returns preview: {"range": f"{sheet_title}!A{next_row}:{last_col}{next_row+len(values)-1}", "values": values}
    """
    headers = sample_info.get("headers", [])
    sample_rows = sample_info.get("sample_rows", [])
    next_row = sample_info.get("next_row", 2)
    last_col_letter = sample_info.get("last_col_letter", "A")

    # Combine headers + up to 2 sample rows as unlabeled context rows
    context_rows: List[List[Any]] = []
    if headers:
        context_rows.append(headers)
    for r in sample_rows[:2]:
        context_rows.append(r)

    prompt = f"""You are a structured spreadsheet data generation assistant.

Here are up to 3 existing rows from the user's spreadsheet (provided as raw data without explicit row labels):
{json.dumps(context_rows)}

Your goals:
1. Examine the rows to determine which row represents the column headers and deduce the data type and format of each column.
2. Based on the user instruction and any input data provided, generate exactly {row_count} new rows matching the column structure and format.

User Instruction: {instruction}
Input Data: {json.dumps(input_data or {})}

Return your output strictly as a JSON object with this schema:
{{
  "sheet_title": "{sheet_title}",
  "headers": ["<column 1 name>", "<column 2 name>", ...],
  "rows": [
    ["<row 1 col 1>", "<row 1 col 2>", ...],
    ...
  ]
}}
"""
    messages = [
        {"role": "system", "content": "You are a deterministic Google Sheets generator. You return ONLY valid JSON."},
        {"role": "user", "content": prompt}
    ]

    llm_resp = LLMRouter.route_completion(messages, json_mode=True, tier="reasoning")

    generated_rows: List[List[Any]] = []
    if isinstance(llm_resp, dict):
        raw_rows = llm_resp.get("rows", [])
        if isinstance(raw_rows, list):
            generated_rows = raw_rows

    # Calculate preview range
    num_generated = len(generated_rows)
    if num_generated > 0:
        max_col_len = max([len(r) for r in generated_rows if isinstance(r, list)], default=len(headers) or 1)
        calc_last_col = col_to_letter(max_col_len)
        preview_range = f"{sheet_title}!A{next_row}:{calc_last_col}{next_row + num_generated - 1}"
    else:
        preview_range = f"{sheet_title}!A{next_row}:{last_col_letter}{next_row}"

    return {
        "preview": {
            "range": preview_range,
            "values": generated_rows,
        }
    }


# Tool Definitions for LLM Tool Calling (Part 3)
SHEETS_TOOL_DEFINITIONS = [
    {
        "name": "get_sheets_info",
        "description": "Retrieves the list of sheet tabs, IDs, and grid dimensions for the active Google spreadsheet.",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "get_sheet_sample",
        "description": "Reads the header row, 2 sample data rows, last populated row index, next available row, and last column letter for a specific sheet tab.",
        "parameters": {
            "type": "object",
            "properties": {
                "sheet_title": {
                    "type": "string",
                    "description": "The exact title/tab name of the sheet to inspect (e.g. 'Sheet1')."
                }
            },
            "required": ["sheet_title"]
        }
    },
    {
        "name": "submit_rows",
        "description": "Final output tool: submits generated rows formatted in exact column header order to write to the spreadsheet.",
        "parameters": {
            "type": "object",
            "properties": {
                "sheet_title": {
                    "type": "string",
                    "description": "Target sheet tab title."
                },
                "start_row": {
                    "type": "integer",
                    "description": "1-based starting row where new rows will be written (must not overwrite existing data)."
                },
                "headers": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Column headers identified from the sheet."
                },
                "rows": {
                    "type": "array",
                    "items": {
                        "type": "array",
                        "description": "Inner row list containing one value per header in exact order."
                    },
                    "description": "List of rows to write to the sheet."
                }
            },
            "required": ["sheet_title", "rows"]
        }
    }
]


def execute_sheets_tool(
    tool_name: str,
    tool_args: Dict[str, Any],
    spreadsheet_id: str,
    access_token: str,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Executes tool calls requested by the LLM:
      1. get_sheets_info() -> calls service function 1
      2. get_sheet_sample(sheet_title) -> calls service function 2
      3. submit_rows(sheet_title, rows) -> returns final structured row payload
    """
    if tool_name == "get_sheets_info":
        sheets = get_sheets_info(spreadsheet_id=spreadsheet_id, access_token=access_token, user_id=user_id)
        return {"sheets": sheets}
    elif tool_name == "get_sheet_sample":
        sheet_title = tool_args.get("sheet_title") or tool_args.get("sheet") or "Sheet1"
        sample_rows = int(tool_args.get("sample_rows", 2))
        return get_sheet_sample(
            spreadsheet_id=spreadsheet_id,
            sheet_title=sheet_title,
            sample_rows=sample_rows,
            access_token=access_token,
            user_id=user_id
        )
    elif tool_name == "submit_rows":
        sheet_title = tool_args.get("sheet_title") or tool_args.get("sheet") or "Sheet1"
        rows = tool_args.get("rows", [])
        return {
            "status": "ready_to_write",
            "sheet_title": sheet_title,
            "rows": rows,
            "row_count": len(rows),
        }
    else:
        raise GoogleSheetsError(f"Unsupported tool '{tool_name}' for Google Sheets.")


def get_sheet_planner_context(
    deploy_tool_data: Optional[Dict[str, Any]] = None,
    user_id: Optional[str] = None,
    deployment_id: Optional[Union[int, str]] = None,
) -> str:
    """
    Fetches target Google Spreadsheet metadata (headers, column count, last row)
    for the Planner LLM prompt in graph_engine.
    Resolves the spreadsheet_id from:
    1. deployment_id via SharedUserAsset (if linked)
    2. deploy_tool_data ('spreadsheet_id', 'google_file_id', 'google_sheet_id', 'file_id')
    3. SharedUserAsset table for the given user_id.

    Returns a formatted string containing exact headers and column instructions,
    or empty string if not applicable or on error.
    """
    deploy_data = deploy_tool_data or {}
    target_sheet_id = (
        deploy_data.get("spreadsheet_id")
        or deploy_data.get("google_file_id")
        or deploy_data.get("google_sheet_id")
        or deploy_data.get("file_id")
    )

    caller_uid = user_id or deploy_data.get("user_id")

    # If not in deploy_data, try finding from SharedUserAsset
    if not target_sheet_id:
        if deployment_id:
            asset = SharedUserAsset.objects.filter(deployment_id=deployment_id, product_name="sheets").first()
            if not asset:
                asset = SharedUserAsset.objects.filter(deployment_id=deployment_id).first()
            if asset:
                target_sheet_id = asset.google_file_or_folder_id

        if not target_sheet_id and caller_uid:
            asset = SharedUserAsset.objects.filter(user_id=caller_uid, product_name="sheets").first()
            if not asset:
                asset = SharedUserAsset.objects.filter(user_id=caller_uid).first()
            if asset:
                target_sheet_id = asset.google_file_or_folder_id

    if not target_sheet_id or not caller_uid:
        return ""

    try:
        ok, token, err = OAuthService.get_or_refresh_token(caller_uid, PROVIDER_GOOGLE)
        if not ok or not token:
            logger.warning("Could not refresh Google token for user %s when building sheet planner context: %s", caller_uid, err)
            return ""

        sample = get_sheet_sample(target_sheet_id, sheet_title="Sheet1", sample_rows=2, access_token=token, user_id=caller_uid)
        sheet_headers = sample.get("headers", [])
        sheet_last_row = sample.get("last_row", 0)
        sheet_title = sample.get("sheet_title", "Sheet1")

        col_instructions = [
            f"   - Column {idx+1} ('{h}'): place the data corresponding to '{h}'. If no data is available in the payload, use empty string \"\"."
            for idx, h in enumerate(sheet_headers)
        ]

        return f"""
=== TARGET GOOGLE SPREADSHEET SCHEMA ===
Spreadsheet ID: {target_sheet_id}
Sheet Title: {sheet_title}
Exact Column Headers ({len(sheet_headers)} columns in order): {json.dumps(sheet_headers)}
Current Last Row with data: {sheet_last_row}
Recommended Next Start Row: {sheet_last_row + 1}

CRITICAL RULES FOR 'write_sheet':
1. Set 'spreadsheet_id': "{target_sheet_id}"
2. Set 'sheet_title': "{sheet_title}"
3. Set 'start_row': {sheet_last_row + 1}
4. Set 'headers': {json.dumps(sheet_headers)}
5. 'values' MUST be an array of rows, where each row is an array of EXACTLY {len(sheet_headers)} elements matching the headers above:
{chr(10).join(col_instructions)}
DO NOT swap columns (e.g. NEVER put email into Name, or name into City!). Each index of each row corresponds strictly to that column header.
Note : if any input data is not matching with headers we have, you can create a new column with name extra data if there is no column for extra data.
"""
    except Exception as exc:
        logger.warning("Failed to fetch target sheet schema for planner context: %s", exc)
        return ""


