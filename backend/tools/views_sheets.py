import logging
from typing import Optional, Tuple
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from tools.models import SharedUserAsset
from tools.oauth_constants import PROVIDER_GOOGLE
from tools.services.oauth_service import OAuthService
from tools.services.sheets_service import (
    GoogleSheetsAuthError,
    GoogleSheetsError,
    GoogleSheetsNotFoundError,
    GoogleSheetsRateLimitError,
    generate_sheet_rows_with_llm,
    get_sheet_sample,
    get_sheets_info,
    write_values,
)

logger = logging.getLogger(__name__)


def resolve_asset_and_token(request, file_id: str) -> Tuple[SharedUserAsset, str, str]:
    """
    Resolves the SharedUserAsset record from the database by DB primary key or google_file_or_folder_id,
    verifies that the requesting user owns the asset, and retrieves a valid Google OAuth access token.
    
    Returns:
      (asset: SharedUserAsset, access_token: str, user_id: str)
    """
    user_id = (
        getattr(request.user, 'user_id', None)
        or getattr(request.user, 'username', None)
        or request.headers.get('X-User-Id')
        or request.query_params.get('user_id')
        or (request.data.get('user_id') if isinstance(request.data, dict) else None)
    )

    if not user_id:
        raise ValidationError({"error": "User ID is required to access Google Sheets."})

    # Look up asset by primary key ID or Google Drive file ID
    asset = None
    if str(file_id).isdigit():
        asset = SharedUserAsset.objects.filter(id=int(file_id), user_id=user_id).first()
    if not asset:
        asset = SharedUserAsset.objects.filter(google_file_or_folder_id=str(file_id), user_id=user_id).first()

    if not asset:
        # Check if asset belongs to another user
        exists_for_other = (
            SharedUserAsset.objects.filter(id=int(file_id)).exists() if str(file_id).isdigit()
            else SharedUserAsset.objects.filter(google_file_or_folder_id=str(file_id)).exists()
        )
        if exists_for_other:
            raise PermissionDenied({"error": "You do not have permission to access this spreadsheet."})
        raise NotFound({"error": f"Spreadsheet asset with id '{file_id}' not found."})

    # Retrieve valid OAuth access token for Google
    success, access_token, err = OAuthService.get_or_refresh_token(user_id, PROVIDER_GOOGLE)
    if not success or not access_token:
        raise AuthenticationFailed({
            "error": "Google OAuth authorization required or token expired.",
            "details": err
        })

    return asset, access_token, user_id


