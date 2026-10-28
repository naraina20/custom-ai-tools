import os
import io
import re
import csv
import json
import base64
import html
import logging
from typing import Any, Dict, List, Optional, Tuple, Union
from pathlib import Path
from django.conf import settings
from django.core.mail import EmailMessage, EmailMultiAlternatives
from tools.services.app_logger import AppLogger

logger = logging.getLogger(__name__)


class GeneralToolsError(Exception):
    """Raised when a general tool execution fails."""
    pass


class DocumentExtractorTool:
    """
    Multi-format document parsing and data extraction tool.
    Supports PDF (pypdf), Word (python-docx), Excel (openpyxl), CSV, Images (OCR), and Text.
    """

    @classmethod
    def extract(cls, file_input: Union[str, bytes], filename: Optional[str] = None) -> Dict[str, Any]:
        """
        Extracts plain text and structured content from diverse document types.
        file_input can be:
          - A local file system path
          - A base64 data URI (data:application/pdf;base64,...)
          - Raw bytes or bytearray
        """
        file_bytes, detected_ext = cls._resolve_input_bytes(file_input, filename)
        ext = detected_ext.lower().strip('.')

        if ext == 'pdf':
            return cls._extract_pdf(file_bytes)
        elif ext in ['docx', 'doc']:
            return cls._extract_docx(file_bytes)
        elif ext in ['xlsx', 'xls']:
            return cls._extract_excel(file_bytes)
        elif ext == 'csv':
            return cls._extract_csv(file_bytes)
        elif ext in ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff']:
            return cls._extract_image_ocr(file_bytes, ext)
        elif ext in ['txt', 'md', 'json', 'xml', 'html']:
            return cls._extract_plain_text(file_bytes, ext)
        else:
            # Fallback to text decoding
            try:
                text = file_bytes.decode('utf-8', errors='ignore')
                return {"status": "success", "file_type": ext or "unknown", "text": text}
            except Exception as exc:
                raise GeneralToolsError(f"Unsupported document format .{ext}: {str(exc)}")

    @classmethod
    def _resolve_input_bytes(cls, file_input: Union[str, bytes], filename: Optional[str] = None) -> tuple[bytes, str]:
        detected_ext = ""
        if filename:
            detected_ext = Path(filename).suffix

        if isinstance(file_input, (bytes, bytearray)):
            return bytes(file_input), detected_ext or ".txt"

        if isinstance(file_input, str):
            # Check for base64 data URI: data:<mime>;base64,<data>
            if file_input.startswith("data:") and ";base64," in file_input:
                header, b64_str = file_input.split(";base64,", 1)
                mime = header.replace("data:", "").lower()
                mime_map = {
                    "application/pdf": ".pdf",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
                    "text/csv": ".csv",
                    "image/png": ".png",
                    "image/jpeg": ".jpg",
                    "text/plain": ".txt",
                }
                detected_ext = detected_ext or mime_map.get(mime, ".bin")
                return base64.b64decode(b64_str), detected_ext

            # Check if it's raw base64 without header
            if len(file_input) > 200 and re.match(r'^[A-Za-z0-9+/=\s]+$', file_input[:100]):
                try:
                    decoded = base64.b64decode(file_input)
                    return decoded, detected_ext or ".bin"
                except Exception:
                    pass

            # Check if file_input is a path on disk
            if os.path.exists(file_input):
                detected_ext = detected_ext or Path(file_input).suffix
                with open(file_input, 'rb') as f:
                    return f.read(), detected_ext

            # Otherwise treat as raw text
            return file_input.encode('utf-8'), detected_ext or ".txt"

        raise GeneralToolsError("Invalid file input: must be file path, base64 data, or raw bytes.")

    @classmethod
    def _extract_pdf(cls, file_bytes: bytes) -> Dict[str, Any]:
        """Extracts text, page count, and metadata from PDF using pypdf."""
        try:
            from pypdf import PdfReader
            stream = io.BytesIO(file_bytes)
            reader = PdfReader(stream)
            pages_text = []
            for i, page in enumerate(reader.pages):
                txt = page.extract_text() or ""
                pages_text.append(f"--- Page {i + 1} ---\n{txt.strip()}")

            full_text = "\n\n".join(pages_text).strip()
            return {
                "status": "success",
                "file_type": "pdf",
                "page_count": len(reader.pages),
                "text": full_text or "(PDF contains no extractable text layer)",
                "metadata": {k: str(v) for k, v in (reader.metadata or {}).items()},
            }
        except Exception as exc:
            raise GeneralToolsError(f"PDF extraction error: {str(exc)}")

    @classmethod
    def _extract_docx(cls, file_bytes: bytes) -> Dict[str, Any]:
        """Extracts paragraphs and tables from Word DOCX."""
        try:
            import docx
            stream = io.BytesIO(file_bytes)
            doc = docx.Document(stream)
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]

            table_data = []
            for t_idx, table in enumerate(doc.tables):
                table_rows = []
                for row in table.rows:
                    row_cells = [cell.text.strip() for cell in row.cells]
                    table_rows.append(" | ".join(row_cells))
                if table_rows:
                    table_data.append(f"--- Table {t_idx + 1} ---\n" + "\n".join(table_rows))

            combined = "\n\n".join(paragraphs + table_data).strip()
            return {
                "status": "success",
                "file_type": "docx",
                "paragraph_count": len(paragraphs),
                "table_count": len(doc.tables),
                "text": combined or "(Word document is empty)",
            }
        except Exception as exc:
            raise GeneralToolsError(f"Word document extraction error: {str(exc)}")

    @classmethod
    def _extract_excel(cls, file_bytes: bytes) -> Dict[str, Any]:
        """Extracts sheets and tabular rows from Excel XLSX using openpyxl."""
        try:
            import openpyxl
            stream = io.BytesIO(file_bytes)
            wb = openpyxl.load_workbook(stream, data_only=True)
            sheets_data = {}
            text_lines = []

            for sheet_name in wb.sheetnames:
                sheet = wb[sheet_name]
                rows = list(sheet.iter_rows(values_only=True))
                if not rows:
                    continue

                sheet_records = []
                headers = [str(c or f"Col_{idx + 1}") for idx, c in enumerate(rows[0])]
                text_lines.append(f"=== Sheet: {sheet_name} ===")
                text_lines.append(" | ".join(headers))

                for row in rows[1:]:
                    if any(cell is not None for cell in row):
                        row_vals = [str(c) if c is not None else "" for c in row]
                        text_lines.append(" | ".join(row_vals))
                        sheet_records.append(dict(zip(headers, row_vals)))

                sheets_data[sheet_name] = sheet_records

            return {
                "status": "success",
                "file_type": "xlsx",
                "sheets": list(sheets_data.keys()),
                "data": sheets_data,
                "text": "\n".join(text_lines),
            }
        except Exception as exc:
            raise GeneralToolsError(f"Excel extraction error: {str(exc)}")

    @classmethod
    def _extract_csv(cls, file_bytes: bytes) -> Dict[str, Any]:
        """Extracts structured rows and text from CSV."""
        try:
            text = file_bytes.decode('utf-8', errors='ignore')
            reader = csv.DictReader(io.StringIO(text))
            rows = [dict(r) for r in reader]
            return {
                "status": "success",
                "file_type": "csv",
                "row_count": len(rows),
                "data": rows,
                "text": text,
            }
        except Exception as exc:
            raise GeneralToolsError(f"CSV extraction error: {str(exc)}")

    @classmethod
    def _extract_image_ocr(cls, file_bytes: bytes, ext: str) -> Dict[str, Any]:
        """Performs OCR and metadata extraction on images using Pillow & pytesseract."""
        try:
            from PIL import Image
            stream = io.BytesIO(file_bytes)
            img = Image.open(stream)
            width, height = img.size
            format_name = img.format

            text = ""
            ocr_performed = False
            try:
                import pytesseract
                text = pytesseract.image_to_string(img).strip()
                ocr_performed = True
            except Exception as ocr_err:
                logger.warning("Pytesseract OCR unavailable or binary not found: %s", str(ocr_err))
                text = f"(Image dimensions: {width}x{height}, format: {format_name}. OCR binary not available)"

            return {
                "status": "success",
                "file_type": ext,
                "dimensions": f"{width}x{height}",
                "ocr_performed": ocr_performed,
                "text": text or "(No text detected in image)",
            }
        except Exception as exc:
            raise GeneralToolsError(f"Image extraction error: {str(exc)}")

    @classmethod
    def _extract_plain_text(cls, file_bytes: bytes, ext: str) -> Dict[str, Any]:
        text = file_bytes.decode('utf-8', errors='ignore').strip()
        return {
            "status": "success",
            "file_type": ext,
            "text": text,
        }


