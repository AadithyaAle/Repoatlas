"""Cross-cutting HTTP concerns: error envelopes, request ids + access logs, logging setup.

Every error leaves the API as `{"success": false, "error": {"code", "message", "details"}}`;
stack traces are logged (with the request id) and never returned to clients.
"""

import json
import logging
import re
import sys
import time
import uuid
from collections.abc import Mapping
from contextvars import ContextVar
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import AppError, ErrorCode
from app.schemas.common import ApiResponse, ErrorBody

logger = logging.getLogger("app")
access_logger = logging.getLogger("app.access")

REQUEST_ID_HEADER = "X-Request-ID"
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
_VALID_REQUEST_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}")
_LOG_EXTRAS = ("method", "path", "status", "duration_ms")
_HTTP_CODES: dict[int, str] = {
    400: ErrorCode.VALIDATION_ERROR,
    401: ErrorCode.UNAUTHORIZED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    405: "METHOD_NOT_ALLOWED",
    409: ErrorCode.CONFLICT,
    422: ErrorCode.VALIDATION_ERROR,
}


# ---------- Logging ----------


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not getattr(record, "request_id", None):
            record.__dict__["request_id"] = request_id_var.get() or "-"
        return True


class JsonFormatter(logging.Formatter):
    """Single-line JSON records for log aggregators."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        payload.update({k: getattr(record, k) for k in _LOG_EXTRAS if hasattr(record, k)})
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO", *, json_format: bool = False) -> None:
    """Idempotent root logger setup: JSON lines in production, readable text in development."""
    handler = logging.StreamHandler(sys.stderr)  # keeps stdout clean for CLI scripts
    handler.addFilter(_RequestIdFilter())
    handler.setFormatter(
        JsonFormatter()
        if json_format
        else logging.Formatter("%(asctime)s %(levelname)-7s %(name)s [%(request_id)s] %(message)s")
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).handlers = []
        logging.getLogger(name).propagate = True
    # Our middleware writes the access log (with request id + duration).
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


# ---------- Request id + timing middleware ----------


class RequestContextMiddleware:
    """Pure ASGI middleware: assigns/propagates X-Request-ID and logs one line per request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = Headers(scope=scope).get(REQUEST_ID_HEADER)
        request_id = (
            incoming if incoming and _VALID_REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex
        )
        scope.setdefault("state", {})["request_id"] = request_id
        token = request_id_var.set(request_id)
        status_code = 500
        start = time.perf_counter()

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            duration_ms = round((time.perf_counter() - start) * 1000, 1)
            method, path = scope["method"], scope["path"]
            access_logger.info(
                "%s %s %s %.1fms",
                method,
                path,
                status_code,
                duration_ms,
                extra={
                    "method": method,
                    "path": path,
                    "status": status_code,
                    "duration_ms": duration_ms,
                },
            )
            request_id_var.reset(token)


# ---------- Exception handlers ----------


def _request_id(request: Request) -> str | None:
    rid = getattr(request.state, "request_id", None)
    return rid if isinstance(rid, str) else None


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: dict[str, object] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    body = ApiResponse[None](
        success=False,
        error=ErrorBody(code=code, message=message, details=jsonable_encoder(details or {})),
    )
    return JSONResponse(body.model_dump(mode="json"), status_code=status_code, headers=headers)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        if exc.status_code >= 500:
            logger.warning("AppError %s: %s", exc.code, exc.message)
        return error_response(exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Only loc/msg/type: never echo (possibly huge or sensitive) input back.
        errors = [
            {
                "loc": [p if isinstance(p, int) else str(p) for p in err.get("loc", ())],
                "msg": str(err.get("msg", "")),
                "type": str(err.get("type", "")),
            }
            for err in exc.errors()
        ]
        return error_response(
            422, ErrorCode.VALIDATION_ERROR, "Request validation failed", {"errors": errors}
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code)
        if code is None:
            code = ErrorCode.INTERNAL_ERROR if exc.status_code >= 500 else "HTTP_ERROR"
        message = "Route not found" if exc.detail == "Not Found" else str(exc.detail)
        return error_response(exc.status_code, code, message, headers=exc.headers)

    @app.exception_handler(NotImplementedError)
    async def _not_implemented(request: Request, exc: NotImplementedError) -> JSONResponse:
        return error_response(501, "NOT_IMPLEMENTED", "This endpoint is not implemented yet")

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Runs in ServerErrorMiddleware (outside RequestContextMiddleware): re-attach the id.
        rid = _request_id(request)
        logger.exception(
            "Unhandled error on %s %s",
            request.method,
            request.url.path,
            exc_info=exc,
            extra={"request_id": rid or "-"},
        )
        return error_response(
            500,
            ErrorCode.INTERNAL_ERROR,
            "An unexpected error occurred",
            {"request_id": rid} if rid else None,
            headers={REQUEST_ID_HEADER: rid} if rid else None,
        )