class SheetsInfoView(APIView):
    """
    GET /api/sheets/{file_id}/info/
    Returns:
      {"sheets": [{"sheet_id": 0, "title": "Sheet1", "row_count": 1000, "column_count": 26}]}
    """
    permission_classes = [AllowAny]

    def get(self, request, file_id: str, *args, **kwargs):
        try:
            asset, access_token, user_id = resolve_asset_and_token(request, file_id)
            spreadsheet_id = asset.google_file_or_folder_id

            sheets = get_sheets_info(
                spreadsheet_id=spreadsheet_id,
                access_token=access_token,
                user_id=user_id
            )
            return Response({"sheets": sheets}, status=status.HTTP_200_OK)

        except GoogleSheetsAuthError as exc:
            return Response({"error": exc.message}, status=status.HTTP_401_UNAUTHORIZED)
        except GoogleSheetsNotFoundError as exc:
            return Response({"error": exc.message}, status=status.HTTP_404_NOT_FOUND)
        except GoogleSheetsRateLimitError as exc:
            return Response({"error": exc.message}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except GoogleSheetsError as exc:
            return Response({"error": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            logger.error("Error fetching sheets info for file_id %s: %s", file_id, str(exc), exc_info=True)
            return Response({"error": f"Internal server error: {str(exc)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SheetsSampleView(APIView):
    """
    GET /api/sheets/{file_id}/sample/?sheet=Sheet1
    Returns:
      {
        "sheet_title": "Sheet1",
        "headers": ["Name","Email","Date","Amount","Status"],
        "sample_rows": [["Asha","asha@x.com","2026-10-01","1200","Paid"],["Ravi","ravi@x.com","2026-10-02","800","Pending"]],
        "last_row": 11,
        "last_col_letter": "E",
        "next_row": 12
      }
    """
    permission_classes = [AllowAny]

    def get(self, request, file_id: str, *args, **kwargs):
        try:
            asset, access_token, user_id = resolve_asset_and_token(request, file_id)
            spreadsheet_id = asset.google_file_or_folder_id

            sheet_title = request.query_params.get("sheet", "").strip()
            if not sheet_title:
                # Default to first sheet
                sheets = get_sheets_info(spreadsheet_id, access_token, user_id=user_id)
                sheet_title = sheets[0]["title"] if sheets else "Sheet1"

            sample_data = get_sheet_sample(
                spreadsheet_id=spreadsheet_id,
                sheet_title=sheet_title,
                sample_rows=2,
                access_token=access_token,
                user_id=user_id
            )
            return Response(sample_data, status=status.HTTP_200_OK)

        except GoogleSheetsAuthError as exc:
            return Response({"error": exc.message}, status=status.HTTP_401_UNAUTHORIZED)
        except GoogleSheetsNotFoundError as exc:
            return Response({"error": exc.message}, status=status.HTTP_404_NOT_FOUND)
        except GoogleSheetsRateLimitError as exc:
            return Response({"error": exc.message}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except GoogleSheetsError as exc:
            return Response({"error": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            logger.error("Error fetching sheet sample for file_id %s: %s", file_id, str(exc), exc_info=True)
            return Response({"error": f"Internal server error: {str(exc)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SheetsGenerateView(APIView):
    """
    POST /api/sheets/{file_id}/generate/
    Payload:
      {"sheet": "Sheet1", "instruction": "add 3 new customers from Jaipur", "row_count": 3, "input_data": {...}}
    Returns:
      {"preview": {"range": "Sheet1!A12:E14", "values": [[...],[...],[...]]}}
    Note: Does NOT write to the sheet.
    """
    permission_classes = [AllowAny]

    def post(self, request, file_id: str, *args, **kwargs):
        try:
            asset, access_token, user_id = resolve_asset_and_token(request, file_id)
            spreadsheet_id = asset.google_file_or_folder_id

            sheet_title = request.data.get("sheet", "").strip()
            instruction = request.data.get("instruction", "").strip()
            row_count = int(request.data.get("row_count", 3))
            input_data = request.data.get("input_data") or {}

            if not sheet_title:
                sheets = get_sheets_info(spreadsheet_id, access_token, user_id=user_id)
                sheet_title = sheets[0]["title"] if sheets else "Sheet1"

            if not instruction:
                return Response(
                    {"error": "instruction is required to generate rows."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Metadata call 1: Get sheet sample (headers + 2 sample rows + next_row)
            sample_data = get_sheet_sample(
                spreadsheet_id=spreadsheet_id,
                sheet_title=sheet_title,
                sample_rows=2,
                access_token=access_token,
                user_id=user_id
            )

            # Send unlabeled 3 rows to LLM to produce preview rows
            result = generate_sheet_rows_with_llm(
                sheet_title=sheet_title,
                instruction=instruction,
                row_count=row_count,
                sample_info=sample_data,
                input_data=input_data,
            )

            return Response(result, status=status.HTTP_200_OK)

        except GoogleSheetsAuthError as exc:
            return Response({"error": exc.message}, status=status.HTTP_401_UNAUTHORIZED)
        except GoogleSheetsNotFoundError as exc:
            return Response({"error": exc.message}, status=status.HTTP_404_NOT_FOUND)
        except GoogleSheetsRateLimitError as exc:
            return Response({"error": exc.message}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except GoogleSheetsError as exc:
            return Response({"error": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            logger.error("Error generating sheet preview for file_id %s: %s", file_id, str(exc), exc_info=True)
            return Response({"error": f"Internal server error: {str(exc)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SheetsWriteView(APIView):
    """
    POST /api/sheets/{file_id}/write/
    Payload:
      {"sheet": "Sheet1", "start_row": 12, "values": [[...],[...],[...]]}
    Returns:
      {"updatedRange": "Sheet1!A12:E14", "updatedRows": 3, "updatedCells": 15}
    """
    permission_classes = [AllowAny]

    def post(self, request, file_id: str, *args, **kwargs):
        try:
            asset, access_token, user_id = resolve_asset_and_token(request, file_id)
            spreadsheet_id = asset.google_file_or_folder_id

            sheet_title = request.data.get("sheet", "").strip()
            values = request.data.get("values", [])
            proposed_start_row = request.data.get("start_row")

            if not sheet_title:
                return Response({"error": "sheet parameter is required."}, status=status.HTTP_400_BAD_REQUEST)

            if not values or not isinstance(values, list):
                return Response({"error": "values must be a non-empty list of rows."}, status=status.HTTP_400_BAD_REQUEST)

            # Metadata call 2 (Pre-write confirmation to prevent overwriting existing rows)
            current_sample = get_sheet_sample(
                spreadsheet_id=spreadsheet_id,
                sheet_title=sheet_title,
                sample_rows=2,
                access_token=access_token,
                user_id=user_id
            )
            confirmed_last_row = current_sample.get("last_row", 0)
            headers = current_sample.get("headers", [])

            # Ensure we NEVER overwrite existing rows:
            # If start_row was omitted or start_row <= confirmed_last_row, advance to next empty row
            if proposed_start_row is None:
                start_row = confirmed_last_row + 1
            else:
                start_row = int(proposed_start_row)
                if start_row <= confirmed_last_row:
                    logger.warning(
                        "Proposed start_row %d is <= confirmed_last_row %d. Advancing to %d to avoid data overwrite.",
                        start_row, confirmed_last_row, confirmed_last_row + 1
                    )
                    start_row = confirmed_last_row + 1

            # Write values with automatic header length check & 1-time LLM alignment
            result = write_values(
                spreadsheet_id=spreadsheet_id,
                sheet_title=sheet_title,
                start_row=start_row,
                values=values,
                access_token=access_token,
                user_id=user_id,
                expected_headers=headers,
            )

            return Response(result, status=status.HTTP_200_OK)

        except GoogleSheetsAuthError as exc:
            return Response({"error": exc.message}, status=status.HTTP_401_UNAUTHORIZED)
        except GoogleSheetsNotFoundError as exc:
            return Response({"error": exc.message}, status=status.HTTP_404_NOT_FOUND)
        except GoogleSheetsRateLimitError as exc:
            return Response({"error": exc.message}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except GoogleSheetsError as exc:
            return Response({"error": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            logger.error("Error writing to sheet for file_id %s: %s", file_id, str(exc), exc_info=True)
            return Response({"error": f"Internal server error: {str(exc)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