class ImagesToPdfTool:
    """
    Combines one or multiple image files into a single, clean PDF document.
    """

    @classmethod
    def convert(
        cls,
        image_inputs: List[Union[str, bytes]],
        output_filename: str = "compiled_document.pdf"
    ) -> Dict[str, Any]:
        if not image_inputs:
            raise GeneralToolsError("No images provided for PDF conversion.")

        try:
            from PIL import Image

            pil_images = []
            for item in image_inputs:
                raw_bytes, _ = DocumentExtractorTool._resolve_input_bytes(item, "image.png")
                img = Image.open(io.BytesIO(raw_bytes))
                # Convert to RGB mode for PDF compatibility
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                pil_images.append(img)

            if not pil_images:
                raise GeneralToolsError("Could not decode any valid images from input.")

            # Ensure output directory exists
            output_dir = Path(getattr(settings, 'MEDIA_ROOT', Path(settings.BASE_DIR) / 'media')) / 'generated_pdfs'
            output_dir.mkdir(parents=True, exist_ok=True)
            output_path = output_dir / output_filename

            first_image = pil_images[0]
            rest_images = pil_images[1:] if len(pil_images) > 1 else []

            first_image.save(
                output_path,
                "PDF",
                resolution=100.0,
                save_all=True,
                append_images=rest_images
            )

            return {
                "status": "success",
                "pdf_path": str(output_path),
                "filename": output_filename,
                "page_count": len(pil_images),
                "size_bytes": os.path.getsize(output_path),
            }

        except Exception as exc:
            raise GeneralToolsError(f"Image to PDF conversion error: {str(exc)}")

    @classmethod
    def execute_plan_item(cls, item: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Dynamically executes a single images_to_pdf plan item."""
        image_sources = item.get("image_sources", [])
        output_filename = item.get("output_filename", "document.pdf")
        pdf_res = cls.convert(image_sources, output_filename=output_filename)
        return {
            "success": True,
            "pdf_details": pdf_res,
        }


class EmailSenderTool:
    """
    Dispatches professional emails via Django's configured SMTP backend.
    Supports single or multiple recipients, HTML formatting, and file attachments.
    """

    @classmethod
    def send(
        cls,
        to_email: Union[str, List[str]],
        subject: str,
        body: str,
        html_body: Optional[str] = None,
        attachments: Optional[List[str]] = None,
        from_email: Optional[str] = None,
    ) -> Dict[str, Any]:
        recipients = [to_email] if isinstance(to_email, str) else list(to_email)
        recipients = [e.strip() for e in recipients if e and e.strip()]

        if not recipients:
            raise GeneralToolsError("Recipient email address (to_email) is required.")

        company = getattr(settings, 'COMPANY_NAME', 'NexusAI')
        sender = from_email or getattr(settings, 'DEFAULT_FROM_EMAIL', f'{company} <support@nexusai.local>')

        AppLogger.debug("EmailSenderTool", f"Attempting SMTP dispatch to: {recipients} | Subject: '{subject}' | From: {sender}")

        try:
            if not html_body:
                escaped_body = html.escape(body or "").replace("\n", "<br>")
                rendered_html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
    <div style="background-color: #4f46e5; padding: 18px 24px;">
      <h2 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 600;">{html.escape(company)}</h2>
    </div>
    <div style="padding: 24px; line-height: 1.6; font-size: 15px;">
      {escaped_body}
    </div>
    <div style="padding: 16px 24px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
      <p style="margin: 0;">This automated message was generated by {html.escape(company)} Agent Systems.</p>
    </div>
  </div>
</body>
</html>"""
            else:
                rendered_html = html_body

            plain_text = body or re.sub(r'<[^<]+?>', '', rendered_html).strip()
            msg = EmailMultiAlternatives(
                subject=subject,
                body=plain_text,
                from_email=sender,
                to=recipients,
            )
            msg.attach_alternative(rendered_html, "text/html")

            # Attach files if provided
            if attachments:
                for file_path in attachments:
                    if os.path.exists(file_path):
                        msg.attach_file(file_path)
                    else:
                        logger.warning("Attachment path does not exist: %s", file_path)

            msg.send(fail_silently=False)
            logger.info("Email dispatched successfully to %s: '%s'", recipients, subject)
            AppLogger.debug("EmailSenderTool", f"SUCCESS! Email delivered to {recipients}")

            return {
                "status": "success",
                "recipients": recipients,
                "subject": subject,
                "attachments_count": len(attachments or []),
            }

        except Exception as exc:
            logger.error("Failed to send email via SMTP: %s", str(exc), exc_info=True)
            AppLogger.error("EmailSenderTool", f"FAILED to deliver email to {recipients}: {exc}", exc=exc)
            raise GeneralToolsError(f"Email delivery failed: {str(exc)}")

    @classmethod
    def execute_plan_item(cls, item: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Dynamically executes a single send_email plan item."""
        company = getattr(settings, 'COMPANY_NAME', 'NexusAI')
        to_email = item.get("to_email")
        subject = item.get("subject", f"{company} Automated Notice")
        body = item.get("body", "")
        html_body = item.get("html_body")
        attachments = item.get("attachments")
        send_res = cls.send(
            to_email=to_email,
            subject=subject,
            body=body,
            html_body=html_body,
            attachments=attachments,
        )
        return {
            "success": True,
            "to_email": to_email,
            "recipient_type": item.get("recipient_type", "client"),
            "is_fallback": item.get("is_fallback_to_personal", False),
            "email_details": send_res,
        }


class ApiCallerTool:
    """
    Universal outbound HTTP API client using requests.
    """

    @classmethod
    def execute(
        cls,
        url: str,
        method: str = "POST",
        headers: Optional[Dict[str, str]] = None,
        json_data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        timeout: int = 30,
    ) -> Dict[str, Any]:
        import requests

        clean_method = (method or "POST").upper().strip()
        req_headers = dict(headers or {})
        if "Content-Type" not in req_headers and json_data is not None:
            req_headers["Content-Type"] = "application/json"

        AppLogger.debug("ApiCallerTool", f"Dispatching {clean_method} request to: {url}")

        try:
            resp = requests.request(
                method=clean_method,
                url=url,
                headers=req_headers,
                json=json_data if clean_method in ["POST", "PUT", "PATCH"] else None,
                params=params,
                timeout=timeout,
            )

            parsed_data = None
            try:
                parsed_data = resp.json()
            except Exception:
                parsed_data = resp.text[:2000]

            AppLogger.debug("ApiCallerTool", f"SUCCESS! Status: {resp.status_code} | URL: {url}")

            return {
                "status": "success",
                "status_code": resp.status_code,
                "is_ok": resp.ok,
                "data": parsed_data,
            }

        except Exception as exc:
            AppLogger.error("ApiCallerTool", f"FAILED API call to '{url}': {exc}", exc=exc)
            raise GeneralToolsError(f"API call to '{url}' failed: {str(exc)}")

    @classmethod
    def execute_plan_item(cls, item: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Dynamically executes a single api_call plan item."""
        url = item.get("url")
        method = item.get("method", "POST")
        headers = item.get("headers")
        json_data = item.get("json_data")
        params = item.get("params")
        api_res = cls.execute(
            url=url,
            method=method,
            headers=headers,
            json_data=json_data,
            params=params,
        )
        if not api_res.get("is_ok", True):
            status_code = api_res.get("status_code")
            data_snippet = str(api_res.get("data", ""))[:200]
            raise GeneralToolsError(f"HTTP request to '{url}' failed with status {status_code}: {data_snippet}")
        return {
            "success": True,
            "url": url,
            "status_code": api_res.get("status_code"),
            "api_response": api_res,
        }


class DataResponseTool:
    """
    Direct data output response tool.
    Formats and returns processed text, summaries, or structured response data.
    """

    @classmethod
    def execute_plan_item(cls, item: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Dynamically formats and returns processed data response item."""
        return {
            "success": True,
            "summary": item.get("summary", "Processed successfully."),
            "response_data": item.get("response_data"),
        }


class PayloadExtractorTool:
    """
    Recursively scans deeply nested JSON structures (e.g. Stripe, Razorpay, GitHub webhooks)
    to extract critical client fields: email, name, amount, invoice details, items.
    """

    @classmethod
    def extract_fields(cls, payload: Dict[str, Any]) -> Dict[str, Any]:
        extracted = {
            "client_email": None,
            "client_name": None,
            "amount": None,
            "currency": None,
            "invoice_id": None,
            "description": None,
            "items": [],
        }

        # Candidate keys
        email_keys = {'email', 'customer_email', 'client_email', 'receipt_email', 'billing_email'}
        name_keys = {'name', 'customer_name', 'client_name', 'billing_name', 'contact_name'}
        amount_keys = {'amount', 'amount_total', 'amount_paid', 'total', 'grand_total', 'subtotal'}
        currency_keys = {'currency', 'currency_code'}
        id_keys = {'invoice_id', 'invoice_number', 'order_id', 'transaction_id', 'id'}

        def _traverse(obj: Any):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    k_lower = str(k).lower().strip()
                    if not extracted["client_email"] and k_lower in email_keys and isinstance(v, str) and '@' in v:
                        extracted["client_email"] = v.strip()
                    if not extracted["client_name"] and k_lower in name_keys and isinstance(v, str):
                        extracted["client_name"] = v.strip()
                    if extracted["amount"] is None and k_lower in amount_keys and isinstance(v, (int, float, str)):
                        extracted["amount"] = v
                    if not extracted["currency"] and k_lower in currency_keys and isinstance(v, str):
                        extracted["currency"] = v.upper().strip()
                    if not extracted["invoice_id"] and k_lower in id_keys and isinstance(v, (str, int)):
                        extracted["invoice_id"] = str(v)
                    if isinstance(v, (dict, list)):
                        _traverse(v)
            elif isinstance(obj, list):
                for item in obj:
                    _traverse(item)

        _traverse(payload)
        return extracted

    @classmethod
    def execute_plan_item(cls, item: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Executes payload extraction for a single plan item.
        Extracts structured fields (name, email, order, amount, status) from the item or webhook payload.
        """
        ctx = context or {}
        raw = item.get("payload") or item.get("data") or item.get("webhook_payload") or ctx.get("webhook_data") or item
        extracted = cls.extract_fields(raw) if isinstance(raw, dict) else {}

        # Merge fields directly provided in the item
        for k, v in item.items():
            if k not in ("tool", "client_identifier", "item_reference", "payload", "webhook_payload"):
                extracted[k] = v

        return {
            "success": True,
            "extracted": extracted,
            "fields_count": len(extracted),
        }


class GoogleActionTool:
    """
    Universal Google Product Action Tool.
    Connects to 7 core Google products: Gmail, Calendar, Docs, Drive, Forms, Meet, Sheets.
    Executes via execute_google_action and respects the Shared Service Account Asset Quarantine Strategy.
    """

    @classmethod
    def execute_plan_item(cls, item: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        from tools.services.google_executor import GoogleExecutorService
        return GoogleExecutorService.execute_google_plan(item, context or {})


class GoogleSheetsServiceTool:
    """
    Dedicated Google Sheets mini-tool executor for Graph Engine and Plan Orchestration.
    Appends structured rows directly after the confirmed last row, preventing overwriting.
    """

    @classmethod
    def execute_plan_item(cls, item: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        from tools.services.sheets_service import write_values, get_sheet_sample
        from tools.models import SharedUserAsset
        from tools.services.oauth_service import OAuthService
        from tools.oauth_constants import PROVIDER_GOOGLE

        ctx = context or {}
        user_id = ctx.get("user_id") or ctx.get("deployer_email") or ctx.get("tool_owner_id")
        spreadsheet_id = item.get("spreadsheet_id")
        sheet_title = item.get("sheet_title") or item.get("sheet") or "Sheet1"
        values = item.get("values", [])

        # If spreadsheet_id not directly provided, find from SharedUserAsset for user
        if not spreadsheet_id and user_id:
            asset = SharedUserAsset.objects.filter(user_id=user_id, product_name="sheets").first()
            if not asset:
                asset = SharedUserAsset.objects.filter(user_id=user_id).first()
            if asset:
                spreadsheet_id = asset.google_file_or_folder_id

        if not spreadsheet_id:
            raise GeneralToolsError("No valid spreadsheet_id found for write_sheet action.")

        # Get valid OAuth access token
        success, token, err = OAuthService.get_or_refresh_token(user_id, PROVIDER_GOOGLE)
        if not success or not token:
            raise GeneralToolsError(f"Google OAuth token unavailable for user {user_id}: {err}")

        # Metadata check 2: Pre-write confirmation to prevent overwriting existing rows
        sample = get_sheet_sample(spreadsheet_id, sheet_title, sample_rows=2, access_token=token, user_id=user_id)
        confirmed_last_row = sample.get("last_row", 0)
        proposed_start = item.get("start_row")
        if proposed_start is None or int(proposed_start) <= confirmed_last_row:
            start_row = confirmed_last_row + 1
        else:
            start_row = int(proposed_start)

        result = write_values(
            spreadsheet_id=spreadsheet_id,
            sheet_title=sheet_title,
            start_row=start_row,
            values=values,
            access_token=token,
            user_id=user_id,
            expected_headers=sample.get("headers"),
        )
        return {
            "status": "success",
            "sheet_title": sheet_title,
            "start_row": start_row,
            "result": result
        }


GENERAL_TOOLS_REGISTRY: Dict[str, Dict[str, Any]] = {
    "send_email": {
        "name": "send_email",
        "title": "SMTP Email Dispatcher",
        "type": "action",
        "description": "Sends professional automated emails with recipient address, subject, body text or HTML, and optional document/PDF attachments via SMTP.",
        "input_types": ["to_email", "subject", "body", "attachments"],
        "capabilities": ["email_dispatch", "notifications", "client_communication"],
        "prompt_instruction": "Dispatches email via SMTP. Can send individual emails to each client or batch/summary to personal email.",
        "supported_execution_modes": ["individual", "batch"],
        "required_item_fields": ["to_email", "subject", "body"],
        "executor": EmailSenderTool.execute_plan_item,
        "schema_instructions": (
            "- Execution Modes:\n"
            "  * Use 'individual' when sending a separate email per client/record found in payload or input data.\n"
            "  * Use 'batch' when the user requests a single aggregated summary email sent to the deployer.\n"
            "- Recipient Resolution:\n"
            "  * When a record contains an email address: set 'to_email' to that address, 'recipient_type': 'client', 'is_fallback_to_personal': false.\n"
            "  * When a record lacks an email address: look for the deployer's email in 'user_tool_data' (e.g. personal_email, email) or 'user_details'. Set 'to_email' to that deployer email, 'recipient_type': 'personal', and 'is_fallback_to_personal': true.\n"
            "- Email Content:\n"
            "  * Dynamically generate tailored, professional 'subject' and 'body' (or HTML) for each item. For personal fallback emails, explicitly mention in the subject and body that the client had no email and their record is being forwarded to the deployer."
        ),
        "schema": {
            "type": "object",
            "properties": {
                "tool": {"type": "string", "enum": ["send_email"]},
                "execution_mode": {
                    "type": "string",
                    "enum": ["individual", "batch"],
                    "description": "'individual' sends an email to each item/client; 'batch' sends one aggregated email."
                },
                "items": {
                    "type": "array",
                    "description": "Array of email dispatch objects to send.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "to_email": {"type": "string", "description": "Valid recipient email address (client email or fallback personal_email)."},
                            "subject": {"type": "string", "description": "Contextual, professional email subject line."},
                            "body": {"type": "string", "description": "Concise, professional email body text or HTML template summarizing the relevant data."},
                            "recipient_type": {"type": "string", "enum": ["client", "personal", "internal"]},
                            "is_fallback_to_personal": {"type": "boolean", "description": "True if this email is sent to personal_email because the client record had no email, else false."},
                            "client_identifier": {"type": "string", "description": "Name, ID, or reference for this client record."}
                        },
                        "required": ["to_email", "subject", "body"]
                    }
                }
            },
            "required": ["tool", "execution_mode", "items"]
        }
    },
    "api_call": {
        "name": "api_call",
        "title": "Outbound HTTP API Client",
        "type": "action",
        "description": "Calls external REST API endpoints or webhook targets using GET, POST, PUT, DELETE, PATCH with custom headers and JSON payloads.",
        "input_types": ["url", "method", "headers", "json_data"],
        "capabilities": ["http_requests", "api_integration", "webhook_forwarding"],
        "prompt_instruction": "Dispatches HTTP requests to external APIs. Can send a single payload with all data or make individual calls per item.",
        "supported_execution_modes": ["single", "per_item"],
        "required_item_fields": ["url", "method"],
        "executor": ApiCallerTool.execute_plan_item,
        "schema_instructions": (
            "- Execution Modes:\n"
            "  * Use 'single' when sending all items/records together in one API request body ('json_data').\n"
            "  * Use 'per_item' when making an individual API call for each client/record.\n"
            "- Endpoint & Method:\n"
            "  * Target URL must be retrieved from 'user_tool_data' (e.g. api_url, endpoint) or tool deployment settings.\n"
            "  * Method defaults to 'POST' unless specified otherwise.\n"
            "- Payload:\n"
            "  * Populate 'json_data' with the structured data intended for the target endpoint."
        ),
        "schema": {
            "type": "object",
            "properties": {
                "tool": {"type": "string", "enum": ["api_call"]},
                "execution_mode": {
                    "type": "string",
                    "enum": ["single", "per_item"],
                    "description": "'single' sends all items/data in one API call; 'per_item' makes an individual API call for each client/item."
                },
                "items": {
                    "type": "array",
                    "description": "Array of HTTP request objects to execute.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "url": {"type": "string", "description": "Target HTTP/HTTPS endpoint URL."},
                            "method": {"type": "string", "enum": ["POST", "GET", "PUT", "PATCH", "DELETE"]},
                            "headers": {"type": "object", "description": "Optional HTTP headers."},
                            "json_data": {"type": "object", "description": "JSON payload to send in request body."},
                            "item_reference": {"type": "string", "description": "Client ID, item name, or batch reference."}
                        },
                        "required": ["url", "method"]
                    }
                }
            },
            "required": ["tool", "execution_mode", "items"]
        }
    },
    "images_to_pdf": {
        "name": "images_to_pdf",
        "title": "Images to PDF Compiler",
        "type": "action",
        "description": "Compiles one or multiple image files (PNG, JPG, JPEG, WEBP, BMP) into a clean, single multi-page PDF document.",
        "input_types": ["images_list"],
        "capabilities": ["image_processing", "pdf_generation"],
        "prompt_instruction": "Compile uploaded images into a PDF.",
        "supported_execution_modes": ["single"],
        "required_item_fields": ["image_sources"],
        "executor": ImagesToPdfTool.execute_plan_item,
        "schema_instructions": (
            "- Execution Mode: 'single'\n"
            "- Extract image sources/paths from input data into 'image_sources' array, and specify a descriptive 'output_filename'."
        ),
        "schema": {
            "type": "object",
            "properties": {
                "tool": {"type": "string", "enum": ["images_to_pdf"]},
                "execution_mode": {"type": "string", "enum": ["single"]},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "image_sources": {"type": "array", "items": {"type": "string"}, "description": "List of image data/paths to compile."},
                            "output_filename": {"type": "string", "description": "Name for the generated PDF."}
                        },
                        "required": ["image_sources"]
                    }
                }
            },
            "required": ["tool", "execution_mode", "items"]
        }
    },
    "data_response": {
        "name": "data_response",
        "title": "Direct Data Output Response",
        "type": "action",
        "description": "Formats and returns processed text, summaries, calculations, or extracted data directly to the user as the final tool response.",
        "input_types": ["any_data"],
        "capabilities": ["data_formatting", "text_summary"],
        "prompt_instruction": "Return processed data directly to user.",
        "supported_execution_modes": ["single"],
        "required_item_fields": ["summary"],
        "executor": DataResponseTool.execute_plan_item,
        "schema_instructions": (
            "- Execution Mode: 'single'\n"
            "- Generate a concise human-readable 'summary' of what was processed and place the formatted output in 'response_data'."
        ),
        "schema": {
            "type": "object",
            "properties": {
                "tool": {"type": "string", "enum": ["data_response"]},
                "execution_mode": {"type": "string", "enum": ["single"]},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "summary": {"type": "string", "description": "Concise summary of data processed."},
                            "response_data": {"type": "object", "description": "Structured processed output."}
                        },
                        "required": ["summary"]
                    }
                }
            },
            "required": ["tool", "execution_mode", "items"]
        }
    },
    "document_extractor": {
        "name": "document_extractor",
        "title": "Document Extractor & OCR",
        "type": "preprocessor",
        "description": "Extracts text, tables, and structured data from documents: PDF (via pypdf), Word DOCX (via python-docx), Excel spreadsheets (via openpyxl), CSV tables, Images OCR (via Pillow/pytesseract), and plain text.",
        "input_types": ["file_path", "base64", "bytes"],
        "capabilities": ["pdf_parsing", "docx_parsing", "excel_parsing", "csv_parsing", "ocr"],
        "prompt_instruction": "Extracts raw text, table structures, and data from uploaded documents (PDF, Word, Excel, CSV, or Images OCR).",
    },
    "google_action": {
        "name": "google_action",
        "title": "Google Products Universal Action",
        "type": "action",
        "description": "Executes API actions across 7 core Google products (Gmail, Calendar, Docs, Drive, Forms, Meet, Sheets) via the Universal API Execution Engine. Respects capability limits (e.g. Gmail only supports gmail.send).",
        "input_types": ["package_product_name", "api_version", "target_resource_path", "method_name", "kwargs"],
        "capabilities": ["google_integration", "drive", "sheets", "docs", "gmail", "calendar", "forms", "meet"],
        "prompt_instruction": "Execute an API action against Google products (Gmail, Calendar, Docs, Drive, Forms, Meet, Sheets).",
        "supported_execution_modes": ["single", "per_item"],
        "required_item_fields": ["package_product_name", "method_name"],
        "executor": GoogleActionTool.execute_plan_item,
        "schema_instructions": (
            "- Execution Modes: 'single' or 'per_item'\n"
            "- Specify 'package_product_name' (e.g. 'drive', 'sheets', 'documents', 'gmail', 'calendar', 'forms', 'meet').\n"
            "- Specify 'api_version' (e.g. 'v4' for sheets, 'v3' for drive/calendar, 'v1' for docs/forms/meet/gmail).\n"
            "- Specify 'target_resource_path' (e.g. 'spreadsheets.values', 'files', 'events', 'users.messages').\n"
            "- Specify 'method_name' (e.g. 'append', 'get', 'create', 'send'). Note: Gmail ONLY supports 'send' or 'create'. Read/modify is strictly forbidden.\n"
            "- For Gmail ('gmail'):\n"
            "  * Set 'target_resource_path': 'users.messages', 'method_name': 'send'.\n"
            "  * In 'kwargs': provide human-readable 'to' (or 'to_email'), 'subject', and 'body' (text or HTML content). The engine automatically constructs the RFC 2822 MIME message and formats it into the required Google Discovery body={'raw': '<base64>'} structure.\n"
            "  * NEVER invent dummy placeholder strings like 'BASE64_ENCODED_WELCOME_EMAIL'. Always supply realistic, readable text for 'to', 'subject', and 'body'.\n"
            "- For other Google tools, pass action parameters under 'kwargs' according to the respective Google product API."
        ),
        "schema": {
            "type": "object",
            "properties": {
                "tool": {"type": "string", "enum": ["google_action"]},
                "execution_mode": {"type": "string", "enum": ["single", "per_item"]},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "package_product_name": {"type": "string", "description": "Google package name: drive, sheets, documents, gmail, calendar, forms, meet."},
                            "api_version": {"type": "string", "description": "API version e.g. v1, v3, v4."},
                            "target_resource_path": {"type": "string", "description": "Resource node path e.g. spreadsheets.values, files, events."},
                            "method_name": {"type": "string", "description": "Target method name e.g. append, get, insert, send."},
                            "kwargs": {"type": "object", "description": "Payload parameters passed to method (**kwargs)."}
                        },
                        "required": ["package_product_name", "method_name"]
                    }
                }
            },
            "required": ["tool", "execution_mode", "items"]
        }
    },
    "write_sheet": {
        "name": "write_sheet",
        "title": "Google Sheets Data Writer",
        "type": "action",
        "description": "Appends formatted rows to a designated Google Sheet at the exact range, ensuring headers align and existing rows are never overwritten.",
        "input_types": ["spreadsheet_id", "sheet_title", "start_row", "values", "range"],
        "capabilities": ["google_integration", "sheets", "spreadsheet_write"],
        "prompt_instruction": "Appends data rows to a Google Spreadsheet. Inspects sheet headers, matches column order, and writes starting after the last row.",
        "supported_execution_modes": ["single"],
        "required_item_fields": ["sheet_title", "values"],
        "executor": GoogleSheetsServiceTool.execute_plan_item,
        "schema_instructions": (
            "- Execution Mode: 'single'\n"
            "- Target sheet: specify 'sheet_title' (e.g. 'Sheet1').\n"
            "- Values format: 'values' must be an array of rows (each row is an array of values), ordered strictly by column headers.\n"
            "- Range & Start Row: specify 'start_row' strictly greater than existing last_row so existing rows are never overwritten.\n"
            "- Deterministic execution: LLM outputs exact rows and column alignment matching sheet schema."
        ),
        "schema": {
            "type": "object",
            "properties": {
                "tool": {"type": "string", "enum": ["write_sheet"]},
                "execution_mode": {"type": "string", "enum": ["single"]},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "spreadsheet_id": {"type": "string", "description": "Google Spreadsheet ID."},
                            "sheet_title": {"type": "string", "description": "Sheet name/tab title (e.g. 'Sheet1')."},
                            "start_row": {"type": "integer", "description": "1-based starting row for new values."},
                            "range": {"type": "string", "description": "Target A1 range e.g. 'Sheet1!A12:E14'."},
                            "headers": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Column headers detected for the sheet."
                            },
                            "values": {
                                "type": "array",
                                "items": {
                                    "type": "array",
                                    "description": "Values for one row matching column headers."
                                },
                                "description": "List of rows to write."
                            }
                        },
                        "required": ["sheet_title", "values"]
                    }
                }
            },
            "required": ["tool", "execution_mode", "items"]
        }
    },
}


