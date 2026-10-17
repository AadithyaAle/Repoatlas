from enum import StrEnum


class ErrorCode(StrEnum):
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INVALID_REPO_URL = "INVALID_REPO_URL"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    ANALYSIS_NOT_READY = "ANALYSIS_NOT_READY"
    GITHUB_REPO_NOT_FOUND = "GITHUB_REPO_NOT_FOUND"
    GITHUB_RATE_LIMITED = "GITHUB_RATE_LIMITED"
    GITHUB_UNAVAILABLE = "GITHUB_UNAVAILABLE"
    REPO_TOO_LARGE = "REPO_TOO_LARGE"
    NO_SOURCE_FILES = "NO_SOURCE_FILES"
    FILE_NOT_IN_SNAPSHOT = "FILE_NOT_IN_SNAPSHOT"
    INVALID_LINE_RANGE = "INVALID_LINE_RANGE"
    AI_DISABLED = "AI_DISABLED"
    AI_FAILED = "AI_FAILED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


_STATUS: dict[ErrorCode, int] = {
    ErrorCode.VALIDATION_ERROR: 422,
    ErrorCode.INVALID_REPO_URL: 422,
    ErrorCode.UNAUTHORIZED: 401,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.CONFLICT: 409,
    ErrorCode.ANALYSIS_NOT_READY: 409,
    ErrorCode.GITHUB_REPO_NOT_FOUND: 404,
    ErrorCode.GITHUB_RATE_LIMITED: 429,
    ErrorCode.GITHUB_UNAVAILABLE: 502,
    ErrorCode.REPO_TOO_LARGE: 413,
    ErrorCode.NO_SOURCE_FILES: 422,
    ErrorCode.FILE_NOT_IN_SNAPSHOT: 404,
    ErrorCode.INVALID_LINE_RANGE: 422,
    ErrorCode.AI_DISABLED: 503,
    ErrorCode.AI_FAILED: 502,
    ErrorCode.INTERNAL_ERROR: 500,
}


class AppError(Exception):
    """Domain error rendered as `{success: false, error: {code, message, details}}`."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        status_code: int | None = None,
        details: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code or _STATUS[code]
        self.details = details or {}