class ToolCatalogManager:
    """
    Maintains our built-in tool registry, handles dynamic schema formatting for LLM planner,
    and provides dynamic execution and item-level parameter validation for robust, resilient execution.
    """

    @classmethod
    def get_all_tool_names(cls) -> List[str]:
        """
        Returns list of all registered tool identifiers.
        """
        return list(GENERAL_TOOLS_REGISTRY.keys())

    @classmethod
    def get_action_tool_names(cls) -> List[str]:
        """
        Returns list of action tool names that can be selected as final execution actions.
        """
        return [
            name for name, info in GENERAL_TOOLS_REGISTRY.items()
            if info.get("type") == "action" or info.get("is_action", False)
        ]

    @classmethod
    def register_tool(cls, tool_name: str, tool_def: Dict[str, Any]) -> None:
        """
        Dynamically registers or updates a general tool in the registry at runtime.
        """
        GENERAL_TOOLS_REGISTRY[tool_name] = tool_def
        logger.info("Dynamically registered general tool: '%s'", tool_name)

    @classmethod
    def get_tools_catalog_for_reasoning(cls) -> str:
        """
        Dynamically formats all registered tools with their full metadata (name, title,
        description, capabilities, input types) for high reasoning LLM evaluation.
        """
        blocks = []
        for name, info in GENERAL_TOOLS_REGISTRY.items():
            caps = ", ".join(info.get("capabilities", []))
            inputs = ", ".join(info.get("input_types", []))
            tool_type = info.get("type", "general")
            block = (
                f"- Tool: '{name}' ({info.get('title', name)}) [Type: {tool_type}]\n"
                f"  Description: {info.get('description', '')}\n"
                f"  Capabilities: {caps}\n"
                f"  Inputs: {inputs}"
            )
            blocks.append(block)
        return "\n\n".join(blocks)

    @classmethod
    def get_supported_tools_summary(cls) -> str:
        """
        Dynamically generates a human-readable list of all registered General Tools.
        """
        lines = []
        for name, info in GENERAL_TOOLS_REGISTRY.items():
            lines.append(f"- '{name}': {info['title']} — {info['description']}")
        return "\n".join(lines)

    @classmethod
    def get_tools_schemas_for_planner(cls, selected_tools: List[str]) -> str:
        """
        Formats the exact universal JSON schemas AND tool-specific schema mapping instructions
        for the specific tools selected for execution, dynamically passing only relevant tool rules.
        """
        sections = []
        for tool_name in selected_tools:
            info = GENERAL_TOOLS_REGISTRY.get(tool_name)
            if not info or "schema" not in info:
                continue
            schema_json = json.dumps(info.get("schema", {}), indent=2)
            reqs = ", ".join(info.get("required_item_fields", []))
            modes = ", ".join(info.get("supported_execution_modes", ["single"]))
            instructions = info.get("schema_instructions", "Follow the exact JSON schema provided.")
            sections.append(
                f"=== Tool: '{tool_name}' ({info.get('title')}) ===\n"
                f"Description: {info.get('description')}\n"
                f"Supported Execution Modes: [{modes}]\n"
                f"Required Item Fields: [{reqs}]\n\n"
                f"--- Specific Rules & Instructions for Tool '{tool_name}' ---\n"
                f"{instructions}\n\n"
                f"--- Exact JSON Schema for Tool '{tool_name}' ---\n"
                f"{schema_json}"
            )
        return "\n\n".join(sections)

    @classmethod
    def execute_tool(cls, tool_name: str, item: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Dynamically executes an item on the requested general tool using its registered executor handler.
        No if-else chains required; fully extensible for dynamically added tools.
        """
        tool_info = GENERAL_TOOLS_REGISTRY.get(tool_name)
        if not tool_info:
            raise GeneralToolsError(f"General tool '{tool_name}' is not registered.")
        executor = tool_info.get("executor")
        if not callable(executor):
            raise GeneralToolsError(f"General tool '{tool_name}' does not have a callable executor handler.")
        return executor(item, context=context)

    @classmethod
    def validate_tool_plan_item(cls, tool_name: str, item: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
        """
        Validates an individual execution item against the tool's required fields and constraints.
        Returns: (is_valid: bool, error_message: Optional[str])
        """
        tool_info = GENERAL_TOOLS_REGISTRY.get(tool_name)
        if not tool_info:
            return False, f"Unknown tool '{tool_name}'."

        if not isinstance(item, dict):
            return False, f"Execution item must be a JSON object, got {type(item).__name__}."

        required_fields = tool_info.get("required_item_fields", [])
        for field in required_fields:
            val = item.get(field)
            if val is None or (isinstance(val, str) and not val.strip()):
                return False, f"Missing or empty required field '{field}' for tool '{tool_name}'."

        # Specific field format validations
        if tool_name == "send_email":
            email = str(item.get("to_email", "")).strip()
            if "@" not in email or "." not in email:
                return False, f"Invalid destination email format '{email}'."
        elif tool_name == "api_call":
            url = str(item.get("url", "")).strip()
            if not (url.startswith("http://") or url.startswith("https://")):
                return False, f"Invalid API URL '{url}'. Must start with http:// or https://."
            method = str(item.get("method", "")).upper().strip()
            if method not in ["GET", "POST", "PUT", "PATCH", "DELETE"]:
                return False, f"Unsupported HTTP method '{method}'."

        return True, None

    @classmethod
    def decide_required_tools(cls, description: str) -> Dict[str, Any]:
        """
        Node 1 Evaluator:
        Uses High Reasoning LLM to evaluate the user's description and determine
        which General Tool or General Tools must be executed to fulfill this process.
        Returns an ordered array of tool names in the exact sequence they should be executed.
        """
        from tools.services.llm_router import LLMRouter

        available_tools_catalog = cls.get_tools_catalog_for_reasoning()
        available_tool_names = cls.get_all_tool_names()

        company = getattr(settings, 'COMPANY_NAME', 'NexusAI')
        eval_prompt = f"""You are the Master Agent Tool Selector for {company}.
The execution engine has already received and ingested the inbound webhook trigger / user request payload.
Our toolbox contains the following General Action Tools to process the data and perform actions:
{available_tools_catalog}

AI-Tool Title / Description:
"{description}"

Your Task:
Determine which General Tool or Tools from our available toolbox must be executed to fulfill the described actions (e.g. writing data to spreadsheets, sending emails, making API calls, or returning data).

Rules:
1. Return an ordered array of tool names in the exact sequence they should be executed (e.g. ["write_sheet", "send_email"]).
2. Inbound webhook data ingestion, payload parsing, and trigger handling are already handled by the platform infrastructure. Focus on the destination actions (e.g. writing to sheets, sending emails, calling APIs).
3. Always select the relevant tools from the available toolbox that fulfill the actions described. If writing to a sheet is described, select "write_sheet". If sending an email is described, select "send_email". If no other specific action is described, select "data_response".

Return ONLY a valid JSON object matching this exact schema:
{{
  "selected_tools": ["<tool_name_1>", "<tool_name_2>"],
  "reason": "<Brief explanation of the ordered tools choice>"
}}
"""
        try:
            eval_raw = LLMRouter.route_completion(
                messages=[
                    {"role": "system", "content": "You are a production tool selector. Return valid JSON only."},
                    {"role": "user", "content": eval_prompt}
                ],
                json_mode=True,
                temperature=0.1,
                tier="reasoning",
            )
            if isinstance(eval_raw, dict):
                data = eval_raw
            else:
                data = json.loads(str(eval_raw))

            selected_tools = data.get("selected_tools") or data.get("tools") or data.get("required_tools") or []
            if isinstance(selected_tools, str):
                selected_tools = [selected_tools]

            # Filter to ensure only valid registered tools are retained in order
            valid_selected = [t for t in selected_tools if t in available_tool_names]
            if not valid_selected and selected_tools:
                valid_selected = selected_tools

            reason = data.get("reason", "")
            return {
                "can_fulfill": True,
                "selected_tools": valid_selected,
                "tools": valid_selected,
                "required_tools": valid_selected,
                "reason": reason,
            }
        except Exception as eval_err:
            logger.warning("LLM capability tool evaluation error: %s", str(eval_err))
            return {
                "can_fulfill": True,
                "selected_tools": ["data_response"],
                "tools": ["data_response"],
                "required_tools": ["data_response"],
                "reason": f"Fallback due to evaluation error: {str(eval_err)}",
            }

    @classmethod
    def check_demand_or_escalate(
        cls,
        description: str,
        client_email: Optional[str] = None,
        client_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Uses High Reasoning LLM via `decide_required_tools` to decide which tool(s)
        from our toolbox will fulfill the user's description.
        If the capability cannot be fulfilled, automatically alerts support via email
        and returns an escalation waitlist message.
        """
        decision = cls.decide_required_tools(description=description)
        can_fulfill = decision.get("can_fulfill", True)
        tools = decision.get("selected_tools") or decision.get("tools") or []
        reason = decision.get("reason", "")

        if not can_fulfill or not tools:
            company = getattr(settings, 'COMPANY_NAME', 'NexusAI')
            support_email = getattr(settings, 'COMPANY_SUPPORT_EMAIL', 'narainad308@gmail.com')
            user_info = f"Client: {client_name or 'Anonymous'} ({client_email or 'No email provided'})"

            try:
                EmailSenderTool.send(
                    to_email=support_email,
                    subject=f"[{company}] New Tool Capability Demand Request",
                    body=(
                        f"A user requested a tool capability not currently in our toolbox:\n\n"
                        f"{user_info}\n\n"
                        f"Requested Tool Description:\n{description}\n\n"
                        f"High Reasoning Evaluator Assessment:\n{reason}\n\n"
                        f"Action: Engineering team should review for future release."
                    ),
                )
            except Exception as mail_err:
                logger.warning("Could not dispatch escalation email: %s", str(mail_err))

            return {
                "is_supported": False,
                "escalated": True,
                "message": (
                    "We don't support this specific tool capability currently, but we have "
                    "forwarded your request to our engineering team to build it for you!"
                ),
                "reason": reason,
                "selected_tools": [],
                "tools": [],
                "required_tools": [],
            }

        return {
            "is_supported": True,
            "escalated": False,
            "selected_tools": tools,
            "tools": tools,
            "required_tools": tools,
            "reason": reason,
        }
